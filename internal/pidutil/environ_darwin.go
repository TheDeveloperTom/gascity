//go:build darwin

package pidutil

import (
	"fmt"

	"golang.org/x/sys/unix"
)

// Environ returns pid's environment as it stood when the process started, one
// KEY=VALUE entry per string, read from the kern.procargs2 sysctl that ps(1)
// reads: each entry stays whole, so a value containing whitespace is intact.
// The kernel answers EINVAL for a pid that does not exist and for one another
// user owns, and withholds the environment of a restricted process (an Apple
// platform binary) from every other process, which reads as none.
func Environ(pid int) ([]string, error) {
	data, err := unix.SysctlRaw("kern.procargs2", pid)
	if err != nil {
		return nil, fmt.Errorf("pidutil: reading the environment of PID %d via kern.procargs2: %w", pid, err)
	}
	env, err := parseProcArgs2Environ(data)
	if err != nil {
		return nil, fmt.Errorf("pidutil: parsing the environment of PID %d: %w", pid, err)
	}
	return env, nil
}

// ArgvEnvValues returns pid's argv, normalized as Cmdline normalizes it, and
// the values of the named environment variables that are set, as they stood
// when the process started — all from one kern.procargs2 read, so argv and
// environment describe the same process. Unlike Environ it never materializes
// any other entry, so callers that must not handle a process's secrets can
// still read identifying markers. With no keys it reads argv only. It fails as
// Environ does for a pid that does not exist or that another user owns; for a
// restricted process (an Apple platform binary) the kernel withholds the
// environment, so no key is set.
func ArgvEnvValues(pid int, keys ...string) ([]string, map[string]string, error) {
	data, err := unix.SysctlRaw("kern.procargs2", pid)
	if err != nil {
		return nil, nil, fmt.Errorf("pidutil: reading the arguments of PID %d via kern.procargs2: %w", pid, err)
	}
	argv, values, err := parseProcArgs2ArgvEnvValues(data, keys)
	if err != nil {
		return nil, nil, fmt.Errorf("pidutil: parsing the arguments of PID %d: %w", pid, err)
	}
	return NormalizeArgv(argv), values, nil
}
