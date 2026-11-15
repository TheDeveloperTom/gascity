import type { AttentionItem } from '../../attention/compose';
import { FoldList } from '../FoldList';

// gascity-dashboard-2j8e.3: the /beads "Needs you" section — the on-page
// counterpart of the Beads nav badge. It renders the badge-counting attention
// items (attention + watch tiers, the same `summary.attention + summary.watch`
// the nav indicator shows), so the page count and the nav badge cannot
// disagree, and gives each item a path to act: Open the escalation / decision /
// ready-unclaimed bead to act on it. The operator does not claim beads — a bead
// assignee must be a concrete session, never the human operator
// (gascity-dashboard-2j8e.8) — so there is no inline Claim affordance.
//
// RB14: the panel is a small enamel plate, because after Task 11 it holds
// only what waits for the owner and enamel means «вам». The list folds after FOLD_LIMIT rows behind
// "Show all N", so a long escalation queue does not push the board off the
// page. The count in the heading always reports the full total.

const FOLD_LIMIT = 5;

interface BeadAttentionPanelProps {
  /** The beads-domain attention items from the composed model (any severity). */
  items: readonly AttentionItem[];
  onOpen: (beadId: string) => void;
}

/** Extract the `bead` query param from an attention item's `/beads?bead=…` href. */
export function beadIdFromHref(href: string | undefined): string | null {
  if (href === undefined) return null;
  const queryStart = href.indexOf('?');
  if (queryStart < 0) return null;
  const beadId = new URLSearchParams(href.slice(queryStart + 1)).get('bead');
  return beadId !== null && beadId.length > 0 ? beadId : null;
}

export function BeadAttentionPanel({ items, onOpen }: BeadAttentionPanelProps) {
  // Rows are the badge items (attention + watch), red ones first: the
  // per-domain list arrives in contributor order, so a stable sort keeps the
  // fold from hiding the red rows behind "Show all" (final review I-1).
  const counted = [
    ...items.filter((item) => item.severity === 'attention'),
    ...items.filter((item) => item.severity === 'watch'),
  ];
  if (counted.length === 0) return null;

  // "Needs you" means one number everywhere (ruling C1, final review I-2):
  // attention only. Watch items get their own quiet count, like the Home
  // board and the amber rail pill.
  const needsYou = counted.filter((item) => item.severity === 'attention').length;
  const toWatch = counted.length - needsYou;
  return (
    <section
      aria-labelledby="beads-attention-title"
      className="mb-8 overflow-hidden rounded-plate bg-plate text-on-plate ring-2 ring-inset ring-on-plate/90 [&_button]:text-on-plate"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-on-plate/25 px-4 py-3">
        <h2
          id="beads-attention-title"
          className="font-display text-headline font-bold text-on-plate"
        >
          Needs you <span className="tnum text-on-plate-muted">({needsYou})</span>
        </h2>
        {toWatch > 0 && <p className="text-body text-on-plate-muted tnum">{toWatch} to watch</p>}
      </div>
      <FoldList
        items={counted}
        limit={FOLD_LIMIT}
        itemKey={(item) => item.id}
        className="divide-y divide-on-plate/25"
        renderItem={(item) => {
          const beadId = beadIdFromHref(item.href);
          return (
            <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                {/* On the plate the enamel carries the signal (RB14); the title is white. */}
                <p className="text-body font-semibold text-on-plate [overflow-wrap:anywhere]">
                  {item.title}
                </p>
                {item.summary !== undefined && (
                  <p className="text-body text-on-plate-muted [overflow-wrap:anywhere]">
                    {item.summary}
                  </p>
                )}
              </div>
              {beadId !== null && (
                <button
                  type="button"
                  onClick={() => onOpen(beadId)}
                  className="focus-mark inline-flex h-8 shrink-0 items-center rounded border border-on-plate/80 px-3 text-label font-semibold text-on-plate hover:bg-on-plate/10"
                >
                  Open
                </button>
              )}
            </li>
          );
        }}
      />
    </section>
  );
}
