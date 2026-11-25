package worker

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gastownhall/gascity/internal/runtime"
)

// A write to the transcript wakes its notifier.
func TestTranscriptNotifierWakesOnTranscriptWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "transcript.jsonl")
	writeNotifyFile(t, path, "{}\n")
	wake := make(chan struct{}, 1)
	n := newTranscriptNotifier(path, wake)
	if n == nil {
		t.Fatal("newTranscriptNotifier = nil, want a notifier")
	}
	defer n.close()
	appendTranscript(t, path, "{}\n")
	select {
	case <-wake:
	case <-time.After(5 * time.Second):
		t.Fatal("a write to the transcript did not wake the notifier")
	}
}

// A write to another file in the transcript's directory does not wake it.
func TestTranscriptNotifierIgnoresSiblingWrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "transcript.jsonl")
	sibling := filepath.Join(dir, "sibling.jsonl")
	writeNotifyFile(t, path, "{}\n")
	writeNotifyFile(t, sibling, "{}\n")
	wake := make(chan struct{}, 1)
	n := newTranscriptNotifier(path, wake)
	if n == nil {
		t.Fatal("newTranscriptNotifier = nil, want a notifier")
	}
	defer n.close()
	appendTranscript(t, sibling, "{}\n")
	select {
	case <-wake:
		t.Fatal("a write to a sibling woke the notifier")
	case <-time.After(500 * time.Millisecond):
	}
}

// A transcript renamed away and created again at the same path wakes the
// watcher on writes again after one backstop poll. kqueue drops a file's
// watch on Rename or Remove, and resolve keeps the same path, so the poll
// must re-arm the notifier.
func TestWatchTurnsTranscriptRearmsAfterReplace(t *testing.T) {
	clock := newManualTurnClock(time.Date(2026, 10, 13, 6, 0, 0, 0, time.UTC))
	s := newTurnSession(t, profiled(runtime.ProfileTmux, runtime.FullFake{Fake: runtime.NewFake()}), "codex", "")
	timing := clock.timing()
	timing.noNotify = false
	s.handle.turns.timing = timing
	path := s.writeCompletedTurn(t, "codex")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch, err := s.handle.WatchTurns(ctx)
	if err != nil {
		t.Fatalf("WatchTurns: %v", err)
	}
	if first := receiveTurnUpdate(t, ch); first.Err != nil || first.History.Current.Active() {
		t.Fatalf("first update = %+v, want the idle history", first)
	}
	clock.nextAsk(t)

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if err := os.Rename(path, filepath.Join(t.TempDir(), "away.jsonl")); err != nil {
		t.Fatalf("rename away: %v", err)
	}
	writeNotifyFile(t, path, string(raw))

	// Let the reads the rename and the create woke finish, then fire the
	// backstop poll the watcher asked for last.
	time.Sleep(300 * time.Millisecond)
	ask := latestAsk(t, clock)
	clock.advance(max(ask.d, turnPollOpen))
	ask.fire <- clock.now()
	clock.nextAsk(t) // the backstop read is done
	drainTurnUpdates(ch)

	appendTranscript(t, path, codexStarted(codexTurn2, "2026-10-08T02:23:01.007Z", 1791426181)+"\n")
	if got := receiveTurnUpdate(t, ch); got.History.Current.TurnID != codexTurn2 {
		t.Fatalf("update after the write = %+v, want %s running", got, codexTurn2)
	}
	cancel()
	assertWatchCloses(t, ch)
}

// latestAsk returns the newest wait the watcher has asked for, waiting for
// one if none is queued.
func latestAsk(t *testing.T, c *manualTurnClock) turnAsk {
	t.Helper()
	ask := c.nextAsk(t)
	for {
		select {
		case next := <-c.asks:
			ask = next
		default:
			return ask
		}
	}
}

func drainTurnUpdates(ch <-chan TurnUpdate) {
	for {
		select {
		case <-ch:
		default:
			return
		}
	}
}

func writeNotifyFile(t *testing.T, path, raw string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		t.Fatalf("WriteFile(%q): %v", path, err)
	}
}
