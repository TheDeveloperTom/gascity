package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gastownhall/gascity/internal/api"
)

type fakeDashResolver struct{ cities []api.CityInfo }

// stubRoundTripper is a sentinel http.RoundTripper for asserting that
// dashboardDeps stores the self-read transport it is handed.
type stubRoundTripper struct{}

func (*stubRoundTripper) RoundTrip(*http.Request) (*http.Response, error) { return nil, nil }

func (f fakeDashResolver) ListCities() []api.CityInfo { return f.cities }
func (f fakeDashResolver) CityState(string) api.State { return nil }

func TestDashboardLoopbackBaseURL(t *testing.T) {
	cases := map[string]struct {
		bind string
		port int
		want string
	}{
		"loopback":     {"127.0.0.1", 8372, "http://127.0.0.1:8372"},
		"empty bind":   {"", 8372, "http://127.0.0.1:8372"},
		"wildcard v4":  {"0.0.0.0", 8372, "http://127.0.0.1:8372"},
		"localhost":    {"localhost", 9000, "http://127.0.0.1:9000"},
		"wildcard v6":  {"::", 8372, "http://[::1]:8372"},
		"explicit v6":  {"::1", 8372, "http://[::1]:8372"},
		"explicit lan": {"192.168.1.5", 8080, "http://192.168.1.5:8080"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if got := dashboardLoopbackBaseURL(tc.bind, tc.port); got != tc.want {
				t.Errorf("dashboardLoopbackBaseURL(%q,%d) = %q, want %q", tc.bind, tc.port, got, tc.want)
			}
		})
	}
}

// TestDashboardDepsWiresSupervisorBaseURL is the regression guard for the
// red-team HIGH finding: attachDashboard must give the plane a non-empty
// SupervisorBaseURL, or the host-side samplers ship permanently degraded.
func TestDashboardDepsWiresSupervisorBaseURL(t *testing.T) {
	deps := dashboardDeps(fakeDashResolver{}, false, "127.0.0.1", 8372, nil)
	if deps.SupervisorBaseURL == "" {
		t.Fatal("dashboardDeps left SupervisorBaseURL empty; samplers would never read /v0/.../status")
	}
	if deps.SupervisorBaseURL != "http://127.0.0.1:8372" {
		t.Errorf("SupervisorBaseURL = %q, want http://127.0.0.1:8372", deps.SupervisorBaseURL)
	}
	if deps.Resolver == nil {
		t.Error("Resolver not wired")
	}
}

// TestDashboardDepsWiresSelfReadTransport is the regression guard for the
// read-auth finding: attachDashboard must give the plane the supervisor's
// in-process loopback transport, or the host-side samplers' loopback self-reads
// of the gated /v0/city/{name}/status route would 401 once read-auth is enabled.
func TestDashboardDepsWiresSelfReadTransport(t *testing.T) {
	rt := &stubRoundTripper{}
	deps := dashboardDeps(fakeDashResolver{}, false, "127.0.0.1", 8372, rt)
	if deps.SelfReadTransport == nil {
		t.Fatal("dashboardDeps left SelfReadTransport nil; samplers' loopback reads would 401 under read-auth")
	}
	if deps.SelfReadTransport != http.RoundTripper(rt) {
		t.Errorf("SelfReadTransport = %v, want the passed-in transport", deps.SelfReadTransport)
	}
}

// TestDashboardDepsModulesCoreOnly records that core-only dashboard modules are
// the intentional steady state: dashboardDeps leaves EnabledModules unset
// because no first-party (gated) view module ships yet, so the omission is a
// tested decision rather than an oversight. When a gated module is added, wire
// its enable source in dashboardDeps and update this test.
func TestDashboardDepsModulesCoreOnly(t *testing.T) {
	deps := dashboardDeps(fakeDashResolver{}, false, "127.0.0.1", 8372, nil)
	if len(deps.EnabledModules) != 0 {
		t.Errorf("EnabledModules = %v, want empty: core-only is the intentional default; wire the enable source and update this test when a gated module ships", deps.EnabledModules)
	}
}

func TestRunCwdAllowedRootsFromEnv(t *testing.T) {
	t.Setenv("RUN_CWD_ALLOWED_ROOTS", "/srv/a:/srv/b: :relative:/srv/c")
	got := runCwdAllowedRootsFromEnv()
	want := []string{"/srv/a", "/srv/b", "/srv/c"}
	if len(got) != len(want) {
		t.Fatalf("roots = %v, want %v (relative/blank entries dropped)", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("roots[%d] = %q, want %q", i, got[i], want[i])
		}
	}

	t.Setenv("RUN_CWD_ALLOWED_ROOTS", "")
	if got := runCwdAllowedRootsFromEnv(); got != nil {
		t.Errorf("empty env should yield nil, got %v", got)
	}
}

// TestAttachDashboardInstallsDashboardBase guards the sling dashboard_url
// wiring: for loopback and explicit-host binds attachDashboard must install
// the listener's browser-reachable link base on the mux, or per-city handlers
// can never mint dashboard deep links even though the dashboard is served.
// For wildcard binds it must install NO base: the loopback literal the
// samplers dial is browser-reachable only on the supervisor host, so a remote
// /v0 sling caller would receive a dashboard_url pointing at its own machine.
// Wildcard responses omit dashboard_url instead (silent degradation).
func TestAttachDashboardInstallsDashboardBase(t *testing.T) {
	cases := map[string]struct {
		bind string
		want string // "" means no link base installed
	}{
		"loopback v4":         {"127.0.0.1", "http://127.0.0.1:8372"},
		"empty bind default":  {"", "http://127.0.0.1:8372"},
		"localhost":           {"localhost", "http://127.0.0.1:8372"},
		"loopback v6":         {"::1", "http://[::1]:8372"},
		"explicit lan":        {"192.168.1.5", "http://192.168.1.5:8372"},
		"wildcard v4":         {"0.0.0.0", ""},
		"wildcard v6":         {"::", ""},
		"wildcard v6 bracket": {"[::]", ""},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Setenv("GC_SUPERVISOR_DASHBOARD", "")
			mux := newTestSupervisorMuxForDashboard()
			plane, err := attachDashboard(mux, fakeDashResolver{}, false, tc.bind, 8372, "")
			if err != nil {
				t.Fatalf("attachDashboard: %v", err)
			}
			if plane == nil {
				t.Fatal("attachDashboard returned nil plane with dashboard enabled")
			}
			if got := mux.DashboardBaseURL(); got != tc.want {
				t.Fatalf("DashboardBaseURL for bind %q = %q, want %q", tc.bind, got, tc.want)
			}
		})
	}
}

// TestAttachDashboardDisabledLeavesNoDashboardBase pins the standalone shape:
// with the dashboard disabled the mux must report no link base, so sling
// responses omit dashboard_url instead of minting dead links.
func TestAttachDashboardDisabledLeavesNoDashboardBase(t *testing.T) {
	t.Setenv("GC_SUPERVISOR_DASHBOARD", "0")
	mux := newTestSupervisorMuxForDashboard()
	plane, err := attachDashboard(mux, fakeDashResolver{}, false, "127.0.0.1", 8372, "")
	if err != nil {
		t.Fatalf("attachDashboard: %v", err)
	}
	if plane != nil {
		t.Fatal("attachDashboard returned a plane with the dashboard disabled")
	}
	if got := mux.DashboardBaseURL(); got != "" {
		t.Fatalf("DashboardBaseURL = %q, want empty when the dashboard is disabled", got)
	}
}

func newTestSupervisorMuxForDashboard() *api.SupervisorMux {
	return api.NewSupervisorMux(fakeDashResolver{}, nil, false, "vtest", "btest", time.Now())
}

func TestDashboardEnabledToggle(t *testing.T) {
	t.Setenv("GC_SUPERVISOR_DASHBOARD", "0")
	if dashboardEnabled() {
		t.Error("GC_SUPERVISOR_DASHBOARD=0 should disable the dashboard")
	}
	t.Setenv("GC_SUPERVISOR_DASHBOARD", "")
	if !dashboardEnabled() {
		t.Error("unset GC_SUPERVISOR_DASHBOARD should default to enabled")
	}
}

func TestWriteSupervisorDashboardStartupOnlyAdvertisesMountedDashboard(t *testing.T) {
	var out bytes.Buffer
	writeSupervisorDashboardStartup(&out, false, false, "127.0.0.1", 8372)
	if out.Len() != 0 {
		t.Fatalf("disabled dashboard output = %q, want empty", out.String())
	}

	writeSupervisorDashboardStartup(&out, true, true, "127.0.0.1", 8372)
	want := "Dashboard:  http://127.0.0.1:8372/  [read-only]\n"
	if out.String() != want {
		t.Fatalf("mounted dashboard output = %q, want %q", out.String(), want)
	}
}

const dashDirTestSHA = "0123456789abcdef0123456789abcdef01234567"

// newDashboardDirRoot builds a dashboard_dir root (PLAN §1 C2) with one
// complete version and current pointing at it.
func newDashboardDirRoot(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "dashboard-ui")
	v := filepath.Join(root, "versions", dashDirTestSHA)
	if err := os.MkdirAll(v, 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		filepath.Join(v, "index.html"):         `<!doctype html><html><body><div id="root"></div>dir-ui</body></html>`,
		filepath.Join(v, "gc-ui-release.json"): `{}`,
		filepath.Join(root, "current"):         dashDirTestSHA + "\n",
	}
	for p, c := range files {
		if err := os.WriteFile(p, []byte(c), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(p, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, d := range []string{root, filepath.Join(root, "versions"), v} {
		if err := os.Chmod(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func dashboardGet(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

// TestAttachDashboardServesDir: the supervisor's dashboard_dir reaches the SPA
// handler, so GET / is served from the version folder.
func TestAttachDashboardServesDir(t *testing.T) {
	t.Setenv("GC_SUPERVISOR_DASHBOARD", "")
	mux := newTestSupervisorMuxForDashboard()
	plane, err := attachDashboard(mux, fakeDashResolver{}, false, "127.0.0.1", 8372, newDashboardDirRoot(t))
	if err != nil || plane == nil {
		t.Fatalf("attachDashboard = (%v, %v), want a plane and nil error", plane, err)
	}
	rec := dashboardGet(t, mux, "/")
	if got := rec.Header().Get("X-GC-Dashboard-UI"); got != "dir "+dashDirTestSHA {
		t.Fatalf("GET /: X-GC-Dashboard-UI = %q, want dir %s (status %d)", got, dashDirTestSHA, rec.Code)
	}
}

// TestAttachDashboardBadDirStillStarts: no state of dashboard_dir may stop the
// supervisor's boot (DESIGN-CHECK K5).
func TestAttachDashboardBadDirStillStarts(t *testing.T) {
	t.Setenv("GC_SUPERVISOR_DASHBOARD", "")
	root := newDashboardDirRoot(t)
	if err := os.Chmod(root, 0o777); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{root, "rel/path", filepath.Join(t.TempDir(), "missing")} {
		mux := newTestSupervisorMuxForDashboard()
		plane, err := attachDashboard(mux, fakeDashResolver{}, false, "127.0.0.1", 8372, dir)
		if err != nil || plane == nil {
			t.Fatalf("attachDashboard(%q) = (%v, %v), want a plane and nil error", dir, plane, err)
		}
		rec := dashboardGet(t, mux, "/")
		if rec.Code != http.StatusOK {
			t.Errorf("dir %q: GET / status = %d, want 200 (embedded)", dir, rec.Code)
		}
	}
}
