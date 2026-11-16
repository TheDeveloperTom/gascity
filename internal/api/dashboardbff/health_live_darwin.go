//go:build darwin

package dashboardbff

import (
	"context"
	"os"

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

// listProcesses reads every process's kernel command name (p_comm, at most
// 16 bytes, from one kern.proc.all sysctl) plus its CPU time and resident
// memory (proc_pidinfo task info). It never reads argv, the environment or
// the executable path. A process the user may not inspect reports zeros.
func listProcesses(ctx context.Context) ([]processSample, error) {
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
