import { useId } from 'react';
import { Link } from 'react-router';
import type { FlightStage, TaskInFlight, TaskStages } from '../../hooks/useTaskStages';
import { t, tn } from '../../i18n';
import { STAGES } from '../../lib/stageBoard';
import { FoldList } from '../FoldList';

// «Что идёт» (R5): the tasks being worked on, by title and stage. Ink on
// plaster with hairline rules: no panel, no colour. Five dots show how far
// along the route the task is; the words say it for screen readers.

const FOLD_LIMIT = 8;

const STAGE_WORD: Readonly<Record<FlightStage, string>> = {
  // Home's own words (the board's stop names are 'Working' and 'PR').
  working: 'Writing code',
  review: 'Review',
  pr: 'Merging',
};

function StageDots({ stage }: { stage: FlightStage }) {
  const reached = STAGES.findIndex((column) => column.id === stage);
  return (
    <span data-stage-dots aria-hidden="true" className="flex shrink-0 items-center gap-1">
      {STAGES.map((column, index) => (
        <span
          key={column.id}
          data-filled={index <= reached ? 'true' : 'false'}
          className={`h-2 w-2 rounded-full border border-fg ${index <= reached ? 'bg-fg' : 'bg-transparent opacity-40'}`}
        />
      ))}
    </span>
  );
}

function TaskRow({ task }: { task: TaskInFlight }) {
  const word = t(STAGE_WORD[task.stage]);
  const detail = task.stepLabel === null ? word : `${word}, ${task.stepLabel}`;
  return (
    <li>
      <Link
        to={task.href}
        aria-label={`${task.title}: ${word}`}
        className="focus-mark grid grid-cols-1 gap-x-4 gap-y-1 py-3 text-fg hover:bg-surface-tint sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,14rem)] sm:items-baseline"
      >
        <span
          title={task.title}
          className="line-clamp-2 text-body font-semibold [overflow-wrap:anywhere]"
        >
          {task.title}
        </span>
        <span className="flex items-center gap-3 sm:contents">
          <StageDots stage={task.stage} />
          <span className="text-body text-fg-muted [overflow-wrap:anywhere]">{detail}</span>
        </span>
      </Link>
    </li>
  );
}

export function TasksInFlight({ stages }: { stages: TaskStages }) {
  const headingId = useId();
  const footer = stages.state === 'ready' && (stages.queued > 0 || stages.outsideWindow > 0);
  return (
    <section aria-labelledby={headingId} className="mb-10">
      <h2 id={headingId} className="mb-2 text-title font-semibold text-fg">
        {t('What is going on')}
      </h2>
      {stages.state === 'loading' ? (
        <p className="py-3 text-body text-fg-muted">{t('Reading the board…')}</p>
      ) : stages.inFlight.length === 0 ? (
        <p className="border-t border-rule py-3 text-body text-fg-muted">
          {t('Nothing is going on right now')}
        </p>
      ) : (
        <FoldList
          items={stages.inFlight}
          limit={FOLD_LIMIT}
          itemKey={(task) => task.id}
          renderItem={(task) => <TaskRow task={task} />}
          showLabel={(total) => t('Show all {n}', { n: total })}
          hideLabel={t('Show fewer')}
          className="divide-y divide-rule border-y border-rule"
        />
      )}
      {footer && (
        <p className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-body">
          {stages.queued > 0 && (
            <Link
              to="/beads"
              className="focus-mark text-fg underline underline-offset-2 hover:text-fg-muted"
            >
              {tn(stages.queued, {
                one: '{n} more task in the queue',
                other: '{n} more tasks in the queue',
              })}
            </Link>
          )}
          {stages.outsideWindow > 0 && (
            <Link
              to="/runs"
              className="focus-mark text-fg-muted underline underline-offset-2 hover:text-fg"
            >
              {tn(stages.outsideWindow, {
                one: '{n} more run with no task on the board',
                other: '{n} more runs with no task on the board',
              })}
            </Link>
          )}
        </p>
      )}
    </section>
  );
}
