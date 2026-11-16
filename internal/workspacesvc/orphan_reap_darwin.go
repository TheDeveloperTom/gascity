//go:build darwin

package workspacesvc

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"time"

	"github.com/gastownhall/gascity/internal/pidutil"
	"golang.org/x/sys/unix"
)

// darwinZombieState is SZOMB from <sys/proc.h>: the process has exited and
// awaits reaping by its parent.
const darwinZombieState = 5

// platformOrphanTable returns the darwin process table for the table-driven
// orphan sweep: rows from the kern.proc sysctls (kinfo_proc), argv and the
// single state-root variable from kern.procargs2. Rows are limited to
// processes whose real uid is the sweeper's; kern.procargs2 refuses another
// user's process anyway, which the sweep reads as a mismatch.
func platformOrphanTable() (orphanProcTable, bool) {
	uid := uint32(os.Getuid())
	return orphanProcTable{
		list: func() ([]orphanProcEntry, error) {
			procs, err := unix.SysctlKinfoProcSlice("kern.proc.all")
			if err != nil {
				return nil, err
			}
			entries := make([]orphanProcEntry, 0, len(procs))
			for i := range procs {
				if procs[i].Eproc.Pcred.P_ruid != uid {
					continue
				}
				entries = append(entries, darwinOrphanEntry(&procs[i]))
			}
			return entries, nil
		},
		lookup: func(pid int) (orphanProcEntry, bool, error) {
			kp, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
			if err != nil {
				// The kernel copies out nothing for a pid that no longer
				// exists, which x/sys reports as EIO.
				if errors.Is(err, unix.EIO) || errors.Is(err, unix.ESRCH) {
					return orphanProcEntry{}, false, nil
				}
				return orphanProcEntry{}, false, err
			}
			if int(kp.Proc.P_pid) != pid || kp.Eproc.Pcred.P_ruid != uid {
				return orphanProcEntry{}, false, nil
			}
			return darwinOrphanEntry(kp), true, nil
		},
		cmdline:  pidutil.Cmdline,
		envValue: pidutil.EnvironValue,
		cwd:      darwinProcessCwd,
		sid:      unix.Getsid,
	}, true
}

// darwinCwdTimeout bounds one lsof call. The sweep only asks for the cwd of
// processes that already carry this instance's state root, so it runs at
// most a handful of times per spawn.
const darwinCwdTimeout = 5 * time.Second

// darwinProcessCwd reads pid's current working directory with
// `lsof -a -p <pid> -d cwd -Fn`, whose field output is one "n<path>" line
// for the cwd. darwin exposes the cwd only through proc_pidinfo, which
// x/sys does not wrap; lsof is part of the base system.
func darwinProcessCwd(pid int) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), darwinCwdTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/sbin/lsof", "-a", "-p", strconv.Itoa(pid), "-d", "cwd", "-Fn").Output()
	if err != nil {
		return "", fmt.Errorf("reading the cwd of PID %d via lsof: %w", pid, err)
	}
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		if line := sc.Text(); len(line) > 1 && line[0] == 'n' {
			return line[1:], nil
		}
	}
	return "", fmt.Errorf("lsof reported no cwd for PID %d", pid)
}

func darwinOrphanEntry(kp *unix.KinfoProc) orphanProcEntry {
	return orphanProcEntry{
		pid:       int(kp.Proc.P_pid),
		ppid:      int(kp.Eproc.Ppid),
		pgid:      int(kp.Eproc.Pgid),
		zombie:    kp.Proc.P_stat == darwinZombieState,
		startTime: kp.Proc.P_starttime.Sec*1_000_000 + int64(kp.Proc.P_starttime.Usec),
	}
}
