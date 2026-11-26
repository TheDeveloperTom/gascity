package runproj

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"github.com/gastownhall/gascity/internal/events"
)

// maxColdLoadBatch is the largest batch the streaming reader hands the cold
// load (events.backfillBatch).
const maxColdLoadBatch = 256

// writeEventLines writes evts to path as JSONL, gzip-compressed when gz is set.
func writeEventLines(t *testing.T, path string, evts []events.Event, gz bool) {
	t.Helper()
	var buf bytes.Buffer
	var w io.Writer = &buf
	var zw *gzip.Writer
	if gz {
		zw = gzip.NewWriter(&buf)
		w = zw
	}
	for _, e := range evts {
		line, err := json.Marshal(e)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(append(line, '\n')); err != nil {
			t.Fatal(err)
		}
	}
	if zw != nil {
		if err := zw.Close(); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

// createdEvents returns bead.created events for seqs first..last, one new bead
// per seq.
func createdEvents(first, last uint64) []events.Event {
	out := make([]events.Event, 0, last-first+1)
	for seq := first; seq <= last; seq++ {
		out = append(out, beadEvent(seq, events.BeadCreated, fmt.Sprintf("c%d", seq), "open"))
	}
	return out
}

// writeColdLoadHistory writes a 900-event log split the way a live city's is: a
// rotated .gz archive (seq 1-400), an in-flight rotating-* file the recorder has
// not gzipped yet (401-600) and the active log (601-900). It reuses 150 bead
// ids, so ids are created, updated, deleted and re-created across the segment
// boundaries. Every 10th event is not a bead event, and every 97th is a bead
// event whose payload does not decode.
func writeColdLoadHistory(t *testing.T, dir string) string {
	t.Helper()
	const total = 900
	evts := make([]events.Event, 0, total)
	live := make(map[string]bool)
	for seq := uint64(1); seq <= total; seq++ {
		switch {
		case seq%97 == 0:
			evts = append(evts, events.Event{Seq: seq, Type: events.BeadUpdated, Payload: json.RawMessage(`{"status":"open"}`)})
		case seq%10 == 0:
			evts = append(evts, events.Event{Seq: seq, Type: events.SessionWoke, Subject: "worker"})
		default:
			id := fmt.Sprintf("b%03d", seq*7%150)
			typ := events.BeadUpdated
			switch {
			case !live[id]:
				typ, live[id] = events.BeadCreated, true
			case seq%3 == 0:
				typ, live[id] = events.BeadDeleted, false
			}
			evts = append(evts, beadEvent(seq, typ, id, fmt.Sprintf("s%d", seq)))
		}
	}
	writeEventLines(t, filepath.Join(dir, "events.jsonl.archive-20260601T120000Z-seq-1-400.gz"), evts[:400], true)
	writeEventLines(t, filepath.Join(dir, "events.jsonl.rotating-20260601T120500Z-seq-401-600"), evts[400:600], false)
	path := filepath.Join(dir, "events.jsonl")
	writeEventLines(t, path, evts[600:], false)
	return path
}

// TestColdLoadContextMatchesSliceFold: folding the streamed batches gives the
// projection the single-slice fold gave — the same beads in the same
// first-seen order after deletes and re-creates, the same cursor and the same
// decode-miss count.
func TestColdLoadContextMatchesSliceFold(t *testing.T) {
	path := writeColdLoadHistory(t, t.TempDir())
	all, err := events.ReadFilteredWithInFlight(path, events.Filter{})
	if err != nil {
		t.Fatalf("ReadFilteredWithInFlight: %v", err)
	}
	want := NewProjector()
	want.Apply(all)

	got := NewProjector()
	if err := got.ColdLoadContext(context.Background(), path); err != nil {
		t.Fatalf("ColdLoadContext: %v", err)
	}

	if !equalIDs(idsOf(got.Beads()), idsOf(want.Beads())) {
		t.Fatalf("order = %v\nwant    %v", idsOf(got.Beads()), idsOf(want.Beads()))
	}
	if !reflect.DeepEqual(got.Beads(), want.Beads()) {
		t.Fatalf("bead snapshots differ from the single-slice fold")
	}
	if got.LastSeq() != want.LastSeq() || got.LastSeq() != 900 {
		t.Fatalf("lastSeq = %d, slice fold %d, want 900", got.LastSeq(), want.LastSeq())
	}
	if got.DecodeMisses() != want.DecodeMisses() || want.DecodeMisses() == 0 {
		t.Fatalf("decode misses = %d, slice fold %d (fixture has some)", got.DecodeMisses(), want.DecodeMisses())
	}
}

// TestColdLoadContextFoldsBatchByBatch counts what the cold load hands Apply:
// the 900-event history arrives as several batches of at most 256 events, each
// folded before the next one is read, not as one slice of the whole log.
func TestColdLoadContextFoldsBatchByBatch(t *testing.T) {
	path := writeColdLoadHistory(t, t.TempDir())
	p := NewProjector()
	var sizes []int
	previous := coldLoadEach
	t.Cleanup(func() { coldLoadEach = previous })
	coldLoadEach = func(ctx context.Context, path string, filter events.Filter, fn func([]events.Event) error) error {
		return previous(ctx, path, filter, func(batch []events.Event) error {
			sizes = append(sizes, len(batch))
			if len(batch) == 0 {
				t.Error("empty batch")
				return nil
			}
			if err := fn(batch); err != nil {
				return err
			}
			if last := batch[len(batch)-1].Seq; p.LastSeq() != last {
				t.Errorf("after batch %d the cursor is %d, want %d: the batch was not folded before the next read", len(sizes), p.LastSeq(), last)
			}
			return nil
		})
	}

	if err := p.ColdLoadContext(context.Background(), path); err != nil {
		t.Fatalf("ColdLoadContext: %v", err)
	}
	if len(sizes) < 2 {
		t.Fatalf("Apply got %d batch(es) %v, want several: the history was folded as one slice", len(sizes), sizes)
	}
	for i, n := range sizes {
		if n > maxColdLoadBatch {
			t.Fatalf("batch %d holds %d events, want at most %d", i+1, n, maxColdLoadBatch)
		}
	}
	if p.LastSeq() != 900 {
		t.Fatalf("lastSeq = %d, want 900", p.LastSeq())
	}
}

// TestColdLoadContextReadErrorLeavesProjectorEmpty: a read that fails after
// some batches were already folded resets the projector, so a failed cold load
// still yields the empty projection the tailer publishes as Partial.
func TestColdLoadContextReadErrorLeavesProjectorEmpty(t *testing.T) {
	dir := t.TempDir()
	writeEventLines(t, filepath.Join(dir, "events.jsonl.archive-20260601T120000Z-seq-1-300.gz"), createdEvents(1, 300), true)
	if err := os.WriteFile(filepath.Join(dir, "events.jsonl.archive-20260601T120500Z-seq-301-400.gz"), []byte("not a gzip stream\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "events.jsonl")
	writeEventLines(t, path, createdEvents(401, 500), false)

	p := NewProjector()
	if err := p.ColdLoadContext(context.Background(), path); err == nil {
		t.Fatal("ColdLoadContext = nil, want the corrupt archive's error")
	}
	if got := idsOf(p.Beads()); len(got) != 0 {
		t.Fatalf("beads after a failed cold load = %d, want none", len(got))
	}
	if p.LastSeq() != 0 || p.DecodeMisses() != 0 {
		t.Fatalf("lastSeq = %d, decode misses = %d after a failed cold load, want 0 and 0", p.LastSeq(), p.DecodeMisses())
	}
}

// TestColdLoadContextStopsOnCanceledContext: a canceled tailer gets ctx's error
// back and an empty projector instead of a replay that runs on for minutes.
func TestColdLoadContextStopsOnCanceledContext(t *testing.T) {
	path := writeColdLoadHistory(t, t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	p := NewProjector()
	if err := p.ColdLoadContext(ctx, path); !errors.Is(err, context.Canceled) {
		t.Fatalf("ColdLoadContext = %v, want context.Canceled", err)
	}
	if len(p.Beads()) != 0 || p.LastSeq() != 0 {
		t.Fatalf("beads = %d, lastSeq = %d after a canceled cold load, want none and 0", len(p.Beads()), p.LastSeq())
	}
}

// TestApplyManyDeletesKeepsFirstSeenOrder replays thousands of creates, updates
// and deletes over a few hundred ids and checks the order against a plain-slice
// model of first-seen order: an update keeps an id's slot, a delete drops it, a
// delete of an unknown id changes nothing, and a re-created id goes to the end.
func TestApplyManyDeletesKeepsFirstSeenOrder(t *testing.T) {
	rng := rand.New(rand.NewPCG(26, 11))
	p := NewProjector()
	var model []string
	live := make(map[string]bool)
	var seq uint64
	var batch []events.Event
	flush := func() {
		p.Apply(batch)
		batch = batch[:0]
		if got := idsOf(p.Beads()); !equalIDs(got, model) {
			t.Fatalf("after seq %d the order is %v\nwant %v", seq, got, model)
		}
	}
	for range 20000 {
		id := fmt.Sprintf("b%d", rng.IntN(300))
		seq++
		if rng.IntN(5) < 2 {
			batch = append(batch, beadEvent(seq, events.BeadDeleted, id, "closed"))
			if live[id] {
				live[id] = false
				model = slices.DeleteFunc(model, func(m string) bool { return m == id })
			}
		} else {
			typ := events.BeadUpdated
			if !live[id] {
				typ, live[id] = events.BeadCreated, true
				model = append(model, id)
			}
			batch = append(batch, beadEvent(seq, typ, id, "open"))
		}
		if len(batch) == 64 {
			flush()
		}
	}
	flush()
	if p.LastSeq() != seq {
		t.Fatalf("lastSeq = %d, want %d", p.LastSeq(), seq)
	}
}

// TestApplyDeleteMovesSurvivorsLinearly counts how often bead.deleted moves a
// surviving id to another slot of the first-seen order. Removing an id by
// shifting every later id left made a history with ~53k deletes quadratic (the
// 26.11 supervisor spike: ~4.6e9 element shifts). Deleting 750 of 1000 ids,
// oldest first, may move the survivors only a few times per id in total.
func TestApplyDeleteMovesSurvivorsLinearly(t *testing.T) {
	const n = 1000
	id := func(i int) string { return fmt.Sprintf("b%04d", i) }
	p := NewProjector()
	var seq uint64
	for i := range n {
		seq++
		p.Apply([]events.Event{beadEvent(seq, events.BeadCreated, id(i), "open")})
	}

	slots := survivorSlots(p)
	moves := 0
	for i := range n * 3 / 4 {
		seq++
		p.Apply([]events.Event{beadEvent(seq, events.BeadDeleted, id(i), "open")})
		next := survivorSlots(p)
		for sid, slot := range next {
			if slots[sid] != slot {
				moves++
			}
		}
		slots = next
	}

	if limit := 4 * n; moves > limit {
		t.Fatalf("%d deletes moved surviving ids %d times, want at most %d: a delete must not shift every later id", n*3/4, moves, limit)
	}
	want := make([]string, 0, n/4)
	for i := n * 3 / 4; i < n; i++ {
		want = append(want, id(i))
	}
	if got := idsOf(p.Beads()); !equalIDs(got, want) {
		t.Fatalf("order after the deletes = %v\nwant %v", got, want)
	}
}

// survivorSlots maps each folded bead id to its slot in p.order.
func survivorSlots(p *Projector) map[string]int {
	slots := make(map[string]int, len(p.beads))
	for i, sid := range p.order {
		if _, ok := p.beads[sid]; ok {
			slots[sid] = i
		}
	}
	return slots
}
