import { useMemo } from 'react';
import type { BeadAttentionSession } from '../../attention/beadsNeedingAttention';
import { useAgentNow } from '../../hooks/useAgentNow';
import { t } from '../../i18n';
import { sessionForBead } from '../../lib/agentNow';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { ExternalLink } from '../ExternalLink';
import type { TaskPr } from './drawerFacts';

// «Работа агентов N» (vk-1to1, canvas Main right panel): one bg-panel card per
// live run — «Исполнитель пишет код» + running dots, «#580 · обновлено
// сейчас», a filled «Смотреть, что пишет» — and a dashed card per queued run
// («в очереди, начнётся после текущей сессии»).

export interface QueuedRun {
  id: string;
  title: string;
}

export interface AgentWorkProps {
  bead: SupervisorBead;
  sessions: readonly BeadAttentionSession[];
  /** Present when the bead's session can stream (isSessionStreamable). */
  onWatch?: () => void;
  pr?: TaskPr | null;
  /** Runs waiting for the current session (e.g. review rounds). */
  queued?: readonly QueuedRun[];
}

/** «обновлено сейчас» / «обновлено 5 мин назад» from an ISO time. */
export function updatedText(iso: string | null | undefined, nowMs: number = Date.now()): string | null {
  if (iso === null || iso === undefined) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const min = Math.floor(Math.max(0, nowMs - at) / 60_000);
  if (min < 1) return t('updated just now');
  if (min < 60) return t('updated {n} min ago', { n: min });
  return t('updated {n} h ago', { n: Math.floor(min / 60) });
}

function RunningDots() {
  return (
    <span aria-hidden="true" className="inline-flex gap-[3px]">
      <span className="h-1 w-1 rounded-full bg-vk-brand" />
      <span className="h-1 w-1 rounded-full bg-vk-brand opacity-60" />
      <span className="h-1 w-1 rounded-full bg-vk-brand opacity-30" />
    </span>
  );
}

export function AgentWork({ bead, sessions, onWatch, pr = null, queued = [] }: AgentWorkProps) {
  const session = useMemo(() => sessionForBead(bead, sessions), [bead, sessions]);
  const ids = useMemo(() => (session ? [session.id] : []), [session]);
  const now = useAgentNow(ids);
  const assignee = bead.assignee?.trim() ?? '';
  const read = session ? now.get(session.id) : undefined;
  const who = session?.alias ?? session?.session_name ?? assignee;
  const live = session !== null || assignee.length > 0;
  const count = (live ? 1 : 0) + queued.length;
  const doing =
    session === null
      ? null
      : read === undefined
        ? t('Reading what it does…')
        : read === 'unknown'
          ? t('Unknown right now')
          : read.text;
  const updated = updatedText(
    read !== undefined && read !== 'unknown' ? read.sinceIso : session?.last_active,
  );

  return (
    <section data-testid="agent-work" className="flex flex-col gap-2">
      <div className="flex items-center justify-between py-1">
        <h3 className="text-sm font-medium text-vk-text-high">{t('Agent work')}</h3>
        {count > 0 && <span className="text-sm text-vk-text-low">{count}</span>}
      </div>
      {count === 0 && <p className="text-sm text-vk-text-low">{t('No agent is on this task.')}</p>}
      {live && (
        <div className="flex min-w-0 flex-col gap-1 rounded-sm bg-vk-bg-panel p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 text-sm font-medium text-vk-text-high [overflow-wrap:anywhere]">
              {doing === null ? who : `${who} · ${doing}`}
            </span>
            {session !== null && <RunningDots />}
          </div>
          {(pr !== null || updated !== null) && (
            <div className="flex items-center gap-1.5 text-xs text-vk-text-low">
              {pr !== null &&
                (pr.url !== null ? (
                  <ExternalLink href={pr.url} className="px-0.5 font-vk-mono text-[13px] text-vk-text-low">
                    #{pr.number}
                  </ExternalLink>
                ) : (
                  <span className="px-0.5 font-vk-mono text-[13px]">#{pr.number}</span>
                ))}
              {updated}
            </div>
          )}
          {onWatch && (
            <div className="pt-1">
              <button
                type="button"
                onClick={onWatch}
                className="inline-flex h-11 items-center rounded-sm bg-[#AC5111] px-2 text-base text-white hover:bg-[#963F0A] focus-mark md:h-8"
              >
                {t('Watch what it writes')}
              </button>
            </div>
          )}
        </div>
      )}
      {queued.map((run) => (
        <div
          key={run.id}
          data-testid="agent-queued"
          className="flex flex-col gap-1 rounded-sm border border-dashed border-vk-border p-2"
        >
          <span className="text-sm font-medium text-vk-text-high [overflow-wrap:anywhere]">{run.title}</span>
          <span className="text-xs text-vk-text-low">{t('queued, starts after the current session')}</span>
        </div>
      ))}
    </section>
  );
}
