package workspacesvc

import (
	"log"
	"path/filepath"
	"syscall"
	"time"
)

// The table-driven orphan sweep is the counterpart of the /proc sweep in
// orphan_reap.go for hosts without /proc — darwin, where a supervisor that
// dies hard (launchd bootout escalating to SIGKILL, a crash mid city start)
// leaves its proxy_process children re-parented to launchd: there is no
// Pdeathsig to take them down, so without this sweep every supervisor restart
// on macOS spawns duplicates next to the survivors, which keep holding the
// service's locks and ports.
//
// It reads the process table through an injectable orphanProcTable and keeps
// the /proc sweep's rules, applied cheapest first so that a process's
// environment is only ever read once it is already known to be an orphan
// running this service's exact command:
//
//  1. not init, not the sweeper, and the sweeper itself is not init;
//  2. not a zombie, and re-parented to init (ppid 1) — no live supervisor
//     owns it (darwin has no `systemd --user`-style subreaper);
//  3. its environment carries GC_SERVICE_STATE_ROOT=<this instance's state
//     root>. The state root is config-derived (stable across supervisor
//     restarts) and unique per city+service, except that services of one
//     pack source may share it — so it scopes the match to this city's
//     instance, and a same-root sibling service's orphan can match too. That
//     is safe: ppid 1 already proves no live supervisor owns it; and
//  4. it runs this service's command, by one of: its argv equals the
//     configured command; or the arguments after argv[0] equal the
//     configured ones (an interpreter re-exec — Homebrew python3 re-execs
//     through Python.app and rewrites argv[0]); or its cwd is the service's
//     command dir (a wrapper such as run.sh exec'd a different binary). The
//     cwd is read only for processes that already passed rule 3, since on
//     darwin it costs an lsof call.
//
// Rule 4 reads exactly one environment variable. A service's environment
// holds bot tokens and API keys; the reader never asks for, materializes or
// logs any other entry, and the logs carry only pids and the service name.
//
// The whole identity is re-read on every escalation pass and once more
// immediately before SIGKILL, so a pid recycled after SIGTERM is dropped
// instead of killed.

// stateRootEnvKey is the only environment variable the table-driven sweep
// reads. The spawn path exports it on every proxy_process child.
const stateRootEnvKey = "GC_SERVICE_STATE_ROOT"

// orphanReapPollInterval is how often the escalation wait re-reads the
// remaining orphans.
const orphanReapPollInterval = 50 * time.Millisecond

// orphanProcEntry is one process-table row: what the kernel's process list
// (kinfo_proc on darwin) answers without reading the process's memory.
type orphanProcEntry struct {
	pid    int
	ppid   int
	zombie bool
}

// orphanProcTable is the injectable process lister the table-driven sweep
// reads through. Every func must be set for the table to be usable.
type orphanProcTable struct {
	// list returns a snapshot of every process the sweeper may inspect.
	list func() ([]orphanProcEntry, error)
	// lookup re-reads one pid's row; ok is false once the pid is gone.
	lookup func(pid int) (orphanProcEntry, bool, error)
	// cmdline returns the pid's argv.
	cmdline func(pid int) ([]string, error)
	// envValue returns the value of exactly one environment variable.
	envValue func(pid int, key string) (string, bool, error)
	// cwd returns the pid's current working directory.
	cwd func(pid int) (string, error)
}

// find returns the pids in the table that satisfy the full orphan identity.
// An incomplete identity, an init sweeper (see
// findOrphanedServiceProcessesFrom) or an unlistable table finds nothing.
func (tb orphanProcTable) find(self int, id orphanIdentity) []int {
	if len(id.command) == 0 || id.stateRoot == "" || self == 1 {
		return nil
	}
	entries, err := tb.list()
	if err != nil {
		log.Printf("workspacesvc: orphan sweep for service %q could not list processes: %v", id.serviceName, err)
		return nil
	}
	var pids []int
	for _, e := range entries {
		if e.pid == self {
			continue
		}
		if tb.entryMatches(id, e) {
			pids = append(pids, e.pid)
		}
	}
	return pids
}

// entryMatches applies the identity rules to one row, cheapest first. Any
// read failure is a mismatch: the sweep never signals a process it cannot
// prove is this service's orphan.
func (tb orphanProcTable) entryMatches(id orphanIdentity, e orphanProcEntry) bool {
	if unsafeSignalTarget(e.pid) || e.zombie || e.ppid != 1 {
		return false
	}
	root, ok, err := tb.envValue(e.pid, stateRootEnvKey)
	if err != nil || !ok || root != id.stateRoot {
		return false
	}
	if argv, err := tb.cmdline(e.pid); err == nil && orphanCommandMatches(argv, id.command) {
		return true
	}
	if id.dir == "" {
		return false
	}
	cwd, err := tb.cwd(e.pid)
	return err == nil && cwd != "" && cwd == id.dir
}

// orphanCommandMatches reports whether a live argv runs the configured
// command: argv-for-argv, or — for a command with arguments — with only
// argv[0] differing, as when an interpreter re-execs itself under another
// path. A command without arguments never matches on its (empty) tail.
func orphanCommandMatches(argv, command []string) bool {
	if len(argv) == 0 || len(command) == 0 {
		return false
	}
	if argvEquals(argv, command) {
		return true
	}
	return len(command) > 1 && argvEquals(argv[1:], command[1:])
}

// stillMatches re-reads pid and reports whether it is still this service's
// orphan.
func (tb orphanProcTable) stillMatches(id orphanIdentity, pid int) bool {
	e, ok, err := tb.lookup(pid)
	if err != nil || !ok || e.pid != pid {
		return false
	}
	return tb.entryMatches(id, e)
}

// reapOrphansFromTable finds this service instance's orphans in tb, sends
// SIGTERM to each one's process group, waits up to wait for them to exit,
// then SIGKILLs those that still match the full identity. It returns the
// pids it signaled. signal is signalProcessOrGroup in production.
func reapOrphansFromTable(tb orphanProcTable, id orphanIdentity, self int, signal func(int, syscall.Signal), wait time.Duration) []int {
	pids := tb.find(self, id)
	if len(pids) == 0 {
		return nil
	}
	for _, pid := range pids {
		log.Printf("workspacesvc: reaping orphaned process of service %q: pid %d (ppid 1), SIGTERM to its process group", id.serviceName, pid)
		signal(pid, syscall.SIGTERM)
	}
	remaining := append([]int(nil), pids...)
	deadline := time.Now().Add(wait)
	for {
		remaining = filterStillMatching(tb, id, remaining)
		if len(remaining) == 0 || !time.Now().Before(deadline) {
			break
		}
		time.Sleep(orphanReapPollInterval)
	}
	for _, pid := range remaining {
		if !tb.stillMatches(id, pid) {
			continue
		}
		log.Printf("workspacesvc: orphaned process of service %q: pid %d survived SIGTERM for %v, SIGKILL to its process group", id.serviceName, pid, wait)
		signal(pid, syscall.SIGKILL)
	}
	return pids
}

func filterStillMatching(tb orphanProcTable, id orphanIdentity, pids []int) []int {
	live := pids[:0]
	for _, pid := range pids {
		if tb.stillMatches(id, pid) {
			live = append(live, pid)
		}
	}
	return live
}

// resolveOrphanCommandDir returns dir with symlinks resolved, the form the
// kernel reports a process's cwd in (on darwin /var is /private/var), so the
// cwd rule compares like with like. An unresolvable dir is only cleaned.
func resolveOrphanCommandDir(dir string) string {
	if dir == "" {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(dir); err == nil {
		return resolved
	}
	return filepath.Clean(dir)
}
