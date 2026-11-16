package dashboardspa

// Fork patch (dashboard_dir): serve the dashboard from a folder on disk,
// chosen per request, and fall back to the embedded bundle on any doubt.
//
// Layout (owned by the city script; the engine never writes under it):
//
//	<root>/current              "embedded" or a 40-hex version name, plus "\n"
//	<root>/versions/<sha40>/    one extracted dist/ tree
//	  index.html                required, regular, 1 B - 1 MiB
//	  gc-ui-release.json        required, regular; written last, never parsed
//
// Every directory on the way and every served file must be owned by this
// process's uid and not group- or world-writable; a symlink anywhere counts
// as missing. No state of the folder is ever an error: it only selects the
// embedded bundle with a fallback reason.

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Fallback reasons (PLAN §1 C10). The empty reason means no fallback.
const (
	reasonRootMissing    = "root-missing"
	reasonRootPerms      = "root-perms"
	reasonNoCurrent      = "no-current"
	reasonBadCurrent     = "bad-current"
	reasonVersionMissing = "version-missing"
	reasonVersionPerms   = "version-perms"
	reasonNoIndex        = "no-index"
	reasonIncomplete     = "incomplete"
)

const (
	currentFile     = "current"
	versionsDir     = "versions"
	markerFile      = "gc-ui-release.json"
	maxCurrentBytes = 64
	maxIndexBytes   = 1 << 20
)

var currentRE = regexp.MustCompile(`^(embedded|[0-9a-f]{40})$`)

// uiSource is a resolved dir source: the version folder (as an os.Root, so no
// path can escape it), its index bytes and that index's CSP. A nil *uiSource
// means the embedded bundle.
type uiSource struct {
	name  string
	root  *os.Root
	index []byte
	csp   string
}

// Close releases the version folder handle. Safe on nil.
func (s *uiSource) Close() {
	if s != nil && s.root != nil {
		_ = s.root.Close()
	}
}

// defaultOwner is the C11 check: owned by this process's uid and not group-
// or world-writable.
var defaultOwner = func(fi fs.FileInfo) bool {
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return false
	}
	return int(st.Uid) == os.Getuid() && fi.Mode().Perm()&0o022 == 0
}

// resolveSource selects the source for one request (C10). It never returns an
// error: any failure is the embedded bundle (nil) with a reason.
func resolveSource(dir string, owner func(fs.FileInfo) bool) (*uiSource, string) {
	if dir == "" {
		return nil, ""
	}
	if !filepath.IsAbs(dir) {
		return nil, reasonRootMissing
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, reasonRootMissing
	}
	defer root.Close() //nolint:errcheck // read-only handle

	// <root> and <root>/versions (C11). Nothing else is read unless both pass.
	fi, err := root.Stat(".")
	if err != nil || !fi.IsDir() {
		return nil, reasonRootMissing
	}
	if !owner(fi) {
		return nil, reasonRootPerms
	}
	fi, err = root.Lstat(versionsDir)
	if err != nil || !fi.Mode().IsDir() {
		return nil, reasonRootMissing
	}
	if !owner(fi) {
		return nil, reasonRootPerms
	}

	name, reason := readCurrent(root)
	if reason != "" {
		return nil, reason
	}
	if name == "embedded" {
		return nil, ""
	}

	vpath := versionsDir + "/" + name
	fi, err = root.Lstat(vpath)
	if err != nil || !fi.Mode().IsDir() {
		return nil, reasonVersionMissing
	}
	if !owner(fi) {
		return nil, reasonVersionPerms
	}
	vroot, err := root.OpenRoot(vpath)
	if err != nil {
		return nil, reasonVersionMissing
	}
	// Re-check through the opened handle: the folder we hold is the one checked.
	if fi, err = vroot.Stat("."); err != nil || !fi.IsDir() || !owner(fi) {
		_ = vroot.Close()
		return nil, reasonVersionPerms
	}

	if fi, err = vroot.Lstat(markerFile); err != nil || !fi.Mode().IsRegular() {
		_ = vroot.Close()
		return nil, reasonIncomplete
	}
	index, csp, ok := loadIndex(dir, name, vroot, owner)
	if !ok {
		_ = vroot.Close()
		return nil, reasonNoIndex
	}
	return &uiSource{name: name, root: vroot, index: index, csp: csp}, ""
}

// readCurrent reads <root>/current per C3.
func readCurrent(root *os.Root) (string, string) {
	fi, err := root.Lstat(currentFile)
	if errors.Is(err, fs.ErrNotExist) {
		return "", reasonNoCurrent
	}
	if err != nil || !fi.Mode().IsRegular() {
		return "", reasonBadCurrent
	}
	f, err := root.Open(currentFile)
	if err != nil {
		return "", reasonBadCurrent
	}
	defer f.Close() //nolint:errcheck // read-only
	fi, err = f.Stat()
	if err != nil || !fi.Mode().IsRegular() || fi.Size() < 1 || fi.Size() > maxCurrentBytes {
		return "", reasonBadCurrent
	}
	buf, err := io.ReadAll(io.LimitReader(f, maxCurrentBytes+1))
	if err != nil || len(buf) > maxCurrentBytes {
		return "", reasonBadCurrent
	}
	name := strings.Trim(string(buf), " \t\r\n")
	if !currentRE.MatchString(name) {
		return "", reasonBadCurrent
	}
	return name, ""
}

// indexKey identifies one index.html on disk (C10 cache key).
type indexKey struct {
	dir   string
	sha   string
	size  int64
	mtime time.Time
	ino   uint64
}

type indexEntry struct {
	index []byte
	csp   string
}

// indexCache holds the index bytes and CSP of recently served versions, so an
// asset request costs an Lstat, not a 1 MiB read and a sha256 per response.
var indexCache = struct {
	sync.Mutex
	m map[indexKey]indexEntry
}{m: map[indexKey]indexEntry{}}

const indexCacheMax = 16

func inodeOf(fi fs.FileInfo) uint64 {
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		return uint64(st.Ino) //nolint:unconvert // uint64 on darwin and linux
	}
	return 0
}

// loadIndex returns the version's index bytes and CSP, from the cache when the
// file's (size, mtime, inode) are unchanged. index.html must be a regular file
// of 1 B - 1 MiB that passes the owner check.
func loadIndex(dir, sha string, vroot *os.Root, owner func(fs.FileInfo) bool) ([]byte, string, bool) {
	fi, err := vroot.Lstat("index.html")
	if err != nil || !fi.Mode().IsRegular() || fi.Size() < 1 || fi.Size() > maxIndexBytes || !owner(fi) {
		return nil, "", false
	}
	key := indexKey{dir: dir, sha: sha, size: fi.Size(), mtime: fi.ModTime(), ino: inodeOf(fi)}
	indexCache.Lock()
	e, hit := indexCache.m[key]
	indexCache.Unlock()
	if hit {
		return e.index, e.csp, true
	}
	f, err := vroot.Open("index.html")
	if err != nil {
		return nil, "", false
	}
	defer f.Close() //nolint:errcheck // read-only
	ofi, err := f.Stat()
	if err != nil || !os.SameFile(fi, ofi) {
		return nil, "", false
	}
	buf, err := io.ReadAll(io.LimitReader(f, maxIndexBytes+1))
	if err != nil || int64(len(buf)) != fi.Size() {
		return nil, "", false
	}
	e = indexEntry{index: buf, csp: buildCSP(buf)}
	indexCache.Lock()
	if len(indexCache.m) >= indexCacheMax {
		indexCache.m = map[indexKey]indexEntry{}
	}
	indexCache.m[key] = e
	indexCache.Unlock()
	return e.index, e.csp, true
}

// openServed opens a file of the version folder for serving (C11): the path
// must be a valid relative path, every directory on the way must be a real
// directory (not a symlink) that passes the owner check, and the file itself
// must be a regular file that passes it. Anything else counts as missing.
func openServed(vroot *os.Root, path string, owner func(fs.FileInfo) bool) (*os.File, fs.FileInfo, bool) {
	if path == "" || !fs.ValidPath(path) {
		return nil, nil, false
	}
	parts := strings.Split(path, "/")
	for i := 1; i < len(parts); i++ {
		fi, err := vroot.Lstat(strings.Join(parts[:i], "/"))
		if err != nil || !fi.Mode().IsDir() || !owner(fi) {
			return nil, nil, false
		}
	}
	fi, err := vroot.Lstat(path)
	if err != nil || !fi.Mode().IsRegular() || !owner(fi) {
		return nil, nil, false
	}
	f, err := vroot.Open(path)
	if err != nil {
		return nil, nil, false
	}
	ofi, err := f.Stat()
	if err != nil || !os.SameFile(fi, ofi) {
		_ = f.Close()
		return nil, nil, false
	}
	return f, ofi, true
}
