import type { ReactNode } from 'react';
import { canWrite } from '../../embed/activitySession';
import { t } from '../../i18n';
import { asOfClock } from '../../lib/boardOwner';
import { renderMiniMarkdown } from '../../lib/miniMarkdown';
import { safeExternalUrl } from '../../lib/stageBoard';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { ExternalLink } from '../ExternalLink';
import { PEER_COLOR, PeerAvatar, PROJECT_COLOR } from '../board/PeerKanbanCard';
import { Chip, statusLabel, TaskDrawer } from './TaskDrawer';

// vk-final part 3: a peer's card, opened (design Peer-Card / Phone-Peer-Card).
// It renders from the snapshot only: it never reads /bead/{id} or writes to
// our API, because our card with the same id is a different card (SYNC-PLAN
// Q5). No discuss, no answer, no close: «Менять её может Ричард».

export interface PeerTaskDrawerProps {
  open: boolean;
  onClose: () => void;
  bead: SupervisorBead;
  rig: string;
  /** «Ричард» */
  name: string;
  /** «Ричарда» */
  label: string;
  avatar: string;
  asOf: string;
  stale: boolean;
  /** The comments thread (vk-final part 4). */
  children?: ReactNode;
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function PeerTaskDrawer({
  open,
  onClose,
  bead,
  rig,
  name,
  label,
  avatar,
  asOf,
  stale,
  children,
}: PeerTaskDrawerProps) {
  const prNumber = bead.metadata?.['devwork.pr_number']?.trim() ?? '';
  const prUrl = safeExternalUrl(bead.metadata?.['devwork.pr_url']?.trim() ?? '');
  const clock = asOfClock(asOf);
  const chips = (
    <span className="flex min-w-0 items-center gap-1 font-vk-mono text-[15px] text-vk-text-normal">
      <span>{name}</span>
      <span className="text-vk-text-low">/</span>
      <span className="min-w-0 truncate">{rig}</span>
      <span role="img" aria-label={t('read only')} className="ml-1 flex text-vk-text-low">
        <LockIcon />
      </span>
    </span>
  );

  return (
    <TaskDrawer open={open} onClose={onClose} chips={chips} title={bead.title} aboveTabs>
      <div data-testid="peer-card" className="-mt-2 flex flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-1">
          <Chip>
            <span aria-hidden="true" className="mr-1.5 h-2 w-2 rounded-full bg-vk-text-low" />
            {statusLabel(bead.status)}
          </Chip>
          <Chip>
            <span className="mr-1.5">
              <PeerAvatar letter={avatar} />
            </span>
            {label}
          </Chip>
          <Chip>
            <span aria-hidden="true" className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: PROJECT_COLOR }} />
            {rig}
          </Chip>
          {clock.length > 0 && (
            <span
              title={t("Data from {owner} city as of this time", { owner: label })}
              className={stale ? 'px-1.5 text-[13px] text-warn' : 'px-1.5 text-[13px] text-vk-text-low'}
            >
              {t('as of {time}', { time: clock })}
            </span>
          )}
          {prNumber.length > 0 &&
            (prUrl !== null ? (
              <ExternalLink href={prUrl} className="px-1 font-vk-mono text-[13px] text-vk-text-low focus-mark hover:text-vk-text-high">
                {`#${prNumber}`}
              </ExternalLink>
            ) : (
              <span className="px-1 font-vk-mono text-[13px] text-vk-text-low">{`#${prNumber}`}</span>
            ))}
        </div>
        <p className="text-sm text-vk-text-low" style={{ borderLeft: `2px solid ${PEER_COLOR}`, paddingLeft: 8 }}>
          {canWrite()
            ? t('A task from {owner} city, read only. Only {name} can change it; you can leave a comment.', {
                owner: label,
                name,
              })
            : t('A task from {owner} city, read only. Only {name} can change it.', { owner: label, name })}
        </p>
        {bead.description !== undefined && bead.description.length > 0 && (
          <div className="text-[15px] text-vk-text-normal [overflow-wrap:anywhere]">
            {renderMiniMarkdown(bead.description)}
          </div>
        )}
        {children}
      </div>
    </TaskDrawer>
  );
}
