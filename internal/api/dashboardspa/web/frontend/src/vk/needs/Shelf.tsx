import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { TasksInFlight } from '../../components/home/TasksInFlight';
import { FoldList } from '../../components/FoldList';
import type { TaskStages } from '../../hooks/useTaskStages';
import { t, tn } from '../../i18n';
import type { NeedsModel } from '../../lib/needsFromMe';
import type { TopicNeed } from '../../lib/peerTopics';
import type { PendingTopicQuestion } from '../../lib/topicQuestions';
import { NeedItem } from './NeedItem';
import { TopicQuestionCard } from './TopicQuestion';

// «Нужно от меня» (vk lane 3, Attention / Phone-Needs frames): three shelves.
// polish2 16.11 (owner, 2000 px): from xl two columns, «Нужно от меня» on the
// left, «Стоит», «Работает» and «Тихо» on the right; one column below xl. «Нужно от меня» is open, «Работает» is open,
// «Тихо» starts folded.

const QUIET_LIMIT = 8;

export function Shelf({
  title,
  count,
  note,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  note?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const bodyId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const Caret = open ? CaretDown : CaretRight;
  return (
    <section className="min-w-0">
      {/* Attention.dc.html: a 32 px caret row, 14 px medium title, quiet count. */}
      <h2 className="text-sm font-medium text-vk-text-high">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          className="focus-mark flex min-h-11 w-full items-center gap-1.5 px-1 text-left md:min-h-8"
        >
          <Caret aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{title}</span>{' '}
          {count !== undefined && <span className="font-normal text-vk-text-low">{count}</span>}
        </button>
      </h2>
      {note !== undefined && (
        <p className="pb-1 pl-6 pr-1 text-[13px] text-vk-text-low">{note}</p>
      )}
      <div id={bodyId} hidden={!open} className="min-w-0 pb-3">
        {open && children}
      </div>
    </section>
  );
}

function Status({ children }: { children: ReactNode }) {
  return <p className="py-2 text-body text-vk-text-low">{children}</p>;
}

/** vk-final part 4: Mayor topics that need the owner (paused) or have unread messages. */
function TopicNeeds({ needs }: { needs: readonly TopicNeed[] }) {
  const headId = useId();
  return (
    <section aria-labelledby={headId} className="mt-4 min-w-0">
      <h3 id={headId} className="pb-2 text-label font-semibold text-vk-text-low">
        {t('Mayor topics')}
      </h3>
      <ul className="flex min-w-0 flex-col gap-2">
        {needs.map((need) => (
          <li key={need.key} className="min-w-0">
            <Link
              to={need.href}
              className="focus-mark flex min-h-11 min-w-0 flex-col gap-0.5 rounded-sm border border-vk-border bg-vk-bg-primary p-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 text-[15px] text-vk-text-high [overflow-wrap:anywhere]">
                  {need.title}
                </span>
                {need.unread > 0 && (
                  <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-vk-brand-secondary px-1.5 text-[11px] font-semibold text-vk-on-brand">
                    {tn(need.unread, { one: '{n} new', other: '{n} new messages' })}
                  </span>
                )}
              </span>
              <span
                className={
                  need.needsHuman
                    ? 'text-[13px] font-medium text-warn'
                    : 'text-[13px] text-vk-text-low [overflow-wrap:anywhere]'
                }
              >
                {need.needsHuman ? t('The Mayors did not agree — a person is needed') : need.preview}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** BOARD-LIVE L7: the owner's plain topic questions (one of their three views). */
function TopicQuestions({ items }: { items: readonly PendingTopicQuestion[] }) {
  const headId = useId();
  return (
    <section aria-labelledby={headId} className="mt-4 min-w-0">
      <h3 id={headId} className="pb-2 text-label font-semibold text-vk-text-low">
        {t('Questions from the Mayors')}
      </h3>
      <ul className="flex min-w-0 flex-col gap-2">
        {items.map(({ question, href }) => (
          <li key={question.questionId} className="flex min-w-0 flex-col gap-1">
            <TopicQuestionCard question={question} />
            {href !== null && (
              <Link
                to={href}
                className="focus-mark inline-flex min-h-11 items-center self-start text-sm text-vk-text-low underline underline-offset-2 md:min-h-0"
              >
                {t('Open the topic view')}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NeedsShelves({
  model,
  stages,
  topicNeeds = [],
  topicQuestions = [],
  peerCount,
  settling,
}: {
  model: NeedsModel;
  stages: TaskStages;
  topicNeeds?: readonly TopicNeed[];
  /** Pending owner questions about Mayor topics (BOARD-LIVE L10/L7). */
  topicQuestions?: readonly PendingTopicQuestion[];
  /** What the peer boards add to the count (lib/topicQuestions peerNeedsCount). */
  peerCount?: number;
  /**
   * Hold «Стоит», the Mayors' lines and the shelves below (the page decides,
   * capped; review I-1). Unset: hold while our board is read.
   */
  settling?: boolean;
}) {
  const stuckId = useId();
  const count = model.count + (peerCount ?? 0);
  // H1 16.11: nothing renders under content that may still grow (the board
  // read, then the peer boards' questions), or it jumps when that lands.
  const holding = settling ?? model.state === 'loading';
  // polish2 16.11: the right column exists only when «Стоит» has items; with
  // none (or while the boards settle) nothing is reserved and the questions
  // take the width, two per row from 1440 px.
  const twoColumns = !holding && model.stalls.length > 0;
  return (
    <div
      className={
        twoColumns
          ? 'grid min-w-0 grid-cols-1 gap-2 font-vk-sans xl:grid-cols-2 xl:items-start xl:gap-10'
          : 'flex min-w-0 flex-col gap-2 font-vk-sans'
      }
    >
      <div className="flex min-w-0 flex-col gap-2">
      <Shelf
        title={t('Needs from me')}
        {...(model.state === 'ready' || count > 0 ? { count } : {})}
      >
        {model.needs.length > 0 && (
          <ul
            className={
              twoColumns
                ? 'flex min-w-0 flex-col gap-2'
                : 'flex min-w-0 flex-col gap-2 min-[1440px]:grid min-[1440px]:grid-cols-2 min-[1440px]:items-start min-[1440px]:gap-3'
            }
          >
            {model.needs.map((need) => (
              <NeedItem key={need.id} need={need} />
            ))}
          </ul>
        )}
        {model.state === 'loading' ? (
          <Status>{t('Reading the board…')}</Status>
        ) : model.state === 'unavailable' ? (
          <Status>
            <Link to="/beads" className="focus-mark underline underline-offset-2">
              {t('Could not read the board')}
            </Link>
          </Status>
        ) : model.needs.length === 0 &&
          model.stalls.length === 0 &&
          topicNeeds.length === 0 &&
          topicQuestions.length === 0 ? (
          <Status>{t('Nothing needs you right now.')}</Status>
        ) : null}
        {/* Our own asks land with our board; the Mayors' lines wait for it, or
            the asks push them down (H1 16.11). */}
        {!holding && topicQuestions.length > 0 && <TopicQuestions items={topicQuestions} />}
        {!holding && topicNeeds.length > 0 && <TopicNeeds needs={topicNeeds} />}
      </Shelf>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
      {!holding && model.stalls.length > 0 && (
        <section aria-labelledby={stuckId} className="min-w-0">
          {/* Phone-Needs: «Стоит» is a quiet 14 px label over its rows. */}
          <h3 id={stuckId} className="mb-2 mt-2 px-1 text-sm font-medium text-vk-text-low xl:mt-0">
            {t('Stuck')}
          </h3>
          <ul className="flex min-w-0 flex-col gap-2">
            {model.stalls.map((stall) => (
              <NeedItem key={stall.id} need={stall} />
            ))}
          </ul>
        </section>
      )}

      {/* H1 16.11: nothing renders under a shelf that is still reading the
          board, or the stuck list pushes it down when it lands (layout shift). */}
      {!holding && (
      <>
      <Shelf
        title={t('At work')}
        {...(stages.state === 'ready' ? { count: stages.inFlight.length } : {})}
      >
        <TasksInFlight stages={stages} heading={false} />
      </Shelf>

      <Shelf
        title={t('Quiet')}
        note={t('waiting their turn or for another task')}
        defaultOpen={false}
      >
        {model.quiet.length === 0 ? (
          <Status>{t('Nothing is waiting quietly.')}</Status>
        ) : (
          <FoldList
            items={model.quiet}
            limit={QUIET_LIMIT}
            itemKey={(item) => item.id}
            renderItem={(item) => (
              <li>
                <Link
                  to={item.href}
                  className="focus-mark flex min-h-11 min-w-0 items-center py-2 text-body text-vk-text-normal [overflow-wrap:anywhere] hover:text-vk-text-high"
                >
                  {item.title}
                </Link>
              </li>
            )}
            showLabel={(total) => t('Show all {n}', { n: total })}
            hideLabel={t('Show fewer')}
            className="divide-y divide-vk-border"
          />
        )}
      </Shelf>
      </>
      )}
      </div>
    </div>
  );
}
