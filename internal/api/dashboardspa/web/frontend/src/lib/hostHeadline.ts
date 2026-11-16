import type { LiveDisk, LiveHealth, LiveMemory } from 'gas-city-dashboard-shared';
import { getLocale, t } from '../i18n';
import { loadPctOf } from './hostLive';

// «Что с маком сейчас» (owner 16.11): one sentence, calm unless a threshold
// is crossed. Each clause carries its own tone; the sentence takes the worst.
//
// Thresholds, and why:
// - CPU: the 1-minute load as a percent of the cores. Under 80 % there is a
//   free core to spare; 80–120 % the Mac is busy and new work starts to wait;
//   120 % and over, threads queue for a core for a sustained minute.
//   Busy % stands in when load is unreadable.
// - Memory: the kernel's own pressure level when macOS reports it (the same
//   signal as Activity Monitor's pressure graph): warn is amber, critical is
//   red. Elsewhere, the available share: under 10 % amber, under 5 % red.
// - Disk: free gigabytes on the data volume, not a percent, since a 460 GB
//   disk at 95 % still has room: under 20 GB amber (builds and Dolt stores
//   need headroom), under 5 GB red (writes start failing soon).

export type HostTone = 'ok' | 'warn' | 'critical';

const GiB = 2 ** 30;

export const HOST_THRESHOLDS = {
  cpuWarnPct: 80,
  cpuCriticalPct: 120,
  memWarnAvailableRatio: 0.1,
  memCriticalAvailableRatio: 0.05,
  diskWarnFreeBytes: 20 * GiB,
  diskCriticalFreeBytes: 5 * GiB,
} as const;

export function cpuTone(pct: number): HostTone {
  if (pct >= HOST_THRESHOLDS.cpuCriticalPct) return 'critical';
  if (pct >= HOST_THRESHOLDS.cpuWarnPct) return 'warn';
  return 'ok';
}

export function memoryTone(mem: LiveMemory): HostTone {
  if (mem.pressure === 'critical') return 'critical';
  if (mem.pressure === 'warn') return 'warn';
  if (mem.pressure === 'normal') return 'ok';
  const ratio = mem.total_bytes > 0 ? mem.available_bytes / mem.total_bytes : 1;
  if (ratio < HOST_THRESHOLDS.memCriticalAvailableRatio) return 'critical';
  if (ratio < HOST_THRESHOLDS.memWarnAvailableRatio) return 'warn';
  return 'ok';
}

export function diskTone(disk: LiveDisk): HostTone {
  if (disk.free_bytes < HOST_THRESHOLDS.diskCriticalFreeBytes) return 'critical';
  if (disk.free_bytes < HOST_THRESHOLDS.diskWarnFreeBytes) return 'warn';
  return 'ok';
}

export function worstTone(tones: readonly HostTone[]): HostTone {
  if (tones.includes('critical')) return 'critical';
  if (tones.includes('warn')) return 'warn';
  return 'ok';
}

const NBSP = ' ';

function numberFormat(maximumFractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(getLocale() === 'ru' ? 'ru-RU' : 'en-US', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  });
}

/** «38 %» in Russian, «38%» in English; never breaks inside. */
export function formatPct(value: number, fractionDigits = 0): string {
  const n = numberFormat(fractionDigits).format(value);
  return getLocale() === 'ru' ? `${n}${NBSP}%` : `${n}%`;
}

/** Binary sizes, at most one decimal under 100 («9,3 ГБ», «19,4 ГБ», «896 МБ»). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units: Array<[number, string]> = [
    [GiB * 1024, t('TB')],
    [GiB, t('GB')],
    [2 ** 20, t('MB')],
    [2 ** 10, t('KB')],
  ];
  for (const [size, unit] of units) {
    if (bytes >= size) {
      const v = bytes / size;
      return `${numberFormat(v < 100 ? 1 : 0).format(v)}${NBSP}${unit}`;
    }
  }
  return `${Math.round(bytes)}${NBSP}${t('B')}`;
}

export interface HeadlineClause {
  key: 'cpu' | 'memory' | 'disk';
  tone: HostTone;
  text: string;
}

export interface Headline {
  tone: HostTone;
  clauses: HeadlineClause[];
  sentence: string;
}

export function cpuPctOf(live: LiveHealth): number | null {
  const load = loadPctOf(live);
  if (load !== null) return load;
  return live.cpu.busy_pct.status === 'available' ? live.cpu.busy_pct.value : null;
}

export function buildHeadline(live: LiveHealth): Headline {
  const clauses: HeadlineClause[] = [];

  const cpu = cpuPctOf(live);
  if (cpu !== null) {
    const tone = cpuTone(cpu);
    const pct = formatPct(Math.round(cpu));
    const text =
      tone === 'critical'
        ? t('The Mac is overloaded: {pct}, work waits for a core', { pct })
        : tone === 'warn'
          ? t('The Mac is {pct} loaded, close to its limit', { pct })
          : t('The Mac is {pct} loaded', { pct });
    clauses.push({ key: 'cpu', tone, text });
  }

  if (live.memory.status === 'available') {
    const tone = memoryTone(live.memory.value);
    const text =
      tone === 'critical'
        ? t('memory is running out')
        : tone === 'warn'
          ? t('memory is tight')
          : t('memory is fine');
    clauses.push({ key: 'memory', tone, text });
  }

  if (live.disk.status === 'available') {
    const tone = diskTone(live.disk.value);
    const free = formatBytes(live.disk.value.free_bytes);
    const text =
      tone === 'critical'
        ? t('the disk is almost full: {free} free', { free })
        : tone === 'warn'
          ? t('disk space is low: {free} free', { free })
          : t('{free} free on disk', { free });
    clauses.push({ key: 'disk', tone, text });
  }

  const joined = clauses.map((c) => c.text).join(', ');
  const sentence =
    joined.length === 0
      ? t('The Mac is not reporting its load right now.')
      : `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
  return { tone: worstTone(clauses.map((c) => c.tone)), clauses, sentence };
}
