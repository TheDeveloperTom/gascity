package dashboardspa

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

const (
	testSHA  = "0123456789abcdef0123456789abcdef01234567"
	testSHA2 = "89abcdef0123456789abcdef0123456789abcdef"
)

func indexWithScript(body string) string {
	return `<!doctype html><html><head><script>` + body + `</script>` +
		`<script type="module" src="/assets/app.js"></script></head>` +
		`<body><div id="root"></div></body></html>`
}

// mustWrite writes a 0644 file (umask-independent).
func mustWrite(t *testing.T, path, content string) {
	const mode os.FileMode = 0o644
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
}

// newUIRoot builds <tmp>/dashboard-ui with versions/ (C2 layout) and returns it.
func newUIRoot(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "dashboard-ui")
	if err := os.MkdirAll(filepath.Join(root, "versions"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{root, filepath.Join(root, "versions")} {
		if err := os.Chmod(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// addVersion writes a complete version folder: index, marker, sw.js, manifest
// and one asset.
func addVersion(t *testing.T, root, sha, index string) string {
	t.Helper()
	v := filepath.Join(root, "versions", sha)
	mustWrite(t, filepath.Join(v, "index.html"), index)
	mustWrite(t, filepath.Join(v, "gc-ui-release.json"), `{"ui_sha":"`+sha+`"}`)
	mustWrite(t, filepath.Join(v, "sw.js"), "// sw "+sha)
	mustWrite(t, filepath.Join(v, "manifest.webmanifest"), `{"display": "standalone"}`)
	mustWrite(t, filepath.Join(v, "assets", "app-"+sha[:8]+".js"), "console.log('"+sha+"')")
	for _, d := range []string{v, filepath.Join(v, "assets")} {
		if err := os.Chmod(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return v
}

func setCurrent(t *testing.T, root, content string) {
	t.Helper()
	tmp := filepath.Join(root, "current.tmp")
	mustWrite(t, tmp, content)
	if err := os.Rename(tmp, filepath.Join(root, "current")); err != nil {
		t.Fatal(err)
	}
}

func resolveT(t *testing.T, dir string) (*uiSource, string) {
	t.Helper()
	src, reason := resolveSource(dir, defaultOwner)
	if src != nil {
		t.Cleanup(src.Close)
	}
	return src, reason
}

func TestResolveSource(t *testing.T) {
	type tc struct {
		name   string
		setup  func(t *testing.T) string
		reason string
		dir    bool // a dir source is expected
	}
	valid := func(t *testing.T) string {
		root := newUIRoot(t)
		addVersion(t, root, testSHA, indexWithScript("a"))
		setCurrent(t, root, testSHA+"\n")
		return root
	}
	cases := []tc{
		{"unset", func(*testing.T) string { return "" }, "", false},
		{"relative", func(*testing.T) string { return "rel/dashboard-ui" }, "root-missing", false},
		{"root-missing", func(t *testing.T) string { return filepath.Join(t.TempDir(), "nope") }, "root-missing", false},
		{"versions-missing", func(t *testing.T) string {
			root := filepath.Join(t.TempDir(), "dashboard-ui")
			if err := os.Mkdir(root, 0o755); err != nil {
				t.Fatal(err)
			}
			return root
		}, "root-missing", false},
		{"root-perms", func(t *testing.T) string {
			root := valid(t)
			if err := os.Chmod(root, 0o777); err != nil {
				t.Fatal(err)
			}
			return root
		}, "root-perms", false},
		{"versions-perms", func(t *testing.T) string {
			root := valid(t)
			if err := os.Chmod(filepath.Join(root, "versions"), 0o775); err != nil {
				t.Fatal(err)
			}
			return root
		}, "root-perms", false},
		{"no-current", newUIRoot, "no-current", false},
		{"current-embedded", func(t *testing.T) string {
			root := newUIRoot(t)
			setCurrent(t, root, "embedded\n")
			return root
		}, "", false},
		{"bad-current-traversal", func(t *testing.T) string {
			root := newUIRoot(t)
			setCurrent(t, root, "../etc\n")
			return root
		}, "bad-current", false},
		{"bad-current-100-bytes", func(t *testing.T) string {
			root := newUIRoot(t)
			setCurrent(t, root, strings.Repeat("a", 100))
			return root
		}, "bad-current", false},
		{"bad-current-upper", func(t *testing.T) string {
			root := newUIRoot(t)
			setCurrent(t, root, "ABC")
			return root
		}, "bad-current", false},
		{"bad-current-empty", func(t *testing.T) string {
			root := newUIRoot(t)
			setCurrent(t, root, "")
			return root
		}, "bad-current", false},
		{"version-missing", func(t *testing.T) string {
			root := newUIRoot(t)
			setCurrent(t, root, testSHA+"\n")
			return root
		}, "version-missing", false},
		{"version-perms", func(t *testing.T) string {
			root := valid(t)
			if err := os.Chmod(filepath.Join(root, "versions", testSHA), 0o777); err != nil {
				t.Fatal(err)
			}
			return root
		}, "version-perms", false},
		{"no-index", func(t *testing.T) string {
			root := valid(t)
			if err := os.Remove(filepath.Join(root, "versions", testSHA, "index.html")); err != nil {
				t.Fatal(err)
			}
			return root
		}, "no-index", false},
		{"no-index-empty", func(t *testing.T) string {
			root := valid(t)
			mustWrite(t, filepath.Join(root, "versions", testSHA, "index.html"), "")
			return root
		}, "no-index", false},
		{"no-index-too-big", func(t *testing.T) string {
			root := valid(t)
			mustWrite(t, filepath.Join(root, "versions", testSHA, "index.html"), strings.Repeat("x", 1<<20+1))
			return root
		}, "no-index", false},
		{"incomplete", func(t *testing.T) string {
			root := valid(t)
			if err := os.Remove(filepath.Join(root, "versions", testSHA, "gc-ui-release.json")); err != nil {
				t.Fatal(err)
			}
			return root
		}, "incomplete", false},
		{"valid", valid, "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dir := c.setup(t)
			src, reason := resolveT(t, dir)
			if reason != c.reason {
				t.Errorf("reason = %q, want %q", reason, c.reason)
			}
			if c.dir != (src != nil) {
				t.Fatalf("src = %v, want dir source %v", src, c.dir)
			}
			if c.dir {
				if src.name != testSHA {
					t.Errorf("src.name = %q, want %q", src.name, testSHA)
				}
				want, err := os.ReadFile(filepath.Join(dir, "versions", testSHA, "index.html"))
				if err != nil {
					t.Fatal(err)
				}
				if string(src.index) != string(want) {
					t.Errorf("src.index = %q, want the file's bytes", src.index)
				}
				if src.csp != buildCSP(want) {
					t.Errorf("src.csp is not the CSP of the version's index")
				}
			}
		})
	}
}

func TestCurrentWhitespaceTrimmed(t *testing.T) {
	root := newUIRoot(t)
	addVersion(t, root, testSHA, indexWithScript("a"))
	setCurrent(t, root, "\t"+testSHA+"\r\n ")
	src, reason := resolveT(t, root)
	if src == nil || reason != "" || src.name != testSHA {
		t.Fatalf("resolve = (%v, %q), want dir %s", src, reason, testSHA)
	}
}

func TestOwnerSeamRefuses(t *testing.T) {
	root := newUIRoot(t)
	addVersion(t, root, testSHA, indexWithScript("a"))
	setCurrent(t, root, testSHA+"\n")
	src, reason := resolveSource(root, func(fs.FileInfo) bool { return false })
	if src != nil || reason != "root-perms" {
		t.Fatalf("resolve with a refusing owner = (%v, %q), want (nil, root-perms)", src, reason)
	}
}

func TestSymlinkEscapeRefused(t *testing.T) {
	root := newUIRoot(t)
	v := addVersion(t, root, testSHA, indexWithScript("a"))
	if err := os.Remove(filepath.Join(v, "index.html")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/etc/hosts", filepath.Join(v, "index.html")); err != nil {
		t.Fatal(err)
	}
	setCurrent(t, root, testSHA+"\n")
	src, reason := resolveT(t, root)
	if src != nil || reason != "no-index" {
		t.Fatalf("resolve = (%v, %q), want (nil, no-index)", src, reason)
	}
}

func TestSymlinkVersionFolderIsMissing(t *testing.T) {
	root := newUIRoot(t)
	other := addVersion(t, newUIRoot(t), testSHA, indexWithScript("a"))
	if err := os.Symlink(other, filepath.Join(root, "versions", testSHA)); err != nil {
		t.Fatal(err)
	}
	setCurrent(t, root, testSHA+"\n")
	src, reason := resolveT(t, root)
	if src != nil || reason != "version-missing" {
		t.Fatalf("resolve = (%v, %q), want (nil, version-missing)", src, reason)
	}
}

func TestTmpAndTrashNamesIgnored(t *testing.T) {
	root := newUIRoot(t)
	for _, name := range []string{".tmp-x", ".trash-" + testSHA + "-1", ".tmp-" + testSHA + "-42"} {
		// A complete-looking folder under that name must still not count.
		mustWrite(t, filepath.Join(root, "versions", name, "index.html"), indexWithScript("a"))
		mustWrite(t, filepath.Join(root, "versions", name, "gc-ui-release.json"), "{}")
	}
	for _, name := range []string{".tmp-x", ".trash-" + testSHA + "-1", ".tmp-" + testSHA + "-42"} {
		setCurrent(t, root, name+"\n")
		src, reason := resolveT(t, root)
		if src != nil || reason != "bad-current" {
			t.Errorf("current=%q: resolve = (%v, %q), want (nil, bad-current)", name, src, reason)
		}
	}
}

func TestCSPCacheRevalidates(t *testing.T) {
	root := newUIRoot(t)
	v := addVersion(t, root, testSHA, indexWithScript("one()"))
	setCurrent(t, root, testSHA+"\n")
	src, _ := resolveT(t, root)
	if src == nil {
		t.Fatal("want a dir source")
	}
	oldCSP := src.csp
	// Same again: served from the cache, same CSP.
	src2, _ := resolveT(t, root)
	if src2 == nil || src2.csp != oldCSP {
		t.Fatal("second resolve changed the CSP with no file change")
	}
	// Replace index.html with a new inode (write + rename), as an extract would.
	tmp := filepath.Join(v, "index.html.new")
	mustWrite(t, tmp, indexWithScript("two()"))
	if err := os.Rename(tmp, filepath.Join(v, "index.html")); err != nil {
		t.Fatal(err)
	}
	src3, _ := resolveT(t, root)
	if src3 == nil {
		t.Fatal("want a dir source after rewrite")
	}
	if src3.csp == oldCSP {
		t.Fatal("CSP not revalidated after index.html was replaced")
	}
	if want := buildCSP([]byte(indexWithScript("two()"))); src3.csp != want {
		t.Fatalf("csp = %q, want the new index's CSP %q", src3.csp, want)
	}
}

// A pointer someone else can write could select any version that already
// passed every check (including one extracted for an older engine), so the
// pointer file itself must pass the owner check (C11).
func TestWritableCurrentRefused(t *testing.T) {
	for _, mode := range []os.FileMode{0o664, 0o646, 0o666} {
		root := newUIRoot(t)
		addVersion(t, root, testSHA, indexWithScript("a"))
		setCurrent(t, root, testSHA+"\n")
		if err := os.Chmod(filepath.Join(root, "current"), mode); err != nil {
			t.Fatal(err)
		}
		src, reason := resolveT(t, root)
		if src != nil || reason != "root-perms" {
			t.Errorf("current mode %o: resolve = (dir source %v, %q), want (nil, root-perms)", mode, src != nil, reason)
		}
	}
}

func TestOwnerSeamRefusesCurrentOnly(t *testing.T) {
	root := newUIRoot(t)
	addVersion(t, root, testSHA, indexWithScript("a"))
	setCurrent(t, root, testSHA+"\n")
	refuseCurrent := func(fi fs.FileInfo) bool { return fi.Name() != "current" && defaultOwner(fi) }
	src, reason := resolveSource(root, refuseCurrent)
	if src != nil || reason != "root-perms" {
		src.Close()
		t.Fatalf("resolve with an owner refusing only current = (dir source %v, %q), want (nil, root-perms)", src != nil, reason)
	}
}

// A FIFO swapped in between the Lstat and the Open must not hang the
// request: the open is non-blocking and the fstat type check rejects it.
func TestOpenReadOnlyFIFODoesNotBlock(t *testing.T) {
	dir := t.TempDir()
	fifo := filepath.Join(dir, "current")
	if err := syscall.Mkfifo(fifo, 0o644); err != nil {
		t.Fatal(err)
	}
	r, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close() //nolint:errcheck // test
	done := make(chan error, 1)
	go func() {
		f, err := openReadOnly(r, "current")
		if f != nil {
			_ = f.Close()
		}
		done <- err
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		// Unblock the stuck reader so the goroutine ends, then fail.
		if w, err := os.OpenFile(fifo, os.O_WRONLY|syscall.O_NONBLOCK, 0); err == nil {
			_ = w.Close()
		}
		t.Fatal("openReadOnly blocked on a FIFO")
	}
	// A regular file still opens and reads normally.
	mustWrite(t, filepath.Join(dir, "f"), "hello")
	f, err := openReadOnly(r, "f")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close() //nolint:errcheck // test
	if b, err := io.ReadAll(f); err != nil || string(b) != "hello" {
		t.Fatalf("read = %q, %v", b, err)
	}
}
