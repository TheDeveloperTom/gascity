import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { TasksInFlight } from '../../components/home/TasksInFlight';
import { FoldList } from '../../components/FoldList';
import type { TaskStages } from '../../hooks/useTaskStages';
import { t } from '../../i18n';
import type { NeedsModel } from '../../lib/needsFromMe';
import { NeedItem } from './NeedItem';

// «Нужно от меня» (vk lane 3, Attention / Phone-Needs frames): three shelves,
// one column at every width. «Нужно от меня» is open, «Работает» is open,
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
    <section className="min-w-0 border-t border-vk-border pt-2">
      <h2 className="text-body font-semibold text-vk-text-high">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          className="focus-mark flex min-h-11 w-full items-center gap-2 text-left"
        >
          <Caret aria-hidden="true" className="h-4 w-4 shrink-0 text-vk-text-low" />
          <span>{title}</span>{' '}
          {count !== undefined && (
            <span className="rounded bg-vk-bg-secondary px-1.5 text-label text-vk-text-normal">
              {count}
            </span>
          )}
        </button>
      </h2>
      {note !== undefined && <p className="pb-2 text-label text-vk-text-low">{note}</p>}
      <div id={bodyId} hidden={!open} className="min-w-0 pb-4">
        {open && children}
      </div>
    </section>
  );
}

function Status({ children }: { children: ReactNode }) {
  return <p className="py-2 text-body text-vk-text-low">{children}</p>;
}

export function NeedsShelves({ model, stages }: { model: NeedsModel; stages: TaskStages }) {
  const stuckId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2 font-vk-sans">
      <Shelf
        title={t('Needs from me')}
        {...(model.state === 'ready' || model.count > 0 ? { count: model.count } : {})}
      >
        {model.needs.length > 0 && (
          <ul className="flex min-w-0 flex-col gap-2">
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
        ) : model.needs.length === 0 && model.stalls.length === 0 ? (
          <Status>{t('Nothing needs you right now.')}</Status>
        ) : null}
        {model.stalls.length > 0 && (
          <section aria-labelledby={stuckId} className="mt-4 min-w-0">
            <h3 id={stuckId} className="pb-2 text-label font-semibold text-vk-text-low">
              {t('Stuck')}
            </h3>
            <ul className="flex min-w-0 flex-col gap-2">
              {model.stalls.map((stall) => (
                <NeedItem key={stall.id} need={stall} />
              ))}
            </ul>
          </section>
        )}
      </Shelf>

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
    </div>
  );
}
