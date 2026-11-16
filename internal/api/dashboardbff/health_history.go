package dashboardbff

import (
	"context"
	"net/http"
	"sync"
	"time"
)

// GET /api/health/history: the last 30 minutes of the cheap host numbers
// (CPU busy % and load, memory with pressure, free disk), so the Health page's
// charts are full the moment it opens instead of starting empty (owner 16.11).
//
// One background sampler per plane reads the host every hostHistoryInterval
// from Plane.Start until Plane.Stop, reusing the live endpoint's sources
// (liveSources.readHost). It never lists processes: «Кто ест Мак» stays on
// demand in GET /api/health/live, because the process table is expensive.
//
// The history is in memory only: an engine (supervisor) restart starts it
// empty, and the page fills it from its own polls until the sampler catches up.
//
// Security: the same host plane and rules as GET /api/health/live — a GET
// route behind the plane guard (read-only; unsafe methods refused), and no
// process names, so nothing here depends on the caller being loopback.

const (
	hostHistoryInterval = 5 * time.Second
	hostHistoryWindow   = 30 * time.Minute
	hostHistoryCapacity = int(hostHistoryWindow / hostHistoryInterval)
)

// hostHistoryResponse is the GET /api/health/history body, matching
// shared/src/dashboard-health.ts HostHistory.
type hostHistoryResponse struct {
	IntervalMS int64         `json:"interval_ms"`
	WindowMS   int64         `json:"window_ms"`
	Points     []hostReading `json:"points"`
}

type hostHistoryEntry struct {
	at      time.Time
	reading hostReading
}

// hostHistory is a fixed-capacity ring of host readings, oldest evicted first.
type hostHistory struct {
	src      liveSources
	capacity int
	window   time.Duration
	// newTicker is time.NewTicker behind a seam, so tests drive the cadence.
	newTicker func(time.Duration) (<-chan time.Time, func())

	mu    sync.Mutex
	ring  []hostHistoryEntry
	start int
	count int
}

func newHostHistory(src liveSources, capacity int, window time.Duration) *hostHistory {
	return &hostHistory{
		src:      src,
		capacity: capacity,
		window:   window,
		newTicker: func(d time.Duration) (<-chan time.Time, func()) {
			t := time.NewTicker(d)
			return t.C, t.Stop
		},
		ring: make([]hostHistoryEntry, capacity),
	}
}

func defaultHostHistory() *hostHistory {
	return newHostHistory(defaultLiveSources(), hostHistoryCapacity, hostHistoryWindow)
}

func (h *hostHistory) record(at time.Time, r hostReading) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.ring[(h.start+h.count)%h.capacity] = hostHistoryEntry{at: at, reading: r}
	if h.count < h.capacity {
		h.count++
	} else {
		h.start = (h.start + 1) % h.capacity
	}
}

// points returns the readings inside the window before now, oldest first. The
// window filter matters after a sleep, when the ring's span exceeds 30 minutes.
func (h *hostHistory) points() []hostReading {
	from := h.src.now().Add(-h.window)
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]hostReading, 0, h.count)
	for i := 0; i < h.count; i++ {
		e := h.ring[(h.start+i)%h.capacity]
		if !e.at.Before(from) {
			out = append(out, e.reading)
		}
	}
	return out
}

// run takes a CPU baseline, then records one reading per tick until ctx ends.
func (h *hostHistory) run(ctx context.Context) {
	var prev cpuReading
	if busy, total, err := h.src.cpuTimes(ctx); err == nil {
		prev = cpuReading{busy: busy, total: total}
	}
	ticks, stop := h.newTicker(hostHistoryInterval)
	defer stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticks:
			at, r := h.src.readHost(ctx, &prev)
			h.record(at, r)
		}
	}
}

func (p *Plane) startHostHistory(ctx context.Context) {
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		p.history.run(ctx)
	}()
}

func (p *Plane) registerHostHistory() {
	p.mux.HandleFunc("GET /api/health/history", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, hostHistoryResponse{
			IntervalMS: hostHistoryInterval.Milliseconds(),
			WindowMS:   hostHistoryWindow.Milliseconds(),
			Points:     p.history.points(),
		})
	})
}
