package dashboardbff

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"sync"
	"testing"
	"time"
)

// fakeTicker stands in for time.NewTicker: the test sends each tick, so the
// sampler's cadence is driven by the test clock, not the wall clock.
type fakeTicker struct {
	mu       sync.Mutex
	asked    []time.Duration
	stopped  int
	ch       chan time.Time
	started  chan struct{}
	onceInit sync.Once
}

func newFakeTicker() *fakeTicker {
	return &fakeTicker{ch: make(chan time.Time), started: make(chan struct{})}
}

func (ft *fakeTicker) newTicker(d time.Duration) (<-chan time.Time, func()) {
	ft.mu.Lock()
	ft.asked = append(ft.asked, d)
	ft.mu.Unlock()
	ft.onceInit.Do(func() { close(ft.started) })
	return ft.ch, func() {
		ft.mu.Lock()
		ft.stopped++
		ft.mu.Unlock()
	}
}

func historyReading(at time.Time, busy float64) hostReading {
	return hostReading{SampledAt: at.UTC().Format(time.RFC3339Nano), CPU: liveCPU{Cores: 1, BusyPct: availableHealthMetric(busy)}}
}

func busyOf(r hostReading) float64 {
	if r.CPU.BusyPct.Value == nil {
		return -1
	}
	return *r.CPU.BusyPct.Value
}

func memPressure(r hostReading) string {
	if r.Memory.Value == nil {
		return ""
	}
	return r.Memory.Value.Pressure
}

func waitForPoints(t *testing.T, h *hostHistory, n int) []hostReading {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		pts := h.points()
		if len(pts) >= n {
			return pts
		}
		if time.Now().After(deadline) {
			t.Fatalf("history has %d points, want %d", len(pts), n)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestHostHistoryDefaultsHoldThirtyMinutesAtFiveSeconds(t *testing.T) {
	if hostHistoryInterval != 5*time.Second {
		t.Fatalf("interval = %v, want 5s", hostHistoryInterval)
	}
	if hostHistoryWindow != 30*time.Minute {
		t.Fatalf("window = %v, want 30m", hostHistoryWindow)
	}
	if hostHistoryCapacity != 360 {
		t.Fatalf("capacity = %d, want 360 (30 min / 5 s)", hostHistoryCapacity)
	}
	h := defaultHostHistory()
	if h.capacity != hostHistoryCapacity || h.window != hostHistoryWindow {
		t.Fatalf("default history capacity %d window %v", h.capacity, h.window)
	}
}

func TestHostHistoryEvictsTheOldestPastCapacity(t *testing.T) {
	now := time.Unix(10_000, 0)
	src := (&fakeLiveSources{now: now}).sources()
	h := newHostHistory(src, 3, time.Hour)
	for i := 0; i < 5; i++ {
		at := now.Add(time.Duration(i-5) * time.Second)
		h.record(at, historyReading(at, float64(i)))
	}
	pts := h.points()
	if len(pts) != 3 {
		t.Fatalf("points = %d, want 3", len(pts))
	}
	for i, p := range pts {
		if want := float64(i + 2); busyOf(p) != want {
			t.Fatalf("point %d busy = %v, want %v (oldest first, oldest evicted)", i, busyOf(p), want)
		}
	}
}

func TestHostHistoryServesOnlyTheLastWindow(t *testing.T) {
	t0 := time.Unix(10_000, 0)
	f := &fakeLiveSources{now: t0.Add(40 * time.Minute)}
	h := newHostHistory(f.sources(), 10, 30*time.Minute)
	h.record(t0, historyReading(t0, 1))
	h.record(t0.Add(20*time.Minute), historyReading(t0.Add(20*time.Minute), 2))
	pts := h.points()
	if len(pts) != 1 || busyOf(pts[0]) != 2 {
		t.Fatalf("points = %#v, want only the one inside 30 min", pts)
	}
}

func TestHostHistorySamplerRecordsOneHostReadingPerTickWithoutProcesses(t *testing.T) {
	t0 := time.Unix(10_000, 0)
	f := &fakeLiveSources{
		now: t0,
		// baseline, then +1 of 10 s, +5 of 10 s busy: 10 %, 50 %.
		cpuTotals: [][2]float64{{100, 1000}, {101, 1010}, {106, 1020}},
	}
	h := newHostHistory(f.sources(), hostHistoryCapacity, hostHistoryWindow)
	ft := newFakeTicker()
	h.newTicker = ft.newTicker

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { h.run(ctx); close(done) }()
	<-ft.started

	f.now = t0.Add(5 * time.Second)
	ft.ch <- f.now
	waitForPoints(t, h, 1)
	f.now = t0.Add(10 * time.Second)
	ft.ch <- f.now
	pts := waitForPoints(t, h, 2)
	cancel()
	<-done

	ft.mu.Lock()
	asked, stopped := ft.asked, ft.stopped
	ft.mu.Unlock()
	if len(asked) != 1 || asked[0] != hostHistoryInterval {
		t.Fatalf("ticker asked for %v, want one %v ticker", asked, hostHistoryInterval)
	}
	if stopped != 1 {
		t.Fatalf("ticker stopped %d times, want 1", stopped)
	}
	if f.procCalls != 0 {
		t.Fatalf("the background sampler listed processes %d times; that stays on demand only", f.procCalls)
	}
	if busyOf(pts[0]) != 10 || busyOf(pts[1]) != 50 {
		t.Fatalf("busy = %v, %v, want 10, 50", busyOf(pts[0]), busyOf(pts[1]))
	}
	if pts[1].SampledAt != t0.Add(10*time.Second).UTC().Format(time.RFC3339Nano) {
		t.Fatalf("sampled_at = %s, want the fake clock", pts[1].SampledAt)
	}
	if pts[1].Memory.Status != "available" || pts[1].Disk.Status != "available" || pts[1].CPU.Load.Status != "available" {
		t.Fatalf("point = %#v, want load, memory and disk", pts[1])
	}
	if memPressure(pts[1]) != "normal" {
		t.Fatalf("pressure = %q, want normal", memPressure(pts[1]))
	}
}

func TestHostHistorySamplerReturnsWhenCanceled(t *testing.T) {
	f := &fakeLiveSources{now: time.Unix(10_000, 0), cpuTotals: [][2]float64{{1, 10}}}
	h := newHostHistory(f.sources(), 4, time.Hour)
	ft := newFakeTicker()
	h.newTicker = ft.newTicker
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { h.run(ctx); close(done) }()
	<-ft.started
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("history sampler did not return after cancel")
	}
}

func TestPlaneStartRunsTheHostHistorySamplerAndStopDrainsIt(t *testing.T) {
	before := runtime.NumGoroutine()
	f := &fakeLiveSources{now: time.Unix(10_000, 0), cpuTotals: [][2]float64{{1, 10}}}
	p := New(Deps{})
	p.history = newHostHistory(f.sources(), 4, time.Hour)
	ft := newFakeTicker()
	p.history.newTicker = ft.newTicker

	p.Start(context.Background())
	select {
	case <-ft.started:
	case <-time.After(2 * time.Second):
		t.Fatal("Plane.Start did not start the host history sampler")
	}
	p.Stop()

	deadline := time.Now().Add(2 * time.Second)
	for runtime.NumGoroutine() > before {
		if time.Now().After(deadline) {
			t.Fatalf("goroutines %d after Stop, %d before Start: the sampler leaked", runtime.NumGoroutine(), before)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestHistoryEndpointServesTheHostPointsAndNoProcesses(t *testing.T) {
	t0 := time.Unix(10_000, 0)
	f := &fakeLiveSources{now: t0}
	p := New(Deps{})
	p.history = newHostHistory(f.sources(), 4, time.Hour)
	p.history.record(t0, historyReading(t0, 42))

	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/health/history", nil)
	r.RemoteAddr = "127.0.0.1:5000"
	r.Host = "127.0.0.1:8372"
	p.Handler().ServeHTTP(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if m["interval_ms"] != float64(5000) || m["window_ms"] != float64(1_800_000) {
		t.Fatalf("interval/window = %v/%v", m["interval_ms"], m["window_ms"])
	}
	mustArray(t, m, "points")
	pts := m["points"].([]any)
	if len(pts) != 1 {
		t.Fatalf("points = %d, want 1", len(pts))
	}
	pt := pts[0].(map[string]any)
	mustString(t, pt, "sampled_at")
	mustObject(t, pt, "cpu")
	mustObject(t, pt, "memory")
	mustObject(t, pt, "disk")
	if _, ok := pt["processes"]; ok {
		t.Fatalf("a history point carries processes: %v", pt)
	}

	// An empty history is an empty array, never null.
	p.history = newHostHistory(f.sources(), 4, time.Hour)
	rec = httptest.NewRecorder()
	p.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health/history", nil))
	var empty struct {
		Points json.RawMessage `json:"points"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &empty); err != nil || string(empty.Points) != "[]" {
		t.Fatalf("empty points = %s (%v), want []", empty.Points, err)
	}
}

func TestHistoryEndpointRefusesWrites(t *testing.T) {
	p := New(Deps{ReadOnly: true})
	rec := httptest.NewRecorder()
	p.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/health/history", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status %d, want 405", rec.Code)
	}
}
