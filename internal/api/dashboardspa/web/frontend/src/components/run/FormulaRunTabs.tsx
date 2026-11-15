import type { RunDisplayNode } from 'gas-city-dashboard-shared';
import { RunNodeSessionPanel } from './RunNodeSessionPanel';

interface FormulaRunTabsProps {
  selectedNode: RunDisplayNode | null;
}

/**
 * The run-evidence panel hosts the selected node's session transcript. It keeps
 * the labelled tab/tabpanel structure (a single Session tab) so the transcript
 * reads as one view of the run, matching the surrounding run-detail chrome.
 */
export function FormulaRunTabs({ selectedNode }: FormulaRunTabsProps) {
  return (
    <section aria-label="Run evidence" className="rounded-lg border border-rule bg-surface-raised">
      <div className="border-b border-rule px-4 py-2.5">
        <div
          className="inline-flex rounded-md border border-rule bg-surface-raised p-0.5 text-label"
          role="tablist"
          aria-label="Run evidence views"
        >
          <button
            id="run-evidence-tab-session"
            type="button"
            role="tab"
            aria-selected
            aria-controls="run-evidence-panel"
            className="focus-mark h-8 rounded bg-surface-tint px-3 font-semibold text-fg"
          >
            Session
          </button>
        </div>
      </div>
      <div
        id="run-evidence-panel"
        role="tabpanel"
        aria-labelledby="run-evidence-tab-session"
        className="px-4 py-4"
      >
        <RunNodeSessionPanel node={selectedNode} visible />
      </div>
    </section>
  );
}
