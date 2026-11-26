package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/gastownhall/gascity/internal/beads"
)

// Kills: an orderTrackingSweepScopedStore that hides its store's Handles().
// The retention sweep reads the whole closed order-tracking history through
// beads.LiveFor; without the forward, LiveFor falls back to the logical live
// reader, which lists through CachingStore.List with Live set, and that path
// installs every closed row into the active cache. The cache then stays
// inflated until the next reconcile, and each later List presizes to it.
func TestOrderTrackingSweepScopedStoreLiveReadKeepsCache(t *testing.T) {
	const openRows, closedRows = 200, 2000
	now := time.Date(2026, 11, 26, 4, 0, 0, 0, time.UTC)
	seed := make([]beads.Bead, 0, openRows+closedRows)
	for i := range openRows {
		seed = append(seed, beads.Bead{
			ID:        fmt.Sprintf("open-%04d", i),
			Title:     "work",
			Status:    "open",
			Type:      "task",
			CreatedAt: now.Add(-time.Hour),
		})
	}
	for i := range closedRows {
		seed = append(seed, beads.Bead{
			ID:        fmt.Sprintf("track-%04d", i),
			Title:     "order:digest",
			Status:    "closed",
			Type:      "task",
			CreatedAt: now.Add(-time.Duration(i+1) * time.Second),
			Labels:    []string{"order-run:digest", labelOrderTracking},
		})
	}
	cache := beads.NewCachingStoreForTest(beads.NewMemStoreFrom(openRows+closedRows+1, seed, nil), nil)
	if err := cache.Prime(context.Background()); err != nil {
		t.Fatalf("prime: %v", err)
	}
	before := cache.Stats().TotalBeads
	if before != openRows {
		t.Fatalf("primed cache holds %d rows, want the %d open rows", before, openRows)
	}

	scoped := orderTrackingSweepScopedStore{Store: cache, label: "city", key: "city"}
	// Every closed row is younger than deleteAfterClose, so the sweep keeps
	// them all: the only effect under test is the read.
	deleted, err := sweepClosedOrderTrackingRetentionBounded(scoped, now, orderTrackingRetentionPolicy{
		deleteAfterClose: 7 * 24 * time.Hour,
		retainLast:       minClosedOrderTrackingRetained,
	}, nil, 100)
	if err != nil {
		t.Fatalf("sweepClosedOrderTrackingRetentionBounded: %v", err)
	}
	if deleted != 0 {
		t.Fatalf("deleted = %d, want 0 (every closed row is inside retention)", deleted)
	}
	if after := cache.Stats().TotalBeads; after != before {
		t.Fatalf("active cache grew from %d to %d rows after the sweep's closed-history read, want %d", before, after, before)
	}
}
