package dashboardbff

import (
	"context"
	"fmt"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
)

// hostCPUTimes returns the machine's cumulative busy and total CPU seconds,
// summed over all cores; the live sampler turns two readings into busy %.
func hostCPUTimes(ctx context.Context) (busy, total float64, err error) {
	times, err := cpu.TimesWithContext(ctx, false)
	if err != nil {
		return 0, 0, err
	}
	if len(times) == 0 {
		return 0, 0, fmt.Errorf("no cpu times reported")
	}
	t := times[0]
	total = t.User + t.System + t.Idle + t.Nice + t.Iowait + t.Irq + t.Softirq + t.Steal
	busy = total - t.Idle - t.Iowait
	return busy, total, nil
}

// hostLiveMemory reads used/available memory, swap and, where the OS reports
// it, the kernel's memory-pressure level.
func hostLiveMemory(ctx context.Context) (liveMemory, error) {
	vm, err := mem.VirtualMemoryWithContext(ctx)
	if err != nil {
		return liveMemory{}, err
	}
	out := liveMemory{
		TotalBytes:     vm.Total,
		AvailableBytes: vm.Available,
		Pressure:       memoryPressureLevel(),
	}
	if vm.Available <= vm.Total {
		out.UsedBytes = vm.Total - vm.Available
	}
	if swap, err := mem.SwapMemoryWithContext(ctx); err == nil {
		out.SwapTotalBytes = swap.Total
		out.SwapUsedBytes = swap.Used
	}
	return out, nil
}

// hostLiveDisk reads the free space of the volume that holds user data.
func hostLiveDisk(ctx context.Context) (liveDisk, error) {
	usage, err := disk.UsageWithContext(ctx, liveDiskPath())
	if err != nil {
		return liveDisk{}, err
	}
	return liveDisk{TotalBytes: usage.Total, FreeBytes: usage.Free}, nil
}
