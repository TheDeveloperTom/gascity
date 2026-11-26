//go:build darwin

package workspacesvc

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// darwinOrphanHelperEnv marks the child TestDarwinOrphanHelperProcess runs
// as. The helper makes itself a process-group leader (as the spawn path's
// Setpgid does), starts a grandchild in that group, records the grandchild's
// pid, and blocks until signaled.
const darwinOrphanHelperEnv = "GC_DARWIN_ORPHAN_HELPER"

func TestDarwinOrphanHelperProcess(_ *testing.T) {
	if os.Getenv(darwinOrphanHelperEnv) != "1" {
		return
	}
	if dir := os.Getenv("GC_DARWIN_ORPHAN_CWD"); dir != "" {
		_ = os.Chdir(dir)
	}
	if os.Getenv("GC_DARWIN_ORPHAN_SETSID") == "1" {
		// A daemon a service started: its own session, like bd's proxy.
		// setsid fails (EPERM) for a group leader; the spawner leaves this
		// helper in its group for that reason. Exit non-zero so a wrong
		// shape fails the test instead of silently becoming the Setpgid one.
		if _, err := syscall.Setsid(); err != nil {
			os.Exit(4)
		}
	} else if err := syscall.Setpgid(0, 0); err != nil {
		// A service root: its own group in its parent's session (Setpgid).
		os.Exit(5)
	}
	child := exec.Command("/bin/sleep", "600")
	if err := child.Start(); err == nil {
		_ = os.WriteFile(os.Getenv("GC_DARWIN_ORPHAN_CHILD_FILE"), []byte(strconv.Itoa(child.Process.Pid)), 0o600)
	}
	// Block until signaled. Not `select {}`: without cgo the runtime has no
	// other thread, reports "all goroutines are asleep" and the helper dies
	// by itself — which would let an "orphan gone" assertion pass unreaped.
	for {
		time.Sleep(time.Hour)
	}
}

// darwinHelperCommand is the argv of an orphan helper; marker makes it unique
// to one test so concurrent test binaries never match each other's orphans.
func darwinHelperCommand(t *testing.T, marker string) []string {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("Executable: %v", err)
	}
	return []string{exe, "-test.run=^TestDarwinOrphanHelperProcess$", "--", marker}
}

// spawnDarwinOrphanGroup spawns the helper as an orphan of launchd carrying
// stateRoot, and returns the helper's pid and its grandchild's pid.
func spawnDarwinOrphanGroup(t *testing.T, command []string, stateRoot string, extraEnv ...string) (int, int) {
	t.Helper()
	childFile := filepath.Join(t.TempDir(), "child.pid")
	pid := spawnOrphanForTest(t, command, append([]string{
		darwinOrphanHelperEnv + "=1",
		"GC_DARWIN_ORPHAN_CHILD_FILE=" + childFile,
		"GC_SERVICE_NAME=darwin-reap-test",
		"GC_SERVICE_STATE_ROOT=" + stateRoot,
		"GC_TEST_FAKE_SECRET=do-not-read",
	}, extraEnv...))
	deadline := time.Now().Add(5 * time.Second)
	for {
		if data, err := os.ReadFile(childFile); err == nil && len(data) > 0 {
			child, err := strconv.Atoi(strings.TrimSpace(string(data)))
			if err != nil {
				t.Fatalf("parse grandchild pid %q: %v", data, err)
			}
			if ident, ok := processIdentityForTest(child); ok {
				t.Cleanup(func() { killOwnProcessForTest(child, ident, false) })
			}
			return pid, child
		}
		if time.Now().After(deadline) {
			t.Fatalf("orphan helper %d never started its grandchild", pid)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// killGroupAtCleanupForTest SIGKILLs, at cleanup, the process group led by a
// process the test spawned, only while leader still names that process.
func killGroupAtCleanupForTest(t *testing.T, leader int) {
	t.Helper()
	if ident, ok := processIdentityForTest(leader); ok {
		t.Cleanup(func() { killOwnProcessForTest(leader, ident, true) })
	}
}

// processRunningForTest reports whether pid exists and is not a zombie, read
// from the kernel's process table.
func processRunningForTest(t *testing.T, pid int) bool {
	t.Helper()
	tb, _ := platformOrphanTable()
	e, ok, err := tb.lookup(pid)
	if err != nil {
		t.Fatalf("lookup(%d): %v", pid, err)
	}
	return ok && !e.zombie
}

// A kern.proc.pid lookup of a pid that no longer exists fails with EIO in
// x/sys; the table reads that (and ESRCH) as "gone", anything else as a
// failed read. A reaped child's pid and this process's own pid exercise the
// real sysctl.
func TestDarwinLookupMapsAMissingPIDToGone(t *testing.T) {
	for _, tc := range []struct {
		err  error
		gone bool
	}{
		{err: unix.EIO, gone: true},
		{err: fmt.Errorf("wrapped: %w", unix.ESRCH), gone: true},
		{err: unix.EPERM},
		{err: unix.ENOMEM},
	} {
		if got := darwinLookupGone(tc.err); got != tc.gone {
			t.Errorf("darwinLookupGone(%v) = %v, want %v", tc.err, got, tc.gone)
		}
	}

	tb, _ := platformOrphanTable()
	if e, ok, err := tb.lookup(os.Getpid()); err != nil || !ok || e.pid != os.Getpid() || e.startTime == 0 {
		t.Fatalf("lookup(self) = %+v, %v, %v; want this process", e, ok, err)
	}
	done := exec.Command("/usr/bin/true")
	if err := done.Run(); err != nil {
		t.Fatalf("run /usr/bin/true: %v", err)
	}
	if e, ok, err := tb.lookup(done.Process.Pid); err != nil || ok {
		t.Fatalf("lookup(reaped child %d) = %+v, %v, %v; want gone, no error", done.Process.Pid, e, ok, err)
	}
}

// A real orphan re-parented to launchd, carrying this instance's state root
// and running the service command, is terminated together with its whole
// process group.
func TestDarwinReapTerminatesOrphanAndItsProcessGroup(t *testing.T) {
	stateRoot := t.TempDir()
	command := darwinHelperCommand(t, fmt.Sprintf("darwin-reap-%d", os.Getpid()))
	orphan, grandchild := spawnDarwinOrphanGroup(t, command, stateRoot)

	reapOrphanedServiceProcesses(newOrphanIdentity("darwin-reap-test", stateRoot, command))

	if !waitProcessGoneForTest(t, orphan, 5*time.Second) {
		t.Fatalf("orphan %d still alive after reap", orphan)
	}
	if !waitProcessGoneForTest(t, grandchild, 5*time.Second) {
		t.Fatalf("grandchild %d in the orphan's process group still alive after reap", grandchild)
	}
}

// The sweep leaves alone a sibling city's orphan of the same service (same
// argv, other state root) and this city's live child (same argv and state
// root, but its parent — this test — is alive), while still reaping the
// real orphan in the same pass.
func TestDarwinReapLeavesOtherCityAndLiveChildren(t *testing.T) {
	stateRoot := t.TempDir()
	command := darwinHelperCommand(t, fmt.Sprintf("darwin-scope-%d", os.Getpid()))
	orphan, _ := spawnDarwinOrphanGroup(t, command, stateRoot)
	otherCity, _ := spawnDarwinOrphanGroup(t, command, stateRoot+"-other-city")

	live := exec.Command(command[0], command[1:]...)
	live.Env = append(os.Environ(),
		darwinOrphanHelperEnv+"=1",
		"GC_DARWIN_ORPHAN_CHILD_FILE="+filepath.Join(t.TempDir(), "live.pid"),
		// The full identity, so only the ppid rule (parent alive) spares it.
		"GC_SERVICE_NAME=darwin-reap-test",
		"GC_SERVICE_STATE_ROOT="+stateRoot,
	)
	live.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := live.Start(); err != nil {
		t.Fatalf("start live child: %v", err)
	}
	t.Cleanup(func() {
		_ = syscall.Kill(-live.Process.Pid, syscall.SIGKILL)
		_ = live.Wait()
	})

	reapOrphanedServiceProcesses(newOrphanIdentity("darwin-reap-test", stateRoot, command))

	if !waitProcessGoneForTest(t, orphan, 5*time.Second) {
		t.Fatalf("this city's orphan %d still alive after reap", orphan)
	}
	time.Sleep(200 * time.Millisecond) // let any wrongly-sent signal land
	if !processAliveForTest(otherCity) {
		t.Errorf("another city's orphan %d was killed", otherCity)
	}
	// Not processAliveForTest: kill(pid, 0) succeeds on a zombie, and this
	// direct child stays one until Wait even if the sweep killed it.
	if !processRunningForTest(t, live.Process.Pid) {
		t.Errorf("live child %d (parent alive) was killed", live.Process.Pid)
	}
}

// Real processes carrying this instance's state root, re-parented to launchd
// and running in the service's command dir, survive when they do not run the
// service command: one shaped like gc's managed dolt sql-server (its own
// group, inside a session it does not lead — what Setpgid gives a service
// root too) and a Setsid daemon (bd's db-proxy-child shape). Their groups
// survive with them.
func TestDarwinReapSparesSameRootOrphansRunningAnotherCommand(t *testing.T) {
	stateRoot := t.TempDir()
	dir := t.TempDir()
	marker := fmt.Sprintf("darwin-other-cmd-%d", os.Getpid())
	configured := darwinHelperCommand(t, marker+"-configured")

	setpgid, setpgidChild := spawnDarwinOrphanGroup(t, darwinHelperCommand(t, marker+"-setpgid"), stateRoot,
		"GC_DARWIN_ORPHAN_CWD="+dir)
	killGroupAtCleanupForTest(t, setpgid)
	daemon, daemonChild := spawnDarwinOrphanGroup(t, darwinHelperCommand(t, marker+"-daemon"), stateRoot,
		"GC_DARWIN_ORPHAN_CWD="+dir, "GC_DARWIN_ORPHAN_SETSID=1", orphanSpawnerNoSetpgidEnv+"=1")
	killGroupAtCleanupForTest(t, daemon)
	if sid, err := unix.Getsid(daemon); err != nil || sid != daemon {
		t.Fatalf("daemon %d: getsid = %d, %v; want it to lead its own session", daemon, sid, err)
	}
	if sid, err := unix.Getsid(setpgid); err != nil || sid == setpgid {
		t.Fatalf("setpgid orphan %d: getsid = %d, %v; want a session it does not lead", setpgid, sid, err)
	}

	reapOrphanedServiceProcesses(newOrphanIdentity("darwin-reap-test", stateRoot, configured))

	time.Sleep(200 * time.Millisecond) // let any wrongly-sent signal land
	for _, pid := range []int{setpgid, setpgidChild, daemon, daemonChild} {
		if !processAliveForTest(pid) {
			t.Errorf("process %d, which does not run the service command, was killed", pid)
		}
	}
}
