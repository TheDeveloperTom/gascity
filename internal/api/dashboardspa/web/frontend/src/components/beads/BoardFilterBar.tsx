import { useId } from 'react';
import { t } from '../../i18n';
import { ListSearchBar } from '../ListSearchBar';

// The board's one filter row (B7): which project, a search, and whether test
// cards show. Nothing here is remembered: the owner starts from «Все» and
// without test cards on every visit. The project control hides when only one
// project has cards; the test checkbox hides when there are none.

interface BoardFilterBarProps {
  projects: readonly { key: string; label: string; count: number }[];
  project: string;
  onProject: (key: string) => void;
  search: string;
  onSearch: (value: string) => void;
  matched: number;
  total: number;
  testCount: number;
  showTests: boolean;
  onShowTests: (show: boolean) => void;
}

export function BoardFilterBar({
  projects,
  project,
  onProject,
  search,
  onSearch,
  matched,
  total,
  testCount,
  showTests,
  onShowTests,
}: BoardFilterBarProps) {
  const testsId = useId();
  // `all` plus at least two projects with cards.
  const showProjects = projects.length > 2;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      {showProjects && (
        <div role="group" aria-label={t('Project')} className="flex flex-wrap gap-1.5">
          {projects.map((p) => {
            const pressed = p.key === project;
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={pressed}
                onClick={() => onProject(p.key)}
                className={`h-8 rounded border px-3 text-label font-medium focus-mark ${
                  pressed
                    ? 'border-fg bg-fg text-surface'
                    : 'border-rule bg-surface-raised text-fg hover:bg-surface-tint'
                }`}
              >
                {p.label} <span className="tnum">{p.count}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="min-w-0 flex-1 basis-64">
        <ListSearchBar
          value={search}
          onChange={onSearch}
          placeholder={t('Find a task by title, id, label or assignee')}
          matchCount={matched}
          totalCount={total}
          ariaLabel={t('Search beads')}
        />
      </div>
      {testCount > 0 && (
        <label htmlFor={testsId} className="flex items-center gap-2 text-label text-fg">
          <input
            id={testsId}
            type="checkbox"
            checked={showTests}
            onChange={(event) => onShowTests(event.target.checked)}
            className="h-4 w-4 accent-[oklch(var(--fg))] focus-mark"
          />
          {t('Show test tasks ({n})', { n: testCount })}
        </label>
      )}
    </div>
  );
}
