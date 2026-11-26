package beads

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sync/atomic"
	"testing"
	"time"
)

// These tests pin SQLiteStore.ListContext, the List a supervisor `gc ready
// --status` leg read takes under its request's context: once that context
// ends, the read stops within one row, hands back ctx.Err() rather than rows,
// and frees its read-pool connection.

// cancelAfterErrCheckContext answers Err() with the context's current error
// and only THEN cancels, on check cancelAt. The check that triggers the cancel
// still sees a live context, so the read goes on past it and only a later
// context-aware step can notice.
type cancelAfterErrCheckContext struct {
	context.Context
	cancel   context.CancelFunc
	cancelAt int64
	checks   atomic.Int64
}

func (c *cancelAfterErrCheckContext) Err() error {
	err := c.Context.Err()
	if c.checks.Add(1) >= c.cancelAt {
		c.cancel()
	}
	return err
}

func seedOpenSQLiteBeads(t *testing.T, store *SQLiteStore, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if _, err := store.Create(Bead{Title: fmt.Sprintf("list-%02d", i), Type: "task", Status: "open"}); err != nil {
			t.Fatalf("Create bead %d: %v", i, err)
		}
	}
}

func TestSQLiteStoreSatisfiesContextLister(t *testing.T) {
	store := newReadySQLiteStore(t)
	if _, ok := Store(store).(ContextLister); !ok {
		t.Fatal("SQLiteStore does not satisfy ContextLister; a leg List cannot stop when its request ends")
	}
}

// TestSQLiteStoreListContextStopsMidScan cancels once the scan is in flight,
// which an entry-only ctx.Err() check cannot catch.
func TestSQLiteStoreListContextStopsMidScan(t *testing.T) {
	store := newReadySQLiteStore(t)
	seedOpenSQLiteBeads(t, store, 64)

	base, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx := &cancelOnErrCheckContext{Context: base, cancel: cancel, cancelAt: 4}

	rows, err := store.ListContext(ctx, ListQuery{Status: "open"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("ListContext error = %v, want context.Canceled (rows = %d)", err, len(rows))
	}
	if len(rows) != 0 {
		t.Fatalf("ListContext returned %d beads after cancellation, want none", len(rows))
	}
	if checks := ctx.checks.Load(); checks < ctx.cancelAt {
		t.Fatalf("context checks = %d, want at least %d; the scan never consulted the context", checks, ctx.cancelAt)
	}
}

// TestSQLiteStoreListContextCancelsBeforeHydratingDeps lets the whole scan
// finish on a live context and cancels at the last scan-side check, after it
// has answered. Only the dependency read that follows can see the cancel: a
// ListContext that hydrates its rows' edges under context.Background() hands
// back every row (and, in production, queues for a pool connection with no
// way out).
func TestSQLiteStoreListContextCancelsBeforeHydratingDeps(t *testing.T) {
	const n = 16
	store := newReadySQLiteStore(t)
	seedOpenSQLiteBeads(t, store, n)

	base, cancel := context.WithCancel(context.Background())
	defer cancel()
	// One entry check, one per row, one after the loop: the cancel lands
	// after the scan's last check has answered nil.
	ctx := &cancelAfterErrCheckContext{Context: base, cancel: cancel, cancelAt: 1 + n + 1}

	rows, err := store.ListContext(ctx, ListQuery{Status: "open"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("ListContext error = %v, want context.Canceled (rows = %d); the dependency read ignored the context", err, len(rows))
	}
	if len(rows) != 0 {
		t.Fatalf("ListContext returned %d beads after cancellation, want none", len(rows))
	}
	if checks := ctx.checks.Load(); checks < ctx.cancelAt {
		t.Fatalf("context checks = %d, want at least %d; the scan did not check once per row", checks, ctx.cancelAt)
	}
}

// TestSQLiteStoreListContextCancelsWhileWaitingForAConnection saturates the
// read pool so the list query cannot start. Only a context that reaches the
// database/sql call can abandon that wait.
func TestSQLiteStoreListContextCancelsWhileWaitingForAConnection(t *testing.T) {
	store := newReadySQLiteStore(t)
	seedOpenSQLiteBeads(t, store, 4)

	store.readDB.SetMaxOpenConns(1)
	held, err := store.readDB.Conn(context.Background())
	if err != nil {
		t.Fatalf("Conn: %v", err)
	}
	defer held.Close() //nolint:errcheck

	base, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx := &observedErrContext{Context: base, checked: make(chan struct{})}
	done := make(chan error, 1)
	go func() {
		_, err := store.ListContext(ctx, ListQuery{Status: "open"})
		done <- err
	}()

	select {
	case <-ctx.checked: // the entry guard ran and saw a live context
	case <-time.After(beadsHangBudget):
		t.Fatal("ListContext never checked its context")
	}
	// Cancel only once the read is parked in the pool wait, so the cancel is
	// seen by that wait, not by DB.conn's entry check.
	deadline := time.Now().Add(beadsHangBudget)
	for store.readDB.Stats().WaitCount == 0 {
		if time.Now().After(deadline) {
			t.Fatal("ListContext never queued for a read connection")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()

	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("ListContext error = %v, want context.Canceled", err)
		}
	case <-time.After(beadsHangBudget):
		_ = held.Close()
		<-done
		t.Fatal("ListContext kept waiting for a read connection after cancellation")
	}
}

// TestSQLiteStoreListContextMatchesList: under a live context ListContext
// answers exactly what List does, edges included.
func TestSQLiteStoreListContextMatchesList(t *testing.T) {
	store := newReadySQLiteStore(t)
	seedOpenSQLiteBeads(t, store, 8)
	a, err := store.Create(Bead{Title: "blocked", Type: "task", Status: "open"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := store.Create(Bead{Title: "blocker", Type: "task", Status: "open"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DepAdd(a.ID, b.ID, "blocks"); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for _, q := range []ListQuery{
		{Status: "open"},
		{Status: "open", Sort: SortCreatedAsc, Limit: 3},
		{AllowScan: true},
	} {
		want, err := store.List(q)
		if err != nil {
			t.Fatalf("List(%+v): %v", q, err)
		}
		got, err := store.ListContext(ctx, q)
		if err != nil {
			t.Fatalf("ListContext(%+v): %v", q, err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("ListContext(%+v) = %+v, want List's %+v", q, got, want)
		}
	}
	if _, err := store.ListContext(ctx, ListQuery{}); !errors.Is(err, ErrQueryRequiresScan) {
		t.Errorf("ListContext with no filter = %v, want ErrQueryRequiresScan", err)
	}
}

func TestSQLiteStoreListBackgroundSkipsErrChecks(t *testing.T) {
	store := newReadySQLiteStore(t)
	seedOpenSQLiteBeads(t, store, 8)

	ctx := &countingErrContext{Context: context.Background()}
	rows, err := store.ListContext(ctx, ListQuery{Status: "open"})
	if err != nil {
		t.Fatalf("ListContext: %v", err)
	}
	if len(rows) == 0 {
		t.Fatal("ListContext returned no beads for an uncancellable context")
	}
	// One check is the entry guard; the per-row loop must skip a context
	// that can never be canceled.
	if checks := ctx.checks.Load(); checks > 1 {
		t.Fatalf("uncancellable context checks = %d, want at most the single entry guard", checks)
	}
}

// TestLegListContextStopsARealSQLiteReadMidScan runs the controller's chain
// end to end: a class handle over a federated leg over a CachingStore over a
// real SQLiteStore, read the way readywork's listRead reads it. A cancel that
// lands mid-scan stops the SQLite scan, and the answer is the context's error
// with no rows.
func TestLegListContextStopsARealSQLiteReadMidScan(t *testing.T) {
	store := newReadySQLiteStore(t)
	seedOpenSQLiteBeads(t, store, 64)
	leg := WorkStore{Store: MintResidentLeg(MintFederatedLeg(NewCachingStoreForTest(store, nil), "rig:r"))}

	base, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx := &cancelOnErrCheckContext{Context: base, cancel: cancel, cancelAt: 4}

	rows, err := ListContextOf(ctx, LiveFor(leg), ListQuery{Status: "open", TierMode: FederatedReadTier})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("ListContextOf through the leg = %v, want context.Canceled (rows = %d)", err, len(rows))
	}
	if len(rows) != 0 {
		t.Fatalf("ListContextOf through the leg returned %d beads after cancellation, want none", len(rows))
	}
	if checks := ctx.checks.Load(); checks < ctx.cancelAt {
		t.Fatalf("context checks = %d, want at least %d; the SQLite scan never saw the context", checks, ctx.cancelAt)
	}
}

// TestSQLiteStoreListContextRefusesAScanBeforeCheckingTheContext: a query
// with no filter is refused as List refuses it, whatever the context's state,
// so both answer the same error first.
func TestSQLiteStoreListContextRefusesAScanBeforeCheckingTheContext(t *testing.T) {
	store := newReadySQLiteStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := store.List(ListQuery{}); !errors.Is(err, ErrQueryRequiresScan) {
		t.Fatalf("List with no filter = %v, want ErrQueryRequiresScan", err)
	}
	if _, err := store.ListContext(ctx, ListQuery{}); !errors.Is(err, ErrQueryRequiresScan) {
		t.Fatalf("ListContext with no filter on an ended context = %v, want ErrQueryRequiresScan, as List answers", err)
	}
}

func TestSQLiteStoreListContextExpiredAtEntry(t *testing.T) {
	store := newReadySQLiteStore(t)
	seedOpenSQLiteBeads(t, store, 2)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rows, err := store.ListContext(ctx, ListQuery{Status: "open"})
	if !errors.Is(err, context.Canceled) || len(rows) != 0 {
		t.Fatalf("ListContext on an ended context = %d rows, %v; want none and context.Canceled", len(rows), err)
	}
}
