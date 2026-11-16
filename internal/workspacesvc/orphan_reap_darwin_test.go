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
	_ = syscall.Setpgid(0, 0)
	child := exec.Command("/bin/sleep", "600")
	if err := child.Start(); err == nil {
		_ = os.WriteFile(os.Getenv("GC_DARWIN_ORPHAN_CHILD_FILE"), []byte(strconv.Itoa(child.Process.Pid)), 0o600)
	}
	select {}
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
func spawnDarwinOrphanGroup(t *testing.T, command []string, stateRoot string) (int, int) {
	t.Helper()
	childFile := filepath.Join(t.TempDir(), "child.pid")
	pid := spawnOrphanForTest(t, command, []string{
		darwinOrphanHelperEnv + "=1",
		"GC_DARWIN_ORPHAN_CHILD_FILE=" + childFile,
		"GC_SERVICE_NAME=darwin-reap-test",
		"GC_SERVICE_STATE_ROOT=" + stateRoot,
		"GC_TEST_FAKE_SECRET=do-not-read",
	})
	deadline := time.Now().Add(5 * time.Second)
	for {
		if data, err := os.ReadFile(childFile); err == nil && len(data) > 0 {
			child, err := strconv.Atoi(strings.TrimSpace(string(data)))
			if err != nil {
				t.Fatalf("parse grandchild pid %q: %v", data, err)
			}
			t.Cleanup(func() { _ = syscall.Kill(child, syscall.SIGKILL) })
			return pid, child
		}
		if time.Now().After(deadline) {
			t.Fatalf("orphan helper %d never started its grandchild", pid)
		}
		time.Sleep(20 * time.Millisecond)
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
	if !processAliveForTest(live.Process.Pid) {
		t.Errorf("live child %d (parent alive) was killed", live.Process.Pid)
	}
}

// darwinProcessCwd reads a live process's cwd in the resolved form the
// cwd rule compares against.
func TestDarwinProcessCwdReadsOwnCwd(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	got, err := darwinProcessCwd(os.Getpid())
	if err != nil {
		t.Fatalf("darwinProcessCwd: %v", err)
	}
	if want := resolveOrphanCommandDir(wd); got != want {
		t.Fatalf("darwinProcessCwd = %q, want %q", got, want)
	}
	if _, err := darwinProcessCwd(999999); err == nil {
		t.Fatal("darwinProcessCwd of a missing pid succeeded")
	}
}
