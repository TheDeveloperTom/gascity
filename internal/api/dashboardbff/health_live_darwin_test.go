//go:build darwin

package dashboardbff

import (
	"context"
	"testing"
	"time"
)

// TestLiveSamplerReadsTheRealMac runs the real samplers: every host metric is
// available on macOS, the process list sees this test's own process, and one
// steady-state sample stays cheap enough to poll every few seconds.
func TestLiveSamplerReadsTheRealMac(t *testing.T) {
	s := defaultLiveSampler()
	first := s.snapshot(context.Background(), true)
	if first.CPU.BusyPct.Status != healthMetricAvailable {
		t.Fatalf("busy_pct = %#v, want available", first.CPU.BusyPct)
	}
	if first.CPU.Load.Status != healthMetricAvailable || first.Memory.Status != healthMetricAvailable || first.Disk.Status != healthMetricAvailable {
		t.Fatalf("host metrics unavailable: load %#v memory %#v disk %#v", first.CPU.Load, first.Memory, first.Disk)
	}
	if p := first.Memory.Value.Pressure; p != "normal" && p != "warn" && p != "critical" {
		t.Fatalf("memory pressure = %q, want a macOS level", p)
	}
	if first.Processes.Status != "available" || first.Processes.Total < 2 || len(first.Processes.Items) == 0 {
		t.Fatalf("processes = %d total, %d items (%s), want the host's list", first.Processes.Total, len(first.Processes.Items), first.Processes.Status)
	}
	var rss uint64
	for _, item := range first.Processes.Items {
		rss += item.RSSBytes
	}
	if rss == 0 {
		t.Fatalf("no process reported resident memory")
	}

	time.Sleep(liveMinInterval)
	start := time.Now()
	s.snapshot(context.Background(), true)
	if took := time.Since(start); took > 750*time.Millisecond {
		t.Fatalf("a steady-state sample took %v, want under 750 ms", took)
	} else {
		t.Logf("steady-state sample: %v for %d processes", took, first.Processes.Total)
	}
}
