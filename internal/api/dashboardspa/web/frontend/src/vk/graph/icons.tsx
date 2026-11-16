// The mockups' 16×16 line icons (gen.py ICONS), used by the graph cards.

const PATHS = {
  hand: (
    <path
      d="M5.5 8.5V4a1 1 0 0 1 2 0v3.5M7.5 7V2.8a1 1 0 0 1 2 0V7.5M9.5 7.5V4a1 1 0 0 1 2 0v5c0 2.7-1.8 4.6-4.2 4.6-1.6 0-2.7-.8-3.5-2.1L2.5 9.4a1 1 0 0 1 1.6-1.2L5.5 9.8"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  slash: (
    <>
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 4l8 8" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 5v3.2l2 1.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  down: (
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  ),
} as const;

export type GraphIconName = keyof typeof PATHS;

export function GraphIcon({ name, size = 14 }: { name: GraphIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      {PATHS[name]}
    </svg>
  );
}
