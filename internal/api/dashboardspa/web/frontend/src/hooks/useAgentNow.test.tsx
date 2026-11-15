import { act, cleanup, render } from '@testing-library/react';
import type { SessionTranscriptGetResponse } from 'gas-city-dashboard-shared/gc-supervisor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n';
import {
  resetSupervisorApiForTests,
  setSupervisorApiForTests,
  type SupervisorApi,
} from '../supervisor/client';
import type { AgentNow } from '../lib/agentNow';
import { AGENT_NOW_MAX_READS, AGENT_NOW_REFRESH_MS, useAgentNow } from './useAgentNow';

function structured(sessionId: string, unavailable = false): SessionTranscriptGetResponse {
  return {
    format: 'structured',
    schema_version: 'session.structured.v1',
    operation: 'snapshot',
    id: sessionId,
    template: 'worker',
    provider: 'claude',
    history: {
      continuity: { status: 'continuous' },
      cursor: { resume_token: 't' },
      generation: { id: 'g' },
      tail_state: { activity: 'idle' },
      transcript_stream_id: 's',
      ...(unavailable ? { diagnostics: [{ code: 'transcript_unavailable' }] } : {}),
    },
    structured_messages: unavailable
      ? []
      : [
          {
            role: 'assistant',
            id: `m-${sessionId}`,
            status: 'final',
            timestamp: '2026-11-15T12:00:00Z',
            blocks: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: { kind: 'command', command: 'npm test', description: `run ${sessionId}` },
              },
            ],
          },
        ],
  } as unknown as SessionTranscriptGetResponse;
}

let inFlight = 0;
let maxInFlight = 0;
const calls: { id: string; format: string | undefined; tail: number | undefined }[] = [];

function installApi(unavailableIds: ReadonlySet<string> = new Set()) {
  const api = {
    sessionTranscript: vi.fn(
      async (_city: string, id: string, format?: string, options?: { tail?: number }) => {
        calls.push({ id, format, tail: options?.tail });
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return structured(id, unavailableIds.has(id));
      },
    ),
  } as unknown as SupervisorApi;
  setSupervisorApiForTests(api);
}

let latest: ReadonlyMap<string, AgentNow | 'unknown'> = new Map();
function Probe({ ids }: { ids: readonly string[] }) {
  latest = useAgentNow(ids);
  return null;
}

async function flush() {
  for (let i = 0; i < 40; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  setLocale('ru');
  inFlight = 0;
  maxInFlight = 0;
  calls.length = 0;
  latest = new Map();
});

afterEach(() => {
  cleanup();
  resetSupervisorApiForTests();
  setLocale('en');
  vi.useRealTimers();
});

describe('useAgentNow', () => {
  it('agent now falls back and caps reads', async () => {
    installApi(new Set(['s-2']));
    const ids = Array.from({ length: 15 }, (_, i) => `s-${i}`);
    render(<Probe ids={ids} />);
    await flush();

    expect(AGENT_NOW_MAX_READS).toBe(12);
    expect(AGENT_NOW_REFRESH_MS).toBe(30_000);
    expect(calls).toHaveLength(12);
    expect(maxInFlight).toBe(1);
    expect(calls.every((c) => c.format === 'structured' && c.tail === 1)).toBe(true);
    expect(latest.get('s-0')).toEqual({
      text: 'run s-0',
      sinceIso: '2026-11-15T12:00:00Z',
      raw: 'npm test',
    });
    expect(latest.get('s-2')).toBe('unknown');
    expect(latest.get('s-14')).toBe('unknown');

    await act(async () => {
      vi.advanceTimersByTime(29_000);
    });
    await flush();
    expect(calls).toHaveLength(12);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await flush();
    expect(calls).toHaveLength(24);
    expect(maxInFlight).toBe(1);
  });

  it('a failed read gives unknown', async () => {
    setSupervisorApiForTests({
      sessionTranscript: vi.fn(async () => {
        throw new Error('timed out after 2500ms');
      }),
    } as unknown as SupervisorApi);
    render(<Probe ids={['s-x']} />);
    await flush();
    expect(latest.get('s-x')).toBe('unknown');
  });
});
