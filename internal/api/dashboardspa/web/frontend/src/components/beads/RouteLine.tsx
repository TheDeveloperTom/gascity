import { t } from '../../i18n';
import { STAGES, type StageId } from '../../lib/stageBoard';

// The route line (RB9, design pass 1 «Маршрут»): five stops of one route, in
// ink only. A filled dot means the stop holds cards, a ring that it is empty.
// Names and counts are set in the narrow display face, as on a route sign.
// Each stop links to its track, so on a phone the line is also the index.

/** The board's grid: the route line and the tracks share it (pass 1). */
export const BOARD_GRID =
  'lg:grid-cols-[minmax(0,1.35fr)_repeat(3,minmax(0,1fr))_minmax(0,1.15fr)]';

export function RouteLine({ counts }: { counts: Readonly<Record<StageId, number>> }) {
  return (
    <ol aria-label={t('Stages')} className={`grid grid-cols-5 gap-x-2 lg:gap-x-6 ${BOARD_GRID}`}>
      {STAGES.map((stage, index) => {
        const count = counts[stage.id];
        const filled = count > 0;
        const last = index === STAGES.length - 1;
        const merged = stage.id === 'merged';
        return (
          <li key={stage.id} className="relative min-w-0">
            {!last && (
              <span
                aria-hidden="true"
                className="absolute left-1.5 top-[5px] h-0.5 w-[calc(100%+0.5rem)] bg-fg lg:w-[calc(100%+1.5rem)]"
              />
            )}
            <a
              href={`#stage-${stage.id}`}
              aria-label={`${t(stage.label)}: ${count}`}
              className="relative block rounded-sm focus-mark"
            >
              <span
                aria-hidden="true"
                data-filled={filled ? 'true' : 'false'}
                className={`relative z-10 block h-3 w-3 rounded-full ${
                  filled ? 'bg-fg' : 'border-2 border-fg bg-surface'
                }`}
              />
              <span className="mt-2 block truncate font-display text-[1rem] font-bold leading-5 text-fg lg:text-[1.25rem] lg:leading-6">
                {t(stage.label)}
              </span>
              <span
                className={`block font-display text-[1.5rem] font-bold leading-7 tnum lg:text-[2rem] lg:leading-9 ${
                  merged ? 'text-fg-muted' : 'text-fg'
                }`}
              >
                {count}
              </span>
              {merged && <span className="block text-label text-fg-faint">{t('recent')}</span>}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
