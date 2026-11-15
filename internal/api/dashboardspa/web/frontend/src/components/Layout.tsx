import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { BottomTabs } from '../vk/shell/BottomTabs';
import { Header } from './Header';

interface LayoutProps {
  children: ReactNode;
}

// Owner pages that use the wide measure (dashboard v3): «Нужно от меня» and
// «Доска». Debug pages keep the dashboard measure.
const WIDE_PATHS: ReadonlySet<string> = new Set(['/', '/beads']);

function isWidePath(pathname: string): boolean {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return WIDE_PATHS.has(trimmed === '' ? '/' : trimmed);
}

// Shell (vk lane 5): the VK top bar, then the main column, left-aligned and
// capped at the page's measure. Below md a fixed bottom tab bar carries the
// sections; main is padded by its height plus the bottom safe area so the bar
// never covers content. The side insets follow the safe area too (390×844
// portrait, Discord Activity insets first).
export function Layout({ children }: LayoutProps) {
  const { pathname } = useLocation();
  const measure = isWidePath(pathname) ? 'max-w-[120rem]' : 'max-w-dashboard';
  return (
    <div className="min-h-screen bg-vk-bg-primary text-fg antialiased">
      <Header />
      <main className="min-w-0 pb-[calc(3.5rem+var(--saib))] pl-[calc(1rem+var(--sail))] pr-[calc(1rem+var(--sair))] pt-3 md:px-6 md:pb-0 md:pt-6 lg:px-10 lg:pt-8">
        <div className={measure}>{children}</div>
      </main>
      <BottomTabs />
    </div>
  );
}
