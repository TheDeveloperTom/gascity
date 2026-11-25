package worker

import (
	"os"
	"path/filepath"
	"testing"
	"time"
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

func writeNotifyFile(t *testing.T, path, raw string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		t.Fatalf("WriteFile(%q): %v", path, err)
	}
}
