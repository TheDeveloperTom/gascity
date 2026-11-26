package main

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/gastownhall/gascity/internal/beads"
)

// policyListContextRecorder records the List and ListContext calls that reach
// the store below a policy wrapper.
type policyListContextRecorder struct {
	*beads.MemStore
	plainQs   []beads.ListQuery
	contextQs []beads.ListQuery
	ctxErrs   []error
}

func (r *policyListContextRecorder) List(q beads.ListQuery) ([]beads.Bead, error) {
	r.plainQs = append(r.plainQs, q)
	return r.MemStore.List(q)
}

func (r *policyListContextRecorder) ListContext(ctx context.Context, q beads.ListQuery) ([]beads.Bead, error) {
	r.contextQs = append(r.contextQs, q)
	r.ctxErrs = append(r.ctxErrs, ctx.Err())
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return r.MemStore.List(q)
}

// TestBeadPolicyLiveReaderForwardsListContext: the policy store's live handle
// (a controller leg's) hands a context-bound list down to the store with the
// policy-expanded tier its List sends, rather than hiding ContextLister behind
// the embedded LiveReader interface.
func TestBeadPolicyLiveReaderForwardsListContext(t *testing.T) {
	rec := &policyListContextRecorder{MemStore: beads.NewMemStore()}
	policy := &beadPolicyStore{Store: rec}
	live := beads.LiveFor(policy)
	q := beads.ListQuery{Status: "closed", TierMode: beads.TierIssues}

	if _, err := live.List(q); err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(rec.plainQs) != 1 {
		t.Fatalf("List reached the store %d times, want once", len(rec.plainQs))
	}
	wantQ := rec.plainQs[0]
	if wantQ.TierMode != beads.TierBoth {
		t.Fatalf("the policy List sent tier %v, want the expanded TierBoth; the fixture no longer exercises the expansion", wantQ.TierMode)
	}
	rec.plainQs = nil

	if _, err := beads.ListContextOf(context.Background(), live, q); err != nil {
		t.Fatalf("ListContextOf: %v", err)
	}
	if len(rec.plainQs) != 0 || len(rec.contextQs) != 1 {
		t.Fatalf("ListContextOf reached List %d times and ListContext %d times; want ListContext once (the policy live reader hides ContextLister)",
			len(rec.plainQs), len(rec.contextQs))
	}
	if !reflect.DeepEqual(rec.contextQs[0], wantQ) {
		t.Errorf("ListContext got %+v, want the query List sends %+v", rec.contextQs[0], wantQ)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := beads.ListContextOf(ctx, live, q); !errors.Is(err, context.Canceled) {
		t.Errorf("ListContextOf on an ended context = %v, want context.Canceled", err)
	}
	if len(rec.ctxErrs) != 2 || !errors.Is(rec.ctxErrs[1], context.Canceled) {
		t.Errorf("the store's ListContext saw %v, want the ended context on the second call", rec.ctxErrs)
	}
}
