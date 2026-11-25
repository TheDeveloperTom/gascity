//go:build freebsd || openbsd || netbsd || dragonfly || darwin

package worker

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/gastownhall/gascity/internal/runtime"
)

// notifierFDBudget bounds the descriptors one transcript notifier may hold
// on kqueue: the kqueue, its close pipe and the transcript, plus slack for
// what the runtime opens meanwhile (8, as cmd/gc's fdCountNoise).
const notifierFDBudget = 20

// A transcript notifier on kqueue holds a handful of descriptors whatever
// else lies in the transcript's directory: kqueue opens one descriptor per
// entry of a watched directory, and a Claude projects directory holds
// thousands of transcripts.
func TestTranscriptNotifierHoldsNoFDPerSibling(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 200; i++ {
		writeNotifyFile(t, filepath.Join(dir, fmt.Sprintf("sibling-%03d.jsonl", i)), "{}\n")
	}
	path := filepath.Join(dir, "transcript.jsonl")
	writeNotifyFile(t, path, "{}\n")

	before := countOpenFDs()
	n := newTranscriptNotifier(path, make(chan struct{}, 1))
	if n == nil {
		t.Fatal("newTranscriptNotifier = nil, want a notifier")
	}
	defer n.close()
	if held := countOpenFDs() - before; held >= notifierFDBudget {
		t.Fatalf("notifier holds %d descriptors with 200 siblings, want fewer than %d", held, notifierFDBudget)
	}
}

// A transcript renamed away and created again at the same path wakes the
// watcher on writes again after one backstop poll. kqueue drops a file's
// watch on Rename or Remove, and resolve keeps the same path, so the poll
// must re-arm the notifier. Off kqueue the directory watch sees the create
// and there is nothing to re-arm, so this test is kqueue-only.
func TestWatchTurnsTranscriptRearmsAfterReplace(t *testing.T) {
	w := startNotifiedWatch(t, "codex")
	w.replace(t, 0o644)
	w.poll(t)
	w.assertWriteWakes(t)
}

// A re-arm that fails is tried again on the next backstop poll, instead of
// leaving the watch on the poll alone until the path changes. A replacement
// of mode 000 resolves (a Claude transcript's ownership is not read from the
// file) but cannot be opened for its kqueue watch (O_EVTONLY needs read
// access), so the first re-arm fails.
func TestWatchTurnsTranscriptRetriesAFailedRearm(t *testing.T) {
	w := startNotifiedWatch(t, "claude")
	w.replace(t, 0o000)
	w.poll(t)
	if err := os.Chmod(w.path, 0o644); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	w.poll(t)
	w.assertWriteWakes(t)
}

// notifiedWatch is a transcript watch with fsnotify on, run on a manual
// clock.
type notifiedWatch struct {
	clock  *manualTurnClock
	ch     <-chan TurnUpdate
	path   string
	family string
	ask    turnAsk // the newest wait the watcher asked for
}

// startNotifiedWatch watches a family session's completed transcript,
// returning once the first update is in and the watcher waits.
func startNotifiedWatch(t *testing.T, family string) *notifiedWatch {
	t.Helper()
	clock := newManualTurnClock(time.Date(2026, 10, 13, 6, 0, 0, 0, time.UTC))
	s := newTurnSession(t, profiled(runtime.ProfileTmux, runtime.FullFake{Fake: runtime.NewFake()}), family, "")
	timing := clock.timing()
	timing.noNotify = false
	s.handle.turns.timing = timing
	path := s.writeCompletedTurn(t, family)
	ctx, cancel := context.WithCancel(context.Background())
	ch, err := s.handle.WatchTurns(ctx)
	if err != nil {
		cancel()
		t.Fatalf("WatchTurns: %v", err)
	}
	t.Cleanup(func() {
		cancel()
		assertWatchCloses(t, ch)
	})
	if first := receiveTurnUpdate(t, ch); first.Err != nil || first.History.Current.Active() {
		t.Fatalf("first update = %+v, want the idle history", first)
	}
	return &notifiedWatch{clock: clock, ch: ch, path: path, family: family, ask: clock.nextAsk(t)}
}

// replace renames the transcript away and creates it again at the same path,
// with the same content and the given mode.
func (w *notifiedWatch) replace(t *testing.T, mode os.FileMode) {
	t.Helper()
	raw, err := os.ReadFile(w.path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if err := os.Rename(w.path, filepath.Join(t.TempDir(), "away.jsonl")); err != nil {
		t.Fatalf("rename away: %v", err)
	}
	if err := os.WriteFile(w.path, raw, 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if err := os.Chmod(w.path, mode); err != nil {
		t.Fatalf("chmod: %v", err)
	}
}

// poll lets the reads that file events woke finish, fires the backstop poll
// the watcher asked for last, waits for that read and drops its updates.
func (w *notifiedWatch) poll(t *testing.T) {
	t.Helper()
	time.Sleep(300 * time.Millisecond)
	for queued := true; queued; {
		select {
		case next := <-w.clock.asks:
			w.ask = next
		default:
			queued = false
		}
	}
	w.clock.advance(max(w.ask.d, turnPollOpen))
	w.ask.fire <- w.clock.now()
	w.ask = w.clock.nextAsk(t) // the backstop read is done
	for drained := false; !drained; {
		select {
		case <-w.ch:
		default:
			drained = true
		}
	}
}

// assertWriteWakes appends a new open turn and expects it without a poll.
func (w *notifiedWatch) assertWriteWakes(t *testing.T) {
	t.Helper()
	line, want := codexStarted(codexTurn2, "2026-10-08T02:23:01.007Z", 1791426181), codexTurn2
	if w.family == "claude" {
		line, want = claudePrompt(claudeTurn2, "2026-10-13T05:00:06.000Z"), claudeTurn2
	}
	appendTranscript(t, w.path, line+"\n")
	if got := receiveTurnUpdate(t, w.ch); got.History.Current.TurnID != want {
		t.Fatalf("update after the write = %+v, want %s running", got, want)
	}
}

// countOpenFDs counts the process's open descriptors.
func countOpenFDs() int {
	n := 0
	for fd := 0; fd < 10240; fd++ {
		var st syscall.Stat_t
		if syscall.Fstat(fd, &st) == nil {
			n++
		}
	}
	return n
}
