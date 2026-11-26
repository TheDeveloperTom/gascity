//go:build darwin

package pidutil

import (
	"os"
	"os/exec"
	"reflect"
	"testing"
)

// ArgvEnvValues reads argv and the named variables of a live process through
// one kern.procargs2 read, and reports a missing variable as absent rather
// than as an error.
func TestArgvEnvValuesReadsArgvAndNamedVariablesOfALiveProcess(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^TestEnvironHelperProcess$")
	cmd.Env = []string{environHelperEnv + "=1", "SECRET_TOKEN=do-not-read", "GC_SERVICE_NAME=x", "GC_SERVICE_STATE_ROOT=/city with spaces/.gc/services/x"}
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

	argv, got, err := ArgvEnvValues(cmd.Process.Pid, "GC_SERVICE_STATE_ROOT", "GC_SERVICE_NAME", "GC_NOT_SET")
	want := map[string]string{"GC_SERVICE_STATE_ROOT": "/city with spaces/.gc/services/x", "GC_SERVICE_NAME": "x"}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("ArgvEnvValues(helper) values = %q, %v; want %q", got, err, want)
	}
	if !reflect.DeepEqual(argv, cmd.Args) {
		t.Fatalf("ArgvEnvValues(helper) argv = %q, want %q", argv, cmd.Args)
	}
}
