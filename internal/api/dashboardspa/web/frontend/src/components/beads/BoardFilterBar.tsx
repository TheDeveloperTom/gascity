import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { t } from '../../i18n';
import { ownerChoicesEnabled, type BoardSource, type OwnerFilter } from '../../lib/boardOwner';
import { ALL_EPICS, epicLabel, epicProgress, NO_EPIC, type EpicSummary } from '../../lib/epics';
import { cn } from '../../vk/cn';
import { ExternalLink } from '../../vk/ExternalLink';
import { ListSearchBar } from '../ListSearchBar';

// The board's one filter row, VK look (vk lane 4): [Все | Мои | Ричарда],
// «Эпик: Все ▾», search «Найти задачу…», «Новая задача +». Nothing here is
// remembered. The project menu «Проект: Все ▾» (vk-final; only with two or
// more projects) sits beside «Эпик», and the test-card checkbox (only when
// test cards exist) stays from B7; both hide otherwise. No priority, status or «waiting on me» filters (owner, 15.11).

interface BoardFilterBarProps {
  projects: readonly { key: string; label: string; count: number }[];
  project: string;
  onProject: (key: string) => void;
  search: string;
  onSearch: (value: string) => void;
  matched: number;
  total: number;
  testCount: number;
  showTests: boolean;
  onShowTests: (show: boolean) => void;
  // vk lane 0b seam props (owner: lane 4). Optional so lane 1 can pass them
  // now; the body reads them once lane 4 lands.
  epics?: readonly EpicSummary[];
  epic?: string;
  onEpic?: (key: string) => void;
  sources?: readonly BoardSource[];
  ownerFilter?: OwnerFilter;
  onOwnerFilter?: (f: OwnerFilter) => void;
  newTaskUrl?: string | null;
  /** «M05–M13»: milestones with an epic bead but no tasks yet («плана ещё нет»). */
  plannedEmpty?: string | null;
}

const NO_EPICS: readonly EpicSummary[] = [];
const ONE_SOURCE: readonly BoardSource[] = [{ owner: 'me', label: 'Mine', available: true }];

/** Control height: 44 px tap target on the phone, the VK 32 px row on desktop. */
const ROW = 'h-11 md:h-8';

/** A stable dot colour per milestone (decorative; never the alarm accent). */
export function epicDotStyle(key: string): { backgroundColor: string } | undefined {
  const m = /\d+/.exec(key);
  if (key === NO_EPIC || m === null) return undefined;
  return { backgroundColor: `oklch(65% 0.13 ${(Number(m[0]) * 47 + 200) % 360})` };
}

/** Viewport margin a dropdown keeps (the page's phone gutter). */
const MENU_GUTTER_PX = 16;

/**
 * H1 16.11: a menu anchored to its button's left edge ran off a phone screen
 * when the button sits mid-row (the «Эпик» menu ended at 523 px on a 390 px
 * phone). Once open, shift it left just enough to keep the gutter.
 */
function useKeepMenuOnScreen(open: boolean, listRef: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open || list === null) return;
    list.style.transform = '';
    const rect = list.getBoundingClientRect();
    const over = rect.right - (window.innerWidth - MENU_GUTTER_PX);
    const shift = Math.min(Math.max(over, 0), Math.max(rect.left - MENU_GUTTER_PX, 0));
    if (shift > 0) list.style.transform = `translateX(-${Math.round(shift)}px)`;
  }, [open, listRef]);
}

function OwnerChips({
  sources,
  value,
  onChange,
}: {
  sources: readonly BoardSource[];
  value: OwnerFilter;
  onChange?: (f: OwnerFilter) => void;
}) {
  const enabled = ownerChoicesEnabled(sources);
  const available = (owner: string) => sources.some((s) => s.owner === owner && s.available);
  // vk-final: one chip per peer board, labelled with the person's genitive
  // («Ричарда»). Before any peer board arrives, a disabled «Ричарда» says
  // where it will come from.
  const peers = sources.filter((s) => s.owner !== 'me');
  const chips: Array<{ key: OwnerFilter; label: string; on: boolean }> = [
    { key: 'all', label: t('Owner: all'), on: true },
    { key: 'me', label: t('Owner: mine'), on: enabled && available('me') },
    ...(peers.length > 0
      ? peers.map((s) => ({ key: s.owner, label: s.label, on: enabled && s.available }))
      : [{ key: 'peer:' as const, label: t("Owner: Richard's"), on: false }]),
  ];
  const active = enabled ? value : 'all';
  return (
    <div
      role="group"
      aria-label={t('Whose tasks')}
      className="inline-flex overflow-hidden rounded-[3px] border border-vk-border bg-vk-bg-secondary"
    >
      {chips.map((chip, i) => {
        const pressed = chip.key === active;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={pressed}
            disabled={!chip.on}
            title={chip.on ? undefined : t("Appears after sync with Richard's city")}
            onClick={() => onChange?.(chip.key)}
            className={cn(
              ROW,
              'px-2.5 font-vk-sans text-[15px] focus-mark disabled:cursor-not-allowed disabled:text-vk-text-low',
              i > 0 && 'border-l border-vk-border',
              pressed ? 'bg-vk-bg-primary text-vk-text-high' : 'bg-transparent text-vk-text-normal',
            )}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

function EpicSelect({
  epics,
  value,
  onChange,
  plannedEmpty,
}: {
  epics: readonly EpicSummary[];
  value: string;
  onChange?: (key: string) => void;
  plannedEmpty?: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useKeepMenuOnScreen(open, listRef);
  const listId = useId();
  const chosen = epics.find((e) => e.key === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent | MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"], [role="option"]')?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (key: string) => {
    onChange?.(key);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = options.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      options[(at + step + options.length) % options.length]?.focus();
    } else if ((event.key === 'Enter' || event.key === ' ') && at >= 0) {
      event.preventDefault();
      const key = options[at]?.dataset.key;
      if (key !== undefined) choose(key);
    }
  };

  const named = epics.filter((e) => e.key !== NO_EPIC);
  const noEpic = epics.find((e) => e.key === NO_EPIC);
  const option = (key: string, children: ReactNode, extra?: string) => (
    <div
      key={key}
      role="option"
      tabIndex={-1}
      data-key={key}
      aria-selected={key === value}
      onClick={() => choose(key)}
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-2 rounded-[3px] px-2 text-[15px] focus-mark md:min-h-9',
        key === value ? 'bg-vk-bg-panel text-vk-text-high' : 'text-vk-text-normal hover:bg-vk-bg-secondary',
        extra,
      )}
    >
      {children}
    </div>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          ROW,
          'inline-flex max-w-full items-center gap-1.5 rounded-[3px] border bg-vk-bg-primary pl-2.5 pr-2 font-vk-sans text-[15px] text-vk-text-high focus-mark',
          open ? 'border-vk-brand' : 'border-vk-border',
        )}
      >
        <span className="text-vk-text-low">{t('Epic:')}</span>{' '}
        {chosen === undefined ? (
          t('Epic: all')
        ) : (
          <>
            {epicDotStyle(chosen.key) && (
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={epicDotStyle(chosen.key)} />
            )}
            <span className="min-w-0 truncate">
              {chosen.key === NO_EPIC ? epicLabel(chosen) : `${chosen.key} · ${epicProgress(chosen)}`}
            </span>
          </>
        )}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d={open ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={t('Choose an epic')}
          onKeyDown={onListKey}
          className="absolute left-0 top-full z-30 mt-1 flex w-[min(320px,calc(100vw-32px))] flex-col gap-0.5 rounded-[4.5px] border border-vk-border bg-vk-bg-primary p-1 font-vk-sans shadow-lg"
        >
          {option(ALL_EPICS, <><span className="w-3.5" aria-hidden="true" />{t('All tasks')}</>)}
          {named.map((e) =>
            option(
              e.key,
              <>
                <span aria-hidden="true" className="flex w-3.5 shrink-0 justify-center">
                  <span className="h-2 w-2 rounded-full" style={epicDotStyle(e.key)} />
                </span>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{epicLabel(e)}</span>
                <span className="shrink-0 text-[13px] text-vk-text-low">{epicProgress(e)}</span>
              </>,
            ),
          )}
          {typeof plannedEmpty === 'string' && plannedEmpty.length > 0 && (
            <div
              aria-disabled="true"
              className="flex min-h-9 items-center gap-2 border-t border-vk-border px-2 text-[15px] text-vk-text-low"
            >
              <span className="w-3.5" aria-hidden="true" />
              <span className="font-vk-mono text-[13px]">{plannedEmpty}</span>
              <span>{t('no plan yet')}</span>
            </div>
          )}
          {noEpic !== undefined &&
            option(
              NO_EPIC,
              <>
                <span className="w-3.5" aria-hidden="true" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{epicLabel(noEpic)}</span>
                <span className="shrink-0 text-[13px] text-vk-text-low">{noEpic.total}</span>
              </>,
              'mt-0.5 border-t border-vk-border',
            )}
        </div>
      )}
    </div>
  );
}

/**
 * «Проект: Все ▾» (vk-final part 2): the project choice as a VK menu beside
 * «Эпик», with each project's count inside the menu. Same keyboard model as
 * the epic menu (arrows, Enter/Space, Escape, outside click closes).
 */
function ProjectSelect({
  projects,
  value,
  onChange,
}: {
  projects: readonly { key: string; label: string; count: number }[];
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useKeepMenuOnScreen(open, listRef);
  const listId = useId();
  const chosen = projects.find((p) => p.key === value) ?? projects[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent | MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"], [role="option"]')?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (key: string) => {
    onChange(key);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = options.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      options[(at + step + options.length) % options.length]?.focus();
    } else if ((event.key === 'Enter' || event.key === ' ') && at >= 0) {
      event.preventDefault();
      const key = options[at]?.dataset.key;
      if (key !== undefined) choose(key);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          ROW,
          'inline-flex max-w-full items-center gap-1.5 rounded-[3px] border bg-vk-bg-primary pl-2.5 pr-2 font-vk-sans text-[15px] text-vk-text-high focus-mark',
          open ? 'border-vk-brand' : 'border-vk-border',
        )}
      >
        <span className="text-vk-text-low">{t('Project:')}</span>{' '}
        <span className="min-w-0 truncate">{chosen?.label ?? t('All')}</span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d={open ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={t('Choose a project')}
          onKeyDown={onListKey}
          className="absolute left-0 top-full z-30 mt-1 flex w-[min(280px,calc(100vw-32px))] flex-col gap-0.5 rounded-[4.5px] border border-vk-border bg-vk-bg-primary p-1 font-vk-sans shadow-lg"
        >
          {projects.map((p) => (
            <div
              key={p.key}
              role="option"
              tabIndex={-1}
              data-key={p.key}
              aria-selected={p.key === value}
              onClick={() => choose(p.key)}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2 rounded-[3px] px-2 text-[15px] focus-mark md:min-h-9',
                p.key === value ? 'bg-vk-bg-panel text-vk-text-high' : 'text-vk-text-normal hover:bg-vk-bg-secondary',
              )}
            >
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{p.label}</span>
              <span className="tnum shrink-0 text-[13px] text-vk-text-low">{p.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewTask({ url }: { url: string | null | undefined }) {
  const className = cn(
    ROW,
    'inline-flex items-center gap-1 rounded-[3px] bg-vk-brand-secondary px-2.5 font-vk-sans text-base font-medium text-vk-on-brand focus-mark',
  );
  const plus = (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
  if (typeof url !== 'string' || url.length === 0) {
    return (
      <button
        type="button"
        disabled
        title={t('The Mayor channel is not configured')}
        className={cn(className, 'cursor-not-allowed opacity-60')}
      >
        {t('New task')}
        {plus}
      </button>
    );
  }
  return (
    <ExternalLink href={url} className={className}>
      {t('New task')}
      {plus}
    </ExternalLink>
  );
}

export function BoardFilterBar({
  projects,
  project,
  onProject,
  search,
  onSearch,
  matched,
  total,
  testCount,
  showTests,
  onShowTests,
  epics = NO_EPICS,
  epic = ALL_EPICS,
  onEpic,
  sources = ONE_SOURCE,
  ownerFilter = 'all',
  onOwnerFilter,
  newTaskUrl,
  plannedEmpty,
}: BoardFilterBarProps) {
  const testsId = useId();
  // `all` plus at least two projects with cards.
  const showProjects = projects.length > 2;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <OwnerChips sources={sources} value={ownerFilter} {...(onOwnerFilter ? { onChange: onOwnerFilter } : {})} />
      <EpicSelect
        epics={epics}
        value={epic}
        plannedEmpty={plannedEmpty}
        {...(onEpic ? { onChange: onEpic } : {})}
      />
      {showProjects && <ProjectSelect projects={projects} value={project} onChange={onProject} />}
      <div className="min-w-0 basis-full md:basis-[220px]">
        <ListSearchBar
          value={search}
          onChange={onSearch}
          placeholder={t('Find a task…')}
          matchCount={matched}
          totalCount={total}
          ariaLabel={t('Search beads')}
        />
      </div>
      {/* undefined = the page has not wired the seam yet (it still has its own button). */}
      {newTaskUrl !== undefined && <NewTask url={newTaskUrl} />}
      {testCount > 0 && (
        <label htmlFor={testsId} className="flex items-center gap-2 font-vk-sans text-[15px] text-vk-text-normal">
          <input
            id={testsId}
            type="checkbox"
            checked={showTests}
            onChange={(event) => onShowTests(event.target.checked)}
            className="h-4 w-4 accent-[oklch(var(--fg))] focus-mark"
          />
          {t('Show test tasks ({n})', { n: testCount })}
        </label>
      )}
    </div>
  );
}
