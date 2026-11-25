package main

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gastownhall/gascity/internal/beads"
)

// One seat read per close transaction (devwork L-engine-seatclose, design
// v2): the close reads the seat once before its lease, reuses that read for
// every section before the close's own, and reads L5 live once more at the
// close. An unreadable seat refuses before the lease, writing nothing.

// seatReadCountingStore counts the seat reads' Lists (live, by assignee)
// made while row is open: a closed row's Lists are its cascade's. delay
// slows every such List, fail fails it, after runs after it with its query.
type seatReadCountingStore struct {
	beads.Store
	row   string
	lists *atomic.Int64
	delay time.Duration
	fail  *atomic.Bool
	after func(q beads.ListQuery)
}

// ConditionalWritesResolveTarget keeps the inner store's fenced writes.
func (s *seatReadCountingStore) ConditionalWritesResolveTarget() beads.Store { return s.Store }

func (s *seatReadCountingStore) List(q beads.ListQuery) ([]beads.Bead, error) {
	if !q.Live || q.Assignee == "" {
		return s.Store.List(q)
	}
	if b, err := s.Store.Get(s.row); err == nil && b.Status != "closed" {
		s.lists.Add(1)
	}
	if s.delay > 0 {
		time.Sleep(s.delay)
	}
	if s.fail != nil && s.fail.Load() {
		return nil, errors.New("seat read list failure")
	}
	rows, err := s.Store.List(q)
	if s.after != nil {
		s.after(q)
	}
	return rows, err
}

// idlePoolSlot is an unmarked pool slot whose runtime is gone, which A21
// closes.
func idlePoolSlot(t *testing.T) *closeCase {
	t.Helper()
	return newCloseCase(t, livenessGone, desireSleep, "state", "asleep", "sleep_reason", "idle", "slept_at", gatherNow.Add(-time.Hour).Format(time.RFC3339))
}

// countSeatReads wires c's work legs through a counting store and returns it.
func countSeatReads(c *closeCase) *seatReadCountingStore {
	s := &seatReadCountingStore{Store: c.store, row: c.k.ID, lists: new(atomic.Int64)}
	c.w.WorkLegs = testWorkLegs(c.w.CityPath, c.cfg, s, nil)
	return s
}

// onSection runs fn as each section's mutation lock is taken, with the
// section's index from 0.
func onSection(t *testing.T, fn func(i int)) {
	t.Helper()
	orig := withRowMutationLock
	var n atomic.Int64
	withRowMutationLock = func(id string, f func() error) error {
		fn(int(n.Add(1) - 1))
		return orig(id, f)
	}
	t.Cleanup(func() { withRowMutationLock = orig })
}

// Kills re-reading the seat in every section: an idle slot's close reads it
// before the lease and once at the close, not once per section as well.
func TestCloseTxSeatReadsTwice(t *testing.T) {
	c := idlePoolSlot(t)
	s := countSeatReads(c)
	var precheck atomic.Int64
	onSection(t, func(i int) {
		if i == 0 {
			precheck.Store(s.lists.Load())
		}
	})
	got := c.run(t, gone().tmux())
	if !got.Closed {
		t.Fatalf("settlement %+v, want the idle slot closed", got)
	}
	per := precheck.Load()
	if per == 0 {
		t.Fatal("the precheck listed nothing: no seat read before the lease")
	}
	if n := s.lists.Load(); n != 2*per {
		t.Fatalf("seat-read Lists %d, want %d: one read before the lease (%d Lists) and one at the close", n, 2*per, per)
	}
}

// Kills the stranded probe re-reading under the Probe's 5 s bound: a seat
// read slower than fenceProbeTimeout, but within the close's read budget,
// stamps the slot's marker naming its work instead of refusing unread.
func TestCloseSlowSeatReadStampsStranded(t *testing.T) {
	if testing.Short() {
		t.Skip("reads slower than fenceProbeTimeout")
	}
	c := idlePoolSlot(t)
	claim := c.work(t, "in_progress", routedClaim())
	s := countSeatReads(c)
	s.delay = fenceProbeTimeout + 500*time.Millisecond
	got := c.run(t, gone().tmux())
	if got.Outcome != settledLanded || c.row(t).Metadata[strandedEventEmittedKey] == "" || len(got.Facts.Events) != 1 {
		t.Fatalf("settlement %+v, want the marker stamped with one session.stranded event", got)
	}
	if p := string(got.Facts.Events[0].Payload); !strings.Contains(p, claim.ID) {
		t.Fatalf("session.stranded payload %s, want it to name %s", p, claim.ID)
	}
}

// Kills taking the lease for a close that can only refuse: an unreadable
// seat refuses work-unread, with its error, before any section runs and
// without writing the row (no lease record, no marker).
func TestCloseUnreadableSeatRefusesBeforeLease(t *testing.T) {
	c := idlePoolSlot(t)
	s := countSeatReads(c)
	s.fail = new(atomic.Bool)
	s.fail.Store(true)
	var sections atomic.Int64
	onSection(t, func(int) { sections.Add(1) })
	rev := c.row(t).Revision
	got := c.run(t, gone().tmux())
	if got.Outcome != settledRefused || got.Cause != causeWorkUnread || got.Err == nil {
		t.Fatalf("settlement %+v, want refused %s with the read's error", got, causeWorkUnread)
	}
	if n := sections.Load(); n != 0 {
		t.Fatalf("%d sections ran, want none: the refusal comes before the lease", n)
	}
	if b := c.row(t); b.Revision != rev || b.Metadata[strandedEventEmittedKey] != "" {
		t.Fatalf("row revision %d (was %d) marker %q, want the row unwritten", b.Revision, rev, b.Metadata[strandedEventEmittedKey])
	}
}

// Guards the branches that act without L5: a killed seat, a repair and an
// orphaned orphan still run on a failed precheck, as before.
func TestCloseUnreadableSeatExemptBranchesRun(t *testing.T) {
	at := gatherNow.Add(-time.Hour).Format(time.RFC3339)
	for name, mk := range map[string]func(t *testing.T) *closeCase{
		"killed": func(t *testing.T) *closeCase {
			return newCloseCase(t, livenessGone, desireSleep, "state", "asleep", "sleep_reason", "killed", "slept_at", at)
		},
		"repair": func(t *testing.T) *closeCase {
			return newCloseCase(t, livenessGone, desireSleep, "state", "asleep", "sleep_reason", "idle", "slept_at", at, strandedEventEmittedKey, at)
		},
		"orphaned": func(t *testing.T) *closeCase {
			c := newCloseCase(t, livenessGone, desireDrain, "state", "asleep")
			c.entry().DrainReason = drainOrphaned
			return c
		},
	} {
		t.Run(name, func(t *testing.T) {
			c := mk(t)
			s := countSeatReads(c)
			s.fail = new(atomic.Bool)
			s.fail.Store(true)
			var sections atomic.Int64
			onSection(t, func(int) { s.fail.Store(false); sections.Add(1) })
			got := c.run(t, gone().tmux())
			if got.Cause == causeWorkUnread || sections.Load() == 0 {
				t.Fatalf("settlement %+v after %d sections, want the effect run", got, sections.Load())
			}
		})
	}
}

// Kills reusing the pre-lease read at the close itself (v5.10a B): a claim
// that lands after the read and before the close holds the close.
func TestCloseNeverClosesSeatWithWork(t *testing.T) {
	c := idlePoolSlot(t)
	countSeatReads(c)
	onSection(t, func(i int) {
		if i == 0 {
			c.work(t, "open", routedClaim())
		}
	})
	got := c.run(t, gone().tmux())
	if got.Closed || c.row(t).Status == "closed" || got.Cause != causeHasWork {
		t.Fatalf("settlement %+v, want refused %s with the row open", got, causeHasWork)
	}
}

// A claim that lands on a leg the close's own read already passed is the
// accepted window (design v2 P2): the close lands, and its cascade takes the
// claim off the closed row (Late), leaving no silent tail.
func TestCloseClaimDuringCloseReadIsReleasedByCascade(t *testing.T) {
	c := idlePoolSlot(t)
	s := countSeatReads(c)
	var section atomic.Int64
	section.Store(-1)
	onSection(t, func(i int) { section.Store(int64(i)) })
	var once sync.Once
	var claimID atomic.Value
	s.after = func(q beads.ListQuery) {
		if section.Load() == 2 && q.Status == "open" && q.Assignee == c.k.ID {
			once.Do(func() { claimID.Store(c.work(t, "open", routedClaim()).ID) })
		}
	}
	got := c.run(t, gone().tmux())
	id, _ := claimID.Load().(string)
	if id == "" {
		t.Fatalf("settlement %+v: no claim landed during the close's read", got)
	}
	if !got.Closed {
		t.Fatalf("settlement %+v, want the close landed over a claim its read did not see", got)
	}
	if b, _ := c.store.Get(id); b.Assignee == c.k.ID {
		t.Fatalf("claim %s still assigned to the closed row: the cascade left a silent tail", id)
	}
}

// Kills a read budget that cannot fit the effect: the pre-lease read, the
// three sections' runtime reads, the stranded Probe and the close's CAS
// reserve leave the close's own L5 read time inside providerEffectDeadline.
func TestCloseBudgetsFitEffectDeadline(t *testing.T) {
	if used := closeSeatReadBudget + 3*fenceProbeTimeout + fenceProbeTimeout + fenceProbeTimeout; used >= providerEffectDeadline {
		t.Fatalf("budgets %v leave nothing of the %v effect deadline for the close's L5", used, providerEffectDeadline)
	}
}

// Kills stamping on a read that did not answer (strandedWork's own rule): a
// failed read is not searched, and its error reaches the step.
func TestStrandedProbeFailedReadNotSearched(t *testing.T) {
	c := idlePoolSlot(t)
	c.work(t, "in_progress", routedClaim())
	var fail atomic.Bool
	fail.Store(true)
	w := *c.w
	w.Env = &reconcileEnv{Cfg: c.cfg}
	v := txView{It: c.decide(), World: &w, Row: c.w.Census.Rows[c.k].Info, Fence: txFence{Work: &txWork{}}}
	got, err := strandedProbe(context.Background(), effectReads{legs: testWorkLegs(w.CityPath, c.cfg, flakyListStore{Store: c.store, fail: &fail}, nil)}, v)
	if got.searched || err == nil {
		t.Fatalf("probe = %+v, %v: want unsearched with the read's error", got, err)
	}
	if step := closeWorkStep(txView{It: v.It, World: &w, Alloc: c.a, Row: v.Row, Meta: c.row(t).Metadata, Fence: v.Fence}, got, err); step.Refuse != causeStrandedUnread || step.Err == nil || len(step.Write) != 0 {
		t.Fatalf("step %+v, want refused %s with its error and no marker", step, causeStrandedUnread)
	}
}

// Kills one cause for two refusals the trace must tell apart: a Probe that
// did not answer refuses stranded-unread, every claim held refuses
// stranded-unstamped, each with its error.
func TestCloseStrandedRefusalCarriesCause(t *testing.T) {
	c := idlePoolSlot(t)
	c.work(t, "in_progress", routedClaim())
	w := *c.w
	w.Env = &reconcileEnv{Cfg: c.cfg}
	v := txView{It: c.decide(), World: &w, Alloc: c.a, Row: c.w.Census.Rows[c.k].Info, Meta: c.row(t).Metadata, Fence: txFence{Work: &txWork{}}}
	if step := closeWorkStep(v, strandedWork{}, errProbeExpired); step.Refuse != causeStrandedUnread || !errors.Is(step.Err, errProbeExpired) {
		t.Fatalf("expired: step %+v, want refused %s with %v", step, causeStrandedUnread, errProbeExpired)
	}
	if step := closeWorkStep(v, strandedWork{searched: true, held: true}, nil); step.Refuse != causeStranded || step.Err == nil {
		t.Fatalf("held: step %+v, want refused %s with an error naming the hold", step, causeStranded)
	}
}

// Kills an unmeasured read: the close's settlement names its pre-lease
// read's bucket, which the pass record counts.
func TestCloseSeatReadDurationCounted(t *testing.T) {
	c := idlePoolSlot(t)
	countSeatReads(c)
	got := c.run(t, gone().tmux())
	if got.SeatRead != closeSeatReadLt5s {
		t.Fatalf("settlement %+v, want seat read bucket %q", got, closeSeatReadLt5s)
	}
	got.Kind = intentClose
	p := newPlanner(newFakePlannerClock(plannerT0), func() time.Duration { return time.Minute }, nil, nil, nil, io.Discard)
	p.observeSettlement(got)
	if n := p.metrics.series[closeSeatReadLt5s]; n != 1 {
		t.Fatalf("series[%s] = %d, want 1", closeSeatReadLt5s, n)
	}
}
