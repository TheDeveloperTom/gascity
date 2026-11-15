import { CollapsibleHeader } from './CollapsibleHeader';

// ProjectGroupHeader: the title above one project's table, clickable to
// fold it. Project name at title size, the row count in a neutral pill.
//
// The non-collapsible variant is a quiet label (no chevron, no count),
// used for the Orchestration pseudo-group that pins cross-rig sessions at
// the top: there is nothing to fold, and it is not a rig.

interface ProjectGroupHeaderProps {
  project: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  collapsible?: boolean;
}

export function ProjectGroupHeader({
  project,
  count,
  collapsed,
  onToggle,
  collapsible = true,
}: ProjectGroupHeaderProps) {
  if (!collapsible) {
    return (
      <div role="heading" aria-level={2} className="mb-2 py-1 text-label font-medium text-fg-muted">
        {project}
      </div>
    );
  }
  return (
    <CollapsibleHeader
      collapsed={collapsed}
      onToggle={onToggle}
      className="group mb-2 flex w-full items-center gap-2 rounded py-1 text-left focus-mark"
      glyphClassName="w-3 group-hover:text-fg-muted"
    >
      {({ glyph }) => (
        <>
          {glyph}
          <span className="min-w-0 truncate text-title font-semibold text-fg">{project}</span>
          <span className="inline-flex min-w-[1.375rem] justify-center rounded-full bg-fg/[0.06] px-1.5 text-label font-semibold text-fg-muted tnum">
            {count}
          </span>
        </>
      )}
    </CollapsibleHeader>
  );
}
