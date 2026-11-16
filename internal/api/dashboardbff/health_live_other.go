//go:build !darwin

package dashboardbff

import (
	"context"

	"github.com/shirou/gopsutil/v4/process"
)

func liveDiskPath() string { return "/" }

// memoryPressureLevel has no portable kernel source off macOS.
func memoryPressureLevel() string { return "unknown" }

// listProcesses reads each process's short name, CPU time and resident
// memory; /proc is world-readable, so it sees every process. On Linux the
// name is /proc/<pid>/comm; when that is 15 bytes or longer gopsutil may
// extend it from the basename of argv[0] (review M-4). Only that basename
// reaches the wire: never other arguments or the environment.
func listProcesses(ctx context.Context) (processList, error) {
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return processList{}, err
	}
	out := make([]processSample, 0, len(procs))
	for _, p := range procs {
		if ctx.Err() != nil {
			return processList{}, ctx.Err()
		}
		name, err := p.NameWithContext(ctx)
		if err != nil {
			continue
		}
		sample := processSample{PID: p.Pid, Name: name}
		if times, err := p.TimesWithContext(ctx); err == nil && times != nil {
			sample.CPUSeconds = times.User + times.System
		}
		if memInfo, err := p.MemoryInfoWithContext(ctx); err == nil && memInfo != nil {
			sample.RSSBytes = memInfo.RSS
		}
		out = append(out, sample)
	}
	return processList{Samples: out, Coverage: processCoverageAll}, nil
}
