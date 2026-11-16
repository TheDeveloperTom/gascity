package workspacesvc

import (
	"log"
	"path/filepath"
	"syscall"
	"time"

	"github.com/gastownhall/gascity/internal/runtime/proctable"
)

// The table-driven orphan sweep is the counterpart of the /proc sweep in
// orphan_reap.go for hosts without /proc — darwin, where a supervisor that
// dies hard (launchd bootout escalating to SIGKILL, a crash mid city start)
// leaves its proxy_process children re-parented to launchd: there is no
// Pdeathsig to take them down, so without this sweep every supervisor restart
// on macOS spawns duplicates next to the survivors, which keep holding the
// service's locks and ports.
//
// It reads the process table through an injectable orphanProcTable. A
// process matches only if every rule holds, applied cheapest first:
//
//  1. not init, not the sweeper, and the sweeper itself is not init;
//  2. not a zombie, and re-parented to init (ppid 1) — no live supervisor
//     owns it (darwin has no `systemd --user`-style subreaper);
//  3. its environment carries GC_SERVICE_STATE_ROOT=<this instance's state
//     root>. The state root is config-derived (stable across supervisor
//     restarts) and unique per city+service, except that services of one
//     pack source may share it — so it scopes the match to this city's
//     instance, and a same-root sibling service's orphan can match too. That
//     is safe: ppid 1 already proves no live supervisor owns it;
//  4. its argv is readable and is NOT city infrastructure
//     (proctable.IsCityInfrastructureArgv: bd's db-proxy-child, gc's
//     managed-Dolt scope watchdog, gc's nudge poller). Those inherit the env
//     and cwd of whatever ran `gc bd …` — a service included — reparent to
//     init by design, and supervise the city's dolt server, so signaling one
//     takes the store down. The session and order-exec reapers apply the
//     same fence; and
//  5. it runs this service's command, by one of: its argv equals the
//     configured command; or the arguments after argv[0] equal the
//     configured ones (an interpreter re-exec — Homebrew python3 re-execs
//     through Python.app and rewrites argv[0]); or (the cwd rule, for a
//     wrapper such as run.sh that exec'd a different binary) it leads its own
//     process group but not its session — exactly what the spawn path's
//     Setpgid-without-Setsid produces, and what a Setsid daemon a service
//     started (bd's proxy) is not — and its cwd is the service's command
//     dir. The cwd rule is off when that dir is the city root (see
//     orphanCwdRuleDir), and its lsof call only runs for processes that
//     passed every other rule.
//
// Rule 3 reads exactly one environment variable. A service's environment
// holds bot tokens and API keys; the reader never asks for, materializes or
// logs any other entry, and the logs carry only pids and the service name.
//
// Kill path: each match is re-read in full immediately before its SIGTERM
// (later candidates' matching can take seconds), and its process group is
// checked for city infrastructure — or a member whose argv cannot be read —
// before the group is signaled at all. During the bounded wait and before
// SIGKILL a pid is re-checked by its kernel start time, which detects pid
// reuse exactly without re-running lsof on every poll.
//
// By design, a copy someone starts by hand with this instance's
// GC_SERVICE_STATE_ROOT exported, detached to ppid 1 and running the service
// command, is reaped too: it would contend for the same locks and ports.

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
	pgid   int
	zombie bool
	// startTime is the kernel's process start time; with pid it identifies
	// one process exactly, so a reused pid never compares equal.
	startTime int64
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
	// sid returns the pid's session id (getsid(2)).
	sid func(pid int) (int, error)
}

// find returns the pids in the table that satisfy the full orphan identity.
func (tb orphanProcTable) find(self int, id orphanIdentity) []int {
	var pids []int
	for _, e := range tb.findEntries(self, id) {
		pids = append(pids, e.pid)
	}
	return pids
}

// findEntries returns the rows that satisfy the full orphan identity. An
// incomplete identity, an init sweeper (see findOrphanedServiceProcessesFrom)
// or an unlistable table finds nothing.
func (tb orphanProcTable) findEntries(self int, id orphanIdentity) []orphanProcEntry {
	if len(id.command) == 0 || id.stateRoot == "" || self == 1 {
		return nil
	}
	entries, err := tb.list()
	if err != nil {
		log.Printf("workspacesvc: orphan sweep for service %q could not list processes: %v", id.serviceName, err)
		return nil
	}
	var matches []orphanProcEntry
	for _, e := range entries {
		if e.pid == self {
			continue
		}
		if tb.entryMatches(id, e) {
			matches = append(matches, e)
		}
	}
	return matches
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
	argv, err := tb.cmdline(e.pid)
	if err != nil || proctable.IsCityInfrastructureArgv(argv) {
		return false
	}
	if orphanCommandMatches(argv, id.command) {
		return true
	}
	if id.dir == "" || e.pgid != e.pid {
		return false
	}
	if sid, err := tb.sid(e.pid); err != nil || sid == e.pid {
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

// rematch re-reads e's pid in full and reports whether it is still the same
// process (same start time) and still this service's orphan.
func (tb orphanProcTable) rematch(id orphanIdentity, e orphanProcEntry) bool {
	fresh, ok, err := tb.lookup(e.pid)
	if err != nil || !ok || fresh.pid != e.pid || fresh.startTime != e.startTime {
		return false
	}
	return tb.entryMatches(id, fresh)
}

// stillOrphaned is the cheap re-check used while waiting: the same process
// (pid and start time) is still alive, not a zombie, and still under init.
// argv, environment and cwd are fixed for a process's lifetime as far as the
// sweep is concerned, so they are not re-read on every poll.
func (tb orphanProcTable) stillOrphaned(e orphanProcEntry) bool {
	fresh, ok, err := tb.lookup(e.pid)
	return err == nil && ok && fresh.pid == e.pid && fresh.startTime == e.startTime &&
		!fresh.zombie && fresh.ppid == 1
}

// groupIsSafe reports whether every live member of process group pgid is
// readable and none is city infrastructure, so kill(-pgid) cannot reach the
// city's store. Any read failure makes the group unsafe.
func (tb orphanProcTable) groupIsSafe(pgid int) bool {
	entries, err := tb.list()
	if err != nil {
		return false
	}
	for _, m := range entries {
		if m.pgid != pgid || m.zombie {
			continue
		}
		argv, err := tb.cmdline(m.pid)
		if err != nil || proctable.IsCityInfrastructureArgv(argv) {
			return false
		}
	}
	return true
}

// reapOrphansFromTable finds this service instance's orphans in tb, sends
// SIGTERM to each one's process group, waits up to wait for them to exit,
// then SIGKILLs the same processes if they are still there. Each one is
// re-read in full, and its group checked, right before its SIGTERM; a group
// is re-checked again before SIGKILL. It returns the pids it signaled.
// signal is signalProcessOrGroup in production.
func reapOrphansFromTable(tb orphanProcTable, id orphanIdentity, self int, signal func(int, syscall.Signal), wait time.Duration) []int {
	var termed []orphanProcEntry
	for _, e := range tb.findEntries(self, id) {
		if !tb.rematch(id, e) {
			continue
		}
		if !tb.groupIsSafe(e.pid) {
			log.Printf("workspacesvc: not reaping orphaned process of service %q: pid %d's process group holds city infrastructure or an unreadable process", id.serviceName, e.pid)
			continue
		}
		log.Printf("workspacesvc: reaping orphaned process of service %q: pid %d (ppid 1), SIGTERM to its process group", id.serviceName, e.pid)
		signal(e.pid, syscall.SIGTERM)
		termed = append(termed, e)
	}
	if len(termed) == 0 {
		return nil
	}
	remaining := append([]orphanProcEntry(nil), termed...)
	deadline := time.Now().Add(wait)
	for {
		remaining = filterStillOrphaned(tb, remaining)
		if len(remaining) == 0 || !time.Now().Before(deadline) {
			break
		}
		time.Sleep(orphanReapPollInterval)
	}
	for _, e := range remaining {
		if !tb.stillOrphaned(e) || !tb.groupIsSafe(e.pid) {
			continue
		}
		log.Printf("workspacesvc: orphaned process of service %q: pid %d survived SIGTERM for %v, SIGKILL to its process group", id.serviceName, e.pid, wait)
		signal(e.pid, syscall.SIGKILL)
	}
	pids := make([]int, 0, len(termed))
	for _, e := range termed {
		pids = append(pids, e.pid)
	}
	return pids
}

func filterStillOrphaned(tb orphanProcTable, entries []orphanProcEntry) []orphanProcEntry {
	live := entries[:0]
	for _, e := range entries {
		if tb.stillOrphaned(e) {
			live = append(live, e)
		}
	}
	return live
}

// orphanCwdRuleDir returns the dir the cwd rule compares against for a
// service run in commandDir, or "" (rule off) when that is the city root:
// a root-pack service's `gc`/`bd` calls leave daemons whose cwd is the city
// root, so there it identifies nothing.
func orphanCwdRuleDir(commandDir, cityPath string) string {
	dir := resolveOrphanCommandDir(commandDir)
	if dir == "" || dir == resolveOrphanCommandDir(cityPath) {
		return ""
	}
	return dir
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
