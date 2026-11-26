package dashboardbff

import (
	"context"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// idleTailerPoll is the tail poll interval of the loop-driven idle tests. The
// loop checks for idleness on every tick, and waitForLanes polls no slower.
const idleTailerPoll = 10 * time.Millisecond

// idleHarness is an enabled run-tailer manager for city "alpha" whose idle
// clock the test moves through an atomic, so the tailer loop reading the clock
// never races the test writing it.
type idleHarness struct {
	m      *runTailerManager
	skew   *atomic.Int64
	wg     *sync.WaitGroup
	cancel context.CancelFunc
	path   string
}

// newIdleHarness sets the idle TTL and the tail poll interval, writes a one-run
// log, and builds and enables the manager. The idle clock is installed before
// the first ensure starts a loop.
func newIdleHarness(t *testing.T, ttl, poll time.Duration) *idleHarness {
	t.Helper()
	prevTTL, prevPoll := runTailerIdleTTL, runTailPollInterval
	runTailerIdleTTL, runTailPollInterval = ttl, poll
	t.Cleanup(func() { runTailerIdleTTL, runTailPollInterval = prevTTL, prevPoll })

	path := filepath.Join(t.TempDir(), ".gc", "events.jsonl")
	writeEventLog(t, path, runMoleculeEvent(1, "run1", "test-formula", ""))

	skew := new(atomic.Int64)
	base := time.Now()
	m := newRunTailerManager(Deps{})
	m.idleClock = func() time.Time { return base.Add(time.Duration(skew.Load())) }
	ctx, cancel := context.WithCancel(context.Background())
	wg := new(sync.WaitGroup)
	m.enable(ctx, wg)
	t.Cleanup(func() {
		cancel()
		wg.Wait()
	})
	return &idleHarness{m: m, skew: skew, wg: wg, cancel: cancel, path: path}
}

// advance moves the idle clock d forward.
func (h *idleHarness) advance(d time.Duration) { h.skew.Add(int64(d)) }

// demand asks for alpha's projection the way every reader does (ensure) and
// waits for the tailer's cold replay.
func (h *idleHarness) demand(t *testing.T) *cityRunTailer {
	t.Helper()
	tl := h.m.ensure("alpha", h.path)
	select {
	case <-tl.readyCh:
	case <-time.After(hangBudget):
		t.Fatal("cold replay did not complete")
	}
	return tl
}

// tracked reports whether tl is still the manager's tailer for its city.
func (h *idleHarness) tracked(tl *cityRunTailer) bool {
	h.m.mu.Lock()
	defer h.m.mu.Unlock()
	return h.m.cities[tl.name] == tl
}

func tailerStopped(tl *cityRunTailer) bool {
	select {
	case <-tl.doneCh:
		return true
	default:
		return false
	}
}

func waitTailerStopped(t *testing.T, tl *cityRunTailer, why string) {
	t.Helper()
	select {
	case <-tl.doneCh:
	case <-time.After(hangBudget):
		t.Fatal(why)
	}
}

// TestRunTailerIdleStopsAfterTTL: a tailer nobody asks for keeps folding until
// runTailerIdleTTL has passed since the last demand, then stops and leaves the
// manager, so an unwatched city stops paying for the fold and its projection.
func TestRunTailerIdleStopsAfterTTL(t *testing.T) {
	h := newIdleHarness(t, 10*time.Minute, idleTailerPoll)
	tl := h.demand(t)
	waitForLanes(t, tl, 1)

	// A second inside the TTL the loop still folds what is appended.
	h.advance(10*time.Minute - time.Second)
	appendEvents(t, h.path, runMoleculeEvent(2, "run2", "test-formula", ""))
	waitForLanes(t, tl, 2)
	if tailerStopped(tl) || !h.tracked(tl) {
		t.Fatal("tailer stopped before the idle TTL")
	}

	h.advance(2 * time.Second)
	waitTailerStopped(t, tl, "idle tailer did not stop after the TTL")
	if h.tracked(tl) {
		t.Fatal("stopped tailer is still the manager's tailer for alpha")
	}
}

// TestRunTailerIdleDemandResetsTimer: every ensure stamps fresh demand, so a
// tailer that is still being read is not evicted however long it has run.
func TestRunTailerIdleDemandResetsTimer(t *testing.T) {
	h := newIdleHarness(t, 10*time.Minute, idleTailerPoll)
	tl := h.demand(t)
	waitForLanes(t, tl, 1)

	h.advance(9 * time.Minute)
	if again := h.m.ensure("alpha", h.path); again != tl {
		t.Fatal("a repeat demand replaced the running tailer")
	}
	// 12 minutes after the first demand, 3 after the second: still folding.
	h.advance(3 * time.Minute)
	appendEvents(t, h.path, runMoleculeEvent(2, "run2", "test-formula", ""))
	waitForLanes(t, tl, 2)
	if tailerStopped(tl) || !h.tracked(tl) {
		t.Fatal("tailer was evicted 3 minutes after its last demand")
	}

	h.advance(7 * time.Minute)
	waitTailerStopped(t, tl, "tailer did not stop a TTL after its last demand")
}

// TestRunTailerIdleTTLNonPositiveNeverEvicts: runTailerIdleTTL <= 0 turns idle
// eviction off, and the tailer runs until the plane stops, as before.
func TestRunTailerIdleTTLNonPositiveNeverEvicts(t *testing.T) {
	for _, ttl := range []time.Duration{0, -time.Minute} {
		t.Run(ttl.String(), func(t *testing.T) {
			h := newIdleHarness(t, ttl, idleTailerPoll)
			tl := h.demand(t)
			waitForLanes(t, tl, 1)

			h.advance(1000 * time.Hour)
			appendEvents(t, h.path, runMoleculeEvent(2, "run2", "test-formula", ""))
			waitForLanes(t, tl, 2)
			if tailerStopped(tl) || !h.tracked(tl) {
				t.Fatal("tailer was evicted with idle eviction turned off")
			}
			if h.m.evictIfIdle(tl) {
				t.Fatal("evictIfIdle = true with idle eviction turned off")
			}
		})
	}
}

// TestRunTailerIdleEvictionRestartsOnDemand: the first demand after an eviction
// starts a fresh tailer whose cold replay folds the whole log again, including
// what was appended while no tailer ran, and whose loop is live.
func TestRunTailerIdleEvictionRestartsOnDemand(t *testing.T) {
	h := newIdleHarness(t, 10*time.Minute, idleTailerPoll)
	first := h.demand(t)
	waitForLanes(t, first, 1)
	h.advance(10*time.Minute + time.Second)
	waitTailerStopped(t, first, "idle tailer did not stop after the TTL")

	appendEvents(t, h.path, runMoleculeEvent(2, "run2", "test-formula", ""))
	second := h.demand(t)
	if second == first {
		t.Fatal("the demand after an eviction reused the stopped tailer")
	}
	waitForLanes(t, second, 2)
	second.mu.RLock()
	ids := laneIDsOf(second.summary.Lanes)
	complete := second.ready && !second.coldReplayIncomplete && lanePresent(second, "run1") && lanePresent(second, "run2")
	second.mu.RUnlock()
	if !complete {
		t.Fatalf("restarted projection lanes = %v, want run1 and run2 from a complete cold replay", ids)
	}
	ctx, cancel := context.WithTimeout(context.Background(), hangBudget)
	defer cancel()
	if !second.sync(ctx) {
		t.Fatal("restarted tailer's loop did not serve a sync")
	}
}

// TestRunTailerIdleNoStartAfterManagerStops: a demand that arrives after the
// plane's context is canceled (a request still in flight during shutdown) does
// not start a tailer for an evicted city, so no loop joins the waitgroup Stop
// waits on.
func TestRunTailerIdleNoStartAfterManagerStops(t *testing.T) {
	h := newIdleHarness(t, 10*time.Minute, time.Hour)
	tl := h.demand(t)
	h.advance(10*time.Minute + time.Second)
	if !h.m.evictIfIdle(tl) {
		t.Fatal("evictIfIdle = false for a tailer idle past the TTL")
	}
	waitTailerStopped(t, tl, "evicted tailer did not stop")

	h.cancel()
	h.wg.Wait()
	late := h.m.ensure("alpha", h.path)
	h.m.mu.Lock()
	started := late.started
	h.m.mu.Unlock()
	if started {
		t.Fatal("ensure started a tailer after the manager's context was canceled")
	}
}

// TestRunTailerIdleSyncAfterEvictionReturnsFalse: a caller still holding an
// evicted tailer gets false from sync once the loop is gone, without waiting
// for its own context to end.
func TestRunTailerIdleSyncAfterEvictionReturnsFalse(t *testing.T) {
	h := newIdleHarness(t, 10*time.Minute, time.Hour)
	tl := h.demand(t)
	h.advance(10*time.Minute + time.Second)
	if !h.m.evictIfIdle(tl) {
		t.Fatal("evictIfIdle = false for a tailer idle past the TTL")
	}
	result := make(chan bool, 1)
	go func() { result <- tl.sync(context.Background()) }()
	select {
	case ok := <-result:
		if ok {
			t.Fatal("sync on an evicted tailer = true, want false")
		}
	case <-time.After(hangBudget):
		t.Fatal("sync on an evicted tailer blocked")
	}
}

// TestRunTailerIdleDemandLandsBeforeTheCheck: ensure stamps demand under the
// lock evictIfIdle takes, so a demand that reaches a tailer already past its
// TTL wins, and the next check keeps the tailer.
func TestRunTailerIdleDemandLandsBeforeTheCheck(t *testing.T) {
	h := newIdleHarness(t, 10*time.Minute, time.Hour)
	tl := h.demand(t)
	h.advance(time.Hour)
	if again := h.m.ensure("alpha", h.path); again != tl {
		t.Fatal("a repeat demand replaced the running tailer")
	}
	if h.m.evictIfIdle(tl) {
		t.Fatal("evictIfIdle = true right after a demand")
	}
	h.advance(10 * time.Minute)
	if !h.m.evictIfIdle(tl) {
		t.Fatal("evictIfIdle = false a TTL after the last demand")
	}
}

// TestRunTailerIdleKeepsStreamedTailer: an open detail stream holds its tailer
// past the TTL. Once the stream is gone the tailer is evicted, and only once.
func TestRunTailerIdleKeepsStreamedTailer(t *testing.T) {
	h := newIdleHarness(t, 10*time.Minute, time.Hour)
	tl := h.demand(t)
	sub := tl.subscribe()
	h.advance(10*time.Minute + time.Second)
	if h.m.evictIfIdle(tl) {
		t.Fatal("evictIfIdle = true for a tailer with a detail-stream subscriber")
	}
	tl.unsubscribe(sub)
	if !h.m.evictIfIdle(tl) {
		t.Fatal("evictIfIdle = false once the last subscriber left")
	}
	if h.m.evictIfIdle(tl) {
		t.Fatal("evictIfIdle = true a second time for the same tailer")
	}
	waitTailerStopped(t, tl, "evicted tailer did not stop")
}
