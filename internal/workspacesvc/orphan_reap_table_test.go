package workspacesvc

import (
	"bytes"
	"errors"
	"log"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// fakeOrphanProc is one row of the fake process table: its kinfo-style
// entry, argv and environment. env holds secrets on purpose so the tests can
// prove the sweep never asks for them. A zero entry.pgid means "leads its own
// group".
type fakeOrphanProc struct {
	entry orphanProcEntry
	argv  []string
	env   map[string]string
}

// fakeOrphanTable is an injectable process lister for the table-driven sweep
// (the darwin path). It records every environment key the sweep asks for,
// every pid whose environment it reads, every pid whose arguments it reads
// at all, and every signal it sends.
type fakeOrphanTable struct {
	mu       sync.Mutex
	procs    map[int]*fakeOrphanProc
	envKeys  []string
	envPIDs  []int
	argPIDs  []int
	listErr  error
	signals  []string
	onSignal func(pid int, sig syscall.Signal)
}

// find returns the pids in the table that satisfy the full orphan identity.
func (tb orphanProcTable) find(self int, id orphanIdentity) []int {
	var pids []int
	for _, e := range tb.findEntries(self, id) {
		pids = append(pids, e.pid)
	}
	return pids
}

func newFakeOrphanTable(procs ...fakeOrphanProc) *fakeOrphanTable {
	ft := &fakeOrphanTable{procs: map[int]*fakeOrphanProc{}}
	for i := range procs {
		ft.put(procs[i])
	}
	return ft
}

func (ft *fakeOrphanTable) put(p fakeOrphanProc) {
	if p.entry.pgid == 0 {
		p.entry.pgid = p.entry.pid
	}
	if p.entry.startTime == 0 {
		p.entry.startTime = int64(p.entry.pid) * 1000
	}
	ft.procs[p.entry.pid] = &p
}

func (ft *fakeOrphanTable) table() orphanProcTable {
	return orphanProcTable{
		list: func() ([]orphanProcEntry, error) {
			ft.mu.Lock()
			defer ft.mu.Unlock()
			if ft.listErr != nil {
				return nil, ft.listErr
			}
			var out []orphanProcEntry
			for _, p := range ft.procs {
				out = append(out, p.entry)
			}
			slices.SortFunc(out, func(a, b orphanProcEntry) int { return a.pid - b.pid })
			return out, nil
		},
		lookup: func(pid int) (orphanProcEntry, bool, error) {
			ft.mu.Lock()
			defer ft.mu.Unlock()
			p, ok := ft.procs[pid]
			if !ok {
				return orphanProcEntry{}, false, nil
			}
			return p.entry, true, nil
		},
		procArgs: func(pid int, keys ...string) ([]string, map[string]string, error) {
			ft.mu.Lock()
			defer ft.mu.Unlock()
			ft.argPIDs = append(ft.argPIDs, pid)
			if len(keys) > 0 {
				ft.envKeys = append(ft.envKeys, keys...)
				ft.envPIDs = append(ft.envPIDs, pid)
			}
			p, ok := ft.procs[pid]
			if !ok || p.argv == nil {
				return nil, nil, errors.New("no such process")
			}
			// A nil env stands for one the kernel withholds (another user's
			// process, a platform binary): readable argv, no variables.
			values := map[string]string{}
			for _, k := range keys {
				if v, ok := p.env[k]; ok {
					values[k] = v
				}
			}
			return slices.Clone(p.argv), values, nil
		},
	}
}

func (ft *fakeOrphanTable) signal(pid int, sig syscall.Signal) {
	ft.mu.Lock()
	ft.signals = append(ft.signals, strconv.Itoa(pid)+":"+sigName(sig))
	cb := ft.onSignal
	ft.mu.Unlock()
	if cb != nil {
		cb(pid, sig)
	}
}

func (ft *fakeOrphanTable) remove(pid int) {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	delete(ft.procs, pid)
}

func (ft *fakeOrphanTable) replace(p fakeOrphanProc) {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	ft.put(p)
}

func (ft *fakeOrphanTable) signaled() []string {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	return slices.Clone(ft.signals)
}

func sigName(sig syscall.Signal) string {
	switch sig {
	case syscall.SIGTERM:
		return "TERM"
	case syscall.SIGKILL:
		return "KILL"
	default:
		return sig.String()
	}
}

const (
	testCityRoot      = "/cities/alpha/.gc/services/discord-gateway"
	testOtherCityRoot = "/cities/beta/.gc/services/discord-gateway"
	testOtherSvcRoot  = "/cities/alpha/.gc/services/slack-adapter"
	testSweeperPID    = 900
)

var testServiceCommand = []string{"python3", "discord_gateway_service.py"}

func secretEnv(root string) map[string]string {
	return map[string]string{
		stateRootEnvKey:     root,
		"GC_SERVICE_NAME":   "discord-gateway",
		"DISCORD_BOT_TOKEN": "secret-token-value",
	}
}

// orphanFixture returns the standard fake host: true orphans of this city's
// service (one per command rule), plus every kind of process the sweep must
// leave alone.
func orphanFixture() *fakeOrphanTable {
	return newFakeOrphanTable(
		// The orphan: re-parented to launchd, same argv, same state root.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4101, ppid: 1}, argv: testServiceCommand, env: secretEnv(testCityRoot)},
		// Another city's orphan of the same service.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4102, ppid: 1}, argv: testServiceCommand, env: secretEnv(testOtherCityRoot)},
		// Another service of this city (its own state root and argv).
		fakeOrphanProc{entry: orphanProcEntry{pid: 4103, ppid: 1}, argv: []string{"python3", "slack_adapter.py"}, env: secretEnv(testOtherSvcRoot)},
		// Same argv, but its state root is not set at all.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4104, ppid: 1}, argv: testServiceCommand, env: map[string]string{"DISCORD_BOT_TOKEN": "secret-token-value"}},
		// This city's live service child: its parent (a running supervisor) is alive.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4105, ppid: 3000}, argv: testServiceCommand, env: secretEnv(testCityRoot)},
		// A zombie orphan: already dead, nothing to signal.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4106, ppid: 1, zombie: true}, argv: testServiceCommand, env: secretEnv(testCityRoot)},
		// A same-argv orphan whose environment cannot be read (another user).
		fakeOrphanProc{entry: orphanProcEntry{pid: 4107, ppid: 1}, argv: testServiceCommand},
		// An unrelated orphan with a different argv.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4108, ppid: 1}, argv: []string{"/usr/sbin/cfprefsd", "agent"}, env: map[string]string{}},
		// This city's state root, but its argv cannot be read: the
		// infrastructure guard cannot run, so it never matches.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4109, ppid: 1}, env: secretEnv(testCityRoot)},
		// Homebrew python re-execs through Python.app, rewriting argv[0]: the
		// arguments after it still equal the configured command's.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4110, ppid: 1}, argv: []string{"/opt/homebrew/Cellar/python@3.14/Python.app/Contents/MacOS/Python", "discord_gateway_service.py"}, env: secretEnv(testCityRoot)},
		// A wrapper script exec'd a binary (run.sh -> adapter): it leads its
		// own group like a service root, but its argv is not the command.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4111, ppid: 1}, argv: []string{"/packs/discord/adapter/bin"}, env: secretEnv(testCityRoot)},
		// This city's state root, but another command.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4112, ppid: 1}, argv: []string{"python3", "some_other_tool.py"}, env: secretEnv(testCityRoot)},
		// A Setsid daemon a service started, with a generic argv.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4113, ppid: 1}, argv: []string{"/usr/local/bin/somedaemon", "--serve"}, env: secretEnv(testCityRoot)},
		// bd's db-proxy-child: city infrastructure supervising the store's
		// dolt server.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4114, ppid: 1}, argv: []string{"bd", "db-proxy-child", "--root", "/cities/alpha/.beads/dolt"}, env: secretEnv(testCityRoot)},
		// gc's managed-Dolt scope watchdog: Setpgid (not Setsid), inherited
		// env, re-parented to launchd.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4115, ppid: 1}, argv: []string{"/Users/x/.local/bin/gc", "__gc-managed-dolt-scope-watchdog", "--city", "/cities/alpha"}, env: secretEnv(testCityRoot)},
		// A descendant in some other process's group.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4116, ppid: 1, pgid: 4111}, argv: []string{"/packs/discord/adapter/helper"}, env: secretEnv(testCityRoot)},
		// The sweeper itself and launchd.
		fakeOrphanProc{entry: orphanProcEntry{pid: testSweeperPID, ppid: 1}, argv: testServiceCommand, env: secretEnv(testCityRoot)},
		fakeOrphanProc{entry: orphanProcEntry{pid: 1, ppid: 0}, argv: []string{"/sbin/launchd"}, env: map[string]string{}},
	)
}

// fixtureMatches is every pid of orphanFixture the sweep must match.
var fixtureMatches = []int{4101, 4110}

func testIdentity() orphanIdentity {
	return newOrphanIdentity("discord-gateway", testCityRoot, testServiceCommand)
}

func TestOrphanTableFindMatchesOnlyThisCitysOrphans(t *testing.T) {
	ft := orphanFixture()
	got := ft.table().find(testSweeperPID, testIdentity())
	if !slices.Equal(got, fixtureMatches) {
		t.Fatalf("find = %v, want %v", got, fixtureMatches)
	}
}

func TestOrphanTableCommandMatchRules(t *testing.T) {
	cmd := []string{"python3", "-u", "svc.py"}
	for _, tc := range []struct {
		name    string
		command []string
		argv    []string
		want    bool
	}{
		{name: "exact", command: cmd, argv: cmd, want: true},
		{name: "interpreter re-exec rewrote argv[0]", command: cmd, argv: []string{"/x/Python.app/Contents/MacOS/Python", "-u", "svc.py"}, want: true},
		{name: "different script", command: cmd, argv: []string{"/x/Python", "-u", "other.py"}},
		{name: "extra argument", command: cmd, argv: []string{"/x/Python", "-u", "svc.py", "--x"}},
		{name: "single-element command never matches on the tail", command: []string{"./run.sh"}, argv: []string{"/bin/other"}},
		{name: "no argv", command: cmd},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := orphanCommandMatches(tc.argv, tc.command); got != tc.want {
				t.Fatalf("orphanCommandMatches(%q, %q) = %v, want %v", tc.argv, tc.command, got, tc.want)
			}
		})
	}
}

func TestOrphanTableFindReadsOnlyTheIdentityVariables(t *testing.T) {
	ft := orphanFixture()
	ft.table().find(testSweeperPID, testIdentity())
	if len(ft.envKeys) == 0 {
		t.Fatal("the sweep never read the identity variables; it cannot have proven ownership")
	}
	for _, k := range ft.envKeys {
		if k != stateRootEnvKey && k != serviceNameEnvKey {
			t.Fatalf("the sweep read environment key %q; only %q and %q may be read", k, stateRootEnvKey, serviceNameEnvKey)
		}
	}
	// A process's arguments are read only for live group-leader orphans: a
	// live supervisor's child, a zombie, a non-leader, launchd and the
	// sweeper itself fail a cheaper check first — and each candidate's
	// arguments and environment are read once, together.
	seen := map[int]bool{}
	for _, pid := range ft.argPIDs {
		switch pid {
		case 4105, 4106, 4116, 1, testSweeperPID:
			t.Fatalf("the sweep read the arguments of pid %d, which fails a cheaper check first", pid)
		}
		if seen[pid] {
			t.Fatalf("the sweep read the arguments of pid %d twice in one find", pid)
		}
		seen[pid] = true
	}
}

// City infrastructure that inherited a service's environment and cwd — bd's
// db-proxy-child (whose group holds the city's dolt sql-server) and gc's
// managed-Dolt scope watchdog — is never matched, by any rule.
func TestOrphanTableNeverMatchesCityInfrastructure(t *testing.T) {
	for _, argv := range [][]string{
		{"bd", "db-proxy-child", "--root", "/cities/alpha/.beads/dolt"},
		{"/Users/x/.local/bin/gc", "__gc-managed-dolt-scope-watchdog"},
		{"gc", "nudge", "poll", "--session", "s1"},
	} {
		t.Run(argv[1], func(t *testing.T) {
			// Even configured as the service's own command, so the exact-argv
			// rule would otherwise match.
			id := newOrphanIdentity("discord-gateway", testCityRoot, argv)
			ft := newFakeOrphanTable(fakeOrphanProc{entry: orphanProcEntry{pid: 4200, ppid: 1}, argv: argv, env: secretEnv(testCityRoot)})
			if got := ft.table().find(testSweeperPID, id); len(got) != 0 {
				t.Fatalf("find = %v, want city infrastructure left alone", got)
			}
		})
	}
}

// A process that carries this instance's state root but does not run the
// service command is never matched, whatever its shape. gc's managed dolt
// sql-server is started Setpgid (its own group, in its starter's session) with
// the starter's whole environment and cwd (cmd/gc/dolt_start_managed.go,
// dolt_scope_watchdog.go): started by a `gc` call a service made, then
// re-parented to launchd once its watchdog is gone, it looks exactly like a
// service root that exec'd another binary in the service's command dir.
func TestOrphanTableNeverMatchesASameRootProcessRunningAnotherCommand(t *testing.T) {
	for _, tc := range []struct {
		name string
		proc fakeOrphanProc
	}{
		{name: "managed dolt sql-server", proc: fakeOrphanProc{entry: orphanProcEntry{pid: 4250, ppid: 1}, argv: []string{"dolt", "sql-server", "--config", "/cities/alpha/.beads/dolt/config.yaml"}, env: secretEnv(testCityRoot)}},
		{name: "tmux server", proc: fakeOrphanProc{entry: orphanProcEntry{pid: 4251, ppid: 1}, argv: []string{"tmux", "-L", "gc-alpha", "new-session", "-d"}, env: secretEnv(testCityRoot)}},
		{name: "agent runtime", proc: fakeOrphanProc{entry: orphanProcEntry{pid: 4252, ppid: 1}, argv: []string{"/Users/x/.local/bin/claude", "--resume", "abc"}, env: secretEnv(testCityRoot)}},
		{name: "wrapper-exec'd binary", proc: fakeOrphanProc{entry: orphanProcEntry{pid: 4253, ppid: 1}, argv: []string{"/packs/discord/adapter/bin"}, env: secretEnv(testCityRoot)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ft := newFakeOrphanTable(tc.proc)
			if got := ft.table().find(testSweeperPID, testIdentity()); len(got) != 0 {
				t.Fatalf("find = %v, want a process not running the service command left alone", got)
			}
		})
	}
}

// A service's orphan carries its own GC_SERVICE_NAME and leads its own
// process group (the spawn path's Setpgid). A sibling service sharing the
// state root, and a same-argv process inside another group, are not this
// service's orphans.
func TestOrphanTableMatchesOnlyThisServicesGroupLeaders(t *testing.T) {
	siblingEnv := secretEnv(testCityRoot)
	siblingEnv["GC_SERVICE_NAME"] = "discord-admin"
	for _, tc := range []struct {
		name string
		proc fakeOrphanProc
	}{
		{name: "sibling service sharing the state root", proc: fakeOrphanProc{entry: orphanProcEntry{pid: 4260, ppid: 1}, argv: testServiceCommand, env: siblingEnv}},
		{name: "no service name", proc: fakeOrphanProc{entry: orphanProcEntry{pid: 4261, ppid: 1}, argv: testServiceCommand, env: map[string]string{stateRootEnvKey: testCityRoot}}},
		{name: "not a group leader", proc: fakeOrphanProc{entry: orphanProcEntry{pid: 4262, ppid: 1, pgid: 4999}, argv: testServiceCommand, env: secretEnv(testCityRoot)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ft := newFakeOrphanTable(tc.proc)
			if got := ft.table().find(testSweeperPID, testIdentity()); len(got) != 0 {
				t.Fatalf("find = %v, want none", got)
			}
		})
	}
}

// The identity check (pid and start time) is the last thing before each
// signal: here the orphan exits while its group is being checked and a new
// process takes its pid, so neither SIGTERM nor SIGKILL may be sent to it.
func TestReapOrphansFromTableRechecksIdentityAfterTheGroupCheck(t *testing.T) {
	reused := func(ft *fakeOrphanTable, pid int) {
		p := *orphanFixture().procs[pid]
		p.entry.startTime += 7
		ft.replace(p)
	}
	t.Run("before SIGTERM", func(t *testing.T) {
		ft := orphanFixture()
		tb := ft.table()
		inner, lists := tb.list, 0
		tb.list = func() ([]orphanProcEntry, error) {
			lists++
			// List 1 is find; list 2 is 4101's group check.
			if lists == 2 {
				reused(ft, 4101)
			}
			return inner()
		}
		ft.onSignal = func(pid int, sig syscall.Signal) { ft.remove(pid) }
		reapOrphansFromTable(tb, testIdentity(), testSweeperPID, ft.signal, 50*time.Millisecond)
		for _, s := range ft.signaled() {
			if strings.HasPrefix(s, "4101:") {
				t.Fatalf("signals = %v; pid 4101 was reused during its group check", ft.signaled())
			}
		}
	})
	t.Run("before SIGKILL", func(t *testing.T) {
		ft := orphanFixture() // the orphans ignore SIGTERM
		tb := ft.table()
		inner, terms, done := tb.list, 0, false
		ft.onSignal = func(pid int, sig syscall.Signal) {
			if sig == syscall.SIGTERM {
				terms++
			}
		}
		tb.list = func() ([]orphanProcEntry, error) {
			// The first list after both SIGTERMs is 4101's pre-SIGKILL
			// group check.
			if terms == len(fixtureMatches) && !done {
				done = true
				reused(ft, 4101)
			}
			return inner()
		}
		reapOrphansFromTable(tb, testIdentity(), testSweeperPID, ft.signal, 50*time.Millisecond)
		for _, s := range ft.signaled() {
			if s == "4101:KILL" {
				t.Fatalf("signals = %v; pid 4101 was reused during its pre-SIGKILL group check", ft.signaled())
			}
		}
	})
}

// gc's managed dolt sql-server in an orphan's group refuses the group: in
// test mode it is started without Setpgid, so it can share a group.
func TestReapOrphansFromTableRefusesAGroupHoldingDolt(t *testing.T) {
	ft := newFakeOrphanTable(
		fakeOrphanProc{entry: orphanProcEntry{pid: 4301, ppid: 1}, argv: testServiceCommand, env: secretEnv(testCityRoot)},
		fakeOrphanProc{entry: orphanProcEntry{pid: 4302, ppid: 4301, pgid: 4301}, argv: []string{"/opt/homebrew/bin/dolt", "sql-server", "--config", "/c/config.yaml"}},
	)
	reapOrphansFromTable(ft.table(), testIdentity(), testSweeperPID, ft.signal, 50*time.Millisecond)
	if got := ft.signaled(); len(got) != 0 {
		t.Fatalf("signals = %v, want none", got)
	}
}

// Infrastructure that joins the group after SIGTERM refuses the SIGKILL.
func TestReapOrphansFromTableRefusesSIGKILLWhenInfrastructureJoinsTheGroup(t *testing.T) {
	ft := newFakeOrphanTable(
		fakeOrphanProc{entry: orphanProcEntry{pid: 4301, ppid: 1}, argv: testServiceCommand, env: secretEnv(testCityRoot)},
	)
	ft.onSignal = func(pid int, sig syscall.Signal) {
		if sig == syscall.SIGTERM {
			ft.replace(fakeOrphanProc{entry: orphanProcEntry{pid: 4302, ppid: 4301, pgid: 4301}, argv: []string{"bd", "db-proxy-child"}})
		}
	}
	reapOrphansFromTable(ft.table(), testIdentity(), testSweeperPID, ft.signal, 50*time.Millisecond)
	if got := ft.signaled(); !slices.Equal(got, []string{"4301:TERM"}) {
		t.Fatalf("signals = %v, want [4301:TERM] and no SIGKILL", got)
	}
}

func TestOrphanTableFindRefusesIncompleteIdentityAndInitSweeper(t *testing.T) {
	ft := orphanFixture()
	for _, tc := range []struct {
		name string
		self int
		id   orphanIdentity
	}{
		{name: "sweeper is init", self: 1, id: testIdentity()},
		{name: "no state root", self: testSweeperPID, id: newOrphanIdentity("discord-gateway", "", testServiceCommand)},
		{name: "no command", self: testSweeperPID, id: newOrphanIdentity("discord-gateway", testCityRoot, nil)},
		{name: "no service name", self: testSweeperPID, id: newOrphanIdentity("", testCityRoot, testServiceCommand)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := ft.table().find(tc.self, tc.id); len(got) != 0 {
				t.Fatalf("find = %v, want none", got)
			}
		})
	}
}

func TestOrphanTableFindListFailureFindsNothing(t *testing.T) {
	ft := orphanFixture()
	ft.listErr = errors.New("sysctl failed")
	if got := ft.table().find(testSweeperPID, testIdentity()); len(got) != 0 {
		t.Fatalf("find = %v, want none when the table cannot be listed", got)
	}
}

func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prevOut, prevFlags := log.Writer(), log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(prevOut)
		log.SetFlags(prevFlags)
	})
	return &buf
}

func termsFor(pids []int, sig string) []string {
	var out []string
	for _, pid := range pids {
		out = append(out, strconv.Itoa(pid)+":"+sig)
	}
	return out
}

func TestReapOrphansFromTableTermsOnlyMatchesAndLogsThem(t *testing.T) {
	logs := captureLog(t)
	ft := orphanFixture()
	// The orphans exit on SIGTERM, as well-behaved services do.
	ft.onSignal = func(pid int, sig syscall.Signal) {
		if sig == syscall.SIGTERM {
			ft.remove(pid)
		}
	}

	reaped := reapOrphansFromTable(ft.table(), testIdentity(), testSweeperPID, ft.signal, 200*time.Millisecond)

	if !slices.Equal(reaped, fixtureMatches) {
		t.Fatalf("reaped = %v, want %v", reaped, fixtureMatches)
	}
	if got, want := ft.signaled(), termsFor(fixtureMatches, "TERM"); !slices.Equal(got, want) {
		t.Fatalf("signals = %v, want %v", got, want)
	}
	out := logs.String()
	for _, pid := range fixtureMatches {
		if !strings.Contains(out, "pid "+strconv.Itoa(pid)) {
			t.Fatalf("log %q does not name reaped pid %d", out, pid)
		}
	}
	if !strings.Contains(out, `"discord-gateway"`) {
		t.Fatalf("log %q does not name the service", out)
	}
	if strings.Contains(out, "secret-token-value") || strings.Contains(out, testCityRoot) {
		t.Fatalf("log %q leaks an environment value", out)
	}
}

func TestReapOrphansFromTableKillsAStragglerAfterTheWait(t *testing.T) {
	ft := orphanFixture() // the orphans ignore SIGTERM
	start := time.Now()
	reapOrphansFromTable(ft.table(), testIdentity(), testSweeperPID, ft.signal, 150*time.Millisecond)
	if elapsed := time.Since(start); elapsed < 150*time.Millisecond {
		t.Fatalf("escalated after %v, before the bounded wait elapsed", elapsed)
	}
	want := append(termsFor(fixtureMatches, "TERM"), termsFor(fixtureMatches, "KILL")...)
	if got := ft.signaled(); !slices.Equal(got, want) {
		t.Fatalf("signals = %v, want %v", got, want)
	}
}

func TestReapOrphansFromTableNeverKillsARecycledPID(t *testing.T) {
	for _, tc := range []struct {
		name string
		next func(pid int) fakeOrphanProc
	}{
		{name: "reused by a process with a live parent", next: func(pid int) fakeOrphanProc {
			return fakeOrphanProc{entry: orphanProcEntry{pid: pid, ppid: 5555}, argv: []string{"vim"}, env: map[string]string{}}
		}},
		// Same ppid, argv and root: only the start time tells the new
		// process apart.
		{name: "reused by an identical-looking orphan", next: func(pid int) fakeOrphanProc {
			p := *orphanFixture().procs[pid]
			p.entry.startTime += 7
			return p
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ft := orphanFixture()
			ft.onSignal = func(pid int, sig syscall.Signal) {
				if sig == syscall.SIGTERM {
					ft.replace(tc.next(pid))
				}
			}
			reapOrphansFromTable(ft.table(), testIdentity(), testSweeperPID, ft.signal, 100*time.Millisecond)
			if got, want := ft.signaled(), termsFor(fixtureMatches, "TERM"); !slices.Equal(got, want) {
				t.Fatalf("signals = %v, want %v (no SIGKILL for recycled pids)", got, want)
			}
		})
	}
}

// A pid that stops matching between find and its first SIGTERM — here, the
// orphan exits and its pid is reused while later candidates are matched —
// is not signaled at all.
func TestReapOrphansFromTableRechecksBeforeFirstSIGTERM(t *testing.T) {
	ft := orphanFixture()
	tb := ft.table()
	inner := tb.procArgs
	tb.procArgs = func(pid int, keys ...string) ([]string, map[string]string, error) {
		// Matching 4110 (the last match) happens after 4101 matched.
		if pid == 4110 {
			ft.replace(fakeOrphanProc{entry: orphanProcEntry{pid: 4101, ppid: 5555}, argv: []string{"vim"}, env: map[string]string{}})
		}
		return inner(pid, keys...)
	}
	reapOrphansFromTable(tb, testIdentity(), testSweeperPID, ft.signal, 50*time.Millisecond)
	for _, s := range ft.signaled() {
		if strings.HasPrefix(s, "4101:") {
			t.Fatalf("signals = %v; pid 4101 was reused before its SIGTERM and must not be signaled", ft.signaled())
		}
	}
}

// A matched orphan whose process group holds city infrastructure — or a
// member whose argv cannot be read — is refused: kill(-pgid) would take the
// infrastructure down with it.
func TestReapOrphansFromTableRefusesAGroupHoldingInfrastructure(t *testing.T) {
	for _, tc := range []struct {
		name   string
		member fakeOrphanProc
	}{
		{name: "db-proxy-child in the group", member: fakeOrphanProc{entry: orphanProcEntry{pid: 4302, ppid: 4301, pgid: 4301}, argv: []string{"bd", "db-proxy-child"}}},
		{name: "unreadable member", member: fakeOrphanProc{entry: orphanProcEntry{pid: 4302, ppid: 4301, pgid: 4301}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logs := captureLog(t)
			ft := newFakeOrphanTable(
				fakeOrphanProc{entry: orphanProcEntry{pid: 4301, ppid: 1}, argv: testServiceCommand, env: secretEnv(testCityRoot)},
				tc.member,
			)
			reapOrphansFromTable(ft.table(), testIdentity(), testSweeperPID, ft.signal, 50*time.Millisecond)
			if got := ft.signaled(); len(got) != 0 {
				t.Fatalf("signals = %v, want none", got)
			}
			if !strings.Contains(logs.String(), "pid 4301") {
				t.Fatalf("log %q does not report the refused pid", logs.String())
			}
		})
	}

	// A group whose other members are ordinary processes is still reaped.
	ft := newFakeOrphanTable(
		fakeOrphanProc{entry: orphanProcEntry{pid: 4301, ppid: 1}, argv: testServiceCommand, env: secretEnv(testCityRoot)},
		fakeOrphanProc{entry: orphanProcEntry{pid: 4302, ppid: 4301, pgid: 4301}, argv: []string{"/bin/sleep", "600"}},
	)
	ft.onSignal = func(pid int, sig syscall.Signal) { ft.remove(pid) }
	reapOrphansFromTable(ft.table(), testIdentity(), testSweeperPID, ft.signal, 50*time.Millisecond)
	if got := ft.signaled(); !slices.Equal(got, []string{"4301:TERM"}) {
		t.Fatalf("signals = %v, want [4301:TERM]", got)
	}
}

// eventLogWriter records each log line as one event in a shared sequence.
type eventLogWriter struct{ record func(string) }

func (w eventLogWriter) Write(p []byte) (int, error) {
	w.record("log")
	return len(p), nil
}

// Nothing that can block — a log write to a full stderr pipe or a slow disk
// above all — sits between the last identity check of a pid and its signal:
// for SIGTERM and SIGKILL alike, the event right before the signal is the
// kernel lookup of that pid, and the signal is still logged, afterwards.
func TestReapOrphansFromTableSignalsRightAfterTheLastIdentityCheck(t *testing.T) {
	var (
		mu     sync.Mutex
		events []string
	)
	record := func(ev string) {
		mu.Lock()
		events = append(events, ev)
		mu.Unlock()
	}
	prevOut, prevFlags := log.Writer(), log.Flags()
	log.SetOutput(eventLogWriter{record: record})
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(prevOut)
		log.SetFlags(prevFlags)
	})

	ft := orphanFixture() // the orphans ignore SIGTERM, so both signals fire
	tb := ft.table()
	lookup := tb.lookup
	tb.lookup = func(pid int) (orphanProcEntry, bool, error) {
		record("lookup:" + strconv.Itoa(pid))
		return lookup(pid)
	}
	signal := func(pid int, sig syscall.Signal) {
		record("signal:" + strconv.Itoa(pid) + ":" + sigName(sig))
		ft.signal(pid, sig)
	}
	reapOrphansFromTable(tb, testIdentity(), testSweeperPID, signal, 50*time.Millisecond)

	signals := 0
	for i, ev := range events {
		if !strings.HasPrefix(ev, "signal:") {
			continue
		}
		signals++
		pid := strings.Split(ev, ":")[1]
		if i == 0 || events[i-1] != "lookup:"+pid {
			t.Fatalf("event before %q is %q, want lookup:%s; events = %v", ev, events[max(i-1, 0)], pid, events)
		}
		if i+1 >= len(events) || events[i+1] != "log" {
			t.Fatalf("%q is not logged right after it is sent; events = %v", ev, events)
		}
	}
	if want := 2 * len(fixtureMatches); signals != want {
		t.Fatalf("sent %d signals, want %d; events = %v", signals, want, events)
	}
}
