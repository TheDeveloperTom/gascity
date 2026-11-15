import { useMemo, useState } from 'react';
import { useOperatorConfig } from '../contexts/OperatorConfigContext';
import { displayLabel, tierLabel, type AliasBucket } from '../hooks/aliasPriority';
import { Icon, StatusShape } from './icons';

// Shared rail shell for both panel states: a white panel on the pavement,
// full-width above the list on phones, fixed-width beside it from sm up;
// only the sm width varies per state.
const ASIDE_BASE_CLASS = 'rounded-lg border border-rule bg-surface-raised p-4 sm:shrink-0';

export function AgentPanel({
  buckets,
  loading,
  sessionsUnavailable,
  value,
  onChange,
  onReset,
  isOperator,
}: {
  buckets: ReadonlyArray<AliasBucket>;
  loading: boolean;
  sessionsUnavailable: boolean;
  value: string;
  onChange: (v: string) => void;
  onReset: () => void;
  isOperator: boolean;
}) {
  // Left-side identity panel. Starts collapsed to a thin rail showing only
  // who you're reading as; expands to a searchable, tier-grouped agent
  // list so the operator can type to find an inbox.
  //
  // Collapse/search state is local: the panel owns its own UI affordances;
  // the page only owns the load-bearing `value`/`onChange` identity state.
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const { operatorAlias: OPERATOR_ALIAS, operatorWireAlias: OPERATOR_WIRE_ALIAS } =
    useOperatorConfig();
  const valueLabel = displayLabel(value, OPERATOR_ALIAS);

  // Filter the tier buckets by the panel's own search box, and drop the
  // operator's wire alias (`human`) — it's the same inbox as "user" and
  // would otherwise read as a confusing duplicate.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return buckets
      .map((bucket) => ({
        tier: bucket.tier,
        aliases: bucket.aliases.filter((alias) => {
          if (alias.toLowerCase() === OPERATOR_WIRE_ALIAS) return false;
          if (q.length === 0) return true;
          const label = displayLabel(alias, OPERATOR_ALIAS).toLowerCase();
          return label.includes(q) || alias.toLowerCase().includes(q);
        }),
      }))
      .filter((bucket) => bucket.aliases.length > 0);
  }, [buckets, query, OPERATOR_ALIAS, OPERATOR_WIRE_ALIAS]);

  const select = (alias: string) => {
    onChange(alias);
    setExpanded(false);
    setQuery('');
  };

  if (!expanded) {
    // Collapsed: who you are reading as, and one boxed action to change it.
    // On phones it is a single row above the list; from sm up a narrow panel.
    return (
      <aside className={`${ASIDE_BASE_CLASS} sm:w-52`}>
        <div className="flex items-center justify-between gap-3 sm:block">
          <div className="min-w-0">
            <ReadingAsLabel isOperator={isOperator} />
            <div
              className={`mt-0.5 truncate text-body font-semibold ${isOperator ? 'text-fg' : 'text-warn'}`}
              title={valueLabel}
            >
              {valueLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded={false}
            className={`${TOGGLE_CLASS} shrink-0 sm:mt-3 sm:w-full`}
          >
            Choose inbox
            <span className="sr-only"> from all agents</span>
          </button>
        </div>
        {!isOperator && <OperatorReturn onReset={onReset} note="Sends go from the operator." />}
      </aside>
    );
  }

  return (
    <aside className={`${ASIDE_BASE_CLASS} sm:w-64`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <ReadingAsLabel isOperator={isOperator} />
          <div
            className={`mt-0.5 truncate text-body font-semibold ${isOperator ? 'text-fg' : 'text-warn'}`}
            title={valueLabel}
          >
            {valueLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded
          className={`${TOGGLE_CLASS} shrink-0`}
        >
          Hide inbox list
        </button>
      </div>

      <div className="relative mt-4">
        <Icon
          name="search"
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an agent"
          aria-label="Find an agent"
          autoFocus
          className="h-9 w-full rounded border border-rule bg-surface-raised pl-8 pr-3 text-body text-fg placeholder:text-fg-faint focus-mark"
        />
      </div>

      <div className="-mx-2 mt-3 max-h-[28rem] space-y-4 overflow-y-auto px-2">
        {/* Progressive: mail-derived aliases land in ~0.5s while the
            slower supervisor sessions call is still in flight. Render whatever
            is ready and footnote "loading more" rather than hiding the
            whole list behind the slowest fetch. */}
        {filtered.length === 0 ? (
          <p className={NOTE_CLASS}>{loading ? 'Loading aliases' : 'No agents match.'}</p>
        ) : (
          filtered.map((bucket) => (
            <div key={bucket.tier}>
              <div className="mb-1 px-2 text-label font-medium text-fg-faint">
                {tierLabel(bucket.tier)}
              </div>
              <ul className="space-y-px">
                {bucket.aliases.map((alias) => {
                  const active = alias.toLowerCase() === value.toLowerCase();
                  return (
                    <li key={alias}>
                      <button
                        type="button"
                        onClick={() => select(alias)}
                        aria-current={active}
                        className={`block w-full truncate rounded px-2 py-1.5 text-left text-body transition-colors duration-150 ease-out-quart focus-mark ${
                          active
                            ? 'bg-surface-tint font-semibold text-fg'
                            : 'text-fg-muted hover:bg-surface-tint hover:text-fg'
                        }`}
                        title={displayLabel(alias, OPERATOR_ALIAS)}
                      >
                        {displayLabel(alias, OPERATOR_ALIAS)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
        {loading && filtered.length > 0 && <p className={NOTE_CLASS}>Loading more agents</p>}
        {/* gascity-dashboard-xba: when supervisor sessions fails, the panel
            is still functional off
            the mail-derived aliases. Surface the partial state explicitly
            so the operator knows session-only agents (no mail activity)
            won't appear, instead of leaving them to wonder if the list is
            still loading.

            gascity-dashboard-5gg: split the message into two branches.
            When the visible list collapses to ONLY the operator entry
            (both fetches failed, or the mail corpus is genuinely empty),
            the narrower "showing mail-derived aliases only" copy is
            misleading because no mail-derived aliases are actually
            present. Use the broader "agent list and mail history both
            unavailable" copy in that case. */}
        {!loading &&
          sessionsUnavailable &&
          filtered.length > 0 &&
          (isOperatorOnly(filtered) ? (
            <p className={`${NOTE_CLASS} text-warn`}>
              Agent list and mail history both unavailable.
            </p>
          ) : (
            <p className={`${NOTE_CLASS} text-warn`}>
              Agent list unavailable; showing mail-derived aliases only.
            </p>
          ))}
      </div>

      {!isOperator && (
        <OperatorReturn onReset={onReset} note="Sends always go from the operator." />
      )}
    </aside>
  );
}

const TOGGLE_CLASS =
  'inline-flex h-8 items-center justify-center rounded border border-rule bg-surface-raised px-3 text-label font-semibold text-fg transition-colors duration-150 ease-out-quart hover:bg-surface-tint focus-mark';

const NOTE_CLASS = 'px-2 text-label text-fg-muted';

// "Reading as" in ink for the operator. For any other inbox it turns amber
// with the watch shape: you are looking at someone else's mail.
function ReadingAsLabel({ isOperator }: { isOperator: boolean }) {
  if (isOperator) return <div className="text-label font-medium text-fg-muted">Reading as</div>;
  return (
    <div className="flex items-center gap-1.5 text-label font-medium text-warn">
      <StatusShape tone="warn" />
      <span>Reading as</span>
    </div>
  );
}

function OperatorReturn({ onReset, note }: { onReset: () => void; note: string }) {
  return (
    <div className="mt-4 space-y-1 border-t border-rule pt-3">
      <button
        type="button"
        onClick={onReset}
        className="text-label font-semibold text-primary underline-offset-2 hover:underline focus-mark"
      >
        Back to operator
      </button>
      <p className="text-label text-fg-muted">Read-only. {note}</p>
    </div>
  );
}

// True iff the visible alias list collapses to the single operator
// entry — i.e. neither sessions nor mail produced any non-operator
// aliases. prioritizeAliases always emits the 'you' tier with the
// operator, so the operator-only case is detectable as a single bucket
// with a single alias after the AgentPanel's own search/wire-alias
// filter has run. (gascity-dashboard-5gg)
function isOperatorOnly(buckets: ReadonlyArray<AliasBucket>): boolean {
  let total = 0;
  for (const bucket of buckets) {
    total += bucket.aliases.length;
    if (total > 1) return false;
  }
  return total <= 1;
}
