package pidutil

import (
	"encoding/binary"
	"reflect"
	"slices"
	"testing"
)

func TestParseProcArgs2PreservesArgumentBoundaries(t *testing.T) {
	data := make([]byte, 4)
	binary.LittleEndian.PutUint32(data, 4)
	data = append(data, []byte("/usr/local/bin/gc\x00\x00\x00")...)
	data = append(data, []byte("gc\x00nudge\x00--city\x00/tmp/city with spaces\x00TOKEN=secret\x00")...)

	got, err := parseProcArgs2(data)
	if err != nil {
		t.Fatalf("parseProcArgs2: %v", err)
	}
	want := []string{"gc", "nudge", "--city", "/tmp/city with spaces"}
	if len(got) != len(want) {
		t.Fatalf("parseProcArgs2 = %q, want %q", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("parseProcArgs2 = %q, want %q", got, want)
		}
	}
}

func TestParseProcArgs2RejectsTruncatedArgv(t *testing.T) {
	data := make([]byte, 4)
	binary.LittleEndian.PutUint32(data, 2)
	data = append(data, []byte("/usr/bin/gc\x00gc\x00")...)

	if _, err := parseProcArgs2(data); err == nil {
		t.Fatal("parseProcArgs2 accepted fewer arguments than argc")
	}
}

// procArgs2Buffer lays out a kern.procargs2 buffer as the kernel copies it
// out: argc, the executable path and its alignment padding, each argument,
// then tail (the environment and whatever follows it) verbatim.
func procArgs2Buffer(argv []string, tail string) []byte {
	data := make([]byte, 4)
	binary.LittleEndian.PutUint32(data, uint32(len(argv)))
	data = append(data, []byte("/usr/local/bin/gc\x00\x00\x00")...)
	for _, arg := range argv {
		data = append(data, arg...)
		data = append(data, 0)
	}
	return append(data, tail...)
}

// The environment is read as the kernel delimits it, never split on
// whitespace: a TMUX_TMPDIR under a directory holding spaces comes back whole,
// and an argument shaped like an entry stays an argument.
func TestParseProcArgs2EnvironKeepsEachEntryWhole(t *testing.T) {
	argv := []string{"gc", "supervisor", "run", "TMUX_TMPDIR=/from/argv"}
	for _, tc := range []struct {
		name string
		tail string
		want []string
	}{
		{name: "a value holding spaces", tail: "TMUX_TMPDIR=/tmp/gc sockets\x00HOME=/Users/dev\x00\x00\x00", want: []string{"TMUX_TMPDIR=/tmp/gc sockets", "HOME=/Users/dev"}},
		{name: "the kernel's own strings after an alignment gap", tail: "TMUX_TMPDIR=/tmp/gc sockets\x00\x00ptr_munge=\x00main_stack=\x00", want: []string{"TMUX_TMPDIR=/tmp/gc sockets"}},
		{name: "the buffer ends after an entry", tail: "A=1\x00B=two words\x00", want: []string{"A=1", "B=two words"}},
		{name: "an environment the kernel withheld", tail: ""},
		{name: "an empty environment", tail: "\x00\x00\x00\x00ptr_munge=\x00"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data := procArgs2Buffer(argv, tc.tail)
			env, err := parseProcArgs2Environ(data)
			if err != nil || !slices.Equal(env, tc.want) {
				t.Fatalf("parseProcArgs2Environ = %q, %v; want %q", env, err, tc.want)
			}
			if got, err := parseProcArgs2(data); err != nil || !slices.Equal(got, argv) {
				t.Fatalf("parseProcArgs2 = %q, %v; want %q", got, err, argv)
			}
		})
	}
}

// A buffer that ends inside an entry has lost the rest of that value, so the
// environment read fails rather than return a truncated value.
func TestParseProcArgs2EnvironRejectsATruncatedEntry(t *testing.T) {
	data := procArgs2Buffer([]string{"gc"}, "A=1\x00TMUX_TMPDIR=/tmp/gc soc")
	if env, err := parseProcArgs2Environ(data); err == nil {
		t.Fatalf("parseProcArgs2Environ = %q, nil; want an error for the truncated entry", env)
	}
}

// parseProcArgs2ArgvEnvValues returns argv and exactly the named variables'
// values, nothing else: a key that is a prefix of another key, an argument
// shaped like an entry, and the kernel's strings after the environment never
// answer for one; the first occurrence wins.
func TestParseProcArgs2ArgvEnvValuesReturnsOnlyTheNamedKeys(t *testing.T) {
	const key, name = "GC_SERVICE_STATE_ROOT", "GC_SERVICE_NAME"
	argv := []string{"python3", "serve.py", key + "=/from/argv"}
	for _, tc := range []struct {
		name string
		tail string
		want map[string]string
	}{
		{name: "present among secrets", tail: "SLACK_TOKEN=xoxb-secret\x00" + key + "=/city/.gc/services/slack\x00" + name + "=slack\x00HOME=/Users/dev\x00", want: map[string]string{key: "/city/.gc/services/slack", name: "slack"}},
		{name: "a value holding spaces", tail: key + "=/tmp/city with spaces/.gc/services/x\x00", want: map[string]string{key: "/tmp/city with spaces/.gc/services/x"}},
		{name: "a longer key sharing the prefix", tail: key + "_OLD=/stale\x00A=1\x00", want: map[string]string{}},
		{name: "absent", tail: "A=1\x00B=2\x00", want: map[string]string{}},
		{name: "only after the alignment gap", tail: "A=1\x00\x00" + key + "=/kernel\x00", want: map[string]string{}},
		{name: "an environment the kernel withheld", tail: "", want: map[string]string{}},
		{name: "an empty value", tail: key + "=\x00", want: map[string]string{key: ""}},
		{name: "the first occurrence wins", tail: name + "=first\x00" + name + "=second\x00", want: map[string]string{name: "first"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gotArgv, got, err := parseProcArgs2ArgvEnvValues(procArgs2Buffer(argv, tc.tail), []string{key, name})
			if err != nil || !reflect.DeepEqual(gotArgv, argv) || !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("parseProcArgs2ArgvEnvValues = %q, %q, %v; want %q, %q, nil", gotArgv, got, err, argv, tc.want)
			}
		})
	}
}

// With no keys only argv is read, even from a buffer whose environment is
// truncated.
func TestParseProcArgs2ArgvEnvValuesWithoutKeysReadsArgvOnly(t *testing.T) {
	argv := []string{"bd", "db-proxy-child"}
	gotArgv, got, err := parseProcArgs2ArgvEnvValues(procArgs2Buffer(argv, "SECRET=x"), nil)
	if err != nil || !reflect.DeepEqual(gotArgv, argv) || len(got) != 0 {
		t.Fatalf("parseProcArgs2ArgvEnvValues(no keys) = %q, %q, %v; want %q, none, nil", gotArgv, got, err, argv)
	}
}

func TestParseProcArgs2ArgvEnvValuesRejectsATruncatedBuffer(t *testing.T) {
	data := procArgs2Buffer([]string{"gc"}, "A=1\x00GC_SERVICE_STATE_ROOT=/tmp/ci")
	if argv, got, err := parseProcArgs2ArgvEnvValues(data, []string{"GC_SERVICE_STATE_ROOT"}); err == nil {
		t.Fatalf("parseProcArgs2ArgvEnvValues = %q, %q, nil; want an error for the truncated entry", argv, got)
	}
}
