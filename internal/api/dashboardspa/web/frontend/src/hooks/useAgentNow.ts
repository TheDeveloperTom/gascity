import { useEffect, useMemo, useState } from 'react';
import type { SessionStructuredMessage } from 'gas-city-dashboard-shared/gc-supervisor';
import { getActiveCity } from '../api/cityBase';
import { describeAgentNow, type AgentNow } from '../lib/agentNow';
import { supervisorApi } from '../supervisor/client';

// «Сейчас» for several agents (dashboard v3, V6). Reads are cheap but a busy
// Mac is not: at most AGENT_NOW_MAX_READS sessions, one read at a time, a new
// pass every AGENT_NOW_REFRESH_MS. A session past the cap, a failed read, or a
// transcript the server could not provide reads as 'unknown'.

export const AGENT_NOW_MAX_READS = 12;
export const AGENT_NOW_REFRESH_MS = 30_000;
const UNAVAILABLE_CODE = 'transcript_unavailable';

async function readNow(city: string, sessionId: string): Promise<AgentNow | 'unknown'> {
  try {
    const transcript = await supervisorApi().sessionTranscript(city, sessionId, 'structured', {
      tail: 1,
    });
    if (transcript.format !== 'structured') return 'unknown';
    const diagnostics = transcript.history?.diagnostics ?? [];
    if (diagnostics.some((d) => d.code === UNAVAILABLE_CODE)) return 'unknown';
    const messages: readonly SessionStructuredMessage[] = Array.isArray(
      transcript.structured_messages,
    )
      ? transcript.structured_messages
      : [];
    return describeAgentNow(messages) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function useAgentNow(
  sessionIds: readonly string[],
): ReadonlyMap<string, AgentNow | 'unknown'> {
  const idsKey = sessionIds.join('\n');
  const ids = useMemo(() => (idsKey.length === 0 ? [] : idsKey.split('\n')), [idsKey]);
  const [read, setRead] = useState<ReadonlyMap<string, AgentNow | 'unknown'>>(() => new Map());

  useEffect(() => {
    const city = getActiveCity();
    const targets = ids.slice(0, AGENT_NOW_MAX_READS);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (city === null || targets.length === 0) return undefined;

    const pass = async () => {
      for (const id of targets) {
        if (cancelled) return;
        const now = await readNow(city, id);
        if (cancelled) return;
        setRead((prev) => {
          const next = new Map(prev);
          next.set(id, now);
          return next;
        });
      }
      if (!cancelled) timer = setTimeout(() => void pass(), AGENT_NOW_REFRESH_MS);
    };
    void pass();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [ids]);

  return useMemo(() => {
    const out = new Map<string, AgentNow | 'unknown'>();
    ids.forEach((id, index) => {
      if (index >= AGENT_NOW_MAX_READS) {
        out.set(id, 'unknown');
        return;
      }
      const value = read.get(id);
      if (value !== undefined) out.set(id, value);
    });
    return out;
  }, [ids, read]);
}
