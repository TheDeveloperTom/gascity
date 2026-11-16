import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { t } from '../../i18n';
import { openCommandBar } from '../../lib/commandBar';
import { useNeedsFromMeCount, useNeedsFromMeIncomplete } from '../../lib/needsFromMe';
import { cn } from '../cn';

// vk lane 5: the phone bottom tab bar (design Phone-Needs / Phone-Board /
// Phone-Card). Three equal tabs, each a 24 px icon centred above a label that
// shares one baseline with the others; the red count sits on the icon's
// top-right corner. Phone only (`md:hidden`); the bar is h-14 plus the bottom
// safe area. Glyphs are drawn from the approved design frames, not from
// vibe-kanban source.

interface GlyphProps {
  size?: number;
  className?: string;
}

function Glyph({ size = 24, className, children }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className ?? 'block'}
    >
      {children}
    </svg>
  );
}

export function NeedsGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path
        d="M5.5 8.5V4a1 1 0 0 1 2 0v3.5M7.5 7V2.8a1 1 0 0 1 2 0V7.5M9.5 7.5V4a1 1 0 0 1 2 0v5c0 2.7-1.8 4.6-4.2 4.6-1.6 0-2.7-.8-3.5-2.1L2.5 9.4a1 1 0 0 1 1.6-1.2L5.5 9.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Glyph>
  );
}

export function BoardGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.2 3v10M9.8 3v10" stroke="currentColor" strokeWidth="1.3" />
    </Glyph>
  );
}

export function SearchGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.5 10.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </Glyph>
  );
}

export function MoreGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
    </Glyph>
  );
}

/**
 * The «Нужно от меня» count. Hidden at zero. Canvas: on the phone tab it is
 * red #C53030 with white figures in both themes (Phone-Board); in the desktop
 * header it is the amber warn chip (Attention).
 */
export function NeedsBadge({
  count,
  className,
  tone = 'red',
  incomplete = false,
}: {
  count: number;
  className?: string;
  tone?: 'red' | 'warn';
  /** The count may miss an unread store's questions: shown as «N?». */
  incomplete?: boolean;
}) {
  if (count <= 0) return null;
  return (
    <span
      data-testid="needs-badge"
      aria-hidden="true"
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] font-semibold leading-[18px] tnum',
        tone === 'red'
          ? 'bg-[#C53030] text-[11px] text-white'
          : 'bg-[var(--vkc-warn-bg)] text-[12px] text-warn',
        className,
      )}
    >
      {count}
      {incomplete ? '?' : ''}
    </span>
  );
}

/** One accessible name for the «Нужно от меня» tab, with the count when there is one. */
export function needsLabel(count: number, incomplete = false): string {
  if (count <= 0) return t('Needs from me');
  return incomplete
    ? t('Needs from me, {n}, not fully read', { n: count })
    : t('Needs from me, {n}', { n: count });
}

const TAB =
  'flex h-14 w-full min-w-0 flex-col items-center gap-1 pt-2 transition-colors duration-150 ease-out-quart focus-mark';
const LABEL = 'block h-4 whitespace-nowrap text-[12px] leading-4';

function TabFace({
  icon,
  label,
  active,
  badge,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  badge?: ReactNode;
}) {
  return (
    <>
      <span className={cn('relative block h-6 w-6', active && 'text-vk-brand')}>
        {icon}
        {badge}
      </span>
      <span className={cn(LABEL, active ? 'font-semibold' : 'font-normal')}>{label}</span>
    </>
  );
}

const tabTone = (active: boolean) => (active ? 'text-vk-text-high' : 'text-vk-text-low');

export function BottomTabs() {
  const count = useNeedsFromMeCount();
  const incomplete = useNeedsFromMeIncomplete();
  return (
    <nav
      aria-label={t('Sections')}
      className="fixed inset-x-0 bottom-0 z-30 box-content h-14 border-t border-vk-border bg-vk-bg-primary pb-[var(--saib)] pl-[var(--sail)] pr-[var(--sair)] font-vk-sans md:hidden"
    >
      <ul className="grid h-14 grid-cols-3">
        <li className="min-w-0">
          <NavLink
            to="/"
            end
            aria-label={needsLabel(count, incomplete)}
            className={({ isActive }) => cn(TAB, tabTone(isActive))}
          >
            {({ isActive }) => (
              <TabFace
                icon={<NeedsGlyph />}
                label={t('Needs from me')}
                active={isActive}
                badge={<NeedsBadge count={count} incomplete={incomplete} className="absolute -top-1 left-4" />}
              />
            )}
          </NavLink>
        </li>
        <li className="min-w-0">
          <NavLink to="/beads" className={({ isActive }) => cn(TAB, tabTone(isActive))}>
            {({ isActive }) => (
              <TabFace icon={<BoardGlyph />} label={t('Board')} active={isActive} />
            )}
          </NavLink>
        </li>
        <li className="min-w-0">
          <button type="button" onClick={openCommandBar} className={cn(TAB, tabTone(false))}>
            <TabFace icon={<SearchGlyph />} label={t('Search')} active={false} />
          </button>
        </li>
      </ul>
    </nav>
  );
}
