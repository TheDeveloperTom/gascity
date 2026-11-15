import type { ReactNode } from 'react';
import { tIfKnown } from '../i18n';

// The opener of every route: an optional back link, the h1 naming the
// view, a one-line synopsis of state, and a right-aligned meta slot (live
// indicator, refresh). Quiet on purpose: on Home the signal board is the
// loud thing, so page titles stay at headline size.
//
// This renders a <header>. It must never contain a <nav>: the app's only
// nav lives in the rail header and tests locate it as `header nav`.

interface PageHeaderProps {
  title: string;
  synopsis?: ReactNode;
  meta?: ReactNode;
  /** Back link above the h1, e.g. `<Link to="/runs">← Runs</Link>`. */
  back?: ReactNode;
  className?: string;
}

export function PageHeader({ title, synopsis, meta, back, className = '' }: PageHeaderProps) {
  return (
    <header
      className={`mb-8 grid grid-cols-1 items-start gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end ${className}`}
    >
      <div className="min-w-0 space-y-1.5">
        {back && (
          <p className="text-label font-medium [&_a:hover]:underline [&_a]:text-primary [&_a]:underline-offset-2">
            {back}
          </p>
        )}
        <h1 className="text-headline font-semibold text-fg [overflow-wrap:anywhere]">
          {tIfKnown(title)}
        </h1>
        {synopsis && <p className="max-w-prose text-body text-fg-muted">{synopsis}</p>}
      </div>
      {meta && <div className="flex flex-wrap items-center gap-3 md:justify-end">{meta}</div>}
    </header>
  );
}
