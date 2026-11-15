import { useMemo } from 'react';
import type { BeadAttentionSession } from '../../attention/beadsNeedingAttention';
import { useAgentNow } from '../../hooks/useAgentNow';
import { t } from '../../i18n';
import { sessionForBead } from '../../lib/agentNow';
import type { SupervisorBead } from '../../supervisor/beadReads';

// «Работа агентов» (vk lane 2): who is on the task and what it is doing now
// (useAgentNow / describeAgentNow, dashboard v3 V6). «Смотреть, что пишет»
// opens the caller's live-run modal when the session can stream.

export interface AgentWorkProps {
  bead: SupervisorBead;
  sessions: readonly BeadAttentionSession[];
  /** Present when the bead's session can stream (isSessionStreamable). */
  onWatch?: () => void;
}

export function AgentWork({ bead, sessions, onWatch }: AgentWorkProps) {
  const session = useMemo(() => sessionForBead(bead, sessions), [bead, sessions]);
  const ids = useMemo(() => (session ? [session.id] : []), [session]);
  const now = useAgentNow(ids);
  const assignee = bead.assignee?.trim() ?? '';
  const read = session ? now.get(session.id) : undefined;

  return (
    <section className="flex flex-col gap-1">
      <h3 className="py-1 text-sm font-medium text-vk-text-high">{t('Agent work')}</h3>
      {session === null && assignee.length === 0 ? (
        <p className="text-sm text-vk-text-low">{t('No agent is on this task.')}</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1 rounded-sm bg-vk-bg-secondary px-3 py-2">
          <span className="font-vk-mono text-sm text-vk-text-high [overflow-wrap:anywhere]">
            {session?.alias ?? session?.session_name ?? assignee}
          </span>
          {session !== null && (
            <span className="text-sm text-vk-text-normal [overflow-wrap:anywhere]">
              {read === undefined
                ? t('Reading what it does…')
                : read === 'unknown'
                  ? t('Unknown right now')
                  : read.text}
            </span>
          )}
          {onWatch && (
            <button
              type="button"
              onClick={onWatch}
              className="mt-1 inline-flex min-h-[44px] items-center self-start rounded-sm px-2 text-sm text-vk-text-high hover:bg-vk-bg-panel focus-mark"
            >
              {t('Watch what it writes')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
