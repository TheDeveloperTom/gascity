import { t } from '../i18n';
import type { SupervisorBead } from '../supervisor/beadReads';

// A card the Mayor paused (owner 17.11). `gc devwork hold` sets the label
// `hold:mayor` (or `hold:external`) and writes `devwork.pause_reason` as
// «<who>, <UTC time>: <reason>»; the bead keeps its status, so an in-progress
// card stays in_progress while nothing runs on it. The board reads the label
// as «waits, paused», never as a stopped run. `hold:plan` (no approved plan)
// and `hold:cleared` (the pause lifted) are not a pause.

const HOLD_PREFIX = 'hold:';
const NOT_A_PAUSE: ReadonlySet<string> = new Set(['plan', 'cleared']);
export const PAUSE_REASON_KEY = 'devwork.pause_reason';
/** «<who>, <when>: <reason>»: the first «: » (colon + space) ends the time; an ISO time has none. */
const REASON_SHAPE = /^([^,]+),\s*(.+?):\s+([\s\S]+)$/u;
const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/u;

export interface PauseInfo {
  /** The `<v>` of the `hold:<v>` label («mayor», «external»). */
  hold: string;
  who: string | null;
  /** «16.11 08:12 UTC» for an ISO time, else the time as written. */
  when: string | null;
  /** The human part of `devwork.pause_reason`, or the whole value when it has no «who, when:» prefix. */
  reason: string | null;
}

function shortTime(raw: string): string {
  const m = ISO_TIME.exec(raw);
  return m === null ? raw : `${m[3]}.${m[2]} ${m[4]}:${m[5]} UTC`;
}

/** The card's pause, or null when no `hold:*` label (other than plan / cleared) is on it. */
export function pauseOf(bead: SupervisorBead): PauseInfo | null {
  let hold: string | null = null;
  for (const label of bead.labels ?? []) {
    const trimmed = label.trim();
    if (!trimmed.startsWith(HOLD_PREFIX)) continue;
    const value = trimmed.slice(HOLD_PREFIX.length).trim().toLowerCase();
    if (value.length === 0 || NOT_A_PAUSE.has(value)) continue;
    hold = value;
    break;
  }
  if (hold === null) return null;
  const raw = bead.metadata?.[PAUSE_REASON_KEY]?.trim() ?? '';
  if (raw.length === 0) return { hold, who: null, when: null, reason: null };
  const m = REASON_SHAPE.exec(raw);
  if (m === null) return { hold, who: null, when: null, reason: raw };
  return { hold, who: (m[1] ?? '').trim(), when: shortTime((m[2] ?? '').trim()), reason: (m[3] ?? '').trim() };
}

function whoWhen(p: PauseInfo): string {
  return [p.who, p.when].filter((s): s is string => s !== null && s.length > 0).join(', ');
}

/** «<reason> (<who>, <when>)»: the drawer's line after «На паузе:». */
export function pauseSummary(p: PauseInfo): string {
  const reason = p.reason ?? `${HOLD_PREFIX}${p.hold}`;
  const by = whoWhen(p);
  return by.length > 0 ? `${reason} (${by})` : reason;
}

/** The card chip's tooltip: the reason, then who paused it and when. */
export function pauseTooltip(p: PauseInfo): string {
  const lines = [p.reason ?? t('Paused, no reason given')];
  if (p.who !== null || p.when !== null) {
    lines.push(t('Paused by {who}, {when}', { who: p.who ?? '?', when: p.when ?? '?' }));
  }
  lines.push(`${HOLD_PREFIX}${p.hold}`);
  return lines.join('\n');
}
