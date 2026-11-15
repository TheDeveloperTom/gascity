import { t } from '../i18n';

// What a supervisor event means, in a sentence. The events table keeps the
// raw type (AC-05); attention rows lead with this and show the type as a ref.
const EVENT_TITLES: Readonly<Record<string, string>> = {
  'agent.claims_stalled': 'An agent claimed work and stopped moving',
  'gc.store.maintenance.failed': 'Task store maintenance failed',
  'order.failed': 'A scheduled order failed',
  'request.failed': 'A request to the city failed',
  'session.crashed': 'An agent session crashed',
  'session.stranded': 'An agent session ended and left work behind',
  'session.work_query_failed': 'An agent could not look up its work',
  'supervisor.shutdown_requested': 'The supervisor was asked to shut down',
  'events.rotated': 'The event log was rotated',
  'session.quarantined': 'An agent session was quarantined',
  'session.suspended': 'An agent session was suspended',
  'supervisor.fs_pressure.skipped_tick': 'The supervisor skipped a tick: disk is under pressure',
};

export function eventTitle(type: string): string {
  const title = EVENT_TITLES[type];
  return title === undefined ? type : t(title);
}
