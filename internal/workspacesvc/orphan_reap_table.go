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
//  2. not a zombie, re-parented to init (ppid 1) — no live supervisor owns
//     it (darwin has no `systemd --user`-style subreaper) — and the leader of
//     its own process group, as the spawn path's Setpgid makes every service
//     root. Rules 1-2 need only the kernel's process list; nothing below is
//     read for a process that fails them;
//  3. one kern.procargs2 read of it returns its argv and exactly two
//     environment variables, GC_SERVICE_STATE_ROOT and GC_SERVICE_NAME, which
//     must equal this instance's state root and service name — as on the
//     /proc path, so another city's orphan and a sibling service sharing the
//     state root never match;
//  4. its argv is NOT city infrastructure (proctable.IsCityInfrastructureArgv:
//     bd's db-proxy-child, gc's managed-Dolt scope watchdog, gc's nudge
//     poller). Those inherit the env of whatever ran `gc bd …` — a service
//     included — reparent to init by design, and supervise the city's dolt
//     server, so signaling one takes the store down. The session and
//     order-exec reapers apply the same fence; and
//  5. it runs this service's command: its argv equals the configured
//     command, or the arguments after argv[0] equal the configured ones (an
//     interpreter re-exec — Homebrew python3 re-execs through Python.app and
//     rewrites argv[0]).
//
// Rule 5 is the only command rule; nothing else stands in for the command.
// Every long-lived process a service can leave behind inherits its
// environment and cwd — bd's proxy, gc's managed dolt sql-server (Setpgid,
// the starter's env and cwd), a tmux server, an agent runtime — and some of
// them have exactly a service root's process shape, so neither cwd nor
// group/session shape can tell them apart.
//
// Limits. Two kinds of orphan never match, so they survive the sweep, as
// every orphan did on darwin before it existed (fail-closed):
//   - one running an Apple platform binary (/bin/sh, /bin/bash, /usr/bin/env,
//     /usr/bin/python3, …): the kernel withholds a restricted process's
//     environment from kern.procargs2, so rule 3 cannot be proven;
//   - one whose wrapper exec'd a different program, e.g. a service
//     configured as ["/bin/sh", "assets/activity-gw/run.sh"] that execs
//     `node server.mjs`: rule 5 does not hold. Such a service should exec
//     with its configured arguments, or be configured with the program's
//     argv.
//
// A service's environment holds bot tokens and API keys; the reader never
// asks for, materializes or logs any other entry, and the logs carry only
// pids and the service name.
//
// Kill path, for SIGTERM and SIGKILL alike: first the process group is
// checked — refused when a member is city infrastructure, gc's managed dolt
// sql-server, or a process whose argv cannot be read — and then, as the last
// step before the signal, the pid's identity: before SIGTERM the full rules
// again plus the kernel start time, before SIGKILL the start time. A pid is
// thus never signaled after the process it named exited and the pid was
// reused, short of reuse inside the microseconds between that last lookup and
// kill(2).
//
// By design, a copy someone starts by hand with this instance's
// GC_SERVICE_STATE_ROOT and GC_SERVICE_NAME exported, detached to ppid 1 and
// running the service command, is reaped too: it would contend for the same
// locks and ports.

// The environment variables the table-driven sweep reads, and the only ones.
// The spawn path exports both on every proxy_process child.
const (
	stateRootEnvKey   = "GC_SERVICE_STATE_ROOT"
	serviceNameEnvKey = "GC_SERVICE_NAME"
)

// orphanIdentityEnvKeys is the full list passed to procArgs.
var orphanIdentityEnvKeys = []string{stateRootEnvKey, serviceNameEnvKey}

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
	// procArgs returns the pid's argv and the values of the named
	// environment variables that are set, from one read of the process's
	// arguments. With no keys it reads argv only.
	procArgs func(pid int, keys ...string) ([]string, map[string]string, error)
}

// findEntries returns the rows that satisfy the full orphan identity. An
// incomplete identity, an init sweeper (see findOrphanedServiceProcessesFrom)
// or an unlistable table finds nothing.
func (tb orphanProcTable) findEntries(self int, id orphanIdentity) []orphanProcEntry {
	if len(id.command) == 0 || id.stateRoot == "" || id.serviceName == "" || self == 1 {
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
	if unsafeSignalTarget(e.pid) || e.zombie || e.ppid != 1 || e.pgid != e.pid {
		return false
	}
	argv, env, err := tb.procArgs(e.pid, orphanIdentityEnvKeys...)
	if err != nil {
		return false
	}
	if root, ok := env[stateRootEnvKey]; !ok || root != id.stateRoot {
		return false
	}
	if name, ok := env[serviceNameEnvKey]; !ok || name != id.serviceName {
		return false
	}
	if proctable.IsCityInfrastructureArgv(argv) {
		return false
	}
	return orphanCommandMatches(argv, id.command)
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

// stillOrphaned reports whether e names the same live process it did when it
// was listed — same pid and kernel start time — and that process is still
// not a zombie, still under init and still leads its group. It is the last
// check before every signal: argv and environment are re-read before SIGTERM
// by entryMatches, and pid plus start time names that same process.
func (tb orphanProcTable) stillOrphaned(e orphanProcEntry) bool {
	fresh, ok, err := tb.lookup(e.pid)
	return err == nil && ok && fresh.pid == e.pid && fresh.startTime == e.startTime &&
		!fresh.zombie && fresh.ppid == 1 && fresh.pgid == e.pid
}

// groupIsSafe reports whether every live member of process group pgid is
// readable and none is city infrastructure or gc's managed dolt sql-server,
// so kill(-pgid) cannot reach the city's store. Any read failure makes the
// group unsafe.
func (tb orphanProcTable) groupIsSafe(pgid int) bool {
	entries, err := tb.list()
	if err != nil {
		return false
	}
	for _, m := range entries {
		if m.pgid != pgid || m.zombie {
			continue
		}
		argv, _, err := tb.procArgs(m.pid)
		if err != nil || proctable.IsCityInfrastructureArgv(argv) || isDoltSQLServerArgv(argv) {
			return false
		}
	}
	return true
}

// isDoltSQLServerArgv reports whether argv is a dolt sql-server. gc starts
// the managed one Setpgid, so it leads its own group; in test mode it is
// started without Setpgid (cmd/gc dolt_start_managed.go) and can share its
// starter's group.
func isDoltSQLServerArgv(argv []string) bool {
	return len(argv) >= 2 && filepath.Base(argv[0]) == "dolt" && argv[1] == "sql-server"
}

// reapOrphansFromTable finds this service instance's orphans in tb, sends
// SIGTERM to each one's process group, waits up to wait for them to exit,
// then SIGKILLs the same processes if they are still there. Before each
// signal the group is checked first and the pid's identity last (see the
// file comment). It returns the pids it sent SIGTERM to. signal is
// signalProcessOrGroup in production.
func reapOrphansFromTable(tb orphanProcTable, id orphanIdentity, self int, signal func(int, syscall.Signal), wait time.Duration) []int {
	var termed []orphanProcEntry
	for _, e := range tb.findEntries(self, id) {
		if !tb.groupIsSafe(e.pid) {
			log.Printf("workspacesvc: not reaping orphaned process of service %q: pid %d's process group holds city infrastructure, a dolt server or an unreadable process", id.serviceName, e.pid)
			continue
		}
		if !tb.entryMatches(id, e) || !tb.stillOrphaned(e) {
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
		if !tb.groupIsSafe(e.pid) || !tb.stillOrphaned(e) {
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
