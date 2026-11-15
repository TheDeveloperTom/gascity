import type { RunDisplayNode, FormulaRunDetail } from 'gas-city-dashboard-shared';
import { FormulaRunNode } from './FormulaRunNode';

interface FormulaRunDiagramProps {
  detail: FormulaRunDetail;
  selectedNodeId: string | null;
  onToggleNode: (nodeId: string) => void;
}

export function FormulaRunDiagram({
  detail,
  selectedNodeId,
  onToggleNode,
}: FormulaRunDiagramProps) {
  const nodes = orderedNodes(detail);
  const laneLabels = nodeLaneLabels(detail);

  if (nodes.length === 0) {
    return (
      <p className="text-body text-fg-muted">
        No graph nodes have materialized for this formula run.
      </p>
    );
  }

  return (
    <section
      aria-label="Formula run graph"
      className="min-w-0 rounded-lg border border-rule bg-surface-raised"
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-rule px-4 py-3">
        <h2 className="text-title font-semibold text-fg">Steps</h2>
      </div>
      <ol className="relative space-y-3 p-4">
        {nodes.map((node, index) => {
          const laneLabel = laneLabels.get(node.id);
          const previousLaneLabel =
            index > 0 ? laneLabels.get(nodes[index - 1]?.id ?? '') : undefined;
          const showLaneLabel = laneLabel !== undefined && laneLabel !== previousLaneLabel;
          return (
            <li key={node.id} className="relative pl-6">
              {showLaneLabel && (
                <p className="mb-1.5 text-label font-medium text-fg-muted [overflow-wrap:anywhere]">
                  {laneLabel}
                </p>
              )}
              {index < nodes.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute left-2 top-10 bottom-[-0.75rem] border-l border-rule"
                />
              )}
              <span
                aria-hidden="true"
                className="absolute left-[0.3125rem] top-7 h-2 w-2 rounded-full bg-fg-faint"
              />
              <FormulaRunNode
                node={node}
                selected={selectedNodeId === node.id}
                onToggle={onToggleNode}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function orderedNodes(detail: FormulaRunDetail): RunDisplayNode[] {
  return detail.nodes.filter((node) => node.visibleInGraph !== false);
}

function nodeLaneLabels(detail: FormulaRunDetail): Map<string, string> {
  const labels = new Map<string, string>();
  for (const lane of detail.lanes) {
    for (const nodeId of lane.nodeIds) {
      labels.set(nodeId, lane.label);
    }
  }
  return labels;
}
