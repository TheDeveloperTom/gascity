import type { ReactNode } from 'react';
import { Header } from './Header';

interface LayoutProps {
  children: ReactNode;
}

// Shell: the rail header on the left from `lg` up (a top bar below it),
// then the main column on the pavement, capped at the dashboard measure.
// The rail's fill and edge live on the full-height grid column, so the rail
// stays one continuous strip however long the page; the header inside it
// is the sticky, viewport-tall part.
export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-surface text-fg antialiased lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="lg:border-r lg:border-rule lg:bg-surface-raised">
        <Header />
      </div>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-dashboard">{children}</div>
      </main>
    </div>
  );
}
