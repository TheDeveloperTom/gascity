import type { AttentionItem } from '../../attention/compose';
import { Button } from '../Button';
import { FoldList } from '../FoldList';
import { StatusBadge } from '../StatusBadge';

// gascity-dashboard-2j8e.3: the /beads "Needs you" section — the on-page
// counterpart of the Beads nav badge. It renders the badge-counting attention
// items (attention + watch tiers, the same `summary.attention + summary.watch`
// the nav indicator shows), so the page count and the nav badge cannot
// disagree, and gives each item a path to act: Open the escalation / decision /
// ready-unclaimed bead to act on it. The operator does not claim beads — a bead
// assignee must be a concrete session, never the human operator
// (gascity-dashboard-2j8e.8) — so there is no inline Claim affordance.
//
// Signal & Pavement: a signal band (red when any item needs you, amber when
// all are watch items). The list folds after FOLD_LIMIT rows behind
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
  // The nav badge counts attention + watch; mirror that exactly so the counts agree.
  const counted = items.filter(
    (item) => item.severity === 'attention' || item.severity === 'watch',
  );
  if (counted.length === 0) return null;

  const alarm = counted.some((item) => item.severity === 'attention');
  const band = alarm ? 'border-accent/40 bg-accent/[0.08]' : 'border-warn/40 bg-warn/[0.10]';

  return (
    <section
      aria-labelledby="beads-attention-title"
      className="mb-8 overflow-hidden rounded-lg border border-rule bg-surface-raised"
    >
      <div className={`border-b px-4 py-3 ${band}`}>
        <h2 id="beads-attention-title" className="text-title font-semibold text-fg">
          Needs you <span className="tnum text-fg-muted">({counted.length})</span>
        </h2>
      </div>
      <FoldList
        items={counted}
        limit={FOLD_LIMIT}
        itemKey={(item) => item.id}
        className="divide-y divide-rule"
        renderItem={(item) => {
          const beadId = beadIdFromHref(item.href);
          return (
            <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <StatusBadge
                  tone={item.severity === 'attention' ? 'stuck' : 'warn'}
                  label={item.title}
                />
                {item.summary !== undefined && (
                  <p className="text-body text-fg-muted [overflow-wrap:anywhere]">{item.summary}</p>
                )}
              </div>
              {beadId !== null && (
                <Button type="button" size="sm" onClick={() => onOpen(beadId)}>
                  Open
                </Button>
              )}
            </li>
          );
        }}
      />
    </section>
  );
}
