package runproj

import (
	"context"

	"github.com/gastownhall/gascity/internal/beads"
	"github.com/gastownhall/gascity/internal/events"
)

// Projector folds bead lifecycle events into the latest snapshot per id while
// preserving first-seen (creation) order. BuildRunSummary groups by first-seen
// order (mirroring the JS Map insertion order of the dashboard's listBeads
// read), so a plain Fold map — whose Go iteration order is random — would make a
// live run view flicker between requests. The per-city tailer drives a Projector
// instead: a cold ColdLoad over the full log, then incremental Apply of newly
// tailed events, and Beads() hands BuildRunSummary a deterministic slice.
//
// A Projector is not safe for concurrent use; the tailer mutates it from its
// single loop goroutine and publishes the built summary under its own lock.
type Projector struct {
	beads map[string]beads.Bead
	// order holds bead ids in first-seen order. A removed id leaves an empty
	// slot ("" is never a decoded bead id) until removeOrder compacts the
	// slice; orderSlot maps each folded id to its slot, so a bead.deleted
	// costs O(1) amortized instead of a search and a shift of every later id.
	order        []string
	orderSlot    map[string]int
	orderHoles   int
	lastSeq      uint64
	decodeMisses int
}

// RunProjectionSnapshot is one immutable bead snapshot published by an
// incremental run projector. Ready distinguishes a genuinely empty city from a
// cold replay that has not completed. Beads and their nested values are
// immutable after publication, so concurrent readers may share the slice.
type RunProjectionSnapshot struct {
	Ready        bool
	Beads        []beads.Bead
	DecodeMisses int
	Partial      bool
}

// NewProjector returns an empty projector.
func NewProjector() *Projector {
	return &Projector{beads: make(map[string]beads.Bead), orderSlot: make(map[string]int)}
}

// coldLoadEach is the streaming read ColdLoadContext folds. It is a variable so
// a test can count the batches the cold load applies.
var coldLoadEach = events.ReadFilteredWithInFlightEach

// ColdLoad is ColdLoadContext with a background context, for callers that have
// no context to pass.
func (p *Projector) ColdLoad(path string) error {
	return p.ColdLoadContext(context.Background(), path)
}

// ColdLoadContext folds the entire event log at path into the projector, one
// batch of at most 256 events at a time, so memory does not grow with the
// history. events.ReadFilteredWithInFlightEach streams the rotated .gz archives,
// any in-flight events.jsonl.rotating-* file the recorder has not yet gzipped
// (otherwise a cold start that lands in a rotation's compression window would
// miss those pre-rotation events until the next rotation's catch-up) and the
// active log, in seq order, dropping the copy of a window a .gz archive and its
// rotating source both hold. Call it once on a fresh projector before the
// incremental tail begins. If the read fails or ctx is done, the projector is
// reset to empty and the error is returned, as when the whole history was read
// before folding.
func (p *Projector) ColdLoadContext(ctx context.Context, path string) error {
	err := coldLoadEach(ctx, path, events.Filter{}, func(batch []events.Event) error {
		p.Apply(batch)
		return nil
	})
	if err != nil {
		*p = *NewProjector()
	}
	return err
}

// Apply folds a chronological event slice, upserting bead.created/updated/closed
// snapshots and removing bead.deleted ones, preserving first-seen order for new
// ids. It advances the cursor past every event (bead or not) and reports whether
// any bead snapshot changed, so the caller can skip a rebuild on a no-op tick.
// A bead.* event whose payload does not decode is counted (DecodeMisses) rather
// than swallowed, so a silent projection starve is observable to the caller.
func (p *Projector) Apply(evts []events.Event) (changed bool) {
	for i := range evts {
		e := &evts[i]
		if e.Seq > p.lastSeq {
			p.lastSeq = e.Seq
		}
		if !beadEventTypes[e.Type] {
			continue
		}
		b, ok := decodeBead(*e)
		if !ok {
			p.decodeMisses++
			continue
		}
		if e.Type == events.BeadDeleted {
			if _, exists := p.beads[b.ID]; exists {
				delete(p.beads, b.ID)
				p.removeOrder(b.ID)
				changed = true
			}
			continue
		}
		if _, exists := p.beads[b.ID]; !exists {
			p.orderSlot[b.ID] = len(p.order)
			p.order = append(p.order, b.ID)
		}
		p.beads[b.ID] = b
		changed = true
	}
	return changed
}

// Beads returns the folded beads in first-seen order — the deterministic input
// BuildRunSummary expects.
func (p *Projector) Beads() []beads.Bead {
	out := make([]beads.Bead, 0, len(p.beads))
	for _, id := range p.order {
		if b, ok := p.beads[id]; ok {
			out = append(out, b)
		}
	}
	return out
}

// LastSeq returns the highest event seq applied — the cursor a live tail resumes
// from.
func (p *Projector) LastSeq() uint64 { return p.lastSeq }

// DecodeMisses returns the cumulative count of bead.* events whose payload did
// not decode to a bead with an id. It is monotonic across Apply calls; the
// tailer watches the delta so a live projection starve (the run-view RCA
// signature) surfaces as a log line instead of a blank view.
func (p *Projector) DecodeMisses() int { return p.decodeMisses }

// removeOrder empties id's slot in the first-seen order. Once empty slots
// outnumber live ids it squeezes them out and renumbers the slots, so each
// removal costs O(1) amortized and the survivors keep their relative order.
func (p *Projector) removeOrder(id string) {
	slot, ok := p.orderSlot[id]
	if !ok {
		return
	}
	delete(p.orderSlot, id)
	p.order[slot] = ""
	p.orderHoles++
	if 2*p.orderHoles <= len(p.order) {
		return
	}
	live := p.order[:0]
	for _, oid := range p.order {
		if oid != "" {
			p.orderSlot[oid] = len(live)
			live = append(live, oid)
		}
	}
	clear(p.order[len(live):])
	p.order = live
	p.orderHoles = 0
}
