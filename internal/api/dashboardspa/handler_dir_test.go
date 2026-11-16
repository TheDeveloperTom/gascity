package dashboardspa

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const uiHeader = UIHeader

func newDirHandler(t *testing.T, dir string) http.Handler {
	t.Helper()
	h, err := NewStaticHandlerWithDir(dir)
	if err != nil {
		t.Fatalf("NewStaticHandlerWithDir(%q): %v", dir, err)
	}
	return h
}

func do(t *testing.T, h http.Handler, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func embeddedIndex(t *testing.T) []byte {
	t.Helper()
	b, err := fs.ReadFile(distFS, "dist/index.html")
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func firstEmbeddedAsset(t *testing.T) string {
	t.Helper()
	entries, err := fs.ReadDir(distFS, "dist/assets")
	if err != nil || len(entries) == 0 {
		t.Skip("no assets in embedded bundle")
	}
	return "/assets/" + entries[0].Name()
}

// validRoot is a root whose current names a complete version testSHA.
func validRoot(t *testing.T, index string) string {
	t.Helper()
	root := newUIRoot(t)
	addVersion(t, root, testSHA, index)
	setCurrent(t, root, testSHA+"\n")
	return root
}

func TestNoDirServesEmbedded(t *testing.T) {
	rec := do(t, newDirHandler(t, ""), http.MethodGet, "/")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get(uiHeader); got != "embedded" {
		t.Errorf("%s = %q, want embedded", uiHeader, got)
	}
	if rec.Body.String() != string(embeddedIndex(t)) {
		t.Error("body is not the embedded index")
	}
	// NewStaticHandler is NewStaticHandlerWithDir("").
	rec = do(t, newHandler(t), http.MethodGet, "/")
	if got := rec.Header().Get(uiHeader); got != "embedded" {
		t.Errorf("NewStaticHandler: %s = %q, want embedded", uiHeader, got)
	}
}

func TestDirServesIndexAndHeader(t *testing.T) {
	idx := indexWithScript("dir()")
	h := newDirHandler(t, validRoot(t, idx))
	for _, p := range []string{"/", "/index.html", "/city/x/agents"} {
		rec := do(t, h, http.MethodGet, p)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s: status = %d", p, rec.Code)
		}
		if got := rec.Header().Get(uiHeader); got != "dir "+testSHA {
			t.Errorf("GET %s: %s = %q, want dir %s", p, uiHeader, got, testSHA)
		}
		if rec.Body.String() != idx {
			t.Errorf("GET %s: body is not the dir index: %q", p, rec.Body.String())
		}
		if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
			t.Errorf("GET %s: Cache-Control = %q, want no-store", p, cc)
		}
		if csp := rec.Header().Get("Content-Security-Policy"); csp != buildCSP([]byte(idx)) {
			t.Errorf("GET %s: CSP is not the dir index's CSP", p)
		}
	}
}

func TestSwitchChangesIndexAndCSP(t *testing.T) {
	root := newUIRoot(t)
	idx1, idx2 := indexWithScript("first()"), indexWithScript("second()")
	addVersion(t, root, testSHA, idx1)
	addVersion(t, root, testSHA2, idx2)
	setCurrent(t, root, testSHA+"\n")
	h := newDirHandler(t, root)
	rec := do(t, h, http.MethodGet, "/")
	csp1 := rec.Header().Get("Content-Security-Policy")
	if rec.Body.String() != idx1 {
		t.Fatal("first: wrong index")
	}
	setCurrent(t, root, testSHA2+"\n")
	rec = do(t, h, http.MethodGet, "/")
	if rec.Body.String() != idx2 {
		t.Fatal("after switch: wrong index")
	}
	if got := rec.Header().Get(uiHeader); got != "dir "+testSHA2 {
		t.Errorf("after switch: header = %q", got)
	}
	csp2 := rec.Header().Get("Content-Security-Policy")
	hash := func(csp string) string {
		for _, f := range strings.Fields(csp) {
			if strings.HasPrefix(f, "'sha256-") {
				return strings.TrimSuffix(f, ";")
			}
		}
		return ""
	}
	h1, h2 := hash(csp1), hash(csp2)
	if h1 == "" || h2 == "" || h1 == h2 {
		t.Fatalf("hashes: %q / %q", h1, h2)
	}
	if !strings.Contains(csp2, h2) || strings.Contains(csp2, h1) {
		t.Errorf("CSP after switch must carry the new hash and not the old: %q", csp2)
	}
}

func TestIndexRemovedThenRestored(t *testing.T) {
	idx := indexWithScript("x()")
	root := validRoot(t, idx)
	h := newDirHandler(t, root)
	p := filepath.Join(root, "versions", testSHA, "index.html")
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	rec := do(t, h, http.MethodGet, "/")
	if got := rec.Header().Get(uiHeader); got != "embedded; fallback=no-index" {
		t.Errorf("removed: header = %q", got)
	}
	if rec.Body.String() != string(embeddedIndex(t)) {
		t.Error("removed: body is not the embedded index")
	}
	mustWrite(t, p, idx)
	rec = do(t, h, http.MethodGet, "/")
	if got := rec.Header().Get(uiHeader); got != "dir "+testSHA || rec.Body.String() != idx {
		t.Errorf("restored: header = %q, body dir index = %v", got, rec.Body.String() == idx)
	}
}

func TestUnknownAssetIs404(t *testing.T) {
	for _, tc := range []struct{ name, dir, header string }{
		{"embedded", "", "embedded"},
		{"dir", validRoot(t, indexWithScript("a")), "dir " + testSHA},
	} {
		h := newDirHandler(t, tc.dir)
		for _, m := range []string{http.MethodGet, http.MethodHead} {
			rec := do(t, h, m, "/assets/does-not-exist-123.js")
			if rec.Code != http.StatusNotFound {
				t.Errorf("%s %s: status = %d, want 404", tc.name, m, rec.Code)
			}
			if strings.Contains(rec.Body.String(), `id="root"`) {
				t.Errorf("%s %s: unknown asset answered with the index", tc.name, m)
			}
			if got := rec.Header().Get(uiHeader); got != tc.header {
				t.Errorf("%s %s: header = %q, want %q", tc.name, m, got, tc.header)
			}
		}
	}
}

func TestDirAssetServedImmutable(t *testing.T) {
	h := newDirHandler(t, validRoot(t, indexWithScript("a")))
	rec := do(t, h, http.MethodGet, "/assets/app-"+testSHA[:8]+".js")
	if rec.Code != http.StatusOK || rec.Body.String() != "console.log('"+testSHA+"')" {
		t.Fatalf("status = %d body = %q", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Errorf("Cache-Control = %q", cc)
	}
}

func TestEmbeddedAssetServedWhenDirLacksIt(t *testing.T) {
	asset := firstEmbeddedAsset(t)
	h := newDirHandler(t, validRoot(t, indexWithScript("a")))
	rec := do(t, h, http.MethodGet, asset)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s: status = %d", asset, rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", cc)
	}
	if got := rec.Header().Get(uiHeader); got != "dir "+testSHA {
		t.Errorf("header = %q, want dir %s (the resolved source)", got, testSHA)
	}
}

func TestMissingSwJsIs404(t *testing.T) {
	root := validRoot(t, indexWithScript("a"))
	v := filepath.Join(root, "versions", testSHA)
	for _, f := range []string{"sw.js", "manifest.webmanifest"} {
		if err := os.Remove(filepath.Join(v, f)); err != nil {
			t.Fatal(err)
		}
	}
	h := newDirHandler(t, root)
	for _, p := range []string{"/sw.js", "/manifest.webmanifest"} {
		rec := do(t, h, http.MethodGet, p)
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s: status = %d, want 404", p, rec.Code)
		}
		if strings.Contains(rec.Body.String(), "<html") {
			t.Errorf("GET %s: answered with HTML", p)
		}
	}
}

func TestDirOtherFilesFromSourceOnly(t *testing.T) {
	h := newDirHandler(t, validRoot(t, indexWithScript("a")))
	rec := do(t, h, http.MethodGet, "/sw.js")
	if rec.Code != http.StatusOK || rec.Body.String() != "// sw "+testSHA {
		t.Fatalf("sw.js: %d %q", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("sw.js Cache-Control = %q", cc)
	}
	rec = do(t, h, http.MethodGet, "/manifest.webmanifest")
	if ct := rec.Header().Get("Content-Type"); ct != "application/manifest+json" {
		t.Errorf("manifest Content-Type = %q", ct)
	}
}

func TestHeadersBothSources(t *testing.T) {
	for _, tc := range []struct{ name, dir string }{
		{"embedded", ""},
		{"dir", validRoot(t, indexWithScript("a"))},
	} {
		h := newDirHandler(t, tc.dir)
		for _, m := range []string{http.MethodGet, http.MethodHead} {
			for _, p := range []string{"/", "/sw.js", "/assets/nope.js", "/some/route"} {
				rec := do(t, h, m, p)
				hd := rec.Header()
				if hd.Get("X-Content-Type-Options") != "nosniff" || hd.Get("X-Frame-Options") != "DENY" ||
					hd.Get("Referrer-Policy") != "same-origin" || hd.Get("Content-Security-Policy") == "" ||
					hd.Get(uiHeader) == "" {
					t.Errorf("%s %s %s: missing security headers: %v", tc.name, m, p, hd)
				}
			}
		}
	}
}

func TestFallbackHeaderNamesReason(t *testing.T) {
	root := validRoot(t, indexWithScript("a"))
	if err := os.Remove(filepath.Join(root, "versions", testSHA, markerFile)); err != nil {
		t.Fatal(err)
	}
	rec := do(t, newDirHandler(t, root), http.MethodGet, "/")
	if got := rec.Header().Get(uiHeader); got != "embedded; fallback=incomplete" {
		t.Errorf("header = %q, want embedded; fallback=incomplete", got)
	}
	if rec.Body.String() != string(embeddedIndex(t)) {
		t.Error("fallback body is not the embedded index")
	}
	setCurrent(t, root, "embedded\n")
	rec = do(t, newDirHandler(t, root), http.MethodGet, "/")
	if got := rec.Header().Get(uiHeader); got != "embedded" {
		t.Errorf("current=embedded: header = %q, want embedded", got)
	}
}

func TestReservedPrefixesUnchanged(t *testing.T) {
	h := newDirHandler(t, validRoot(t, indexWithScript("a")))
	for _, p := range []string{"/v0/cities", "/api/city/x/config", "/health", "/openapi.json", "/debug/pprof/"} {
		rec := do(t, h, http.MethodGet, p)
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s: status = %d, want 404", p, rec.Code)
		}
		if len(rec.Header().Values(uiHeader)) > 0 {
			t.Errorf("GET %s: carries %s", p, uiHeader)
		}
		if rec.Header().Get("Content-Security-Policy") != "" {
			t.Errorf("GET %s: carries a CSP (not byte-identical to today)", p)
		}
	}
}

func TestWritableServedFileIsMissing(t *testing.T) {
	root := validRoot(t, indexWithScript("a"))
	v := filepath.Join(root, "versions", testSHA)
	asset := "assets/app-" + testSHA[:8] + ".js"
	if err := os.Chmod(filepath.Join(v, asset), 0o666); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Join(v, "sw.js"), 0o646); err != nil {
		t.Fatal(err)
	}
	h := newDirHandler(t, root)
	if rec := do(t, h, http.MethodGet, "/"+asset); rec.Code != http.StatusNotFound {
		t.Errorf("writable asset: status = %d, want 404", rec.Code)
	}
	if rec := do(t, h, http.MethodGet, "/sw.js"); rec.Code != http.StatusNotFound {
		t.Errorf("writable sw.js: status = %d, want 404", rec.Code)
	}
	// A writable intermediate directory hides everything under it.
	if err := os.Chmod(filepath.Join(v, asset), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Join(v, "assets"), 0o777); err != nil {
		t.Fatal(err)
	}
	if rec := do(t, h, http.MethodGet, "/"+asset); rec.Code != http.StatusNotFound {
		t.Errorf("asset under writable dir: status = %d, want 404", rec.Code)
	}
	// A symlinked served file counts as missing, even inside the folder.
	if err := os.Chmod(filepath.Join(v, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("app-"+testSHA[:8]+".js", filepath.Join(v, "assets", "link.js")); err != nil {
		t.Fatal(err)
	}
	if rec := do(t, h, http.MethodGet, "/assets/link.js"); rec.Code != http.StatusNotFound {
		t.Errorf("symlinked asset: status = %d, want 404", rec.Code)
	}
}

func TestBadDirNeverErrors(t *testing.T) {
	states := map[string]func(t *testing.T) string{
		"relative":    func(*testing.T) string { return "rel/path" },
		"missing":     func(t *testing.T) string { return filepath.Join(t.TempDir(), "nope") },
		"a-file":      func(t *testing.T) string { p := filepath.Join(t.TempDir(), "f"); mustWrite(t, p, "x"); return p },
		"no-versions": func(t *testing.T) string { return t.TempDir() },
		"perms": func(t *testing.T) string {
			r := newUIRoot(t)
			_ = os.Chmod(r, 0o777)
			return r
		},
		"no-current":  newUIRoot,
		"bad-current": func(t *testing.T) string { r := newUIRoot(t); setCurrent(t, r, "zz"); return r },
		"version-missing": func(t *testing.T) string {
			r := newUIRoot(t)
			setCurrent(t, r, testSHA)
			return r
		},
		"version-perms": func(t *testing.T) string {
			r := validRoot(t, "i")
			_ = os.Chmod(filepath.Join(r, "versions", testSHA), 0o777)
			return r
		},
		"no-index": func(t *testing.T) string {
			r := validRoot(t, "i")
			_ = os.Remove(filepath.Join(r, "versions", testSHA, "index.html"))
			return r
		},
		"incomplete": func(t *testing.T) string {
			r := validRoot(t, "i")
			_ = os.Remove(filepath.Join(r, "versions", testSHA, markerFile))
			return r
		},
	}
	for name, mk := range states {
		t.Run(name, func(t *testing.T) {
			dir := mk(t)
			h, err := NewStaticHandlerWithDir(dir)
			if err != nil || h == nil {
				t.Fatalf("NewStaticHandlerWithDir(%q) = (%v, %v), want a handler and nil error", dir, h, err)
			}
			rec := do(t, h, http.MethodGet, "/")
			if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get(uiHeader), "embedded; fallback=") {
				t.Errorf("GET /: %d %q, want 200 and an embedded fallback", rec.Code, rec.Header().Get(uiHeader))
			}
		})
	}
}
