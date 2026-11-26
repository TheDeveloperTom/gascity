package beads

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"
)

// listContextRecorder is a MemStore that records which List it was asked
// for, and with which query and context error.
type listContextRecorder struct {
	*MemStore
	mu         sync.Mutex
	plainQs    []ListQuery
	contextQs  []ListQuery
	contextErr []error
}

func (r *listContextRecorder) List(q ListQuery) ([]Bead, error) {
	r.mu.Lock()
	r.plainQs = append(r.plainQs, q)
	r.mu.Unlock()
	return r.MemStore.List(q)
}

func (r *listContextRecorder) ListContext(ctx context.Context, q ListQuery) ([]Bead, error) {
	r.mu.Lock()
	r.contextQs = append(r.contextQs, q)
	r.contextErr = append(r.contextErr, ctx.Err())
	r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return r.MemStore.List(q)
}

func (r *listContextRecorder) reset() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.plainQs, r.contextQs, r.contextErr = nil, nil, nil
}

// TestLiveForForwardsListContext: the live reader a leg read takes hands its
// context down to the store's ListContext, through every layer between, with
// the query its List would have sent. A layer that hides the capability
// leaves only boundary semantics: the read below runs to its end.
func TestLiveForForwardsListContext(t *testing.T) {
	shapes := map[string]func(Store) StoreReader{
		"the store":                  func(s Store) StoreReader { return s },
		"a CachingStore":             func(s Store) StoreReader { return NewCachingStoreForTest(s, nil) },
		"a federated leg (cached)":   func(s Store) StoreReader { return MintFederatedLeg(NewCachingStoreForTest(s, nil), "rig:r") },
		"a relic leg":                func(s Store) StoreReader { return MintRelicLeg(s, "rig:r") },
		"a resident federated leg":   func(s Store) StoreReader { return MintResidentLeg(MintFederatedLeg(s, "rig:r")) },
		"a relic leg (cached)":       func(s Store) StoreReader { return MintRelicLeg(NewCachingStoreForTest(s, nil), "rig:r") },
		"a federated leg (no cache)": func(s Store) StoreReader { return MintFederatedLeg(s, "rig:r") },
	}
	q := ListQuery{Status: "closed", TierMode: FederatedReadTier}
	for name, over := range shapes {
		rec := &listContextRecorder{MemStore: NewMemStore()}
		reader := over(rec)
		live := LiveFor(reader)

		// What the plain List sends the store.
		rec.reset()
		if _, err := live.List(q); err != nil {
			t.Fatalf("%s: List: %v", name, err)
		}
		if len(rec.plainQs) != 1 {
			t.Fatalf("%s: List reached the store %d times, want once", name, len(rec.plainQs))
		}
		wantQ := rec.plainQs[0]

		// A live context: ListContext reaches the store with the same query.
		rec.reset()
		if _, err := ListContextOf(context.Background(), live, q); err != nil {
			t.Fatalf("%s: ListContextOf: %v", name, err)
		}
		if len(rec.plainQs) != 0 || len(rec.contextQs) != 1 {
			t.Fatalf("%s: ListContextOf reached List %d times and ListContext %d times; want ListContext once, List never (a layer hides ContextLister)",
				name, len(rec.plainQs), len(rec.contextQs))
		}
		if !reflect.DeepEqual(rec.contextQs[0], wantQ) {
			t.Errorf("%s: ListContext got query %+v, want the query List sends %+v", name, rec.contextQs[0], wantQ)
		}

		// An ended context reaches the store, which is the one that stops.
		rec.reset()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err := ListContextOf(ctx, live, q); !errors.Is(err, context.Canceled) {
			t.Errorf("%s: ListContextOf on an ended context = %v, want context.Canceled", name, err)
		}
		if len(rec.contextErr) != 1 || !errors.Is(rec.contextErr[0], context.Canceled) {
			t.Errorf("%s: the store's ListContext saw %v, want one call carrying the ended context", name, rec.contextErr)
		}
	}
}

// plainLister has only List.
type plainLister struct {
	calls int
	rows  []Bead
	// during runs inside List, to end a context mid-read.
	during func()
}

func (p *plainLister) List(ListQuery) ([]Bead, error) {
	p.calls++
	if p.during != nil {
		p.during()
	}
	return p.rows, nil
}

// TestListContextOfBoundarySemantics: a reader without ListContext is not
// started on an ended context, and a read that the context outlived answers
// the context's error, not its rows.
func TestListContextOfBoundarySemantics(t *testing.T) {
	ended, cancel := context.WithCancel(context.Background())
	cancel()
	p := &plainLister{rows: []Bead{{ID: "a"}}}
	if rows, err := ListContextOf(ended, p, ListQuery{AllowScan: true}); !errors.Is(err, context.Canceled) || rows != nil || p.calls != 0 {
		t.Fatalf("ended context: rows %v, err %v, %d List calls; want nil, context.Canceled, none", rows, err, p.calls)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	p = &plainLister{rows: []Bead{{ID: "a"}}, during: cancel}
	if rows, err := ListContextOf(ctx, p, ListQuery{AllowScan: true}); !errors.Is(err, context.Canceled) || rows != nil {
		t.Fatalf("context ended mid-read: rows %v, err %v; want nil, context.Canceled", rows, err)
	}

	p = &plainLister{rows: []Bead{{ID: "a"}}}
	rows, err := ListContextOf(context.Background(), p, ListQuery{AllowScan: true})
	if err != nil || len(rows) != 1 || p.calls != 1 {
		t.Fatalf("live context: rows %v, err %v, %d calls; want the reader's rows", rows, err, p.calls)
	}
	//nolint:staticcheck // a nil context is treated as Background.
	if rows, err := ListContextOf(nil, p, ListQuery{AllowScan: true}); err != nil || len(rows) != 1 {
		t.Fatalf("nil context: rows %v, err %v; want the reader's rows", rows, err)
	}
}
