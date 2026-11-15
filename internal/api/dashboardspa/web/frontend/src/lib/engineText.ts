import { getLocale, t } from '../i18n';

// Engine text → the owner's words (dashboard v3, ruling V7). The engine and
// the city write fixed, machine-generated templates ("order timeout of 1m30s
// exceeded", "Repair PR #578: merge_conflict"); each row below matches one
// template and says it in plain words. These are not titles people write, so
// matching them is not reading human text by regex (the 19.10 law). An
// unknown template reads as a neutral sentence; the raw text always travels
// beside it so the owner can open «подробнее» (components/MoreDetails).

export interface EngineText {
  /** What the owner reads. */
  text: string;
  /** The engine's own words, shown only inside «подробнее»; null for our own sentences. */
  raw: string | null;
  /** False when no template matched and `text` is the neutral fallback. */
  known: boolean;
}

/** A sentence the dashboard wrote itself: nothing to hide behind «подробнее». */
export function ownText(text: string): EngineText {
  return { text, raw: null, known: true };
}

function decimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return getLocale() === 'ru' ? text.replace('.', ',') : text;
}

/** A Go duration ("1m30s", "115s", "2500ms", "1h2m") in words, or null. */
export function durationWords(raw: string): string | null {
  const ms = /^(\d+(?:\.\d+)?)ms$/.exec(raw);
  if (ms !== null) {
    const value = Number(ms[1]);
    return value >= 1000
      ? t('{n} s', { n: decimal(value / 1000) })
      : t('{n} ms', { n: decimal(value) });
  }
  const go = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(raw);
  if (go === null || raw.length === 0) return null;
  const [, h, m, s] = go;
  const parts: string[] = [];
  if (h !== undefined) parts.push(t('{n} h', { n: Number(h) }));
  if (m !== undefined) parts.push(t('{n} min', { n: Number(m) }));
  if (s !== undefined && (Number(s) > 0 || parts.length === 0)) {
    parts.push(t('{n} s', { n: decimal(Number(s)) }));
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** A coarse age ("45m", "3h", "4d", from attention/elapsed) in words, or null. */
export function ageWords(raw: string): string | null {
  const match = /^(\d+)([mhd])$/.exec(raw);
  if (match === null) return null;
  const n = Number(match[1]);
  const unit = match[2];
  if (unit === 'm') return t('{n} min', { n });
  if (unit === 'h') return t('{n} h', { n });
  return t('{n} d', { n });
}

const REPAIR_REASONS: Readonly<Record<string, string>> = {
  merge_conflict: 'merge conflict',
  ci_failed: 'checks failed',
  ci_red: 'checks failed',
  review_changes: 'review asked for changes',
};

function stallDetail(detail: string): string | null {
  if (detail === 'no assignee') return t('nobody took it');
  if (detail === 'session ended') return t('the agent stopped');
  const quiet = /^no activity for (\S+)$/.exec(detail);
  if (quiet !== null) {
    const age = ageWords(quiet[1] ?? '');
    return age === null ? null : t('no activity for {age}', { age });
  }
  const gone = /^no live session for (.+)$/.exec(detail);
  if (gone !== null) return t('{who} is not running', { who: gone[1] ?? '' });
  return null;
}

type Row = (raw: string) => string | null;

const ROWS: readonly Row[] = [
  (raw) => {
    const m = /^order timeout of (\S+) exceeded/.exec(raw);
    const d = m === null ? null : durationWords(m[1] ?? '');
    return d === null ? null : t('The scheduled order did not finish within {d}', { d });
  },
  (raw) => {
    const m = /rig "([^"]+)" store[\s\S]*timeout after (\S+?)\s*$/.exec(raw);
    const d = m === null ? null : durationWords(m[2] ?? '');
    return m === null || d === null
      ? null
      : t('The {rig} task store did not answer within {d}', { rig: m[1] ?? '', d });
  },
  (raw) => (/^Gate: gh:pr$/.test(raw) ? t('waits for the PR to merge') : null),
  (raw) => {
    const m = /^Repair PR #(\d+): ([a-z_]+)$/.exec(raw);
    if (m === null) return null;
    const reason = REPAIR_REASONS[m[2] ?? ''];
    return reason === undefined
      ? t('Repair PR #{n}', { n: m[1] ?? '' })
      : t('Repair PR #{n}: {reason}', { n: m[1] ?? '', reason: t(reason) });
  },
  (raw) => {
    const m = /^Repair PR #(\d+) on \S+$/.exec(raw);
    return m === null ? null : t('Repairing PR #{n}', { n: m[1] ?? '' });
  },
  (raw) => {
    const m = /^merged into (\S+) at [0-9a-f]/.exec(raw);
    return m === null ? null : t('merged into {branch}', { branch: m[1] ?? '' });
  },
  (raw) => {
    const m = /^stalled (?:(\S+) )?— (.+)$/.exec(raw);
    if (m === null) return null;
    const detail = stallDetail(m[2] ?? '');
    if (detail === null) return null;
    if (m[1] === undefined) return t('stalled, {detail}', { detail });
    const age = ageWords(m[1]);
    return age === null ? null : t('stalled {age}, {detail}', { age, detail });
  },
  (raw) => {
    const m = /^Nobody has taken it for (\d+) days?$/.exec(raw);
    return m === null
      ? null
      : t('nobody takes it for {age}', { age: t('{n} d', { n: Number(m[1]) }) });
  },
  (raw) => {
    const m = /^timed out after (\S+)$/.exec(raw);
    const d = m === null ? null : durationWords(m[1] ?? '');
    return d === null ? null : t('did not answer within {d}', { d });
  },
];

export function explainEngineText(raw: string): EngineText {
  const trimmed = raw.trim();
  for (const row of ROWS) {
    const text = row(trimmed);
    if (text !== null) return { text, raw, known: true };
  }
  return { text: t('The city reported an error'), raw, known: false };
}
