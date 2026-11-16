import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { BottomTabs } from '../vk/shell/BottomTabs';
import { ProjectRail } from '../vk/shell/ProjectRail';
import { Header } from './Header';

interface LayoutProps {
  children: ReactNode;
}

// The board uses the wide measure (four columns); «Нужно от меня» is a list
// read top to bottom, so it keeps a reading measure, centred on wide screens
// (design pass 15.11: a 2000 px row of one sentence is unreadable). Debug
// pages keep the dashboard measure.
function measureOf(pathname: string): string {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const path = trimmed === '' ? '/' : trimmed;
  if (path === '/beads') return 'max-w-[120rem]';
  // polish2 16.11 (owner, 2000 px): two columns from xl, capped at 1600 px.
  if (path === '/') return 'mx-auto max-w-[100rem]';
  return 'max-w-dashboard';
}

// Shell (vk-1to1 16.11): the canvas 56 px project rail (desktop), then the
// column: the 44 px header and the main column, left-aligned and
// capped at the page's measure. Below md a fixed bottom tab bar carries the
// sections; main is padded by its height plus the bottom safe area so the bar
// never covers content. The side insets follow the safe area too (390×844
// portrait; the installed PWA runs edge to edge).
export function Layout({ children }: LayoutProps) {
  const { pathname } = useLocation();
  const measure = measureOf(pathname);
  return (
    <div className="flex min-h-screen bg-vk-bg-primary text-vk-text-normal antialiased">
      <ProjectRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-w-0 pb-[calc(3.5rem+var(--saib))] pl-[calc(1rem+var(--sail))] pr-[calc(1rem+var(--sair))] pt-3 md:px-4 md:pb-0 md:pt-4">
          <div className={measure}>{children}</div>
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}
