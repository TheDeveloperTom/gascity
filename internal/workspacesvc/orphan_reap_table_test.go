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

// testSessionID is the session every fake process belongs to unless a row
// says otherwise: the supervisor's session, which no service root leads.
const testSessionID = 500

// fakeOrphanProc is one row of the fake process table: its kinfo-style
// entry, its session, argv, environment and cwd. env holds secrets on
// purpose so the tests can prove the sweep never asks for them. A zero
// entry.pgid means "leads its own group"; a zero sid means testSessionID.
type fakeOrphanProc struct {
	entry orphanProcEntry
	sid   int
	argv  []string
	env   map[string]string
	cwd   string
}

// fakeOrphanTable is an injectable process lister for the table-driven sweep
// (the darwin path). It records every environment key the sweep asks for,
// every pid whose environment or cwd it reads, and every signal it sends.
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
		ft.put(procs[i])
	}
	return ft
}

func (ft *fakeOrphanTable) put(p fakeOrphanProc) {
	if p.entry.pgid == 0 {
		p.entry.pgid = p.entry.pid
	}
	if p.sid == 0 {
		p.sid = testSessionID
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
		sid: func(pid int) (int, error) {
			ft.mu.Lock()
			defer ft.mu.Unlock()
			p, ok := ft.procs[pid]
			if !ok {
				return 0, errors.New("no such process")
			}
			return p.sid, nil
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
	testCommandDir    = "/packs/discord"
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
		// This city's state root and cwd, but its argv cannot be read: the
		// infrastructure guard cannot run, so it never matches.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4109, ppid: 1}, env: secretEnv(testCityRoot), cwd: testCommandDir},
		// Homebrew python re-execs through Python.app, rewriting argv[0]: the
		// arguments after it still equal the configured command's.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4110, ppid: 1}, argv: []string{"/opt/homebrew/Cellar/python@3.14/Python.app/Contents/MacOS/Python", "discord_gateway_service.py"}, env: secretEnv(testCityRoot), cwd: "/elsewhere"},
		// A wrapper script exec'd a binary (run.sh -> adapter): the argv is
		// unrelated, but the process runs in the service's command dir and,
		// like every service root, leads its own group inside the
		// supervisor's session.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4111, ppid: 1}, argv: []string{"/packs/discord/adapter/bin"}, env: secretEnv(testCityRoot), cwd: testCommandDir},
		// This city's state root, but neither the command nor the cwd match.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4112, ppid: 1}, argv: []string{"python3", "some_other_tool.py"}, env: secretEnv(testCityRoot), cwd: "/elsewhere"},
		// A Setsid daemon a service started (bd's db-proxy-child shape, with
		// a generic argv): it inherited the state root and cwd and was
		// re-parented to launchd, but it leads its own session — no service
		// root ever does.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4113, ppid: 1}, sid: 4113, argv: []string{"/usr/local/bin/somedaemon", "--serve"}, env: secretEnv(testCityRoot), cwd: testCommandDir},
		// bd's db-proxy-child itself, even shaped as a non-session group
		// leader: city infrastructure supervising the store's dolt server.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4114, ppid: 1}, argv: []string{"bd", "db-proxy-child", "--root", "/cities/alpha/.beads/dolt"}, env: secretEnv(testCityRoot), cwd: testCommandDir},
		// gc's managed-Dolt scope watchdog: Setpgid (not Setsid), inherited
		// env and cwd, re-parented to launchd. Only the infrastructure guard
		// tells it apart.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4115, ppid: 1}, argv: []string{"/Users/x/.local/bin/gc", "__gc-managed-dolt-scope-watchdog", "--city", "/cities/alpha"}, env: secretEnv(testCityRoot), cwd: testCommandDir},
		// A descendant in some other process's group: same root and cwd, but
		// not a group leader, so not a service root.
		fakeOrphanProc{entry: orphanProcEntry{pid: 4116, ppid: 1, pgid: 4111}, argv: []string{"/packs/discord/adapter/helper"}, env: secretEnv(testCityRoot), cwd: testCommandDir},
		// The sweeper itself and launchd.
		fakeOrphanProc{entry: orphanProcEntry{pid: testSweeperPID, ppid: 1}, argv: testServiceCommand, env: secretEnv(testCityRoot)},
		fakeOrphanProc{entry: orphanProcEntry{pid: 1, ppid: 0}, argv: []string{"/sbin/launchd"}, env: map[string]string{}},
	)
}

// fixtureMatches is every pid of orphanFixture the sweep must match.
var fixtureMatches = []int{4101, 4110, 4111}

func testIdentity() orphanIdentity {
	id := newOrphanIdentity("discord-gateway", testCityRoot, testServiceCommand)
	id.dir = testCommandDir
	return id
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
	// The cwd (an lsof call on darwin) is only read for same-root,
	// non-infrastructure group leaders outside a session lead whose argv did
	// not match.
	for _, pid := range ft.cwdPIDs {
		switch pid {
		case 4111, 4112:
		default:
			t.Fatalf("the sweep read the cwd of pid %d; only same-root group-leader argv mismatches need it", pid)
		}
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
			id.dir = testCommandDir
			ft := newFakeOrphanTable(fakeOrphanProc{entry: orphanProcEntry{pid: 4200, ppid: 1}, argv: argv, env: secretEnv(testCityRoot), cwd: testCommandDir})
			if got := ft.table().find(testSweeperPID, id); len(got) != 0 {
				t.Fatalf("find = %v, want city infrastructure left alone", got)
			}
		})
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

// Without a known command dir the cwd rule never matches: an empty dir must
// not equal a process whose cwd could not be read.
func TestOrphanTableFindWithoutCommandDirSkipsCwdRule(t *testing.T) {
	ft := orphanFixture()
	got := ft.table().find(testSweeperPID, newOrphanIdentity("discord-gateway", testCityRoot, testServiceCommand))
	if !slices.Equal(got, []int{4101, 4110}) {
		t.Fatalf("find = %v, want [4101 4110]", got)
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

// The escalation wait re-checks a matched pid by its start time, not by
// re-running the identity rules: the cwd rule's lsof runs once per pid, not
// on every 50ms poll.
func TestReapOrphansFromTableReadsCwdOncePerPID(t *testing.T) {
	ft := orphanFixture() // the orphans ignore SIGTERM
	reapOrphansFromTable(ft.table(), testIdentity(), testSweeperPID, ft.signal, 200*time.Millisecond)
	reads := 0
	for _, pid := range ft.cwdPIDs {
		if pid == 4111 {
			reads++
		}
	}
	// One read in find, one in the pre-SIGTERM re-check.
	if reads > 2 {
		t.Fatalf("read the cwd of pid 4111 %d times during one reap; want at most 2", reads)
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
		// Same ppid, argv, root and cwd: only the start time tells the new
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
	inner := tb.cwd
	tb.cwd = func(pid int) (string, error) {
		// Matching 4111 (the last match) happens after 4101 matched.
		if pid == 4111 {
			ft.replace(fakeOrphanProc{entry: orphanProcEntry{pid: 4101, ppid: 5555}, argv: []string{"vim"}, env: map[string]string{}})
		}
		return inner(pid)
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

// The cwd rule is disabled when the service runs in the city root: every
// `gc`/`bd` call a root-pack service makes from there leaves descendants with
// that cwd, so it identifies nothing. A pack dir keeps it.
func TestOrphanCwdRuleDir(t *testing.T) {
	city := t.TempDir()
	pack := t.TempDir()
	if got := orphanCwdRuleDir(city, city); got != "" {
		t.Fatalf("orphanCwdRuleDir(city, city) = %q, want disabled", got)
	}
	if got, want := orphanCwdRuleDir(pack, city), resolveOrphanCommandDir(pack); got != want {
		t.Fatalf("orphanCwdRuleDir(pack, city) = %q, want %q", got, want)
	}
	if got := orphanCwdRuleDir("", city); got != "" {
		t.Fatalf("orphanCwdRuleDir(\"\", city) = %q, want disabled", got)
	}
}
