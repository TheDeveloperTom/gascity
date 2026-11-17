package dashboardbff

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// Owner 17.11: a card's screenshots (copied by the city into
// .gc/attachments/<bead>/<file>) are served to the dashboard drawer.

func attachmentPlane(t *testing.T) *Plane {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, ".gc", "attachments", "dw-1.2")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	png := []byte("\x89PNG\r\n\x1a\nfake")
	if err := os.WriteFile(filepath.Join(dir, "1-image.png"), png, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "secret.png"), png, 0o644); err != nil {
		t.Fatal(err)
	}
	return New(Deps{Resolver: mapResolver{"alpha": root}})
}

func getAttachment(p *Plane, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	p.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestAttachmentServesCardImage(t *testing.T) {
	rec := getAttachment(attachmentPlane(t), "/api/city/alpha/attachments/dw-1.2/1-image.png")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", ct)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Error("missing nosniff")
	}
	if rec.Body.String() != "\x89PNG\r\n\x1a\nfake" {
		t.Errorf("body = %q", rec.Body.String())
	}
}

func TestAttachmentRefusesNonImagesTraversalAndUnknown(t *testing.T) {
	p := attachmentPlane(t)
	for _, path := range []string{
		"/api/city/alpha/attachments/dw-1.2/notes.txt",
		"/api/city/alpha/attachments/dw-1.2/missing.png",
		"/api/city/alpha/attachments/..%2F..%2F/secret.png",
		"/api/city/alpha/attachments/dw-1.2/..%2F..%2F..%2Fsecret.png",
		"/api/city/alpha/attachments/.hidden/1-image.png",
		"/api/city/ghost/attachments/dw-1.2/1-image.png",
	} {
		if rec := getAttachment(p, path); rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", path, rec.Code)
		}
	}
}
