package main

import (
	"context"
	"errors"
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

// Kills: a forwarded Handles() that breaks the sweep's delete path over a
// CachingStore. Every closed row is past deleteAfterClose, so beyond the
// latest-minClosedOrderTrackingRetained floor the sweep deletes up to its
// limit through the scoped store, and the active cache must still hold only
// the open rows afterwards.
func TestOrderTrackingSweepScopedStoreDeletesPastRetentionKeepsCache(t *testing.T) {
	const openRows, closedRows, limit = 200, 2000, 100
	const deleteAfterClose = 7 * 24 * time.Hour
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
	closedIDs := make([]string, 0, closedRows)
	for i := range closedRows {
		id := fmt.Sprintf("track-%04d", i)
		closedIDs = append(closedIDs, id)
		seed = append(seed, beads.Bead{
			ID:        id,
			Title:     "order:digest",
			Status:    "closed",
			Type:      "task",
			CreatedAt: now.Add(-deleteAfterClose - 24*time.Hour - time.Duration(i+1)*time.Second),
			Labels:    []string{"order-run:digest", labelOrderTracking},
		})
	}
	backing := beads.NewMemStoreFrom(openRows+closedRows+1, seed, nil)
	cache := beads.NewCachingStoreForTest(backing, nil)
	if err := cache.Prime(context.Background()); err != nil {
		t.Fatalf("prime: %v", err)
	}
	if primed := cache.Stats().TotalBeads; primed != openRows {
		t.Fatalf("primed cache holds %d rows, want the %d open rows", primed, openRows)
	}

	scoped := orderTrackingSweepScopedStore{Store: cache, label: "city", key: "city"}
	deleted, err := sweepClosedOrderTrackingRetentionBounded(scoped, now, orderTrackingRetentionPolicy{
		deleteAfterClose: deleteAfterClose,
		retainLast:       minClosedOrderTrackingRetained,
	}, nil, limit)
	if err != nil {
		t.Fatalf("sweepClosedOrderTrackingRetentionBounded: %v", err)
	}
	// 2000 closed rows minus the 10-row floor leave 1990 eligible; the limit caps it.
	if deleted != limit {
		t.Fatalf("deleted = %d, want %d (every closed row past retention, capped by the limit)", deleted, limit)
	}
	gone := 0
	for _, id := range closedIDs {
		if _, err := backing.Get(id); errors.Is(err, beads.ErrNotFound) {
			gone++
		} else if err != nil {
			t.Fatalf("backing Get(%s): %v", id, err)
		}
	}
	if gone != deleted {
		t.Fatalf("backing store lost %d closed rows, want the %d the sweep reported deleted", gone, deleted)
	}
	if after := cache.Stats().TotalBeads; after != openRows {
		t.Fatalf("active cache holds %d rows after the deleting sweep, want the %d open rows", after, openRows)
	}
}
