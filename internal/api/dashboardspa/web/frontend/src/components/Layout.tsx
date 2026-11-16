import type { ReactNode } from 'react';
import { BottomTabs } from '../vk/shell/BottomTabs';
import { ProjectRail } from '../vk/shell/ProjectRail';
import { Header } from './Header';

interface LayoutProps {
  children: ReactNode;
}

// Shell (vk-1to1 16.11): the canvas 56 px project rail (desktop), then the
// column: the 44 px header and the main column. Owner 16.11 (2000 px): no
// max-width cap on any page; every page uses the full width inside main's
// padding. Below md a fixed bottom tab bar carries the
// sections; main is padded by its height plus the bottom safe area so the bar
// never covers content. The side insets follow the safe area too (390×844
// portrait; the installed PWA runs edge to edge).
export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex min-h-screen bg-vk-bg-primary text-vk-text-normal antialiased">
      <ProjectRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-w-0 pb-[calc(3.5rem+var(--saib))] pl-[calc(1rem+var(--sail))] pr-[calc(1rem+var(--sair))] pt-3 md:px-4 md:pb-0 md:pt-4">
          <div className="w-full min-w-0">{children}</div>
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}
