import { useId } from 'react';
import { Link } from 'react-router';
import type { AttentionItem } from '../../attention/compose';
import type { TaskStages } from '../../hooks/useTaskStages';
import { t } from '../../i18n';
import { FoldList } from '../FoldList';

// «Город» (R5, HO-02 superseded): three rows, each number from one source.
// Agents come from status.agents only; tasks from the same TaskStages object
// «Что идёт» renders, so the two can never disagree; problems are the city
// slice. An unread source says so, never a zero. Lamp amber only on the
// problem count, and only when there is a problem.

export type CityAgents = { running: number; total: number } | 'loading' | 'unavailable';

const ISSUE_FOLD_LIMIT = 3;
const NUMBER = 'font-display text-[1.25rem] font-bold leading-none tnum';

function agentsText(agents: CityAgents): string {
  if (agents === 'loading') return t('reading…');
  if (agents === 'unavailable') return t('could not read');
  return t('{running} of {total} working', { running: agents.running, total: agents.total });
}

function tasksText(tasks: TaskStages): string {
  if (tasks.state === 'loading') return t('reading…');
  return t('{inFlight} in progress, {queued} queued', {
    inFlight: tasks.inFlight.length,
    queued: tasks.queued,
  });
}

export function CityStrip({
  agents,
  tasks,
  issues,
  unreadable,
}: {
  agents: CityAgents;
  tasks: TaskStages;
  issues: readonly AttentionItem[];
  unreadable: readonly AttentionItem[];
}) {
  const headingId = useId();
  const count = issues.length;
  return (
    <section aria-labelledby={headingId} className="mb-10">
      <h2 id={headingId} className="mb-2 text-title font-semibold text-fg">
        {t('City')}
      </h2>
      <dl className="divide-y divide-rule border-y border-rule">
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-x-4 py-3">
          <dt className="text-body text-fg-muted">{t('Agents')}</dt>
          <dd className={`text-body text-fg ${typeof agents === 'object' ? '' : 'text-fg-muted'}`}>
            {agentsText(agents)}
          </dd>
        </div>
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-x-4 py-3">
          <dt className="text-body text-fg-muted">{t('Tasks')}</dt>
          <dd className="text-body text-fg">{tasksText(tasks)}</dd>
        </div>
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-x-4 py-3">
          <dt className="text-body text-fg-muted">{t('Problems')}</dt>
          <dd className="min-w-0">
            <span className="flex items-baseline gap-4">
              <span data-count className={`${NUMBER} ${count > 0 ? 'text-warn' : 'text-fg'}`}>
                {count}
              </span>
              <Link
                to="/health"
                className="focus-mark ml-auto text-body text-fg underline underline-offset-2 hover:text-fg-muted"
              >
                {t('Health')}
              </Link>
            </span>
            {count > 0 && (
              <FoldList
                items={issues}
                limit={ISSUE_FOLD_LIMIT}
                itemKey={(item) => `${item.domain}:${item.id}`}
                showLabel={(total) => t('Show all {n}', { n: total })}
                hideLabel={t('Show fewer')}
                className="mt-2 space-y-2"
                renderItem={(item) => (
                  <li className="min-w-0">
                    {item.href === undefined ? (
                      <p className="text-body text-fg [overflow-wrap:anywhere]">{item.title}</p>
                    ) : (
                      <Link
                        to={item.href}
                        className="focus-mark text-body text-fg underline-offset-2 hover:underline [overflow-wrap:anywhere]"
                      >
                        {item.title}
                      </Link>
                    )}
                    {item.summary !== undefined && (
                      <p className="text-label text-fg-muted [overflow-wrap:anywhere]">
                        {item.summary}
                      </p>
                    )}
                  </li>
                )}
              />
            )}
          </dd>
        </div>
      </dl>
      {unreadable.length > 0 && (
        <p className="mt-2 text-label text-fg-faint [overflow-wrap:anywhere]">
          {t('Could not read: {names}', {
            names: unreadable.map((item) => item.title).join(', '),
          })}
        </p>
      )}
    </section>
  );
}
