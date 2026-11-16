//go:build darwin

package dashboardbff

import (
	"context"
	"os"
	"os/exec"
	"time"

	"github.com/shirou/gopsutil/v4/process"
	"golang.org/x/sys/unix"
)

// macOS keeps user data on the Data volume; "/" is the sealed system
// snapshot, whose "used" says nothing about how full the disk is. Both share
// one APFS container, so free space is the same; the Data volume's total and
// free are what Finder shows.
const darwinDataVolume = "/System/Volumes/Data"

func liveDiskPath() string {
	if _, err := os.Stat(darwinDataVolume); err == nil {
		return darwinDataVolume
	}
	return "/"
}

// memoryPressureLevel reads kern.memorystatus_vm_pressure_level: 1 normal,
// 2 warn, 4 critical (the levels Activity Monitor's pressure graph shows).
func memoryPressureLevel() string {
	level, err := unix.SysctlUint32("kern.memorystatus_vm_pressure_level")
	if err != nil {
		return "unknown"
	}
	switch level {
	case 1:
		return "normal"
	case 2:
		return "warn"
	case 4:
		return "critical"
	default:
		return "unknown"
	}
}

// psListTimeout bounds one /bin/ps run (about 10 ms on an idle Mac).
const psListTimeout = 2 * time.Second

// listProcesses reads every process (review I-1). /bin/ps is setuid root on
// macOS, so it sees other users' processes (WindowServer, mds_stores,
// backupd), which libproc refuses to a non-root caller. It runs with a fixed
// absolute path, fixed arguments and an empty environment, and asks only for
// ucomm (the kernel command name): never argv, the environment or paths.
// When ps fails, the libproc lister reads the caller's own processes only and
// the coverage says so.
func listProcesses(ctx context.Context) (processList, error) {
	psCtx, cancel := context.WithTimeout(ctx, psListTimeout)
	defer cancel()
	cmd := exec.CommandContext(psCtx, "/bin/ps", "-axo", "pid=,time=,rss=,ucomm=")
	cmd.Env = []string{}
	if out, err := cmd.Output(); err == nil {
		if samples := parsePSOutput(string(out)); len(samples) > 0 {
			return processList{Samples: samples, Coverage: processCoverageAll}, nil
		}
	}
	samples, err := listOwnProcesses(ctx)
	if err != nil {
		return processList{}, err
	}
	return processList{Samples: samples, Coverage: processCoverageOwn}, nil
}

// listOwnProcesses reads every process's kernel command name (p_comm, at
// most 16 bytes, from one kern.proc.all sysctl) plus its CPU time and
// resident memory (proc_pidinfo task info). Another user's process reads as
// zeros: libproc refuses it, and gopsutil hides the refusal.
func listOwnProcesses(ctx context.Context) ([]processSample, error) {
	kprocs, err := unix.SysctlKinfoProcSlice("kern.proc.all")
	if err != nil {
		return nil, err
	}
	out := make([]processSample, 0, len(kprocs))
	for i := range kprocs {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		kp := &kprocs[i]
		pid := kp.Proc.P_pid
		if pid <= 0 {
			continue
		}
		sample := processSample{PID: pid, Name: unix.ByteSliceToString(kp.Proc.P_comm[:])}
		p := &process.Process{Pid: pid}
		if times, err := p.TimesWithContext(ctx); err == nil && times != nil {
			sample.CPUSeconds = times.User + times.System
		}
		if memInfo, err := p.MemoryInfoWithContext(ctx); err == nil && memInfo != nil {
			sample.RSSBytes = memInfo.RSS
		}
		out = append(out, sample)
	}
	return out, nil
}
