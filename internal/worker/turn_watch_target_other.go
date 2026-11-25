//go:build !(freebsd || openbsd || netbsd || dragonfly || darwin)

package worker

import "path/filepath"

// transcriptWatchTarget is what a transcript notifier watches. Off kqueue it
// is the transcript's directory, which costs one watch however many files it
// holds and sees a transcript replaced at the same path.
func transcriptWatchTarget(path string) string {
	return filepath.Dir(path)
}
