import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { Header } from './Header';

interface LayoutProps {
  children: ReactNode;
}

// Owner pages that use the wide measure (dashboard v3): Главная and «Задачи».
// Debug pages keep the dashboard measure.
const WIDE_PATHS: ReadonlySet<string> = new Set(['/', '/beads']);

function isWidePath(pathname: string): boolean {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return WIDE_PATHS.has(trimmed === '' ? '/' : trimmed);
}

// Shell: the rail header on the left from `lg` up (a top bar below it),
// then the main column on the pavement, capped at the dashboard measure and
// left-aligned against the rail (DESIGN-PLAN §6: everything is left-aligned).
// The rail's fill and edge live on the full-height grid column, so the rail
// stays one continuous strip however long the page; the header inside it
// is the sticky, viewport-tall part.
export function Layout({ children }: LayoutProps) {
  const { pathname } = useLocation();
  const measure = isWidePath(pathname) ? 'max-w-[120rem]' : 'max-w-dashboard';
  return (
    <div className="min-h-screen bg-surface text-fg antialiased lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="lg:border-r lg:border-rule lg:bg-surface-raised">
        <Header />
      </div>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className={measure}>{children}</div>
      </main>
    </div>
  );
}
