// Package dashboardspa serves the embedded Gas City dashboard single-page app.
//
// The compiled Vite bundle lives under dist/ and is embedded into the gc
// binary. NewStaticHandler returns an http.Handler that the supervisor mounts
// as its "/" catch-all, so the SPA, the typed /v0 API, and the host-side /api
// plane are all served same-origin from one listener.
package dashboardspa

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// reservedPrefixes are request paths the SPA handler must never answer with
// index.html. They belong to sibling handlers (the typed /v0 API, health, the
// host-side /api plane, the OpenAPI document, pprof). Because the SPA is the
// "/" catch-all, a request that reaches this handler under one of these
// prefixes means the sibling handler did not match it, so returning 404 makes
// stale callers fail visibly instead of silently receiving the SPA shell.
var reservedPrefixes = []string{
	"/v0/",
	"/api/",
	"/health",
	"/openapi.json",
	"/debug/",
}

// NewStaticHandler returns the embedded-SPA handler. It serves hashed assets
// with long-lived caching, serves index.html (no-store) for the app shell and
// for any unknown client-side route, 404s the reserved non-SPA prefixes, and
// applies a strict same-origin Content-Security-Policy whose script-src is
// pinned to the sha256 of each inline <script> found in index.html. It is
// NewStaticHandlerWithDir("").
func NewStaticHandler() (http.Handler, error) {
	return NewStaticHandlerWithDir("")
}

// UIHeader names the response header that tells which interface answered:
// "dir <sha40>", "embedded", or "embedded; fallback=<reason>".
const UIHeader = "X-GC-Dashboard-UI"

// NewStaticHandlerWithDir is NewStaticHandler with an optional dashboard_dir
// (fork patch). For every non-reserved request it resolves the source from
// dir (see dir.go) and serves the version folder named by <dir>/current, or
// the embedded bundle when dir is empty or any check fails. The only error is
// an unreadable embedded bundle: no state of dir is ever an error.
//
// Paths: "" and index.html get the source index (no-store); assets/<f> come
// from the source, then the embedded bundle (immutable), and a miss is a 404,
// never the index; other files come from the source only (no-cache), with a
// missing sw.js or manifest.webmanifest a 404; any other path gets the source
// index. Every response carries UIHeader and the source index's CSP.
func NewStaticHandlerWithDir(dir string) (http.Handler, error) {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return nil, fmt.Errorf("dashboardspa: sub fs: %w", err)
	}
	indexBytes, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		return nil, fmt.Errorf("dashboardspa: read index.html: %w", err)
	}
	csp := buildCSP(indexBytes)
	fileServer := http.FileServer(http.FS(sub))
	if dir != "" && !filepath.IsAbs(dir) {
		log.Printf("dashboard: dashboard_dir %q is not an absolute path; serving embedded (fallback: %s)", dir, reasonRootMissing)
	}
	var srcLog sourceLog

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		for _, p := range reservedPrefixes {
			if strings.HasPrefix(r.URL.Path, p) {
				http.NotFound(w, r)
				return
			}
		}
		src, reason := resolveSource(dir, defaultOwner)
		defer src.Close()
		label, index, pageCSP := "embedded", indexBytes, csp
		switch {
		case src != nil:
			label, index, pageCSP = "dir "+src.name, src.index, src.csp
		case reason != "":
			label = "embedded; fallback=" + reason
		}
		if dir != "" {
			srcLog.note(src, reason)
		}
		setSecurityHeaders(w, pageCSP)
		w.Header().Set(UIHeader, label)

		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" || path == "index.html" {
			writeIndex(w, index)
			return
		}
		if strings.HasPrefix(path, "assets/") {
			// Vite emits content-hashed assets under assets/; they are safe to
			// cache forever. Source first, then embedded (an old tab's chunk
			// after a switch); a miss is a 404 so no cache ever stores HTML
			// under an asset URL.
			const immutable = "public, max-age=31536000, immutable"
			if src != nil && serveDirFile(w, r, src.root, path, immutable) {
				return
			}
			if st, statErr := fs.Stat(sub, path); statErr == nil && !st.IsDir() {
				w.Header().Set("Cache-Control", immutable)
				fileServer.ServeHTTP(w, r)
				return
			}
			http.NotFound(w, r)
			return
		}
		if src != nil {
			if serveDirFile(w, r, src.root, path, "no-cache") {
				return
			}
		} else if st, statErr := fs.Stat(sub, path); statErr == nil && !st.IsDir() {
			// Everything else (favicons, manifest, sw.js) revalidates.
			w.Header().Set("Cache-Control", "no-cache")
			setManifestType(w, path)
			fileServer.ServeHTTP(w, r)
			return
		}
		if path == "sw.js" || path == "manifest.webmanifest" {
			// Never hand HTML back as the service worker or the manifest.
			http.NotFound(w, r)
			return
		}
		// Unknown path under the SPA: hand back the shell so the client-side
		// router can render it (or its own not-found view).
		writeIndex(w, index)
	})
	return mux, nil
}

// serveDirFile serves path from a version folder if it passes openServed.
func serveDirFile(w http.ResponseWriter, r *http.Request, vroot *os.Root, path, cacheControl string) bool {
	f, fi, ok := openServed(vroot, path, defaultOwner)
	if !ok {
		return false
	}
	defer f.Close() //nolint:errcheck // read-only
	w.Header().Set("Cache-Control", cacheControl)
	setManifestType(w, path)
	http.ServeContent(w, r, fi.Name(), fi.ModTime(), f)
	return true
}

// setManifestType types the PWA manifest (owner 16.11): Go's mime table has
// no .webmanifest entry, and nosniff would leave it untyped.
func setManifestType(w http.ResponseWriter, path string) {
	if strings.HasSuffix(path, ".webmanifest") {
		w.Header().Set("Content-Type", "application/manifest+json")
	}
}

// sourceLog logs a change of the resolved source once.
type sourceLog struct {
	mu   sync.Mutex
	last string
}

func (l *sourceLog) note(src *uiSource, reason string) {
	var line string
	switch {
	case src != nil:
		line = "dashboard: serving dir " + src.name[:9]
	case reason != "":
		line = "dashboard: embedded (fallback: " + reason + ")"
	default:
		line = "dashboard: embedded"
	}
	l.mu.Lock()
	changed := line != l.last
	l.last = line
	l.mu.Unlock()
	if changed {
		log.Print(line)
	}
}

func writeIndex(w http.ResponseWriter, index []byte) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(index)
}

func setSecurityHeaders(w http.ResponseWriter, csp string) {
	h := w.Header()
	h.Set("Content-Security-Policy", csp)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "same-origin")
}

var (
	inlineScriptRE = regexp.MustCompile(`(?is)<script((?:\s[^>]*)?)>(.*?)</script>`)
	srcAttrRE      = regexp.MustCompile(`(?i)\ssrc\s*=`)
)

// buildCSP computes a same-origin Content-Security-Policy. Each inline
// <script> (one without a src attribute) in index.html is hashed (sha256,
// base64) and pinned in script-src, so the strict policy admits exactly the
// bundle's own inline boot script and nothing else; external module scripts
// are governed by 'self'. The hash is read from the embedded index.html at
// boot rather than hardcoded, so it always tracks the shipped bundle.
func buildCSP(index []byte) string {
	var hashes []string
	for _, m := range inlineScriptRE.FindAllSubmatch(index, -1) {
		attrs, body := m[1], m[2]
		if srcAttrRE.Match(attrs) {
			continue
		}
		sum := sha256.Sum256(body)
		hashes = append(hashes, "'sha256-"+base64.StdEncoding.EncodeToString(sum[:])+"'")
	}
	scriptSrc := "script-src 'self'"
	if len(hashes) > 0 {
		scriptSrc += " " + strings.Join(hashes, " ")
	}
	return strings.Join([]string{
		"default-src 'self'",
		scriptSrc,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self' data:",
		"connect-src 'self'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
		"frame-src 'none'",
		"worker-src 'self'",
		"manifest-src 'self'",
		"object-src 'none'",
	}, "; ")
}
