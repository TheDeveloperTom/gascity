import { describe, expect, it } from 'vitest';
import type { TypedEventStreamEnvelope } from 'gas-city-dashboard-shared/gc-supervisor';
import { eventDetailCell } from './Activity';

// R14: Activity hides the Detail cell when it only repeats the Subject.
// supervisorEventDetail reads message, then subject, then type.

function envelope(fields: Partial<TypedEventStreamEnvelope>): TypedEventStreamEnvelope {
  return {
    seq: 1,
    type: 'bead.closed',
    ts: '2026-11-15T00:19:00Z',
    actor: 'supervisor',
    ...fields,
  } as TypedEventStreamEnvelope;
}

describe('eventDetailCell', () => {
  it('is empty when the detail repeats the subject', () => {
    expect(eventDetailCell(envelope({ subject: 'gcg-231164' }))).toBe('');
  });

  it('is empty when the message equals the subject', () => {
    expect(eventDetailCell(envelope({ subject: 'gc-12', message: 'gc-12' }))).toBe('');
  });

  it('keeps a distinct message', () => {
    expect(eventDetailCell(envelope({ subject: 'gc-12', message: 'exit 137' }))).toBe('exit 137');
  });

  it('keeps the type when there is neither message nor subject', () => {
    expect(eventDetailCell(envelope({ type: 'molecule.resolved' }))).toBe('molecule.resolved');
  });
});
