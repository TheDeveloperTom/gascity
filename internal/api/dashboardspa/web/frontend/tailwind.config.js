// Tokens for the ds-research dashboard.
//
// All semantic colors resolve from CSS custom properties defined in
// styles/index.css under :root (light) and :root[data-theme="dark"]
// (or prefers-color-scheme: dark when the operator has not pinned a
// theme). The values are OKLCH triplets ("L% C H") so Tailwind's
// alpha-value substitution works via `oklch(var(--token) / <alpha>)`.

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Dark mode is selector-driven on <html data-theme="dark">. The CSS
  // also reacts to prefers-color-scheme directly so SSR/no-JS isn't
  // stuck in the wrong theme.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      // «Табличка» (OWNER-HOME-REVIEW §4). plate is the enamel street plate:
      // the plate ground and the focus ring only. primary is ink. accent is
      // stop red (broken or failed), warn lamp amber (city trouble).
      colors: {
        plate: 'oklch(var(--plate) / <alpha-value>)',
        'on-plate': 'oklch(var(--on-plate) / <alpha-value>)',
        'on-plate-muted': 'oklch(var(--on-plate-muted) / <alpha-value>)',
        surface: 'oklch(var(--surface) / <alpha-value>)',
        'surface-raised': 'oklch(var(--surface-raised) / <alpha-value>)',
        'surface-tint': 'oklch(var(--surface-tint) / <alpha-value>)',
        fg: 'oklch(var(--fg) / <alpha-value>)',
        'fg-muted': 'oklch(var(--fg-muted) / <alpha-value>)',
        'fg-faint': 'oklch(var(--fg-faint) / <alpha-value>)',
        rule: 'oklch(var(--rule) / <alpha-value>)',
        primary: 'oklch(var(--primary) / <alpha-value>)',
        'on-primary': 'oklch(var(--on-primary) / <alpha-value>)',
        accent: 'oklch(var(--accent) / <alpha-value>)',
        ok: 'oklch(var(--ok) / <alpha-value>)',
        warn: 'oklch(var(--warn) / <alpha-value>)',
        scrim: 'oklch(var(--scrim) / <alpha-value>)',
        // vibe-kanban names (src/vk/), aliases of the tokens above via the
        // --vk-* custom properties in styles/index.css: bg-vk-bg-primary,
        // text-vk-text-high, border-vk-border, bg-vk-brand, ...
        'vk-brand': 'oklch(var(--vk-brand) / <alpha-value>)',
        'vk-brand-secondary': 'oklch(var(--vk-brand-secondary) / <alpha-value>)',
        'vk-on-brand': 'oklch(var(--vk-on-brand) / <alpha-value>)',
        'vk-bg-primary': 'oklch(var(--vk-bg-primary) / <alpha-value>)',
        'vk-bg-secondary': 'oklch(var(--vk-bg-secondary) / <alpha-value>)',
        'vk-bg-panel': 'oklch(var(--vk-bg-panel) / <alpha-value>)',
        'vk-text-high': 'oklch(var(--vk-text-high) / <alpha-value>)',
        'vk-text-normal': 'oklch(var(--vk-text-normal) / <alpha-value>)',
        'vk-text-low': 'oklch(var(--vk-text-low) / <alpha-value>)',
        'vk-border': 'oklch(var(--vk-border) / <alpha-value>)',
      },
      fontFamily: {
        // Golos Text Variable, self-hosted (styles/index.css @font-face).
        sans: ['"Golos Text Variable"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        // PT Sans Narrow Bold, self-hosted: the plate headline and the few
        // big numbers only. Narrow fallbacks keep the plate's width if it fails.
        display: ['"PT Sans Narrow"', '"Arial Narrow"', '"Roboto Condensed"', 'sans-serif'],
        // Mono only for copyable ids and literal terminal output.
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', '"Liberation Mono"', 'monospace'],
        // IBM Plex for the vibe-kanban port, self-hosted via @fontsource (main.tsx).
        'vk-sans': ['"IBM Plex Sans"', '"Golos Text Variable"', 'system-ui', 'sans-serif'],
        'vk-mono': ['"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      fontSize: {
        // DESIGN-PLAN §4. No positive tracking anywhere: labels are
        // sentence case at tracking 0, the two large steps tighten a touch.
        label: ['0.8125rem', { lineHeight: '1.125rem', letterSpacing: '0' }],
        body: ['0.9375rem', { lineHeight: '1.4375rem' }],
        reading: ['1rem', { lineHeight: '1.6' }],
        title: ['1.125rem', { lineHeight: '1.5rem' }],
        headline: ['1.5rem', { lineHeight: '1.875rem', letterSpacing: '-0.01em' }],
        display: ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.015em' }],
      },
      letterSpacing: {
        tightest: '-0.03em',
        tighter: '-0.02em',
        tight: '-0.01em',
        normal: '0',
        wide: '0.02em',
        wider: '0.04em',
        widest: '0.08em',
      },
      // Radius by hierarchy: sm meters and id chips, DEFAULT buttons and
      // inputs, md step cards and nav items, lg panels, modals and the board.
      borderRadius: {
        none: '0',
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '12px',
        // The enamel plate's corner (review §5: plate 12, buttons 6).
        plate: '12px',
        full: '9999px',
      },
      // Elevation e2 is for overlays only (modals, expanded transcript).
      boxShadow: {
        overlay: 'var(--shadow-overlay)',
      },
      maxWidth: {
        dashboard: '76rem',
        prose: '70ch',
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
      },
    },
  },
  plugins: [],
};
