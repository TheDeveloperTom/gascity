package events

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/gastownhall/gascity/internal/platform/livefile"
)

// ReadFilteredWithInFlightEach passes fn what ReadFilteredWithInFlight returns
// (the sibling .gz archives, the in-flight events.jsonl.rotating-* files and
// the active log, in seq order) in batches of at most backfillBatch events, so
// memory stays O(batch) instead of growing with the whole history. A positive
// Filter.Limit is an error, since ignoring it would hand the caller the whole
// history.
//
// It is the FileRecorder.Watch resume backfill read to EOF: the active log is
// opened first and its size kept, then the archive and rotating segments are
// listed (listBackfillSources, by first seq) and read through
// openSegmentReader, which reads the derived .gz when a rotating file was
// promoted between the listing and the open. The active log is read last, up to
// the kept size; later appends are left to the caller's tail. A rotation
// between the open and the listing shows the old active log twice, as a
// rotating segment and through the open fd; the seq guard drops the second copy.
//
// The seq guard is segmentReader.readInto's: an event is delivered only when
// its seq is above every seq already delivered. That drops the window a .gz
// archive and its not-yet-removed rotating source both hold, and it relies on
// the log's strictly increasing seq: a seq-0 line or a seq that rolls back is
// dropped, where ReadFilteredWithInFlight returns it. Other differences from
// ReadFilteredWithInFlight: a listed archive that is gone when opened
// (retention reaping) is skipped instead of failing the read, a line longer
// than 1 MiB is read instead of failing the scan, and a Since filter is
// checked per event with no backward walk.
//
// fn must not keep the batch slice after it returns; the next batch reuses it.
// The read stops at fn's first error and returns it. ctx is checked before each
// batch, and ctx's error is returned once it is done.
func ReadFilteredWithInFlightEach(ctx context.Context, path string, filter Filter, fn func([]Event) error) error {
	if filter.Limit > 0 {
		return fmt.Errorf("ReadFilteredWithInFlightEach: Filter.Limit %d is not supported", filter.Limit)
	}
	var active *os.File
	var activeSize int64
	f, err := livefile.Open(path)
	switch {
	case err == nil:
		active = f
		defer active.Close() //nolint:errcheck // read-only file
		info, statErr := active.Stat()
		if statErr != nil {
			return fmt.Errorf("reading events: %w", statErr)
		}
		activeSize = info.Size()
	case !os.IsNotExist(err):
		return fmt.Errorf("reading events: %w", err)
	}
	sources, err := listBackfillSources(filepath.Dir(path), filter.AfterSeq)
	if err != nil {
		return fmt.Errorf("listing event segments: %w", err)
	}

	maxSeq := filter.AfterSeq
	batch := make([]Event, 0, backfillBatch)
	drain := func(sr *segmentReader, name string) error {
		for {
			if err := ctx.Err(); err != nil {
				return err
			}
			done, err := sr.readInto(filter, &maxSeq, &batch, backfillBatch-len(batch))
			if err != nil {
				return fmt.Errorf("reading %q: %w", name, err)
			}
			if len(batch) == backfillBatch {
				if err := fn(batch); err != nil {
					return err
				}
				batch = batch[:0]
			}
			if done {
				return nil
			}
		}
	}
	for _, src := range sources {
		sr, err := openSegmentReader(src)
		if err != nil {
			return fmt.Errorf("reading %q: %w", filepath.Base(src.path), err)
		}
		if sr == nil {
			continue // removed since the listing; see openSegmentReader
		}
		err = drain(sr, filepath.Base(src.path))
		sr.close()
		if err != nil {
			return err
		}
	}
	if active != nil {
		sr, err := activeSegmentReader(active, activeSize)
		if err != nil {
			return fmt.Errorf("reading events: %w", err)
		}
		if err := drain(sr, filepath.Base(path)); err != nil {
			return err
		}
	}
	if len(batch) == 0 {
		return nil
	}
	return fn(batch)
}
