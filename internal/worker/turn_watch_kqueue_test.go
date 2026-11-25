//go:build freebsd || openbsd || netbsd || dragonfly || darwin

package worker

import (
	"fmt"
	"path/filepath"
	"syscall"
	"testing"
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
