package events

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// eachEpoch stamps the fixture archive and rotating names; each segment adds
// minutes so the names stay distinct and in chronological order.
var eachEpoch = time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)

// writeArchiveSeqs writes seqs as the canonical .gz archive for their window,
// gzipped from a throwaway source outside dir.
func writeArchiveSeqs(t *testing.T, dir string, minute int, seqs []uint64) string {
	t.Helper()
	src := filepath.Join(t.TempDir(), "archive-source.jsonl")
	writeJSONLEvents(t, src, seqs...)
	dest := filepath.Join(dir, formatArchiveBasename(eachEpoch.Add(time.Duration(minute)*time.Minute), seqs[0], seqs[len(seqs)-1]))
	var stderr bytes.Buffer
	if err := gzipAndArchive(src, dest, &stderr); err != nil {
		t.Fatalf("gzipAndArchive: %v (stderr %q)", err, stderr.String())
	}
	return dest
}

// writeRotatingSeqs writes seqs as an in-flight rotating-* file the recorder
// has not gzipped yet.
func writeRotatingSeqs(t *testing.T, dir string, minute int, seqs []uint64) string {
	t.Helper()
	p := filepath.Join(dir, formatRotatingBasename(eachEpoch.Add(time.Duration(minute)*time.Minute), seqs[0], seqs[len(seqs)-1]))
	writeJSONLEvents(t, p, seqs...)
	return p
}

// collectEach runs ReadFilteredWithInFlightEach to completion and returns the
// delivered events. It fails the test if any batch exceeds backfillBatch.
func collectEach(t *testing.T, path string, filter Filter) []Event {
	t.Helper()
	var got []Event
	err := ReadFilteredWithInFlightEach(context.Background(), path, filter, func(batch []Event) error {
		if len(batch) == 0 || len(batch) > backfillBatch {
			t.Errorf("batch of %d events, want 1..%d", len(batch), backfillBatch)
		}
		got = append(got, batch...)
		return nil
	})
	if err != nil {
		t.Fatalf("ReadFilteredWithInFlightEach: %v", err)
	}
	return got
}

// TestReadFilteredWithInFlightEachMatchesSliceRead holds the streaming reader to
// the slice reader it replaces in the run projector's cold load: the same events
// in the same order across archives, in-flight rotating files, a .gz/rotating
// twin, a promotion racing the listing, a missing active log and a missing
// directory. Each reader gets its own fresh fixture, so a promotion hook fires
// once per reader.
func TestReadFilteredWithInFlightEachMatchesSliceRead(t *testing.T) {
	promotingSetup := func(timing string) func(t *testing.T) string {
		return func(t *testing.T) string {
			dir := t.TempDir()
			path := filepath.Join(dir, "events.jsonl")
			rotating := writeRotatingSeqs(t, dir, 5, []uint64{1, 2})
			archive := filepath.Join(dir, formatArchiveBasename(eachEpoch.Add(5*time.Minute), 1, 2))
			writeJSONLEvents(t, path, 3)
			promoted := false
			promote := func() {
				if promoted {
					return
				}
				promoted = true
				var stderr bytes.Buffer
				if err := gzipAndArchive(rotating, archive, &stderr); err != nil {
					t.Fatalf("promote rotating file: %v (stderr %q)", err, stderr.String())
				}
			}
			previous := readRotationDir
			t.Cleanup(func() { readRotationDir = previous })
			readRotationDir = func(dir string) ([]os.DirEntry, error) {
				if timing == "before listing" {
					promote()
					return os.ReadDir(dir)
				}
				entries, err := os.ReadDir(dir) // "between list and open"
				promote()
				return entries, err
			}
			return path
		}
	}

	cases := []struct {
		name  string
		setup func(t *testing.T) string
	}{
		{"archives, in-flight rotating and active over many batches", func(t *testing.T) string {
			dir := t.TempDir()
			writeArchiveSeqs(t, dir, 0, seqRange(1, 300))
			writeArchiveSeqs(t, dir, 1, seqRange(301, 600))
			writeRotatingSeqs(t, dir, 2, seqRange(601, 800))
			path := filepath.Join(dir, "events.jsonl")
			writeJSONLEvents(t, path, seqRange(801, 1000)...)
			return path
		}},
		{"archive and its rotating twin share a window", func(t *testing.T) string {
			dir := t.TempDir()
			writeRotatingSeqs(t, dir, 5, []uint64{2, 3})
			writeArchiveSeqs(t, dir, 5, []uint64{2, 3})
			path := filepath.Join(dir, "events.jsonl")
			writeJSONLEvents(t, path, 4)
			return path
		}},
		{"rotating promoted before listing", promotingSetup("before listing")},
		{"rotating promoted between list and open", promotingSetup("between list and open")},
		{"no active log after a rotation", func(t *testing.T) string {
			dir := t.TempDir()
			writeArchiveSeqs(t, dir, 0, seqRange(1, 3))
			writeRotatingSeqs(t, dir, 1, seqRange(4, 6))
			return filepath.Join(dir, "events.jsonl")
		}},
		{"missing directory", func(t *testing.T) string {
			return filepath.Join(t.TempDir(), "absent", "events.jsonl")
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			want, err := ReadFilteredWithInFlight(tc.setup(t), Filter{})
			if err != nil {
				t.Fatalf("ReadFilteredWithInFlight: %v", err)
			}
			got := collectEach(t, tc.setup(t), Filter{})
			if !reflect.DeepEqual(seqsOf(got), seqsOf(want)) {
				t.Fatalf("streamed seqs = %v\nslice seqs    = %v", seqsOf(got), seqsOf(want))
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("streamed events differ from the slice read:\n got  %+v\n want %+v", got, want)
			}
		})
	}
}

// TestReadFilteredWithInFlightEachStopsAtFnError proves the reader hands the
// history over in bounded batches instead of collecting it first: fn stops on
// the first batch, so at most one batch arrives and fn's error comes back. The
// archive after the first one is not gzip at all; a reader that collected the
// whole history before calling fn would fail on it instead.
func TestReadFilteredWithInFlightEachStopsAtFnError(t *testing.T) {
	dir := t.TempDir()
	writeArchiveSeqs(t, dir, 0, seqRange(1, 600))
	corrupt := filepath.Join(dir, formatArchiveBasename(eachEpoch.Add(time.Minute), 601, 800))
	if err := os.WriteFile(corrupt, []byte("not a gzip stream\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "events.jsonl")
	writeJSONLEvents(t, path, seqRange(801, 1000)...)

	errStop := errors.New("stop")
	calls, received := 0, 0
	err := ReadFilteredWithInFlightEach(context.Background(), path, Filter{}, func(batch []Event) error {
		calls++
		received += len(batch)
		return errStop
	})
	if !errors.Is(err, errStop) {
		t.Fatalf("err = %v, want fn's stop error", err)
	}
	if calls != 1 {
		t.Fatalf("fn called %d times after it returned an error, want 1", calls)
	}
	if received == 0 || received > backfillBatch {
		t.Fatalf("received %d events before stopping, want 1..%d of the 1000 on disk", received, backfillBatch)
	}
}

// TestReadFilteredWithInFlightEachDropsSeqNotAboveDelivered pins the monotonic
// seq guard the stream inherits from the Watch backfill (segmentReader.readInto
// keeps an event only when its seq is above every seq already delivered). The
// guard is what drops the copy of a window that a .gz archive and its
// not-yet-removed rotating source both hold. It also drops a seq-0 line and any
// seq that rolls back, which ReadFilteredWithInFlight would return, so callers
// rely on the log's strictly increasing seq.
func TestReadFilteredWithInFlightEachDropsSeqNotAboveDelivered(t *testing.T) {
	dir := t.TempDir()
	writeArchiveSeqs(t, dir, 0, []uint64{1, 2, 3})
	path := filepath.Join(dir, "events.jsonl")
	// seq 0, a rollback to 2, then a repeat of 4.
	writeJSONLEvents(t, path, 0, 4, 2, 4, 5)

	got := collectEach(t, path, Filter{})
	if seqs := seqsOf(got); !reflect.DeepEqual(seqs, []uint64{1, 2, 3, 4, 5}) {
		t.Fatalf("seqs = %v, want [1 2 3 4 5]: lines at or below the delivered seq are dropped", seqs)
	}
}

// TestReadFilteredWithInFlightEachRejectsLimit: the stream does not implement
// Filter.Limit, and ignoring it would hand a caller the whole history.
func TestReadFilteredWithInFlightEachRejectsLimit(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "events.jsonl")
	writeJSONLEvents(t, path, 1, 2, 3)

	called := false
	err := ReadFilteredWithInFlightEach(context.Background(), path, Filter{Limit: 1}, func([]Event) error {
		called = true
		return nil
	})
	if err == nil {
		t.Fatal("err = nil, want an error for Filter.Limit > 0")
	}
	if called {
		t.Fatal("fn was called although the filter was rejected")
	}
}

// TestReadFilteredWithInFlightEachStopsOnCanceledContext: a canceled caller gets
// ctx's error back and no batch.
func TestReadFilteredWithInFlightEachStopsOnCanceledContext(t *testing.T) {
	dir := t.TempDir()
	writeArchiveSeqs(t, dir, 0, seqRange(1, 300))
	path := filepath.Join(dir, "events.jsonl")
	writeJSONLEvents(t, path, seqRange(301, 400)...)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	err := ReadFilteredWithInFlightEach(ctx, path, Filter{}, func([]Event) error {
		called = true
		return nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if called {
		t.Fatal("fn was called on a canceled context")
	}
}

// TestReadFilteredWithInFlightEachSkipsArchiveRemovedAfterListing pins the
// stream's answer when retention reaping removes a listed archive before it is
// opened: the archive is skipped (openSegmentReader returns no reader), where
// ReadFilteredWithInFlight fails the read.
func TestReadFilteredWithInFlightEachSkipsArchiveRemovedAfterListing(t *testing.T) {
	dir := t.TempDir()
	writeArchiveSeqs(t, dir, 0, seqRange(1, 3))
	reaped := writeArchiveSeqs(t, dir, 1, seqRange(4, 6))
	path := filepath.Join(dir, "events.jsonl")
	writeJSONLEvents(t, path, 7, 8)

	previous := readRotationDir
	t.Cleanup(func() { readRotationDir = previous })
	readRotationDir = func(dir string) ([]os.DirEntry, error) {
		entries, err := os.ReadDir(dir)
		if rmErr := os.Remove(reaped); rmErr != nil && !os.IsNotExist(rmErr) {
			t.Fatalf("reap archive: %v", rmErr)
		}
		return entries, err
	}

	got := collectEach(t, path, Filter{})
	if seqs := seqsOf(got); !reflect.DeepEqual(seqs, []uint64{1, 2, 3, 7, 8}) {
		t.Fatalf("seqs = %v, want [1 2 3 7 8]: the reaped archive is skipped", seqs)
	}
}
