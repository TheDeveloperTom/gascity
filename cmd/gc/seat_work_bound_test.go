package main

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gastownhall/gascity/internal/beads"
)

// gatedState is what every gatedListStore of one test shares: how many Lists
// started, how many run now and at most, and the gate they block on.
type gatedState struct {
	calls, cur, max *atomic.Int64
	writes          *atomic.Int64 // Update, SetMetadata and SetMetadataBatch calls
	release         chan struct{}
	panicOnce       *atomic.Bool
}

func newGatedState() gatedState {
	return gatedState{
		calls:     new(atomic.Int64),
		cur:       new(atomic.Int64),
		max:       new(atomic.Int64),
		writes:    new(atomic.Int64),
		release:   make(chan struct{}),
		panicOnce: new(atomic.Bool),
	}
}

func (g gatedListStore) Update(id string, opts beads.UpdateOpts) error {
	g.writes.Add(1)
	return g.Store.Update(id, opts)
}

func (g gatedListStore) SetMetadata(id, key, value string) error {
	g.writes.Add(1)
	return g.Store.SetMetadata(id, key, value)
}

func (g gatedListStore) SetMetadataBatch(id string, kvs map[string]string) error {
	g.writes.Add(1)
	return g.Store.SetMetadataBatch(id, kvs)
}

// gatedListStore is a leg whose List counts itself and blocks on release.
type gatedListStore struct {
	beads.Store
	gatedState
}

func (g gatedListStore) List(q beads.ListQuery) ([]beads.Bead, error) {
	g.calls.Add(1)
	cur := g.cur.Add(1)
	for {
		m := g.max.Load()
		if cur <= m || g.max.CompareAndSwap(m, cur) {
			break
		}
	}
	defer g.cur.Add(-1)
	if g.panicOnce.CompareAndSwap(true, false) {
		panic("gated list panics once")
	}
	<-g.release
	return g.Store.List(q)
}

// seatReadBoundFixture is a two-leg city (the work store and rig "r"), both
// gated, and a seat with two identities: one read is 2 legs × 2 ids × 2
// statuses = 8 Lists.
type seatReadBoundFixture struct {
	dir   string
	state gatedState
	work  gatedListStore
	legs  WorkLegs
	scope ReleaseScope
	q     seatWorkQuery
}

// newSeatReadBoundFixture sets the city's slots to slots before the legs are
// minted, and seeds an assigned bead in the work store when seed is set.
func newSeatReadBoundFixture(t *testing.T, slots int, seed bool) *seatReadBoundFixture {
	t.Helper()
	f := &seatReadBoundFixture{dir: t.TempDir(), state: newGatedState()}
	setSeatReadSlotsForTest(t, f.dir, slots)
	f.work = gatedListStore{Store: beads.NewMemStore(), gatedState: f.state}
	rig := gatedListStore{Store: beads.NewMemStore(), gatedState: f.state}
	if seed {
		mustCreateDrainAckBead(t, f.work.Store, beads.Bead{Title: "claimed", Type: "task"}, "in_progress", "worker-1")
	}
	cfg := servingRigsCity(declaredRigsConfig("r"), "worker")
	f.legs = testWorkLegs(f.dir, cfg, f.work, map[string]beads.Store{"r": rig})
	f.scope = ReleaseScope{ids: []string{"s-1", "worker-1"}}
	f.q = seatWorkQuery{scope: f.scope, statuses: seatWorkStatuses}
	return f
}

// releaseAtCleanup unblocks every List when the test ends, so abandoned reads
// finish.
func (f *seatReadBoundFixture) releaseAtCleanup(t *testing.T) {
	t.Cleanup(func() {
		select {
		case <-f.state.release:
		default:
			close(f.state.release)
		}
	})
}

func waitForCur(t *testing.T, s gatedState, n int64) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for s.cur.Load() != n {
		if time.Now().After(deadline) {
			t.Fatalf("concurrent Lists = %d, want %d", s.cur.Load(), n)
		}
		time.Sleep(time.Millisecond)
	}
}

type hasResult struct {
	has bool
	err error
}

func TestSeatReadListsBoundedPerCity(t *testing.T) {
	f := newSeatReadBoundFixture(t, 3, true)
	f.releaseAtCleanup(t)
	results := make(chan hasResult, 3)
	for range 3 {
		go func() {
			has, err := seatWorkFor(f.legs, f.scope).has(f.q)
			results <- hasResult{has, err}
		}()
	}
	waitForCur(t, f.state, 3)
	time.Sleep(50 * time.Millisecond)
	if got := f.state.max.Load(); got != 3 {
		t.Fatalf("max concurrent Lists = %d before release, want 3", got)
	}
	close(f.state.release)
	for range 3 {
		r := <-results
		if !r.has || r.err != nil {
			t.Errorf("has = %v, %v; want true, nil", r.has, r.err)
		}
	}
	if got := f.state.max.Load(); got > 3 {
		t.Errorf("max concurrent Lists = %d, want <= 3", got)
	}
}

func TestSeatReadBoundCountsAbandonedReads(t *testing.T) {
	f := newSeatReadBoundFixture(t, 2, true)
	f.releaseAtCleanup(t)
	go func() { _, _ = seatWorkFor(f.legs, f.scope).has(f.q) }() // abandoned: never waited for
	waitForCur(t, f.state, 2)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err := seatWorkForCtx(ctx, f.legs, f.scope).has(f.q)
	if !errors.Is(err, errSeatReadNoSlot) {
		t.Fatalf("err = %v, want errSeatReadNoSlot", err)
	}
	if got := f.state.calls.Load(); got != 2 {
		t.Errorf("Lists started = %d, want 2 (only the abandoned read's)", got)
	}
}

func TestSeatReadGivesUpWithoutStartingWhenCtxEnds(t *testing.T) {
	f := newSeatReadBoundFixture(t, 2, true)
	f.releaseAtCleanup(t)
	go func() { _, _ = seatWorkFor(f.legs, f.scope).has(f.q) }()
	waitForCur(t, f.state, 2)

	t.Run("slots full", func(t *testing.T) {
		before := f.state.calls.Load()
		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()
		if _, err := seatWorkForCtx(ctx, f.legs, f.scope).has(f.q); !errors.Is(err, errSeatReadNoSlot) {
			t.Fatalf("err = %v, want errSeatReadNoSlot", err)
		}
		if got := f.state.calls.Load(); got != before {
			t.Errorf("Lists started = %d, want %d", got, before)
		}
	})

	t.Run("slot free, ctx already ended", func(t *testing.T) {
		g := newSeatReadBoundFixture(t, 16, true)
		g.releaseAtCleanup(t)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err := seatWorkForCtx(ctx, g.legs, g.scope).has(g.q); !errors.Is(err, errSeatReadNoSlot) {
			t.Fatalf("err = %v, want errSeatReadNoSlot", err)
		}
		if got := g.state.calls.Load(); got != 0 {
			t.Errorf("Lists started = %d, want 0", got)
		}
	})

	close(f.state.release)
	waitForCur(t, f.state, 0)
	before := f.state.calls.Load()
	has, err := seatWorkFor(f.legs, f.scope).has(f.q)
	if !has || err != nil {
		t.Fatalf("fresh read: has = %v, %v; want true, nil", has, err)
	}
	if got := f.state.calls.Load() - before; got != 8 {
		t.Errorf("fresh read started %d Lists, want 8", got)
	}
}

func TestSeatReadSlotFreedOnListPanic(t *testing.T) {
	f := newSeatReadBoundFixture(t, 1, false)
	close(f.state.release)
	f.state.panicOnce.Store(true)
	if _, err := seatWorkFor(f.legs, f.scope).has(f.q); err == nil {
		t.Fatal("first read: want the panicked List's error")
	}
	done := make(chan hasResult, 1)
	go func() {
		has, err := seatWorkFor(f.legs, f.scope).has(f.q)
		done <- hasResult{has, err}
	}()
	select {
	case r := <-done:
		if r.err != nil {
			t.Fatalf("second read: %v", r.err)
		}
	case <-time.After(time.Second):
		t.Fatal("second read did not answer within 1s: the panicked List kept its slot")
	}
}

func TestSeatReadFreshInheritsCtx(t *testing.T) {
	f := newSeatReadBoundFixture(t, 16, false)
	close(f.state.release)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := seatWorkForCtx(ctx, f.legs, f.scope).fresh(f.scope).ctx; got != ctx {
		t.Fatalf("fresh ctx = %v, want the parent's", got)
	}
	refuse := seatWorkQuery{scope: RefuseScope{ids: f.scope.ids}, statuses: seatWorkStatuses}
	if _, err := newSeatWork(f.legs).has(refuse); err != nil {
		t.Fatalf("refusing question with no ctx: %v", err)
	}
	if f.state.calls.Load() == 0 {
		t.Error("a refusing question with no ctx read nothing")
	}
}

func TestWorkLegsShareCitySlotsAcrossPasses(t *testing.T) {
	cfg := servingCity("worker")
	mint := func(dir string) WorkLegs {
		return workLegsFromCensus(dir, cfg, cityWorkLeg{store: beads.NewMemStore()}, nil)
	}
	dir := t.TempDir()
	a, b := mint(dir).readSlots(), mint(dir).readOnly().readSlots()
	if a == nil || a != b {
		t.Fatalf("one city's passes: slots %p and %p, want one non-nil channel", a, b)
	}
	if other := mint(t.TempDir()).readSlots(); other == a {
		t.Error("two cities share one slot channel")
	}
	if got := mint("").readSlots(); got != nil {
		t.Errorf("empty city path: slots %p, want nil (no bound)", got)
	}
}
