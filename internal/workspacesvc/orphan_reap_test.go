package workspacesvc

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/gastownhall/gascity/internal/beads"
	"github.com/gastownhall/gascity/internal/config"
	"github.com/gastownhall/gascity/internal/pidutil"
	"github.com/gastownhall/gascity/internal/runtime"
)

// requireProcFS skips tests that depend on Linux /proc semantics, mirroring
// the production sweep's silent no-op on hosts without /proc (such as the
// macOS `make test` lane).
func requireProcFS(t *testing.T) {
	t.Helper()
	if _, err := os.Stat("/proc"); err != nil {
		t.Skip("no /proc on this host; orphan reaping is a no-op")
	}
}

// spawnOrphanForTest spawns argv detached through an intermediate process
// (TestOrphanSpawnerProcess) so the child re-parents to init (ppid 1) as the
// leader of its own process group, simulating a service process that
// survived a supervisor hard exit. extraEnv entries are appended to the
// orphan's environment. It returns only once the orphan's
// /proc/<pid>/cmdline reads as argv: right after spawn the exec transition
// can transiently expose an empty or stale command line, which would make
// identity matching flaky for callers asserting on a live match. Skips the
// test on hosts without /proc and on hosts where a child-subreaper
// intercepts re-parenting, since the production filter requires ppid 1 read
// from /proc.
func spawnOrphanForTest(t *testing.T, argv []string, extraEnv []string) int {
	t.Helper()
	requireOrphanSweepHost(t)
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("Executable: %v", err)
	}
	args := append([]string{"-test.run=^TestOrphanSpawnerProcess$", "--"}, argv...)
	cmd := exec.Command(exe, args...)
	cmd.Env = append(append(os.Environ(), extraEnv...), orphanSpawnerEnv+"=1")
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("spawn orphan: %v", err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil {
		t.Fatalf("parse orphan pid from %q: %v", out, err)
	}
	if ident, ok := processIdentityForTest(pid); ok {
		t.Cleanup(func() { killOwnProcessForTest(pid, ident, false) })
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		ppid, err := processParentPIDForTest(pid)
		if err != nil {
			t.Fatalf("orphan %d exited before re-parenting: %v", pid, err)
		}
		if ppid == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Skipf("orphan %d re-parented to %d, not init; host has a child subreaper", pid, ppid)
		}
		time.Sleep(20 * time.Millisecond)
	}

	want := pidutil.NormalizeArgv(argv)
	deadline = time.Now().Add(2 * time.Second)
	for {
		got, err := pidutil.Cmdline(pid)
		if err == nil && argvEquals(got, want) {
			return pid
		}
		if time.Now().After(deadline) {
			t.Fatalf("orphan %d cmdline never became %q (last read %q, err %v)", pid, want, got, err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// orphanSpawnerEnv marks the child TestOrphanSpawnerProcess runs as.
const orphanSpawnerEnv = "GC_TEST_ORPHAN_SPAWNER"

// orphanSpawnerNoSetpgidEnv, passed in extraEnv, makes the spawner start the
// orphan in the spawner's own process group instead: for an orphan that must
// call setsid itself (a daemon), which a group leader cannot.
const orphanSpawnerNoSetpgidEnv = "GC_TEST_ORPHAN_SPAWNER_NO_SETPGID"

// TestOrphanSpawnerProcess is not a test. Run as a child with
// orphanSpawnerEnv set, it starts the argv after the first "--" as the leader
// of its own process group — what the spawn path's Setpgid makes every
// proxy_process child — prints its pid and exits without waiting, so the
// started process re-parents to init: a service orphaned by a supervisor
// hard exit. With orphanSpawnerNoSetpgidEnv set it skips Setpgid.
func TestOrphanSpawnerProcess(_ *testing.T) {
	if os.Getenv(orphanSpawnerEnv) != "1" {
		return
	}
	var argv []string
	for i, arg := range os.Args {
		if arg == "--" {
			argv = os.Args[i+1:]
			break
		}
	}
	if len(argv) == 0 {
		os.Exit(2)
	}
	setpgid := os.Getenv(orphanSpawnerNoSetpgidEnv) != "1"
	env := make([]string, 0, len(os.Environ()))
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, orphanSpawnerEnv+"=") && !strings.HasPrefix(kv, orphanSpawnerNoSetpgidEnv+"=") {
			env = append(env, kv)
		}
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Env = env
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: setpgid}
	if err := cmd.Start(); err != nil {
		os.Exit(3)
	}
	fmt.Println(cmd.Process.Pid)
	os.Exit(0)
}

// processIdentityForTest returns a token naming the process that holds pid
// now: the kernel start time from the sweep's process table where there is
// one (darwin, microseconds), else pidutil.StartTime. ok is false once the
// pid is gone or unreadable.
func processIdentityForTest(pid int) (string, bool) {
	if tb, ok := platformOrphanTable(); ok {
		e, found, err := tb.lookup(pid)
		if err != nil || !found {
			return "", false
		}
		return strconv.FormatInt(e.startTime, 10), true
	}
	start, err := pidutil.StartTime(pid)
	return start, err == nil
}

// killOwnProcessForTest SIGKILLs pid — with group, the process group it
// leads — only while pid still names the process identified by ident, so a
// test cleanup never signals a process that reused the pid of one it spawned.
func killOwnProcessForTest(pid int, ident string, group bool) {
	if cur, ok := processIdentityForTest(pid); !ok || cur != ident {
		return
	}
	if group {
		_ = syscall.Kill(-pid, syscall.SIGKILL)
		return
	}
	_ = syscall.Kill(pid, syscall.SIGKILL)
}

// requireOrphanSweepHost skips tests that need a working orphan sweep: /proc
// (linux) or the sysctl process table (darwin).
func requireOrphanSweepHost(t *testing.T) {
	t.Helper()
	if _, ok := platformOrphanTable(); ok {
		return
	}
	requireProcFS(t)
}

func processParentPIDForTest(pid int) (int, error) {
	if tb, ok := platformOrphanTable(); ok {
		e, found, err := tb.lookup(pid)
		if err != nil {
			return 0, err
		}
		if !found {
			return 0, fmt.Errorf("pid %d is gone", pid)
		}
		return e.ppid, nil
	}
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(string(data[strings.LastIndexByte(string(data), ')')+1:]))
	if len(fields) < 2 {
		return 0, fmt.Errorf("malformed stat for pid %d", pid)
	}
	return strconv.Atoi(fields[1])
}

func processAliveForTest(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}

func waitProcessGoneForTest(t *testing.T, pid int, timeout time.Duration) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !processAliveForTest(pid) {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return !processAliveForTest(pid)
}

func TestReapOrphanedServiceProcessesKillsPPID1CommandMatch(t *testing.T) {
	// `sleep` is an Apple platform binary on darwin, whose environment the
	// kernel withholds; orphan_reap_darwin_test.go covers darwin.
	requireProcFS(t)
	marker := fmt.Sprintf("86340.0%d", os.Getpid())
	stateRoot := t.TempDir()
	command := []string{"sleep", marker}
	pid := spawnOrphanForTest(t, command, []string{
		"GC_SERVICE_NAME=orphan-reap-test",
		"GC_SERVICE_STATE_ROOT=" + stateRoot,
	})

	reapOrphanedServiceProcesses(newOrphanIdentity("orphan-reap-test", stateRoot, command))

	if !waitProcessGoneForTest(t, pid, 3*time.Second) {
		t.Fatalf("orphan %d still alive after reap", pid)
	}
}

func TestReapOrphanedServiceProcessesSkipsNonMatches(t *testing.T) {
	// Linux /proc sweep semantics (service-name scoping, the /proc scan);
	// the darwin sweep is covered by orphan_reap_table_test.go and
	// orphan_reap_darwin_test.go.
	requireProcFS(t)
	marker := fmt.Sprintf("86341.0%d", os.Getpid())
	stateRoot := t.TempDir()
	command := []string{"sleep", marker}

	// Same argv and state root, but the environ marker names a different
	// service: another service's orphan must not be reaped by this
	// service's sweep.
	otherService := spawnOrphanForTest(t, command, []string{
		"GC_SERVICE_NAME=some-other-service",
		"GC_SERVICE_STATE_ROOT=" + stateRoot,
	})
	// Same argv, no gc markers at all: not provably a gc service spawn, so
	// it must survive.
	unmarked := spawnOrphanForTest(t, command, nil)
	// Same argv and service name but a different state root: a sibling
	// city's orphan of the same service (same name, same command, same
	// uid) may still be serving that city and must never be reaped by
	// this city's sweep.
	siblingCity := spawnOrphanForTest(t, command, []string{
		"GC_SERVICE_NAME=orphan-reap-test",
		"GC_SERVICE_STATE_ROOT=" + stateRoot + "-other-city",
	})
	// Matching argv and markers but still parented to this test process:
	// a live supervised child, not an orphan.
	supervised := exec.Command(command[0], command[1:]...)
	supervised.Env = append(os.Environ(),
		"GC_SERVICE_NAME=orphan-reap-test",
		"GC_SERVICE_STATE_ROOT="+stateRoot,
	)
	if err := supervised.Start(); err != nil {
		t.Fatalf("start supervised child: %v", err)
	}
	t.Cleanup(func() {
		_ = supervised.Process.Kill()
		_ = supervised.Wait()
	})
	// Orphan with the right markers but a different argv.
	differentArgv := spawnOrphanForTest(t, []string{"sleep", marker, "0"}, []string{
		"GC_SERVICE_NAME=orphan-reap-test",
		"GC_SERVICE_STATE_ROOT=" + stateRoot,
	})

	reapOrphanedServiceProcesses(newOrphanIdentity("orphan-reap-test", stateRoot, command))

	// Give any wrongly-issued SIGTERM time to land before asserting.
	time.Sleep(200 * time.Millisecond)
	for name, pid := range map[string]int{
		"other-service orphan":  otherService,
		"unmarked process":      unmarked,
		"sibling-city orphan":   siblingCity,
		"supervised child":      supervised.Process.Pid,
		"different-argv orphan": differentArgv,
	} {
		if !processAliveForTest(pid) {
			t.Errorf("%s (pid %d) was killed; reap matched too broadly", name, pid)
		}
	}
}

// TestReapOrphanedServiceProcessesMatchesWhitespaceOnlyCommandArgs pins the
// configured-command normalization: a service command containing an
// interior whitespace-only argument must still match — and reap — its own
// orphans, because pidutil.Cmdline drops such arguments from the process
// side and newOrphanIdentity applies the same rule to the configured side.
func TestReapOrphanedServiceProcessesMatchesWhitespaceOnlyCommandArgs(t *testing.T) {
	// Linux /proc sweep semantics (service-name scoping, the /proc scan);
	// the darwin sweep is covered by orphan_reap_table_test.go and
	// orphan_reap_darwin_test.go.
	requireProcFS(t)
	marker := fmt.Sprintf("86344.0%d", os.Getpid())
	stateRoot := t.TempDir()
	// The two-command script keeps the shell wrapper alive (no single-exec
	// optimization) so its argv — including the whitespace-only positional
	// argument — stays visible in /proc; marker makes the argv unique.
	command := []string{"sh", "-c", "sleep 60; : " + marker, "gc-ws-arg", " "}
	pid := spawnOrphanForTest(t, command, []string{
		"GC_SERVICE_NAME=orphan-reap-test",
		"GC_SERVICE_STATE_ROOT=" + stateRoot,
	})

	reapOrphanedServiceProcesses(newOrphanIdentity("orphan-reap-test", stateRoot, command))

	if !waitProcessGoneForTest(t, pid, 3*time.Second) {
		t.Fatalf("orphan %d with whitespace-only command argument survived reap", pid)
	}
}

// TestFindOrphanedServiceProcessesSkipsWhenSweeperIsInit covers the pid-1
// guard: when the sweeping process is itself init (gc as a container
// entrypoint), ppid 1 marks live supervised children rather than orphans, so
// the sweep must find nothing instead of matching healthy processes.
func TestFindOrphanedServiceProcessesSkipsWhenSweeperIsInit(t *testing.T) {
	// Linux /proc sweep semantics (service-name scoping, the /proc scan);
	// the darwin sweep is covered by orphan_reap_table_test.go and
	// orphan_reap_darwin_test.go.
	requireProcFS(t)
	marker := fmt.Sprintf("86342.0%d", os.Getpid())
	stateRoot := t.TempDir()
	command := []string{"sleep", marker}
	id := newOrphanIdentity("orphan-reap-test", stateRoot, command)
	pid := spawnOrphanForTest(t, command, []string{
		"GC_SERVICE_NAME=orphan-reap-test",
		"GC_SERVICE_STATE_ROOT=" + stateRoot,
	})

	// Sanity: a normal (non-init) sweeper sees the seeded orphan.
	found := false
	for _, got := range findOrphanedServiceProcessesFrom(os.Getpid(), id) {
		if got == pid {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("normal sweep did not find seeded orphan %d", pid)
	}

	if got := findOrphanedServiceProcessesFrom(1, id); len(got) != 0 {
		t.Fatalf("pid-1 sweep returned %v, want none", got)
	}
	if !processAliveForTest(pid) {
		t.Fatalf("orphan %d died during find-only sweeps", pid)
	}
}

// TestLiveMatchingOrphansDropsIdentityMismatch covers the escalation-wait
// identity re-check: a pid that no longer satisfies the full orphan
// identity — recycled to a different command, claimed by a different
// service, or owned by a different city's state root — must be dropped from
// the kill list rather than retained for SIGKILL, while a pid that still
// matches is kept. spawnOrphanForTest returns only once the orphan's
// command line is visible in /proc, so the keep case cannot race the exec
// transition.
func TestLiveMatchingOrphansDropsIdentityMismatch(t *testing.T) {
	// Linux /proc sweep semantics (service-name scoping, the /proc scan);
	// the darwin sweep is covered by orphan_reap_table_test.go and
	// orphan_reap_darwin_test.go.
	requireProcFS(t)
	marker := fmt.Sprintf("86343.0%d", os.Getpid())
	stateRoot := t.TempDir()
	command := []string{"sleep", marker}
	pid := spawnOrphanForTest(t, command, []string{
		"GC_SERVICE_NAME=orphan-reap-test",
		"GC_SERVICE_STATE_ROOT=" + stateRoot,
	})

	for name, id := range map[string]orphanIdentity{
		"command mismatch":    newOrphanIdentity("orphan-reap-test", stateRoot, []string{"sleep", "not-" + marker}),
		"service mismatch":    newOrphanIdentity("some-other-service", stateRoot, command),
		"state-root mismatch": newOrphanIdentity("orphan-reap-test", stateRoot+"-other-city", command),
	} {
		if got := liveMatchingOrphans([]int{pid}, id); len(got) != 0 {
			t.Errorf("%s: liveMatchingOrphans kept pid %d: %v", name, pid, got)
		}
	}

	if got := liveMatchingOrphans([]int{pid}, newOrphanIdentity("orphan-reap-test", stateRoot, command)); len(got) != 1 {
		t.Fatalf("liveMatchingOrphans dropped live matching pid %d: %v", pid, got)
	}
}

// TestUnsafeSignalTarget covers the refusal guard shared with
// internal/processgroup: init, nonpositive pids (kill(2) broadcast and
// current-group semantics), and the sweeper's own process group must never
// be signaled.
func TestUnsafeSignalTarget(t *testing.T) {
	for _, pid := range []int{-1, 0, 1, syscall.Getpgrp()} {
		if !unsafeSignalTarget(pid) {
			t.Errorf("unsafeSignalTarget(%d) = false, want true", pid)
		}
	}
	// An ordinary pid — positive, not init, not the sweeper's own group — must
	// be allowed. Derive it from the current group but force it past the pid<=1
	// init guard: inside a fresh PID namespace (e.g. the CI bwrap sandbox)
	// Getpgrp() can be 0, so a bare Getpgrp()+1 would be 1 and collide with that
	// guard. The bumped value stays != Getpgrp() (0 vs 2), so it is genuinely
	// ordinary.
	ordinary := syscall.Getpgrp() + 1
	if ordinary <= 1 {
		ordinary = 2
	}
	if unsafeSignalTarget(ordinary) {
		t.Errorf("unsafeSignalTarget(%d) = true for an ordinary pid, want false", ordinary)
	}
}

// TestProxyProcessStartReapsOrphanedDuplicates verifies the spawn-path
// wiring: before a proxy_process child is spawned, survivors of a previous
// supervisor hard exit running the same service command are terminated so
// duplicates never accumulate (ga-mukg0s; ~39 observed in production).
func TestProxyProcessStartReapsOrphanedDuplicates(t *testing.T) {
	t.Setenv("GC_SERVICE_HELPER", "1")
	setHelperPassthrough(t)
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("Executable: %v", err)
	}
	command := []string{exe, "-test.run=^TestProxyProcessHelper$", "--"}

	cityPath := t.TempDir()
	svc := config.Service{
		Name: "bridge",
		Kind: "proxy_process",
		Process: config.ServiceProcessConfig{
			Command:    command,
			HealthPath: "/healthz",
		},
	}
	// The orphan's state root must be the same instance-derived path the
	// manager will compute, or the ownership-scoped sweep would (correctly)
	// skip it as another city's process.
	absStateRoot := svc.StateRootOrDefault()
	if !filepath.IsAbs(absStateRoot) {
		absStateRoot = filepath.Join(cityPath, absStateRoot)
	}

	// The orphan is a literal leftover service instance: same binary, same
	// argv, service-name and state-root markers in its environment, serving
	// on a stale socket, re-parented to init.
	orphanDir, err := os.MkdirTemp("", "gcorph")
	if err != nil {
		t.Fatalf("MkdirTemp: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(orphanDir) })
	orphanSocket := orphanDir + "/o.sock"
	orphanPID := spawnOrphanForTest(t, command, []string{
		"GC_SERVICE_HELPER=1",
		"GC_SERVICE_NAME=bridge",
		"GC_SERVICE_STATE_ROOT=" + absStateRoot,
		"GC_SERVICE_SOCKET=" + orphanSocket,
	})
	// Wait until the orphan is serving so it provably lingers on its own.
	dialDeadline := time.Now().Add(5 * time.Second)
	for {
		if conn, err := net.DialTimeout("unix", orphanSocket, 100*time.Millisecond); err == nil {
			_ = conn.Close()
			break
		}
		if time.Now().After(dialDeadline) {
			t.Fatalf("orphan helper (pid %d) never started serving", orphanPID)
		}
		time.Sleep(20 * time.Millisecond)
	}

	rt := &testRuntime{
		cityPath: cityPath,
		cityName: "test-city",
		cfg: &config.City{
			Services: []config.Service{svc},
		},
		sp:    runtime.NewFake(),
		store: beads.NewMemStore(),
	}
	mgr := NewManager(rt)
	if err := mgr.Reload(); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	defer mgr.Close() //nolint:errcheck // best-effort cleanup

	if !waitProcessGoneForTest(t, orphanPID, 5*time.Second) {
		t.Fatalf("orphaned duplicate (pid %d) still alive after service start", orphanPID)
	}
	status, ok := mgr.Get("bridge")
	if !ok {
		t.Fatal("service status missing")
	}
	if status.LocalState != "ready" {
		t.Fatalf("LocalState = %q, want ready (reason=%q)", status.LocalState, status.Reason)
	}
}

func TestParentIsSubreaper(t *testing.T) {
	tests := []struct {
		name         string
		subreaperPID int
		ppid         int
		want         bool
	}{
		{name: "init always counts", subreaperPID: 0, ppid: 1, want: true},
		{name: "init counts even with subreaper set", subreaperPID: 900, ppid: 1, want: true},
		{name: "systemd --user subreaper counts", subreaperPID: 900, ppid: 900, want: true},
		{name: "live supervisor pid does not count", subreaperPID: 900, ppid: 1234, want: false},
		{name: "no subreaper detected -> only init", subreaperPID: 0, ppid: 900, want: false},
		{name: "subreaper pid 1 is ignored as a subreaper key", subreaperPID: 1, ppid: 1234, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id := orphanIdentity{subreaperPID: tt.subreaperPID}
			if got := id.parentIsSubreaper(tt.ppid); got != tt.want {
				t.Fatalf("parentIsSubreaper(%d) with subreaperPID=%d = %v, want %v", tt.ppid, tt.subreaperPID, got, tt.want)
			}
		})
	}
}

func TestDetectUserSubreaperPID(t *testing.T) {
	// Ancestry: self(500) -> shell(400) -> systemd --user(900) -> systemd(1).
	t.Run("finds systemd --user manager", func(t *testing.T) {
		parents := map[int]int{500: 400, 400: 900, 900: 1}
		comms := map[int]string{400: "bash", 900: "systemd", 1: "systemd"}
		parentOf := func(pid int) (int, error) { return parents[pid], nil }
		commOf := func(pid int) string { return comms[pid] }
		if got := detectUserSubreaperPIDWith(500, parentOf, commOf); got != 900 {
			t.Fatalf("detectUserSubreaperPID = %d, want 900", got)
		}
	})

	t.Run("plain init host returns 0", func(t *testing.T) {
		// self(500) -> supervisor(400) -> init(1); only systemd is pid 1.
		parents := map[int]int{500: 400, 400: 1}
		comms := map[int]string{400: "gc", 1: "systemd"}
		parentOf := func(pid int) (int, error) { return parents[pid], nil }
		commOf := func(pid int) string { return comms[pid] }
		if got := detectUserSubreaperPIDWith(500, parentOf, commOf); got != 0 {
			t.Fatalf("detectUserSubreaperPID = %d, want 0 (no user subreaper)", got)
		}
	})

	t.Run("unreadable parent returns 0", func(t *testing.T) {
		parentOf := func(int) (int, error) { return 0, fmt.Errorf("no /proc") }
		commOf := func(int) string { return "" }
		if got := detectUserSubreaperPIDWith(500, parentOf, commOf); got != 0 {
			t.Fatalf("detectUserSubreaperPID = %d, want 0", got)
		}
	})

	t.Run("cyclic ancestry terminates", func(t *testing.T) {
		// Malformed /proc reporting a cycle must not loop forever.
		parentOf := func(int) (int, error) { return 700, nil }
		commOf := func(int) string { return "notsystemd" }
		if got := detectUserSubreaperPIDWith(700, parentOf, commOf); got != 0 {
			t.Fatalf("detectUserSubreaperPID = %d, want 0", got)
		}
	})
}
