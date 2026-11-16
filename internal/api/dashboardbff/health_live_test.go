package dashboardbff

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeLiveSources is a scripted host: each call to the CPU / process samplers
// returns the next scripted value, so CPU deltas are exact.
type fakeLiveSources struct {
	cpuTotals [][2]float64 // {busy seconds, total seconds}
	procs     [][]processSample
	cpuCalls  int
	procCalls int
	sleeps    []time.Duration
	now       time.Time
	procErr   error
}

func (f *fakeLiveSources) sources() liveSources {
	return liveSources{
		now: func() time.Time { return f.now },
		sleep: func(d time.Duration) {
			f.sleeps = append(f.sleeps, d)
			f.now = f.now.Add(d)
		},
		cpuTimes: func(context.Context) (float64, float64, error) {
			v := f.cpuTotals[min(f.cpuCalls, len(f.cpuTotals)-1)]
			f.cpuCalls++
			return v[0], v[1], nil
		},
		cores: func() int { return 10 },
		load: func() (hostLoadAverages, error) {
			return hostLoadAverages{LoadAvg1: 3.8, LoadAvg5: 3.7, LoadAvg15: 3.1}, nil
		},
		memory: func(context.Context) (liveMemory, error) {
			return liveMemory{TotalBytes: 24 << 30, UsedBytes: 19 << 30, AvailableBytes: 5 << 30, SwapTotalBytes: 4 << 30, SwapUsedBytes: 2 << 30, Pressure: "normal"}, nil
		},
		disk: func(context.Context) (liveDisk, error) {
			return liveDisk{TotalBytes: 460 << 30, FreeBytes: 9 << 30}, nil
		},
		processes: func(context.Context) ([]processSample, error) {
			if f.procErr != nil {
				return nil, f.procErr
			}
			v := f.procs[min(f.procCalls, len(f.procs)-1)]
			f.procCalls++
			return v, nil
		},
	}
}

func liveRequest(remote string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/api/health/live", nil)
	r.RemoteAddr = remote
	return r
}

func TestLiveSamplerFirstSampleTakesABaselineSoCPUIsNeverBlank(t *testing.T) {
	f := &fakeLiveSources{
		now:       time.Unix(1000, 0),
		cpuTotals: [][2]float64{{100, 1000}, {103, 1010}}, // 3 of 10 s busy = 30 %
		procs: [][]processSample{
			{{PID: 1, Name: "claude", CPUSeconds: 10, RSSBytes: 100}},
			{{PID: 1, Name: "claude", CPUSeconds: 10.5, RSSBytes: 100}},
		},
	}
	s := newLiveSampler(f.sources())
	snap := s.snapshot(context.Background(), true)

	if len(f.sleeps) != 1 {
		t.Fatalf("first snapshot slept %d times, want exactly one baseline wait", len(f.sleeps))
	}
	if snap.CPU.BusyPct.Status != healthMetricAvailable || *snap.CPU.BusyPct.Value != 30 {
		t.Fatalf("busy_pct = %#v, want 30", snap.CPU.BusyPct)
	}
	if snap.Processes.Status != "available" || len(snap.Processes.Items) != 1 {
		t.Fatalf("processes = %#v, want one item", snap.Processes)
	}
	wait := f.sleeps[0].Seconds()
	want := 0.5 / wait * 100
	if got := snap.Processes.Items[0].CPUPct; got < want-0.05 || got > want+0.05 {
		t.Fatalf("claude cpu_pct = %v, want %v (0.5 s CPU over the baseline wait)", got, want)
	}
}

func TestLiveSamplerReusesASnapshotYoungerThanTheMinimumInterval(t *testing.T) {
	f := &fakeLiveSources{
		now:       time.Unix(1000, 0),
		cpuTotals: [][2]float64{{0, 0}, {1, 10}, {2, 20}},
		procs:     [][]processSample{{}},
	}
	s := newLiveSampler(f.sources())
	s.snapshot(context.Background(), true)
	calls := f.cpuCalls
	f.now = f.now.Add(200 * time.Millisecond)
	s.snapshot(context.Background(), true)
	if f.cpuCalls != calls {
		t.Fatalf("a second request within the minimum interval re-sampled the host")
	}
	f.now = f.now.Add(2 * time.Second)
	s.snapshot(context.Background(), true)
	if f.cpuCalls != calls+1 {
		t.Fatalf("cpu sampled %d times after the interval, want %d (no second baseline)", f.cpuCalls, calls+1)
	}
}

func TestLiveSamplerTakesAFreshBaselineAfterALongIdle(t *testing.T) {
	f := &fakeLiveSources{
		now:       time.Unix(1000, 0),
		cpuTotals: [][2]float64{{0, 0}, {1, 10}, {500, 1000}, {501, 1010}},
		procs:     [][]processSample{{}},
	}
	s := newLiveSampler(f.sources())
	s.snapshot(context.Background(), true)
	f.now = f.now.Add(10 * time.Minute)
	snap := s.snapshot(context.Background(), true)
	if len(f.sleeps) != 2 {
		t.Fatalf("after a long idle the sampler slept %d times, want a second baseline", len(f.sleeps))
	}
	if *snap.CPU.BusyPct.Value != 10 {
		t.Fatalf("busy_pct = %v, want 10 (the fresh window, not the ten-minute average)", *snap.CPU.BusyPct.Value)
	}
}

func TestLiveSamplerAggregatesProcessesByNameOnly(t *testing.T) {
	f := &fakeLiveSources{
		now:       time.Unix(1000, 0),
		cpuTotals: [][2]float64{{0, 0}, {1, 10}},
		procs: [][]processSample{
			{{PID: 1, Name: "dolt", CPUSeconds: 0}, {PID: 2, Name: "dolt", CPUSeconds: 0}, {PID: 3, Name: "gc"}},
			{
				{PID: 1, Name: "dolt", CPUSeconds: 0.1, RSSBytes: 100},
				{PID: 2, Name: "dolt", CPUSeconds: 0.2, RSSBytes: 50},
				{PID: 3, Name: "gc", CPUSeconds: 0, RSSBytes: 600},
				{PID: 4, Name: "new", CPUSeconds: 5, RSSBytes: 1}, // no baseline: counts no CPU
			},
		},
	}
	snap := newLiveSampler(f.sources()).snapshot(context.Background(), true)
	byName := map[string]processUsage{}
	for _, item := range snap.Processes.Items {
		byName[item.Name] = item
	}
	if got := byName["dolt"]; got.Count != 2 || got.RSSBytes != 150 {
		t.Fatalf("dolt = %#v, want count 2, rss 150", got)
	}
	if got := byName["new"]; got.CPUPct != 0 {
		t.Fatalf("a process without a baseline reported %v %% CPU, want 0", got.CPUPct)
	}
	if snap.Processes.Total != 4 {
		t.Fatalf("total = %d, want 4", snap.Processes.Total)
	}
}

func TestLiveSamplerCapsTheProcessListAndFoldsTheTailIntoRest(t *testing.T) {
	var procs []processSample
	for i := 0; i < 300; i++ {
		procs = append(procs, processSample{PID: int32(i + 1), Name: "p" + strings.Repeat("x", i%40) + string(rune('a'+i%26)), RSSBytes: uint64(i + 1)})
	}
	f := &fakeLiveSources{now: time.Unix(1000, 0), cpuTotals: [][2]float64{{0, 0}, {1, 10}}, procs: [][]processSample{procs}}
	snap := newLiveSampler(f.sources()).snapshot(context.Background(), true)
	if len(snap.Processes.Items) > maxLiveProcessNames {
		t.Fatalf("items = %d, want at most %d", len(snap.Processes.Items), maxLiveProcessNames)
	}
	var kept uint64
	keptCount := 0
	for _, item := range snap.Processes.Items {
		kept += item.RSSBytes
		keptCount += item.Count
	}
	var all uint64
	for _, p := range procs {
		all += p.RSSBytes
	}
	if kept+snap.Processes.Rest.RSSBytes != all {
		t.Fatalf("kept %d + rest %d != all %d: the cap lost memory", kept, snap.Processes.Rest.RSSBytes, all)
	}
	if keptCount+snap.Processes.Rest.Count != len(procs) {
		t.Fatalf("kept %d + rest %d processes != %d", keptCount, snap.Processes.Rest.Count, len(procs))
	}
	body, _ := json.Marshal(snap)
	if len(body) > 16<<10 {
		t.Fatalf("response is %d bytes, want ≤ 16 KiB", len(body))
	}
}

func TestLiveSamplerSanitizesAndTruncatesProcessNames(t *testing.T) {
	f := &fakeLiveSources{
		now:       time.Unix(1000, 0),
		cpuTotals: [][2]float64{{0, 0}, {1, 10}},
		procs:     [][]processSample{{{PID: 1, Name: "evil\x1b[31m\nname" + strings.Repeat("y", 80), RSSBytes: 1}, {PID: 2, Name: "", RSSBytes: 1}}},
	}
	snap := newLiveSampler(f.sources()).snapshot(context.Background(), true)
	for _, item := range snap.Processes.Items {
		if strings.ContainsAny(item.Name, "\x1b\n") {
			t.Fatalf("name %q carries control characters", item.Name)
		}
		if len([]rune(item.Name)) > maxLiveProcessNameRunes {
			t.Fatalf("name %q longer than %d runes", item.Name, maxLiveProcessNameRunes)
		}
		if item.Name == "" {
			t.Fatalf("an empty name reached the wire")
		}
	}
}

func TestLiveEndpointRefusesTheProcessListToANonLoopbackCaller(t *testing.T) {
	f := &fakeLiveSources{now: time.Unix(1000, 0), cpuTotals: [][2]float64{{0, 0}, {1, 10}}, procs: [][]processSample{{{PID: 1, Name: "claude"}}}}
	p := New(Deps{})
	p.live = newLiveSampler(f.sources())

	forwarded := liveRequest("127.0.0.1:5000")
	forwarded.Header.Set("X-Forwarded-For", "203.0.113.4")
	cases := map[string]*http.Request{
		"remote address":                  liveRequest("192.0.2.10:5000"),
		"forwarded through a local proxy": forwarded,
	}
	for name, req := range cases {
		rec := httptest.NewRecorder()
		p.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", name, rec.Code)
		}
		var got liveHealth
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("%s: decode: %v", name, err)
		}
		if got.Processes.Status != "unavailable" || got.Processes.Reason != "not_loopback" || len(got.Processes.Items) != 0 {
			t.Fatalf("%s: processes = %#v, want unavailable/not_loopback", name, got.Processes)
		}
		if strings.Contains(rec.Body.String(), "claude") {
			t.Fatalf("%s: a process name leaked to a non-loopback caller", name)
		}
	}
}

func TestLiveEndpointServesTheProcessListOnLoopback(t *testing.T) {
	f := &fakeLiveSources{now: time.Unix(1000, 0), cpuTotals: [][2]float64{{0, 0}, {1, 10}}, procs: [][]processSample{{{PID: 1, Name: "claude", RSSBytes: 9}}}}
	p := New(Deps{})
	p.live = newLiveSampler(f.sources())
	for _, remote := range []string{"127.0.0.1:5000", "[::1]:5000"} {
		rec := httptest.NewRecorder()
		p.Handler().ServeHTTP(rec, liveRequest(remote))
		var got liveHealth
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("%s: decode: %v", remote, err)
		}
		if got.Processes.Status != "available" || len(got.Processes.Items) != 1 {
			t.Fatalf("%s: processes = %#v, want the list", remote, got.Processes)
		}
	}
}

func TestLiveEndpointWireCarriesOnlyNameCountCPUAndMemoryPerProcess(t *testing.T) {
	f := &fakeLiveSources{now: time.Unix(1000, 0), cpuTotals: [][2]float64{{0, 0}, {1, 10}}, procs: [][]processSample{{{PID: 77123, Name: "claude", RSSBytes: 9}}}}
	p := New(Deps{})
	p.live = newLiveSampler(f.sources())
	rec := httptest.NewRecorder()
	p.Handler().ServeHTTP(rec, liveRequest("127.0.0.1:1"))
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode: %v", err)
	}
	mustString(t, m, "sampled_at")
	mustObject(t, m, "cpu")
	mustObject(t, m, "memory")
	mustObject(t, m, "disk")
	mustObject(t, m, "processes")
	procs := m["processes"].(map[string]any)
	mustArray(t, procs, "items")
	mustObject(t, procs, "rest")
	item := procs["items"].([]any)[0].(map[string]any)
	if len(item) != 4 {
		t.Fatalf("process item has keys %v, want exactly name/count/cpu_pct/rss_bytes", item)
	}
	for _, k := range []string{"name", "count", "cpu_pct", "rss_bytes"} {
		if _, ok := item[k]; !ok {
			t.Fatalf("process item lacks %q: %v", k, item)
		}
	}
	if strings.Contains(rec.Body.String(), "77123") {
		t.Fatalf("a PID reached the wire: %s", rec.Body.String())
	}
}

func TestLiveSamplerReportsAProcessFailureWithoutHidingHostMetrics(t *testing.T) {
	f := &fakeLiveSources{now: time.Unix(1000, 0), cpuTotals: [][2]float64{{0, 0}, {1, 10}}, procErr: errors.New("boom")}
	snap := newLiveSampler(f.sources()).snapshot(context.Background(), true)
	if snap.Processes.Status != "unavailable" || snap.Processes.Reason != "sample_failed" {
		t.Fatalf("processes = %#v, want unavailable/sample_failed", snap.Processes)
	}
	if snap.Memory.Status != healthMetricAvailable || snap.Disk.Status != healthMetricAvailable {
		t.Fatalf("a process failure hid host metrics: %#v %#v", snap.Memory, snap.Disk)
	}
	if snap.Processes.Items == nil {
		t.Fatalf("items must be an empty array, never null")
	}
}

func TestLiveEndpointRefusesMutations(t *testing.T) {
	p := New(Deps{ReadOnly: true})
	rec := httptest.NewRecorder()
	p.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/health/live", nil))
	if rec.Code == http.StatusOK {
		t.Fatalf("POST /api/health/live answered 200")
	}
}
