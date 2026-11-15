import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Actions look like actions (DESIGN-PLAN §9.6): boxed, sentence case,
// semibold. 'default' is a white box on the pavement. 'accent' is the one
// primary action of a view, filled Gas-flame blue (the tone keeps its old
// name so call sites stay put; red is reserved for alarms). 'quiet' is a
// blue text action for inline list rows (Peek, Approve, Copy attach).

export type ButtonTone = 'default' | 'accent' | 'quiet';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
  children: ReactNode;
}

const TONE: Record<ButtonTone, string> = {
  default:
    'border border-rule bg-surface-raised text-fg hover:bg-surface-tint disabled:hover:bg-surface-raised',
  accent: 'border border-primary bg-primary text-on-primary hover:bg-primary/90',
  quiet: 'border border-transparent text-primary hover:bg-primary/10 disabled:hover:bg-transparent',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-label',
  md: 'h-9 px-4 text-body',
};

export function Button({
  tone = 'default',
  size = 'sm',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-semibold transition-colors duration-150 ease-out-quart focus-mark disabled:cursor-not-allowed disabled:opacity-45 ${TONE[tone]} ${SIZE[size]} ${className}`}
    >
      {children}
    </button>
  );
}
