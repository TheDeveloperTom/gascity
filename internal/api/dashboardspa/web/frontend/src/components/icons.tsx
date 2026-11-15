import type { ReactNode } from 'react';
import type { StatusTone } from './StatusBadge';

// Signpost pictograms (DESIGN-PLAN §5). Drawn by hand for this dashboard on a
// 20 px grid, 1.75 px stroke in currentColor so they take the colour of the
// text beside them. Always decorative: the word next to them carries the
// meaning, so every icon is aria-hidden and never focusable.

export type IconName =
  | 'home'
  | 'runs'
  | 'agents'
  | 'beads'
  | 'mail'
  | 'activity'
  | 'health'
  | 'flame'
  | 'search'
  | 'sun'
  | 'moon'
  | 'chevron-left'
  | 'external';

const PATHS: Record<IconName, ReactNode> = {
  // House: roof, walls, door.
  home: (
    <>
      <path d="M3.25 9.25 10 3.75l6.75 5.5" />
      <path d="M5.25 8v8.25h9.5V8" />
      <path d="M8.5 16.25v-4h3v4" />
    </>
  ),
  // Route between two stops.
  runs: (
    <>
      <circle cx="4.75" cy="4.75" r="1.75" />
      <circle cx="15.25" cy="15.25" r="1.75" />
      <path d="M6.5 4.75h5.25a2.75 2.75 0 0 1 0 5.5h-3.5a2.75 2.75 0 0 0 0 5.5h5.25" />
    </>
  ),
  // Two heads, one behind the other.
  agents: (
    <>
      <circle cx="7.75" cy="7" r="2.75" />
      <path d="M2.75 16.5c0-2.8 2.25-5 5-5s5 2.2 5 5" />
      <path d="M12.75 4.6a2.5 2.5 0 1 1 1.5 4.75" />
      <path d="M14.5 11.6c1.75.5 2.75 2.4 2.75 4.9" />
    </>
  ),
  // Three beads on a thread.
  beads: (
    <>
      <circle cx="5" cy="10" r="2.25" />
      <circle cx="10" cy="10" r="2.25" />
      <circle cx="15" cy="10" r="2.25" />
      <path d="M1.75 10h1M7.25 10h.5M12.25 10h.5M17.25 10h1" />
    </>
  ),
  // Envelope.
  mail: (
    <>
      <rect x="2.75" y="4.75" width="14.5" height="10.5" rx="1.5" />
      <path d="m3.5 5.75 6.5 5 6.5-5" />
    </>
  ),
  // Pulse line.
  activity: <path d="M2.25 10.5H6l2-5.25 4 9.5 2-4.25h3.75" />,
  // Heart with a heartbeat through it.
  health: (
    <>
      <path d="M10 16.5S3.5 12.6 3.5 7.9A3.4 3.4 0 0 1 10 6.1a3.4 3.4 0 0 1 6.5 1.8c0 4.7-6.5 8.6-6.5 8.6Z" />
      <path d="M6.25 10h2l1-1.75 1.5 3.25 1-1.5h2" />
    </>
  ),
  // Gas flame: outer tongue and the inner core.
  flame: (
    <>
      <path d="M10 2.5c.75 2.6 5 4.6 5 9a5 5 0 0 1-10 0c0-2.1 1-3.4 2.1-4.5.2 1.5 1 2.4 2 2.8-.4-2.6-.1-5.1.9-7.3Z" />
      <path d="M10 17.25a2.1 2.1 0 0 1-2.1-2.1c0-1.4 1.3-2.2 2.1-3.4.8 1.2 2.1 2 2.1 3.4a2.1 2.1 0 0 1-2.1 2.1Z" />
    </>
  ),
  search: (
    <>
      <circle cx="8.75" cy="8.75" r="5" />
      <path d="m12.5 12.5 4.25 4.25" />
    </>
  ),
  sun: (
    <>
      <circle cx="10" cy="10" r="3.25" />
      <path d="M10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.25 1.25M14.05 14.05l1.25 1.25M4.7 15.3l1.25-1.25M14.05 5.95l1.25-1.25" />
    </>
  ),
  moon: <path d="M16 12.25A6.5 6.5 0 0 1 7.75 4a6.5 6.5 0 1 0 8.25 8.25Z" />,
  'chevron-left': <path d="M12 4.5 6.5 10l5.5 5.5" />,
  external: (
    <>
      <path d="M11.5 3.75h4.75V8.5" />
      <path d="m16.25 3.75-7 7" />
      <path d="M14 11.5v3.75a1 1 0 0 1-1 1H4.75a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H8.5" />
    </>
  ),
};

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}

// Status shapes for pills: the shape survives greyscale and colour
// blindness. Golos has no ● ▲ ■ glyphs, so these replace the text glyphs.
const SHAPES: Record<StatusTone, ReactNode> = {
  ok: <circle cx="4" cy="4" r="3.5" fill="currentColor" />,
  warn: <path d="M4 .6 7.6 7.2H.4Z" fill="currentColor" />,
  stuck: <rect x=".75" y=".75" width="6.5" height="6.5" rx=".75" fill="currentColor" />,
  neutral: <circle cx="4" cy="4" r="2.75" fill="none" stroke="currentColor" strokeWidth="1.5" />,
};

export function StatusShape({ tone }: { tone: StatusTone }) {
  return (
    <svg
      viewBox="0 0 8 8"
      width="8"
      height="8"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {SHAPES[tone]}
    </svg>
  );
}
