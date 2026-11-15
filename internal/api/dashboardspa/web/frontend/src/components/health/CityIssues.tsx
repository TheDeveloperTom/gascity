import { Link } from 'react-router';
import {
  ATTENTION_DOMAINS,
  type AttentionDomain,
  type AttentionItem,
  type AudienceSlice,
} from '../../attention/compose';
import { t } from '../../i18n';
import { FoldList } from '../FoldList';

// HE-12 (OWNER-HOME-PLAN Task 10, ruling R4): the city's own trouble — stalled
// steps, errored agents, unclaimed work, host pressure — is not the owner's
// to-do, but it is never hidden. It is listed here, first on Health, grouped
// by where it lives, five per group with the rest one click away. Lamp amber
// marks it; red is kept for what waits for the owner.

const GROUP_LIMIT = 5;

const DOMAIN_LABEL: Readonly<Record<AttentionDomain, string>> = {
  agents: 'Agents',
  beads: 'Beads',
  runs: 'Runs',
  mail: 'Mail',
  activity: 'Activity',
  health: 'Health',
};

export function CityIssues({
  slice,
  unreadable,
}: {
  slice: AudienceSlice;
  unreadable: readonly AttentionItem[];
}) {
  const issues = slice.items.filter((item) => item.severity !== 'unavailable');
  const groups = ATTENTION_DOMAINS.map((domain) => ({
    domain,
    items: issues.filter((item) => item.domain === domain),
  })).filter((group) => group.items.length > 0);
  const empty = groups.length === 0 && unreadable.length === 0;

  return (
    <section
      aria-labelledby="city-issues-heading"
      className="mb-6 min-w-0 rounded-lg border border-rule bg-surface-raised"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-rule px-4 py-3">
        <h2 id="city-issues-heading" className="text-title font-semibold text-fg">
          {t('City issues')}
        </h2>
        {issues.length > 0 && (
          <span className="inline-flex min-w-[1.375rem] justify-center rounded-full bg-warn px-1.5 text-label font-semibold text-on-primary tnum">
            {issues.length}
          </span>
        )}
      </div>
      <div className="space-y-5 px-4 py-4">
        {empty && <p className="text-body text-fg-muted">{t('No city issues')}</p>}
        {unreadable.length > 0 && (
          <div className="min-w-0">
            <h3 className="mb-1.5 text-label font-semibold text-fg-muted">{t('Could not read')}</h3>
            <ul className="space-y-1">
              {unreadable.map((item) => (
                <li key={item.id} className="text-body text-fg-muted [overflow-wrap:anywhere]">
                  {item.title}
                </li>
              ))}
            </ul>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.domain} className="min-w-0">
            <h3 className="mb-1.5 text-label font-semibold text-fg-muted">
              {t(DOMAIN_LABEL[group.domain])}{' '}
              <span className="tnum font-medium text-fg-faint">{group.items.length}</span>
            </h3>
            <FoldList
              items={group.items}
              limit={GROUP_LIMIT}
              itemKey={(item) => item.id}
              renderItem={(item) => <IssueRow item={item} />}
              showLabel={(total) => t('Show all {n}', { n: total })}
              hideLabel={t('Show fewer')}
              className="divide-y divide-rule border-l-2 border-warn"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function IssueRow({ item }: { item: AttentionItem }) {
  const body = (
    <>
      <span className="min-w-0 font-medium text-fg [overflow-wrap:anywhere]">{item.title}</span>
      {item.ref !== undefined && (
        <span className="shrink-0 font-mono text-label text-fg-muted">{item.ref}</span>
      )}
    </>
  );
  const rowClass =
    'flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2 pl-3 pr-1 text-body';
  return (
    <li>
      {item.href !== undefined ? (
        <Link
          to={item.href}
          className={`${rowClass} rounded-sm hover:bg-surface-tint/60 focus-mark`}
        >
          {body}
        </Link>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
      {item.summary !== undefined && (
        <p className="pb-2 pl-3 text-label text-fg-muted [overflow-wrap:anywhere]">
          {item.summary}
        </p>
      )}
    </li>
  );
}
