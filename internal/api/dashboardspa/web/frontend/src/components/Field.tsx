import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  children: ReactNode;
  variant?: 'definition' | 'form';
}

// Sentence-case labels above their value. `form` wraps the control in its
// label so the whole block is the hit target.
export function Field({ label, children, variant = 'definition' }: FieldProps) {
  if (variant === 'form') {
    return (
      <label className="block space-y-1.5">
        <span className="block text-label font-medium text-fg-muted">{label}</span>
        {children}
      </label>
    );
  }

  return (
    <div className="min-w-0">
      <dt className="mb-0.5 text-label font-medium text-fg-muted">{label}</dt>
      <dd className="text-body text-fg [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
