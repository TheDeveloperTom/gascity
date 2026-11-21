package main

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gastownhall/gascity/internal/beads"
	sessionpkg "github.com/gastownhall/gascity/internal/session"
)

// gatedState is what every gatedListStore of one test shares: how many Lists
// started, how many run now and at most, and the gate they block on.
type gatedState struct {
	calls, cur, max *atomic.Int64
	release         chan struct{}
	panicOnce       *atomic.Bool
	onList          *atomic.Pointer[func()] // when set, runs after each List returns
}

func newGatedState() gatedState {
	return gatedState{
		calls:     new(atomic.Int64),
		cur:       new(atomic.Int64),
		max:       new(atomic.Int64),
		release:   make(chan struct{}),
		panicOnce: new(atomic.Bool),
		onList:    new(atomic.Pointer[func()]),
	}
}

// ConditionalWritesResolveTarget keeps the inner store's fenced writes, which
// a release takes (releaseWorkAssignmentIfRevisionMatches).
func (g gatedListStore) ConditionalWritesResolveTarget() beads.Store { return g.Store }

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
	if hook := g.onList.Load(); hook != nil {
		defer (*hook)()
	}
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

// fullSlotsFixture is a fixture whose two slots an abandoned read holds.
func fullSlotsFixture(t *testing.T) *seatReadBoundFixture {
	t.Helper()
	f := newSeatReadBoundFixture(t, 2, true)
	f.releaseAtCleanup(t)
	go func() { _, _ = seatWorkFor(f.legs, f.scope).has(f.q) }() // abandoned
	waitForCur(t, f.state, 2)
	return f
}

// effectPassOver is the pass a planner mints over f's legs.
func (f *seatReadBoundFixture) effectPassOver() *effectPass {
	return newEffectPass(&World{WorkLegs: f.legs, Env: &reconcileEnv{Cfg: f.legs.cfg}}, nil)
}

// drainAbandoned opens the gate and waits until every List that will start
// has run: the abandoned read's own 8, plus any a give-up read started late.
func (f *seatReadBoundFixture) drainAbandoned(t *testing.T) {
	t.Helper()
	close(f.state.release)
	waitForCur(t, f.state, 0)
	time.Sleep(100 * time.Millisecond)
	waitForCur(t, f.state, 0)
}

func TestFenceL5ExpiryStartsNoNewSeatList(t *testing.T) {
	f := fullSlotsFixture(t)
	p := f.effectPassOver()
	row := sessionInfoForBoundTest()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	now := time.Now()
	fence := readLegs(ctx, nil, "s", needs{Legs: legWork}, now, now, func(ctx context.Context) *txWork {
		return p.readWork(ctx, row, intent{Kind: intentClose})
	})
	if fence.Work == nil || fence.Work.Free || fence.Work.Err == nil {
		t.Fatalf("L5 = %+v, want not free with an error (fail closed)", fence.Work)
	}
	time.Sleep(50 * time.Millisecond) // the abandoned L5 read's Lists give up
	f.drainAbandoned(t)
	if got := f.state.calls.Load(); got != 8 {
		t.Errorf("Lists started = %d, want 8 (the abandoned read's only: the expired L5 started none)", got)
	}
}

func TestCloseWorthRunningGivesUpOnSlotWait(t *testing.T) {
	f := fullSlotsFixture(t)
	row := sessionInfoForBoundTest()
	a := aroundCaps{
		it:      intent{Kind: intentClose, Closing: closeSpec{Kind: closeOrphan, Orphaned: true, Row: row}},
		reads:   f.effectPassOver().reads,
		release: &closeReleases{cfg: f.legs.cfg},
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan bool, 1)
	go func() { done <- closeWorthRunning(ctx, a) }()
	select {
	case run := <-done:
		if !run {
			t.Fatal("closeWorthRunning = false on an unread L5, want true (a failed read runs, and the effect decides)")
		}
	case <-time.After(time.Second):
		t.Fatal("closeWorthRunning waited for a slot past its ctx")
	}
	f.drainAbandoned(t)
	if got := f.state.calls.Load(); got != 8 {
		t.Errorf("Lists started = %d, want 8 (the precheck started none)", got)
	}
}

// The precheck's stranded re-read (onlyStrandedWork) takes the effect's ctx
// too: once it has ended, the re-read starts no List and the close runs (the
// effect decides), never a refusal on a read nobody waits for.
func TestCloseWorthRunningStrandedReReadGivesUp(t *testing.T) {
	f := newSeatReadBoundFixture(t, 16, false)
	close(f.state.release)
	row := sessionInfoForBoundTest()
	mustCreateDrainAckBead(t, f.work.Store, beads.Bead{Title: "stranded", Type: "task", Metadata: map[string]string{"gc.routed_to": "nowhere/lane"}}, "open", row.ID)
	scope := releaseScope(row, f.legs.cfg)
	if has, err := seatWorkFor(f.legs, scope).has(seatWorkQuery{scope: scope, statuses: seatWorkStatuses}); !has || err != nil {
		t.Fatalf("setup: seat read = %v, %v; want the stranded claim", has, err)
	}
	perRead := f.state.calls.Swap(0)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	hook := func() { cancel() } // the deadline passes while the first read runs
	f.state.onList.Store(&hook)
	a := aroundCaps{
		it:      intent{Kind: intentClose, Closing: closeSpec{Kind: closeOrphan, Orphaned: true, Row: row}},
		reads:   f.effectPassOver().reads,
		release: &closeReleases{cfg: f.legs.cfg},
	}
	if !closeWorthRunning(ctx, a) {
		t.Fatal("closeWorthRunning = false after its ctx ended, want true (the effect decides)")
	}
	if got := f.state.calls.Load(); got != perRead {
		t.Errorf("Lists started = %d, want %d (the first read's only: the re-read after the deadline started none)", got, perRead)
	}
}

// A read takes every slot it needs at once or none: with slots only partly
// free when its ctx ends, it starts no List.
func TestSeatReadTakesAllSlotsOrNone(t *testing.T) {
	f := newSeatReadBoundFixture(t, 10, true)
	f.releaseAtCleanup(t)
	go func() { _, _ = seatWorkFor(f.legs, f.scope).has(f.q) }() // abandoned: holds 8, 2 stay free
	waitForCur(t, f.state, 8)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := seatWorkForCtx(ctx, f.legs, f.scope).has(f.q)
		done <- err
	}()
	select {
	case err := <-done:
		if !errors.Is(err, errSeatReadNoSlot) {
			t.Errorf("err = %v, want errSeatReadNoSlot", err)
		}
	case <-time.After(time.Second):
		t.Error("the ctx'd read did not give up: it started Lists on the free slots and waits on them")
	}
	f.drainAbandoned(t)
	if got := f.state.calls.Load(); got != 8 {
		t.Errorf("Lists started = %d, want 8 (the abandoned read's only: the ctx'd read started none of its 8)", got)
	}
}

func TestReleaseClaimsWaitsForSlotAndWritesOnce(t *testing.T) {
	f := newSeatReadBoundFixture(t, 2, false)
	f.releaseAtCleanup(t)
	claim := mustCreateDrainAckBead(t, f.work.Store, beads.Bead{Title: "orphaned", Type: "task", Metadata: map[string]string{"gc.routed_to": "worker"}}, "open", "worker-1")
	claim, err := f.work.Store.Get(claim.ID) // the row as stored: the helper returns it before its claim update
	if err != nil {
		t.Fatal(err)
	}
	other := mustCreateDrainAckBead(t, f.work.Store, beads.Bead{Title: "unrelated", Type: "task"}, "", "")
	go func() { _, _ = seatWorkFor(f.legs, f.scope).has(f.q) }() // abandoned: holds both slots
	waitForCur(t, f.state, 2)

	type released struct {
		out ReleaseOutcome
		err error
	}
	done := make(chan released, 1)
	go func() {
		out, err := ReleaseClaims(seatWorkFor(f.legs, f.scope), f.scope, releaseSeat{id: "s-1"}, releaseOrphan, ReleaseOpts{})
		done <- released{out, err}
	}()
	select {
	case r := <-done:
		t.Fatalf("release returned while slots were full: %+v, %v", r.out, r.err)
	case <-time.After(100 * time.Millisecond):
	}
	// A release writes through the inner store's fenced writer, so its writes
	// show as the claim's revision.
	if got, _ := f.work.Store.Get(claim.ID); got.Revision != claim.Revision || got.Assignee != "worker-1" {
		t.Fatalf("claim while waiting for a slot: rev %d assignee %q, want rev %d still worker-1's", got.Revision, got.Assignee, claim.Revision)
	}
	direct := make(chan error, 1)
	go func() { direct <- f.work.Update(other.ID, beads.UpdateOpts{Labels: []string{"touched"}}) }()
	select {
	case err := <-direct:
		if err != nil {
			t.Fatalf("direct update: %v", err)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("a direct write waited on the seat-read bound")
	}
	close(f.state.release)
	r := <-done
	if r.err != nil || len(r.out.Released) != 1 || r.out.Released[0].bead.ID != claim.ID {
		t.Fatalf("release = %+v, %v; want %s released", r.out, r.err, claim.ID)
	}
	got, _ := f.work.Store.Get(claim.ID)
	if got.Assignee != "" || got.Revision != claim.Revision+1 {
		t.Errorf("released claim: rev %d assignee %q, want rev %d unassigned (one write)", got.Revision, got.Assignee, claim.Revision+1)
	}
}

func TestSeatReadCtxOnlyOnReadOnlyLegs(t *testing.T) {
	f := newSeatReadBoundFixture(t, 16, false)
	close(f.state.release)
	p := f.effectPassOver()
	n := 0
	p.reads.legs.each(func(s beads.Store) {
		n++
		if _, err := s.Create(beads.Bead{Title: "x"}); err == nil {
			t.Fatal("a ctx-carrying read's leg accepted a write")
		}
	})
	if n == 0 {
		t.Fatal("the pass holds no legs")
	}
}

// sessionInfoForBoundTest is a dead seat's row whose identities are the
// fixture's scope.
func sessionInfoForBoundTest() sessionpkg.Info {
	return sessionpkg.Info{ID: "s-1", Alias: "worker-1"}
}
