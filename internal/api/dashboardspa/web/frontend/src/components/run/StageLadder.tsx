import type { RunStage } from 'gas-city-dashboard-shared';

// The dashboard-derived phase ladder rendered as a glyph + word row.
// Extracted from LaneCard (gascity-dashboard-ud6j) so the run-detail view
// and the RunMap lane share one render and one set of visual tokens — the
// stages themselves come from the SAME backend pipeline, so they must look
// identical wherever they appear. Reads in greyscale: stage identity comes
// from order + label + glyph, not color (DESIGN.md "States have words").

const STAGE_GLYPH: Record<RunStage['status'], string> = {
  pending: '·',
  active: '⬣',
  complete: '◆',
  blocked: '✕',
};

const STAGE_TONE: Record<RunStage['status'], string> = {
  pending: 'text-fg-faint',
  active: 'text-fg',
  complete: 'text-fg-muted',
  // Warm-amber tint reserved for blocked status only (DESIGN.md).
  blocked: 'text-accent',
};

const STAGE_WORD_TONE: Record<RunStage['status'], string> = {
  pending: 'text-fg-muted',
  active: 'text-fg',
  complete: 'text-fg-muted',
  blocked: 'text-accent',
};

interface StageLadderProps {
  stages: RunStage[];
  label: string;
}

// Chip fill per status: the active stage reads as "you are here", the
// blocked stage carries the alarm tint, finished and pending stay quiet.
const STAGE_CHIP: Record<RunStage['status'], string> = {
  pending: 'border-rule',
  active: 'border-fg/25 bg-surface-tint font-semibold',
  complete: 'border-transparent bg-fg/[0.06]',
  blocked: 'border-accent/40 bg-accent/10',
};

export function StageLadder({ stages, label }: StageLadderProps) {
  if (stages.length === 0) return null;
  return (
    <ol className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label={`${label} stages`}>
      {stages.map((stage) => (
        <li
          key={stage.key}
          className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-label ${STAGE_CHIP[stage.status]} ${STAGE_TONE[stage.status]}`}
          title={`${stage.label}: ${stage.status}`}
        >
          <span aria-hidden="true" className="leading-none">
            {STAGE_GLYPH[stage.status]}
          </span>{' '}
          <span className={`min-w-0 truncate ${STAGE_WORD_TONE[stage.status]}`}>{stage.label}</span>
        </li>
      ))}
    </ol>
  );
}
