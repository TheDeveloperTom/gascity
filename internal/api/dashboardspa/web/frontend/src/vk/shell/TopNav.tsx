import { NavLink } from 'react-router';
import { t } from '../../i18n';
import { openCommandBar } from '../../lib/commandBar';
import { useNeedsFromMeCount, useNeedsFromMeIncomplete } from '../../lib/needsFromMe';
import { cn } from '../cn';
import { NeedsBadge, SearchGlyph, needsLabel } from './BottomTabs';

// vk lane 5: the desktop section tabs and the ⌘K search button of the VK top
// bar (design Attention / Main header). Desktop only: on phones the bottom
// tabs carry the same two sections plus «Поиск».

const TAB =
  'inline-flex h-[30px] items-center gap-1.5 rounded-[3px] px-2 text-[15px] transition-colors duration-150 ease-out-quart focus-mark';

export function TopNav() {
  const count = useNeedsFromMeCount();
  const incomplete = useNeedsFromMeIncomplete();
  return (
    <div className="hidden min-w-0 items-center gap-2 md:flex">
      <nav aria-label={t('Sections')} className="flex items-center gap-0.5">
        <NavLink
          to="/"
          end
          aria-label={needsLabel(count, incomplete)}
          className={({ isActive }) =>
            cn(
              TAB,
              isActive
                ? 'bg-vk-bg-panel text-vk-text-high'
                : 'text-vk-text-normal hover:bg-vk-bg-panel/60 hover:text-vk-text-high',
            )
          }
        >
          {t('Needs from me')}
          <NeedsBadge count={count} incomplete={incomplete} tone="warn" />
        </NavLink>
        <NavLink
          to="/beads"
          className={({ isActive }) =>
            cn(
              TAB,
              isActive
                ? 'bg-vk-bg-panel text-vk-text-high'
                : 'text-vk-text-normal hover:bg-vk-bg-panel/60 hover:text-vk-text-high',
            )
          }
        >
          {t('Board')}
        </NavLink>
      </nav>
      <button
        type="button"
        onClick={openCommandBar}
        className="inline-flex h-[30px] items-center gap-2 rounded-[3px] border border-vk-border bg-vk-bg-secondary pl-2 pr-1.5 text-[14px] text-vk-text-low transition-colors duration-150 ease-out-quart hover:text-vk-text-high focus-mark"
      >
        <SearchGlyph size={15} />
        {t('Search')}
        <kbd className="rounded-sm border border-vk-border px-1 font-vk-sans text-[12px] leading-4 text-vk-text-low">
          ⌘K
        </kbd>
      </button>
    </div>
  );
}
