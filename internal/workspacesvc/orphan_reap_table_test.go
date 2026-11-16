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
// entry, its argv, and its environment. env holds secrets on purpose so the
// tests can prove the sweep never asks for them.
type fakeOrphanProc struct {
	entry orphanProcEntry
	argv  []string
	env   map[string]string
	cwd   string
}

// fakeOrphanTable is an injectable process lister for the table-driven sweep
// (the darwin path). It records every environment key the sweep asks for and
// every pid whose environment it reads.
type fakeOrphanTable struct {
	mu       sync.Mutex
	procs    map[int]*fakeOrphanProc
	envKeys  []string
	envPIDs  []int
	cwdPIDs  []int
	listErr  error
	signals  []string
	onSignal func(pid int, sig syscall.Signal)
}

func newFakeOrphanTable(procs ...fakeOrphanProc) *fakeOrphanTable {
	ft := &fakeOrphanTable{procs: map[int]*fakeOrphanProc{}}
	for i := range procs {
		p := procs[i]
		ft.procs[p.entry.pid] = &p
	}
	return ft
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
		cmdline: func(pid int) ([]string, error) {
			ft.mu.Lock()
			defer ft.mu.Unlock()
			p, ok := ft.procs[pid]
			if !ok || p.argv == nil {
				return nil, errors.New("no such process")
			}
			return slices.Clone(p.argv), nil
		},
		envValue: func(pid int, key string) (string, bool, error) {
			ft.mu.Lock()
			defer ft.mu.Unlock()
			ft.envKeys = append(ft.envKeys, key)
			ft.envPIDs = append(ft.envPIDs, pid)
			p, ok := ft.procs[pid]
			if !ok || p.env == nil {
				return "", false, errors.New("environment unreadable")
			}
			v, ok := p.env[key]
			return v, ok, nil
		},
		cwd: func(pid int) (string, error) {
			ft.mu.Lock()
			defer ft.mu.Unlock()
			ft.cwdPIDs = append(ft.cwdPIDs, pid)
			p, ok := ft.procs[pid]
			if !ok || p.cwd == "" {
				return "", errors.New("cwd unreadable")
			}
			return p.cwd, nil
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
	testCommandDir    = "/packs/discord"
)

var testServiceCommand = []string{"python3", "discord_gateway_service.py"}

// orphanFixture returns the standard fake host: one true orphan of this
// city's service, plus every kind of process the sweep must leave alone.
func orphanFixture() *fakeOrphanTable {
	secretEnv := func(root string) map[string]string {
		return map[string]string{
			stateRootEnvKey:     root,
			"GC_SERVICE_NAME":   "discord-gateway",
			"DISCORD_BOT_TOKEN": "secret-token-value",
		}
	}
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
		// A same-argv orphan whose argv cannot be read.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4109, ppid: 1}, env: secretEnv(testCityRoot)},
		// Homebrew python re-execs through Python.app, rewriting argv[0]: the
		// arguments after it still equal the configured command's.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4110, ppid: 1}, argv: []string{"/opt/homebrew/Cellar/python@3.14/Python.app/Contents/MacOS/Python", "discord_gateway_service.py"}, env: secretEnv(testCityRoot), cwd: "/elsewhere"},
		// A wrapper script exec'd a binary (run.sh -> adapter): the argv is
		// unrelated, but the process runs in the service's command dir.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4111, ppid: 1}, argv: []string{"/packs/discord/adapter/bin"}, env: secretEnv(testCityRoot), cwd: testCommandDir},
		// This city's state root, but neither the command nor the cwd match.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4112, ppid: 1}, argv: []string{"python3", "some_other_tool.py"}, env: secretEnv(testCityRoot), cwd: "/elsewhere"},
		// The sweeper itself and launchd.
		fakeOrphanProc{entry: orphanProcEntry{pid: testSweeperPID, ppid: 1}, argv: testServiceCommand, env: secretEnv(testCityRoot)},
		fakeOrphanProc{entry: orphanProcEntry{pid: 1, ppid: 0}, argv: []string{"/sbin/launchd"}, env: map[string]string{}},
	)
}

func testIdentity() orphanIdentity {
	id := newOrphanIdentity("discord-gateway", testCityRoot, testServiceCommand)
	id.dir = testCommandDir
	return id
}

func TestOrphanTableFindMatchesOnlyThisCitysOrphan(t *testing.T) {
	ft := orphanFixture()
	got := ft.table().find(testSweeperPID, testIdentity())
	if !slices.Equal(got, []int{4101, 4110, 4111}) {
		t.Fatalf("find = %v, want [4101 4110 4111]", got)
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

func TestOrphanTableFindReadsOnlyTheStateRootVariable(t *testing.T) {
	ft := orphanFixture()
	ft.table().find(testSweeperPID, testIdentity())
	if len(ft.envKeys) == 0 {
		t.Fatal("the sweep never read the state root; it cannot have proven ownership")
	}
	for _, k := range ft.envKeys {
		if k != stateRootEnvKey {
			t.Fatalf("the sweep read environment key %q; only %q may be read", k, stateRootEnvKey)
		}
	}
	// The environment is only read for live orphans: a live supervisor's
	// child, a zombie, launchd and the sweeper itself are never touched.
	for _, pid := range ft.envPIDs {
		switch pid {
		case 4105, 4106, 1, testSweeperPID:
			t.Fatalf("the sweep read the environment of pid %d, which fails a cheaper check first", pid)
		}
	}
	// The cwd (an lsof call on darwin) is only read for orphans that already
	// carry this instance's state root and whose argv did not match.
	for _, pid := range ft.cwdPIDs {
		switch pid {
		case 4109, 4111, 4112: // same root; argv unreadable or not the command
		default:
			t.Fatalf("the sweep read the cwd of pid %d; only same-root argv mismatches need it", pid)
		}
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

func TestReapOrphansFromTableTermsOnlyMatchesAndLogsThem(t *testing.T) {
	logs := captureLog(t)
	ft := orphanFixture()
	// The orphan exits on SIGTERM, as a well-behaved service does.
	ft.onSignal = func(pid int, sig syscall.Signal) {
		if sig == syscall.SIGTERM {
			ft.remove(pid)
		}
	}

	reaped := reapOrphansFromTable(ft.table(), testIdentity(), testSweeperPID, ft.signal, 200*time.Millisecond)

	if !slices.Equal(reaped, []int{4101, 4110, 4111}) {
		t.Fatalf("reaped = %v, want [4101 4110 4111]", reaped)
	}
	if got := ft.signaled(); !slices.Equal(got, []string{"4101:TERM", "4110:TERM", "4111:TERM"}) {
		t.Fatalf("signals = %v, want only SIGTERM to the three orphans", got)
	}
	out := logs.String()
	for _, pid := range []string{"4101", "4110", "4111"} {
		if !strings.Contains(out, "pid "+pid) {
			t.Fatalf("log %q does not name reaped pid %s", out, pid)
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
	ft := orphanFixture() // the orphan ignores SIGTERM
	start := time.Now()
	reapOrphansFromTable(ft.table(), testIdentity(), testSweeperPID, ft.signal, 150*time.Millisecond)
	if elapsed := time.Since(start); elapsed < 150*time.Millisecond {
		t.Fatalf("escalated after %v, before the bounded wait elapsed", elapsed)
	}
	want := []string{"4101:TERM", "4110:TERM", "4111:TERM", "4101:KILL", "4110:KILL", "4111:KILL"}
	if got := ft.signaled(); !slices.Equal(got, want) {
		t.Fatalf("signals = %v, want %v", got, want)
	}
}

func TestReapOrphansFromTableNeverKillsARecycledPID(t *testing.T) {
	ft := orphanFixture()
	// After SIGTERM the orphan exits and its pid is reused by an unrelated
	// process with a live parent: the re-check must drop it before SIGKILL.
	ft.onSignal = func(pid int, sig syscall.Signal) {
		if sig != syscall.SIGTERM {
			return
		}
		ft.mu.Lock()
		ft.procs[pid] = &fakeOrphanProc{entry: orphanProcEntry{pid: pid, ppid: 5555}, argv: []string{"vim"}, env: map[string]string{}}
		ft.mu.Unlock()
	}
	reapOrphansFromTable(ft.table(), testIdentity(), testSweeperPID, ft.signal, 100*time.Millisecond)
	if got := ft.signaled(); !slices.Equal(got, []string{"4101:TERM", "4110:TERM", "4111:TERM"}) {
		t.Fatalf("signals = %v, want no SIGKILL for the recycled pids", got)
	}
}

// Without a known command dir the cwd rule never matches: an empty dir must
// not equal a process whose cwd could not be read.
func TestOrphanTableFindWithoutCommandDirSkipsCwdRule(t *testing.T) {
	ft := orphanFixture()
	got := ft.table().find(testSweeperPID, newOrphanIdentity("discord-gateway", testCityRoot, testServiceCommand))
	if !slices.Equal(got, []int{4101, 4110}) {
		t.Fatalf("find = %v, want [4101 4110]", got)
	}
}
