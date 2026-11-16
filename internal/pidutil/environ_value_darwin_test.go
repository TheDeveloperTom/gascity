//go:build darwin

package pidutil

import (
	"os"
	"os/exec"
	"testing"
)

// EnvironValue reads one variable of a live process through kern.procargs2
// and reports a missing one as absent rather than as an error.
func TestEnvironValueReadsOneVariableOfALiveProcess(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^TestEnvironHelperProcess$")
	cmd.Env = []string{environHelperEnv + "=1", "SECRET_TOKEN=do-not-read", "GC_SERVICE_STATE_ROOT=/city with spaces/.gc/services/x"}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatalf("StdinPipe: %v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("starting the helper: %v", err)
	}
	t.Cleanup(func() {
		_ = stdin.Close()
		_ = cmd.Wait()
	})

	got, ok, err := EnvironValue(cmd.Process.Pid, "GC_SERVICE_STATE_ROOT")
	if err != nil || !ok || got != "/city with spaces/.gc/services/x" {
		t.Fatalf("EnvironValue(helper) = %q, %v, %v; want the state root", got, ok, err)
	}
	if got, ok, err := EnvironValue(cmd.Process.Pid, "GC_NOT_SET"); err != nil || ok || got != "" {
		t.Fatalf("EnvironValue(helper, unset) = %q, %v, %v; want absent", got, ok, err)
	}
}
