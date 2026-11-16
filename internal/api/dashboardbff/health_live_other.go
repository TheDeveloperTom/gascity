//go:build !darwin

package dashboardbff

import (
	"context"

	"github.com/shirou/gopsutil/v4/process"
)

func liveDiskPath() string { return "/" }

// memoryPressureLevel has no portable kernel source off macOS.
func memoryPressureLevel() string { return "unknown" }

// listProcesses reads each process's short name (Linux: /proc/<pid>/comm or status,
// never cmdline), CPU time and resident memory. It never reads argv or environment.
func listProcesses(ctx context.Context) ([]processSample, error) {
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]processSample, 0, len(procs))
	for _, p := range procs {
		if ctx.Err() != nil {
			return nil, ctx.Err()
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
	return out, nil
}
