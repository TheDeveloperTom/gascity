package dashboardbff

import (
	"context"
	"log"
	"math"
	"net"
	"net/http"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/shirou/gopsutil/v4/load"
)

// GET /api/health/live: the Health page's realtime host reading (owner 16.11:
// «что с маком происходит при текущей нагрузке»). One request returns CPU
// busy %, load, memory with pressure, free disk and the processes grouped by
// name, so the page polls one endpoint every few seconds and keeps its own
// 15–30 minute ring buffer. It lives next to GET /api/health/system, on the
// host-side /api plane (plane.go): host metrics are not a city domain object
// and the plane is the sanctioned home for host-side probes.
//
// Security. The endpoint is read-only (the plane guard refuses every unsafe
// method in read-only mode and every cross-origin one otherwise). The process
// list carries the kernel's command name only — never arguments, environment,
// paths or PIDs — and only to a loopback caller with no forwarding header; any
// other caller gets the host numbers and `processes.status = unavailable`,
// reason `not_loopback`. Output is capped (maxLiveProcessNames entries, names
// at maxLiveProcessNameRunes runes, the tail folded into `rest`).

const (
	// liveMinInterval collapses polls from several tabs into one host sample.
	liveMinInterval = time.Second
	// liveBaselineWait is the one-time wait the first sample (or the first
	// after liveBaselineMaxAge idle) takes so CPU deltas are never blank.
	liveBaselineWait = 300 * time.Millisecond
	// liveBaselineMaxAge: an older previous sample would average CPU over the
	// whole idle gap, so the sampler takes a fresh baseline instead.
	liveBaselineMaxAge = time.Minute
	// maxLiveProcessNames caps the per-name list; the tail folds into rest.
	maxLiveProcessNames = 48
	// maxLiveProcessNameRunes caps one name's length on the wire.
	maxLiveProcessNameRunes = 32
)

// liveHealth is the GET /api/health/live response, matching
// shared/src/dashboard-health.ts LiveHealth.
type liveHealth struct {
	SampledAt string                   `json:"sampled_at"`
	CPU       liveCPU                  `json:"cpu"`
	Memory    healthMetric[liveMemory] `json:"memory"`
	Disk      healthMetric[liveDisk]   `json:"disk"`
	Processes liveProcesses            `json:"processes"`
}

type liveCPU struct {
	// Cores is the logical CPU count.
	Cores int `json:"cores"`
	// BusyPct is the share of all cores busy since the previous sample, 0–100.
	BusyPct healthMetric[float64] `json:"busy_pct"`
	// Load is the 1/5/15-minute load average (runnable threads).
	Load healthMetric[hostLoadAverages] `json:"load"`
}

type liveMemory struct {
	TotalBytes     uint64 `json:"total_bytes"`
	UsedBytes      uint64 `json:"used_bytes"`
	AvailableBytes uint64 `json:"available_bytes"`
	SwapTotalBytes uint64 `json:"swap_total_bytes"`
	SwapUsedBytes  uint64 `json:"swap_used_bytes"`
	// Pressure is the kernel's memory-pressure level where the OS reports
	// one (macOS): normal, warn or critical; unknown elsewhere.
	Pressure string `json:"pressure"`
}

type liveDisk struct {
	TotalBytes uint64 `json:"total_bytes"`
	FreeBytes  uint64 `json:"free_bytes"`
}

// processUsage is one command name's share of the Mac: how many processes
// carry the name, their summed CPU (percent of one core, as Activity Monitor
// counts) and summed resident memory.
type processUsage struct {
	Name     string  `json:"name"`
	Count    int     `json:"count"`
	CPUPct   float64 `json:"cpu_pct"`
	RSSBytes uint64  `json:"rss_bytes"`
}

// processRest is the folded tail past maxLiveProcessNames.
type processRest struct {
	Count    int     `json:"count"`
	CPUPct   float64 `json:"cpu_pct"`
	RSSBytes uint64  `json:"rss_bytes"`
}

type liveProcesses struct {
	Status string `json:"status"`
	// Reason is set when Status is "unavailable": not_loopback or sample_failed.
	Reason string         `json:"reason,omitempty"`
	Total  int            `json:"total"`
	Items  []processUsage `json:"items"`
	Rest   processRest    `json:"rest"`
}

// processSample is one process as the OS lister reads it. PID stays in
// process: it keys the CPU delta and never reaches the wire.
type processSample struct {
	PID        int32
	Name       string
	CPUSeconds float64
	RSSBytes   uint64
}

// liveSources are the host samplers, injected so tests script exact deltas.
type liveSources struct {
	now       func() time.Time
	sleep     func(time.Duration)
	cpuTimes  func(context.Context) (busySeconds, totalSeconds float64, err error)
	cores     func() int
	load      func() (hostLoadAverages, error)
	memory    func(context.Context) (liveMemory, error)
	disk      func(context.Context) (liveDisk, error)
	processes func(context.Context) ([]processSample, error)
}

type cpuReading struct{ busy, total float64 }

// liveSampler keeps the previous reading so each snapshot reports the CPU
// spent since the last one. Its mutex collapses concurrent polls.
type liveSampler struct {
	src liveSources

	mu       sync.Mutex
	cached   liveHealth
	cachedAt time.Time
	primed   bool

	prevAt   time.Time
	prevCPU  cpuReading
	prevProc map[int32]float64
	hasPrev  bool
}

func newLiveSampler(src liveSources) *liveSampler {
	return &liveSampler{src: src}
}

func defaultLiveSampler() *liveSampler {
	return newLiveSampler(liveSources{
		now:      time.Now,
		sleep:    time.Sleep,
		cpuTimes: hostCPUTimes,
		cores:    runtime.NumCPU,
		load: func() (hostLoadAverages, error) {
			avg, err := load.Avg()
			if err != nil {
				return hostLoadAverages{}, err
			}
			return hostLoadAverages{LoadAvg1: avg.Load1, LoadAvg5: avg.Load5, LoadAvg15: avg.Load15}, nil
		},
		memory:    hostLiveMemory,
		disk:      hostLiveDisk,
		processes: listProcesses,
	})
}

// snapshot returns the current reading; withProcesses=false drops the process
// list (a non-loopback caller) without changing what is sampled or cached.
func (s *liveSampler) snapshot(ctx context.Context, withProcesses bool) liveHealth {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.src.now()
	if !s.primed || now.Sub(s.cachedAt) >= liveMinInterval {
		s.cached = s.sample(ctx)
		s.cachedAt = s.src.now()
		s.primed = true
	}
	out := s.cached
	if !withProcesses {
		out.Processes = liveProcesses{Status: "unavailable", Reason: "not_loopback", Items: []processUsage{}}
	}
	return out
}

func (s *liveSampler) sample(ctx context.Context) liveHealth {
	if !s.hasPrev || s.src.now().Sub(s.prevAt) > liveBaselineMaxAge {
		s.takeBaseline(ctx)
		s.src.sleep(liveBaselineWait)
	}
	at := s.src.now()
	elapsed := at.Sub(s.prevAt).Seconds()

	out := liveHealth{SampledAt: at.UTC().Format(time.RFC3339Nano)}
	out.CPU.Cores = s.src.cores()

	busy, total, err := s.src.cpuTimes(ctx)
	switch {
	case err != nil:
		out.CPU.BusyPct = failedHealthMetric[float64]("host cpu times", healthMetricSampleFailed, err)
	default:
		dTotal := total - s.prevCPU.total
		dBusy := busy - s.prevCPU.busy
		if dTotal <= 0 || dBusy < 0 {
			out.CPU.BusyPct = unavailableHealthMetric[float64](healthMetricInvalidSample)
		} else {
			out.CPU.BusyPct = availableHealthMetric(roundTo(math.Min(100, 100*dBusy/dTotal), 1))
		}
		s.prevCPU = cpuReading{busy: busy, total: total}
	}

	if avg, err := s.src.load(); err != nil {
		out.CPU.Load = failedHealthMetric[hostLoadAverages]("host load average", healthMetricSampleFailed, err)
	} else if !validLoadAverage(avg.LoadAvg1) || !validLoadAverage(avg.LoadAvg5) || !validLoadAverage(avg.LoadAvg15) {
		out.CPU.Load = unavailableHealthMetric[hostLoadAverages](healthMetricInvalidSample)
	} else {
		out.CPU.Load = availableHealthMetric(avg)
	}

	if m, err := s.src.memory(ctx); err != nil {
		out.Memory = failedHealthMetric[liveMemory]("host memory", healthMetricSampleFailed, err)
	} else if m.TotalBytes == 0 || m.UsedBytes > m.TotalBytes {
		out.Memory = unavailableHealthMetric[liveMemory](healthMetricInvalidSample)
	} else {
		out.Memory = availableHealthMetric(m)
	}

	if d, err := s.src.disk(ctx); err != nil {
		out.Disk = failedHealthMetric[liveDisk]("host disk", healthMetricSampleFailed, err)
	} else if d.TotalBytes == 0 || d.FreeBytes > d.TotalBytes {
		out.Disk = unavailableHealthMetric[liveDisk](healthMetricInvalidSample)
	} else {
		out.Disk = availableHealthMetric(d)
	}

	procs, err := s.src.processes(ctx)
	if err != nil {
		log.Printf("dashboard live-health process list unavailable: %v", err)
		out.Processes = liveProcesses{Status: "unavailable", Reason: "sample_failed", Items: []processUsage{}}
	} else {
		out.Processes = aggregateProcesses(procs, s.prevProc, elapsed)
		s.prevProc = processCPUIndex(procs)
	}
	s.prevAt = at
	s.hasPrev = true
	return out
}

func (s *liveSampler) takeBaseline(ctx context.Context) {
	s.prevAt = s.src.now()
	if busy, total, err := s.src.cpuTimes(ctx); err == nil {
		s.prevCPU = cpuReading{busy: busy, total: total}
	}
	if procs, err := s.src.processes(ctx); err == nil {
		s.prevProc = processCPUIndex(procs)
	} else {
		s.prevProc = nil
	}
}

func processCPUIndex(procs []processSample) map[int32]float64 {
	idx := make(map[int32]float64, len(procs))
	for _, p := range procs {
		idx[p.PID] = p.CPUSeconds
	}
	return idx
}

// aggregateProcesses sums processes by sanitized name. A process with no
// previous reading (new since the last sample) counts no CPU yet: its
// lifetime CPU time is not a rate.
func aggregateProcesses(procs []processSample, prev map[int32]float64, elapsed float64) liveProcesses {
	byName := map[string]*processUsage{}
	for _, p := range procs {
		name := sanitizeProcessName(p.Name)
		u := byName[name]
		if u == nil {
			u = &processUsage{Name: name}
			byName[name] = u
		}
		u.Count++
		u.RSSBytes += p.RSSBytes
		if before, ok := prev[p.PID]; ok && elapsed > 0 && p.CPUSeconds >= before {
			u.CPUPct += 100 * (p.CPUSeconds - before) / elapsed
		}
	}
	all := make([]processUsage, 0, len(byName))
	for _, u := range byName {
		u.CPUPct = roundTo(u.CPUPct, 1)
		all = append(all, *u)
	}
	// Keep the names that matter by either measure: alternate the top by CPU
	// and the top by memory until the cap, then fold the rest.
	byCPU := append([]processUsage(nil), all...)
	sort.Slice(byCPU, func(i, j int) bool {
		if byCPU[i].CPUPct != byCPU[j].CPUPct {
			return byCPU[i].CPUPct > byCPU[j].CPUPct
		}
		return byCPU[i].Name < byCPU[j].Name
	})
	byMem := append([]processUsage(nil), all...)
	sort.Slice(byMem, func(i, j int) bool {
		if byMem[i].RSSBytes != byMem[j].RSSBytes {
			return byMem[i].RSSBytes > byMem[j].RSSBytes
		}
		return byMem[i].Name < byMem[j].Name
	})
	kept := map[string]bool{}
	items := make([]processUsage, 0, min(len(all), maxLiveProcessNames))
	for i := 0; len(items) < maxLiveProcessNames && i < len(all); i++ {
		for _, u := range []processUsage{byCPU[i], byMem[i]} {
			if len(items) < maxLiveProcessNames && !kept[u.Name] {
				kept[u.Name] = true
				items = append(items, u)
			}
		}
	}
	var rest processRest
	for _, u := range all {
		if !kept[u.Name] {
			rest.Count += u.Count
			rest.CPUPct += u.CPUPct
			rest.RSSBytes += u.RSSBytes
		}
	}
	rest.CPUPct = roundTo(rest.CPUPct, 1)
	sort.Slice(items, func(i, j int) bool { return items[i].RSSBytes > items[j].RSSBytes })
	return liveProcesses{Status: "available", Total: len(procs), Items: items, Rest: rest}
}

// sanitizeProcessName keeps printable runes only, caps the length and names
// an empty result, so a hostile process title cannot reach the browser as
// control sequences.
func sanitizeProcessName(raw string) string {
	var b strings.Builder
	n := 0
	for _, r := range raw {
		if n >= maxLiveProcessNameRunes {
			break
		}
		if !unicode.IsPrint(r) {
			continue
		}
		b.WriteRune(r)
		n++
	}
	name := strings.TrimSpace(b.String())
	if name == "" {
		return "?"
	}
	return name
}

func roundTo(v float64, places int) float64 {
	p := math.Pow(10, float64(places))
	return math.Round(v*p) / p
}

// isLoopbackCaller is true for a direct loopback peer only: a forwarding
// header means a local proxy relays someone else.
func isLoopbackCaller(r *http.Request) bool {
	for _, h := range []string{"X-Forwarded-For", "Forwarded", "X-Real-Ip"} {
		if r.Header.Get(h) != "" {
			return false
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func (p *Plane) registerLiveHealth() {
	p.mux.HandleFunc("GET /api/health/live", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, p.live.snapshot(r.Context(), isLoopbackCaller(r)))
	})
}
