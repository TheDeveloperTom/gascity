import { t, tn } from '../i18n';
import type { BeadRowParts, StallCause } from './beadsNeedingAttention';

// Attention row summaries in the viewer's language (review I5). The selector
// keeps its English `summary` for the board cards; the attention layer
// phrases the same facts here, every word through t()/tn().

const HOUR_MS = 60 * 60 * 1000;

/** "5 hours", "4 days": the same rounding as formatElapsed, in words. */
export function elapsedWords(ms: number): string {
  const hours = Math.max(1, Math.round(ms / HOUR_MS));
  if (hours < 48) return tn(hours, { one: '{n} hour', other: '{n} hours' });
  const days = Math.round(hours / 24);
  return tn(days, { one: '{n} day', other: '{n} days' });
}

function actorName(who: string): string {
  switch (who) {
    case 'mayor':
      return t('Mayor');
    case 'external':
      return t('someone outside the city');
    default:
      return who;
  }
}

function causeWords(cause: StallCause): string {
  switch (cause.kind) {
    case 'no-assignee':
      return t('nobody is on it');
    case 'no-session':
      return t('{who} has no live session', { who: cause.assignee });
    case 'session-ended':
      return t('the session ended');
    case 'session-state':
      return t('the session is {state}', { state: cause.state });
    case 'inactive':
      return t('no activity for {age}', { age: elapsedWords(cause.ms) });
  }
}

export function beadRowSummary(parts: BeadRowParts): string {
  switch (parts.reason) {
    case 'escalated':
      return t('Asks for help');
    case 'ready-unclaimed':
      return t('Nobody has taken it for {age}', { age: elapsedWords(parts.ageMs) });
    case 'waiting-human': {
      if (parts.toOwner === true) {
        return parts.waitMs === null
          ? t('Waiting on you')
          : t('Waiting on you for {age}', { age: elapsedWords(parts.waitMs) });
      }
      if (parts.who === null) {
        return parts.waitMs === null
          ? t('On hold')
          : t('On hold for {age}', { age: elapsedWords(parts.waitMs) });
      }
      const who = actorName(parts.who);
      return parts.waitMs === null
        ? t('Waiting on {who}', { who })
        : t('Waiting on {who} for {age}', { who, age: elapsedWords(parts.waitMs) });
    }
    case 'stalled': {
      const cause = causeWords(parts.cause);
      const line =
        parts.ageMs === null
          ? t('Stalled: {cause}', { cause })
          : t('Stalled for {age}: {cause}', { age: elapsedWords(parts.ageMs), cause });
      return parts.step === undefined ? line : `${parts.step}: ${line}`;
    }
  }
}
