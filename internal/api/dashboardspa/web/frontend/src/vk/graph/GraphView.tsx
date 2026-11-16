// STUB (page lane): the view lane owns this file; the integrator takes theirs.
import type { GraphModel } from './model';

export interface GraphViewProps {
  model: GraphModel;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAnswer: (questionId: string) => void;
}

export function GraphView({ model, selectedId, onSelect }: GraphViewProps) {
  return (
    <div data-testid="graph-view">
      {model.nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          data-graph-node={node.id}
          aria-pressed={node.id === selectedId}
          onClick={() => onSelect(node.id)}
        >
          {node.title}
        </button>
      ))}
    </div>
  );
}
