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

// EnvironValue returns the value of one environment variable of pid, as it
// stood when the process started, and whether the variable is set. Unlike
// Environ it never materializes any other entry, so callers that must not
// handle a process's secrets can still read one identifying marker. It fails
// as Environ does for a pid that does not exist or that another user owns.
func EnvironValue(pid int, key string) (string, bool, error) {
	data, err := unix.SysctlRaw("kern.procargs2", pid)
	if err != nil {
		return "", false, fmt.Errorf("pidutil: reading the environment of PID %d via kern.procargs2: %w", pid, err)
	}
	value, ok, err := parseProcArgs2EnvValue(data, key)
	if err != nil {
		return "", false, fmt.Errorf("pidutil: parsing the environment of PID %d: %w", pid, err)
	}
	return value, ok, nil
}
