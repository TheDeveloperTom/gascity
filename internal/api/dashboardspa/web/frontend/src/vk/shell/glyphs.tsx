import type { ReactNode } from 'react';

// vk-1to1 16.11: the canvas header icons (Main.dc.html), path for path.

function Svg({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

export function LinkGlyph() {
  return (
    <Svg size={15}>
      <path
        d="M6.6 9.4l2.8-2.8M7.2 4.6l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7l-1.2 1.2M8.8 11.4l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7l1.2-1.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function ListGlyph() {
  return (
    <Svg size={17}>
      <path
        d="M3 4.5h10M3 8h10M3 11.5h10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function HelpGlyph() {
  return (
    <Svg size={17}>
      <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M6.4 6.3a1.7 1.7 0 0 1 3.2.6c0 1.1-1.6 1.4-1.6 2.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.3" r="0.7" fill="currentColor" />
    </Svg>
  );
}

export function SettingsGlyph() {
  return (
    <Svg size={17}>
      <path
        d="M3 5h5.5M11.5 5H13M3 11h1.5M7.5 11H13"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="10" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.4" />
    </Svg>
  );
}
