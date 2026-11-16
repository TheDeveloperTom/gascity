import type { IsoTimestamp } from './dashboard-sessions.js';

export type HealthMetricUnavailableReason = 'sample_failed' | 'invalid_sample' | 'value_overflow';

export type HealthMetric<T> =
  | { status: 'available'; value: T }
  | { status: 'unavailable'; reason: HealthMetricUnavailableReason };

export interface HostLoadAverages {
  load_avg_1: number;
  load_avg_5: number;
  load_avg_15: number;
}

export interface HostMemory {
  total_mem_bytes: number;
  free_mem_bytes: number;
}

export interface SystemHealth {
  /** Backend process state — totally local to the admin dashboard's node process. */
  admin: {
    pid: number;
    uptime_sec: number;
    rss: HealthMetric<number>;
    heap_used_bytes: number;
    node_version: string;
  };
  /** Machine-level state from Node's os module. */
  host: {
    load: HealthMetric<HostLoadAverages>;
    memory: HealthMetric<HostMemory>;
    /** Number of logical CPUs. */
    cpu_count: number;
    uptime: HealthMetric<number>;
  };
}

export type LocalToolVersion =
  | { status: 'available'; version: string; source: string }
  | { status: 'unavailable'; reason: string };

/** Installed versions of the host tools the dashboard probes locally — the same
 *  version data `gc doctor` surfaces, reported as a plain passthrough. The
 *  dashboard does not maintain a recommended-version floor or compute drift
 *  verdicts; gc owns that policy. */
export interface LocalToolVersions {
  dolt: LocalToolVersion;
  beads: LocalToolVersion;
  gc: LocalToolVersion;
}

export interface DoltNomsSample {
  ts: IsoTimestamp;
  bytes: number;
}

export type DoltNomsUnavailableReason = 'store_health_absent' | 'sample_failed';

export type DoltNomsTrend =
  | {
      available: true;
      /** Up to 144 samples (24 h at 10-min cadence). */
      samples: DoltNomsSample[];
      source: string;
    }
  | {
      available: false;
      /** Historical samples, if the source became unavailable after sampling. */
      samples: DoltNomsSample[];
      reason: DoltNomsUnavailableReason;
    };

/** GET /api/health/live (dashboardbff/health_live.go): the Health page's
 *  realtime host reading, polled every few seconds. */
export interface LiveHealth {
  sampled_at: IsoTimestamp;
  cpu: {
    /** Logical CPU count. */
    cores: number;
    /** Share of all cores busy since the previous sample, 0–100. */
    busy_pct: HealthMetric<number>;
    load: HealthMetric<HostLoadAverages>;
  };
  memory: HealthMetric<LiveMemory>;
  disk: HealthMetric<LiveDisk>;
  processes: LiveProcesses;
}

/** The cheap host numbers of one reading: LiveHealth without the process
 *  list (dashboardbff hostReading). */
export type HostReading = Omit<LiveHealth, 'processes'>;

/** GET /api/health/history (dashboardbff/health_history.go): the last
 *  window_ms of host readings, one every interval_ms, oldest first, sampled
 *  in the background while the engine runs. In memory only: an engine
 *  restart starts it empty. */
export interface HostHistory {
  interval_ms: number;
  window_ms: number;
  points: HostReading[];
}

export type MemoryPressure = 'normal' | 'warn' | 'critical' | 'unknown';

export interface LiveMemory {
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  swap_total_bytes: number;
  swap_used_bytes: number;
  /** The kernel's memory-pressure level (macOS); `unknown` elsewhere. */
  pressure: MemoryPressure;
}

export interface LiveDisk {
  total_bytes: number;
  free_bytes: number;
}

/** One command name's share: never args, env, paths or PIDs. */
export interface ProcessUsage {
  name: string;
  count: number;
  /** Summed CPU, percent of ONE core (Activity Monitor's scale). */
  cpu_pct: number;
  rss_bytes: number;
}

export interface ProcessRest {
  count: number;
  cpu_pct: number;
  rss_bytes: number;
}

export type LiveProcessesUnavailableReason = 'not_loopback' | 'sample_failed';

/** Which processes the list could read: every one (via setuid /bin/ps on
 *  macOS), only the caller's own (system processes missing), or none. */
export type ProcessCoverage = 'all_processes' | 'own_processes' | 'none';

export type LiveProcesses =
  | {
      status: 'available';
      coverage: ProcessCoverage;
      total: number;
      items: ProcessUsage[];
      rest: ProcessRest;
    }
  | {
      status: 'unavailable';
      reason: LiveProcessesUnavailableReason;
      coverage: ProcessCoverage;
      total: number;
      items: ProcessUsage[];
      rest: ProcessRest;
    };
