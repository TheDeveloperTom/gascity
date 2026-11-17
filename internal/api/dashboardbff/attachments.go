package dashboardbff

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Card attachments (owner 17.11): when a task is made from an owner's Discord
// message, the city copies the message's images to
// <cityRoot>/.gc/attachments/<beadId>/<file> and lists the file names in the
// bead's devwork.attachments metadata. The drawer shows them from here.
// Read-only, images only, one plain name per path segment.

var (
	attachmentBeadID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	attachmentName   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 ._-]{0,199}$`)
	attachmentTypes  = map[string]string{
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".gif":  "image/gif",
		".webp": "image/webp",
	}
)

func (p *Plane) registerAttachments() {
	p.mux.HandleFunc("GET /api/city/{cityName}/attachments/{beadId}/{name}", func(w http.ResponseWriter, r *http.Request) {
		root, ok := p.resolveCityPath(r.PathValue("cityName"))
		bead, name := r.PathValue("beadId"), r.PathValue("name")
		ctype := attachmentTypes[strings.ToLower(filepath.Ext(name))]
		if !ok || ctype == "" || !attachmentBeadID.MatchString(bead) || !attachmentName.MatchString(name) ||
			strings.Contains(bead, "..") || strings.Contains(name, "..") {
			writeError(w, http.StatusNotFound, "no such attachment")
			return
		}
		path := filepath.Join(root, ".gc", "attachments", bead, name)
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			writeError(w, http.StatusNotFound, "no such attachment")
			return
		}
		f, err := os.Open(path)
		if err != nil {
			writeError(w, http.StatusNotFound, "no such attachment")
			return
		}
		defer func() { _ = f.Close() }()
		h := w.Header()
		h.Set("Content-Type", ctype)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Content-Security-Policy", "default-src 'none'")
		h.Set("Cache-Control", "private, max-age=3600")
		http.ServeContent(w, r, name, info.ModTime(), f)
	})
}
