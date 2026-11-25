//go:build freebsd || openbsd || netbsd || dragonfly || darwin

package worker

// transcriptWatchTarget is what a transcript notifier watches. On kqueue it
// is the transcript itself: fsnotify opens one descriptor per entry of a
// watched directory there, and a provider's transcript directory holds
// thousands of files.
func transcriptWatchTarget(path string) string {
	return path
}
