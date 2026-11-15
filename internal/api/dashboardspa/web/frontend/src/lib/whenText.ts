import { getLocale, t } from '../i18n';

// «влито сегодня в 00:10» (B6): today and yesterday by the calendar day in
// the zone, otherwise a short date. Times are 24-hour.

function dayKey(ms: number, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(new Date(ms));
}

export function formatWhen(iso: string, nowMs: number, timeZone?: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return iso;
  const zone = timeZone === undefined ? {} : { timeZone };
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...zone,
  }).format(new Date(at));
  const day = dayKey(at, timeZone);
  if (day === dayKey(nowMs, timeZone)) return t('today at {time}', { time });
  // Noon of today minus a day lands on yesterday whatever the DST shift.
  const noonToday = Date.parse(`${dayKey(nowMs, timeZone)}T12:00:00Z`);
  if (day === dayKey(noonToday - 86_400_000, timeZone)) {
    return t('yesterday at {time}', { time });
  }
  return new Intl.DateTimeFormat(getLocale() === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'short',
    ...zone,
  }).format(new Date(at));
}
