// ⌘K / Ctrl+K palette «Найти и перейти» (vk lane 4, owner). Lane 5 only mounts
// <CommandBar/>; the palette registers its own shortcut. Markup follows the
// design frame Command.dc.html; a plain dialog + listbox, no cmdk or Radix.
// Below `md` it is full-screen.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { BOARD_RECENT_CLOSED_LIMIT, useBoardData } from '../hooks/useBoardData';
import { t } from '../i18n';
import { beadRole } from '../lib/boardRoles';
import { closeCommandBar, toggleCommandBar, useCommandBarOpen } from '../lib/commandBar';
import { mayorChannelUrl } from '../lib/discussWithMayor';
import { epicLabel, epicProgress, epicSummaries } from '../lib/epics';
import { openExternal } from '../lib/openExternal';
import { milestoneOf } from '../lib/waitReasons';
import type { SupervisorBead } from '../supervisor/beadReads';
import { cn } from './cn';

/** Tasks shown for a query; the board page is one action away for more. */
export const PALETTE_TASK_LIMIT = 8;

type Section = 'tasks' | 'epics' | 'actions';

interface Entry {
  id: string;
  section: Section;
  label: string;
  meta?: string;
  icon: ReactNode;
  disabled?: boolean;
  disabledTitle?: string;
  run: () => void;
}

const SECTION_LABEL: Record<Section, string> = {
  tasks: 'Palette: tasks',
  epics: 'Palette: epics',
  actions: 'Palette: actions',
};

function isShortcut(event: globalThis.KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k';
}

const ICON = {
  open: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.2 2" />
    </svg>
  ),
  closed: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.6 8.2l1.7 1.7 3.2-3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  go: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chat: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4h11v6.5H7.2L4 13v-2.5H2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  search: (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  dot: <span className="h-2 w-2 rounded-full bg-vk-text-low" />,
};

function matches(query: string, ...texts: ReadonlyArray<string | undefined>): boolean {
  if (query.length === 0) return true;
  return texts.some((text) => text !== undefined && text.toLowerCase().includes(query));
}

function isTask(bead: SupervisorBead): boolean {
  return bead.issue_type !== 'epic' && beadRole(bead) === 'task';
}

export function CommandBar(): ReactElement | null {
  const [open] = useCommandBarOpen();

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!isShortcut(event)) return;
      event.preventDefault();
      toggleCommandBar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return open ? <Palette /> : null;
}

/** Mounted only while open, so the board is read only when the palette shows. */
function Palette(): ReactElement {
  const navigate = useNavigate();
  const { data } = useBoardData();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  // Focus the input on open and give focus back on close.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => before?.focus();
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim().toLowerCase();
    const items = data?.items ?? [];
    const go = (path: string) => () => {
      closeCommandBar();
      void navigate(path);
    };
    const out: Entry[] = [];

    if (q.length > 0) {
      const tasks = items.filter((b) => isTask(b) && matches(q, b.title, b.id)).slice(0, PALETTE_TASK_LIMIT);
      for (const bead of tasks) {
        out.push({
          id: `task-${bead.id}`,
          section: 'tasks',
          label: bead.title || bead.id,
          meta: milestoneOf(bead) ?? bead.id,
          icon: bead.status === 'closed' ? ICON.closed : ICON.open,
          run: go(`/beads?bead=${encodeURIComponent(bead.id)}`),
        });
      }
    }

    const closed = items.filter((b) => b.status === 'closed').length;
    for (const epic of epicSummaries(items, { closedCapped: closed >= BOARD_RECENT_CLOSED_LIMIT })) {
      const label = epicLabel(epic);
      if (!matches(q, label, epic.key)) continue;
      out.push({
        id: `epic-${epic.key}`,
        section: 'epics',
        label,
        meta: epicProgress(epic),
        icon: ICON.dot,
        run: go(`/beads?epic=${encodeURIComponent(epic.key)}`),
      });
    }

    const mayor = mayorChannelUrl();
    const actions: Entry[] = [
      { id: 'act-home', section: 'actions', label: t('Open «Needs from me»'), icon: ICON.go, run: go('/') },
      { id: 'act-board', section: 'actions', label: t('Palette: board'), icon: ICON.go, run: go('/beads') },
      {
        id: 'act-mayor',
        section: 'actions',
        label: t('Discuss with the Mayor in Discord'),
        icon: ICON.chat,
        disabled: mayor === null,
        disabledTitle: t('The Mayor channel is not configured'),
        run: () => {
          if (mayor === null) return;
          closeCommandBar();
          openExternal(mayor);
        },
      },
    ];
    for (const action of actions) if (matches(q, action.label)) out.push(action);
    return out;
  }, [data, navigate, query]);

  const enabled = entries.filter((e) => e.disabled !== true);
  const current = enabled[Math.min(active, enabled.length - 1)];
  const optionId = (entry: Entry) => `${baseId}-${entry.id}`;

  useEffect(() => {
    if (current === undefined) return;
    const node = document.getElementById(optionId(current));
    if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  });

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCommandBar();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (enabled.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const at = Math.min(active, enabled.length - 1);
      setActive((at + step + enabled.length) % enabled.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      current?.run();
    } else if (event.key === 'Tab') {
      // Focus trap: the input is the dialog's one tab stop.
      event.preventDefault();
      inputRef.current?.focus();
    }
  };

  const sections: Section[] = ['tasks', 'epics', 'actions'];

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-scrim/50" onClick={() => closeCommandBar()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Find and go')}
        onKeyDown={onKeyDown}
        className={cn(
          'fixed inset-0 z-50 flex flex-col overflow-hidden bg-vk-bg-primary font-vk-sans text-vk-text-normal',
          'pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]',
          'md:inset-auto md:left-1/2 md:top-[120px] md:w-[640px] md:max-w-[calc(100%-32px)] md:-translate-x-1/2',
          'md:rounded-[4.5px] md:border md:border-vk-border md:pb-0 md:pt-0 md:shadow-2xl',
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-vk-border px-3 md:h-12">
          <label htmlFor={`${baseId}-input`} className="flex text-vk-text-low">
            {ICON.search}
            <span className="sr-only">{t('Find a task, epic or action')}</span>
          </label>
          <input
            ref={inputRef}
            id={`${baseId}-input`}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current === undefined ? undefined : optionId(current)}
            autoComplete="off"
            spellCheck={false}
            value={query}
            placeholder={t('Find a task, epic or action')}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            className="h-10 min-w-0 flex-1 border-0 bg-transparent text-base text-vk-text-high outline-none placeholder:text-vk-text-low"
          />
          <kbd className="hidden rounded-[3px] border border-vk-border bg-vk-bg-secondary px-1.5 font-vk-mono text-xs text-vk-text-low md:inline">
            esc
          </kbd>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => closeCommandBar()}
            className="h-11 shrink-0 rounded-[3px] px-3 text-[15px] text-vk-text-normal md:hidden"
          >
            {t('Palette: close button')}
          </button>
        </div>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={t('Results')}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2 pt-1 md:max-h-[60vh] md:flex-none"
        >
          {sections.map((section) => {
            const rows = entries.filter((e) => e.section === section);
            if (rows.length === 0) return null;
            const headId = `${baseId}-${section}`;
            return (
              <div key={section} role="group" aria-labelledby={headId}>
                <div id={headId} className="px-3 pb-1 pt-2.5 text-xs font-medium text-vk-text-low">
                  {t(SECTION_LABEL[section])}
                </div>
                {rows.map((entry) => {
                  const selected = entry === current;
                  return (
                    <div
                      key={entry.id}
                      id={optionId(entry)}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={entry.disabled === true ? true : undefined}
                      title={entry.disabled === true ? entry.disabledTitle : undefined}
                      onMouseMove={() => {
                        if (entry.disabled === true) return;
                        const at = enabled.indexOf(entry);
                        if (at >= 0 && at !== active) setActive(at);
                      }}
                      onClick={() => {
                        if (entry.disabled !== true) entry.run();
                      }}
                      className={cn(
                        'mx-1 flex min-h-11 items-center gap-2.5 rounded-[3px] px-2 py-1.5 md:min-h-10',
                        entry.disabled === true
                          ? 'cursor-not-allowed text-vk-text-low'
                          : 'cursor-pointer',
                        selected && 'bg-vk-bg-panel text-vk-text-high',
                      )}
                    >
                      <span className="flex w-[15px] shrink-0 justify-center text-vk-text-low">{entry.icon}</span>
                      <span className="min-w-0 flex-1 text-[15px] [overflow-wrap:anywhere]">{entry.label}</span>
                      {entry.meta !== undefined && (
                        <span
                          className={cn(
                            'shrink-0 text-[13px] text-vk-text-low',
                            entry.section === 'tasks' && 'font-vk-mono',
                          )}
                        >
                          {entry.meta}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {entries.length === 0 && (
            <p className="px-3 py-4 text-[15px] text-vk-text-low">{t('Nothing found')}</p>
          )}
        </div>
        <div className="hidden flex-wrap gap-3 border-t border-vk-border bg-vk-bg-secondary px-3 py-2 text-xs text-vk-text-low md:flex">
          <span>
            <kbd className="font-vk-mono">↑↓</kbd> {t('Palette: select')}
          </span>
          <span>
            <kbd className="font-vk-mono">↵</kbd> {t('Palette: open')}
          </span>
          <span>
            <kbd className="font-vk-mono">esc</kbd> {t('Palette: close')}
          </span>
        </div>
      </div>
    </>
  );
}
