import { Link, useLocation, useSearchParams } from 'react-router';
import { t } from '../../i18n';
import { mayorChannelUrl } from '../../lib/mayorLink';
import { openExternal } from '../../lib/openExternal';
import { cn } from '../cn';
import { useSelfIdentity, type SelfIdentity } from '../../lib/selfIdentity';

// vk-1to1 16.11: the canvas left project rail (Main / Attention .dc.html),
// desktop only. 56 px wide, bg-secondary with a right border, 8 px padding
// and gap: menu, the DW and ГО project tiles (the current one in
// active-bg / active-fg), «+» «Подключить проект», a spacer, the city's own avatar
// («А» here, «Р» in Richard's city; lib/selfIdentity)
// and the Mayor-in-Discord link. Phones keep the bottom tabs instead.

export const DW_PROJECT = 'devwork';
export const CITY_PROJECT = 'city';

const TILE =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-[4.5px] text-[14px] font-medium transition-colors duration-150 ease-out-quart focus-mark';
const IDLE = 'bg-vk-bg-primary text-vk-text-normal hover:text-vk-text-high';
const ACTIVE = 'bg-[var(--vkc-active-bg)] text-[var(--vkc-active-fg)]';

/** The project the board shows: `?project=` on /beads, DW by default. */
function currentProject(pathname: string, param: string | null): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path !== '/beads') return null;
  return param ?? DW_PROJECT;
}

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

export function ProjectRail({ identity }: { identity?: SelfIdentity } = {}) {
  const cityIdentity = useSelfIdentity();
  const me = identity ?? cityIdentity;
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const active = currentProject(pathname, params.get('project'));
  return (
    <nav
      aria-label={t('Projects')}
      className="sticky top-0 hidden h-screen w-14 shrink-0 flex-col items-center gap-2 border-r border-vk-border bg-vk-bg-secondary p-2 pt-[calc(0.5rem+var(--sait))] font-vk-sans md:flex"
    >
      <Link
        to="/"
        aria-label={t('Menu')}
        className={cn(TILE, 'bg-transparent text-vk-text-normal hover:bg-vk-bg-panel')}
      >
        <Svg>
          <rect
            x="2.5"
            y="3"
            width="11"
            height="10"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M2.5 6.5h11M6 6.5V13" stroke="currentColor" strokeWidth="1.4" />
        </Svg>
      </Link>
      <Link
        to={`/beads?project=${DW_PROJECT}`}
        aria-label={t('devwork product')}
        aria-current={active === DW_PROJECT ? 'page' : undefined}
        className={cn(TILE, active === DW_PROJECT ? ACTIVE : IDLE)}
      >
        DW
      </Link>
      <Link
        to={`/beads?project=${CITY_PROJECT}`}
        aria-label={t('The city itself')}
        aria-current={active === CITY_PROJECT ? 'page' : undefined}
        className={cn(TILE, active === CITY_PROJECT ? ACTIVE : IDLE)}
      >
        ГО
      </Link>
      <button
        type="button"
        aria-label={t('Connect a project')}
        title={t('Connect a project')}
        disabled
        className={cn(TILE, IDLE, 'cursor-default')}
      >
        <Svg>
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </Svg>
      </button>
      <div className="flex-1" />
      <span
        aria-label={t('You')}
        title={me.login === null ? t('Who you are: not read') : (me.name ?? t('You'))}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-vk-bg-panel text-[13px] font-medium text-vk-text-normal"
      >
        {me.initial}
      </span>
      {/* Always drawn (canvas). The city's mayor_url arrives later through
          usePeerBoards and is not reactive, so the link is read on click. */}
      <button
        type="button"
        aria-label={t('Mayor in Discord')}
        title={t('Mayor in Discord')}
        onClick={() => {
          const url = mayorChannelUrl();
          if (url !== null) openExternal(url);
        }}
        className={cn(TILE, IDLE)}
      >
        <Svg>
          <path
            d="M2.5 4h11v6.5H7.2L4 13v-2.5H2.5z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </Svg>
      </button>
    </nav>
  );
}
