package dashboardbff

import (
	"strconv"
	"strings"
)

// parsePSOutput reads `ps -axo pid=,time=,rss=,ucomm=` (review I-1). ucomm is
// the kernel's accounting name (p_comm, ≤ 16 bytes): never argv, never a
// path. It is the last column and may contain spaces («Brave Browser He»).
// pid 0 and malformed lines are skipped.
func parsePSOutput(out string) []processSample {
	var samples []processSample
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		pid, err := strconv.ParseInt(fields[0], 10, 32)
		if err != nil || pid <= 0 {
			continue
		}
		cpu, ok := parsePSCPUTime(fields[1])
		if !ok {
			continue
		}
		rssKB, err := strconv.ParseUint(fields[2], 10, 64)
		if err != nil {
			continue
		}
		samples = append(samples, processSample{
			PID:        int32(pid),
			Name:       strings.Join(fields[3:], " "),
			CPUSeconds: cpu,
			RSSBytes:   rssKB * 1024,
		})
	}
	return samples
}

// parsePSCPUTime reads ps's cumulative CPU time: BSD «MMM:SS.cc», or
// «[D-]HH:MM:SS[.cc]».
func parsePSCPUTime(v string) (float64, bool) {
	days := 0.0
	if d, rest, found := strings.Cut(v, "-"); found {
		n, err := strconv.ParseFloat(d, 64)
		if err != nil {
			return 0, false
		}
		days, v = n, rest
	}
	parts := strings.Split(v, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, false
	}
	total := 0.0
	for _, part := range parts {
		n, err := strconv.ParseFloat(part, 64)
		if err != nil || n < 0 {
			return 0, false
		}
		total = total*60 + n
	}
	return days*86400 + total, true
}
