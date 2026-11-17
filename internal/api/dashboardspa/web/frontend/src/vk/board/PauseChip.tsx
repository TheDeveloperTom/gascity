import { t } from '../../i18n';
import { pauseTooltip, type PauseInfo } from '../../lib/pause';
import { KanbanBadge } from './KanbanBadge';

// owner 17.11: a card the Mayor paused shows «⏸ На паузе» (tooltip: the
// reason, who and when) and the reason as a quiet second line.

export function PauseChip({ pause }: { pause: PauseInfo }) {
  return <KanbanBadge name={t('⏸ Paused')} title={pauseTooltip(pause)} />;
}

export function PauseLine({ pause }: { pause: PauseInfo }) {
  if (pause.reason === null) return null;
  return (
    <div data-pause-reason="" title={pauseTooltip(pause)} className="min-w-0 truncate text-sm text-vk-text-low">
      {pause.reason}
    </div>
  );
}
