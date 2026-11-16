import { CardShell, type CardShellProps } from './GraphCard';
import { GraphIcon } from './icons';

// An owner question in «От тебя» (Graph-Epic qcard): amber = «ждёт тебя»; the
// same size as a task card; «держит N» and «Ответить». Hovering «Ответить»
// is the V1 what-if preview.

export interface QuestionCardProps extends Omit<CardShellProps, 'children' | 'className'> {
  onAnswer: (id: string) => void;
  onAnswerHover: (id: string | null) => void;
}

export function QuestionCard({ onAnswer, onAnswerHover, ...shell }: QuestionCardProps) {
  const { node } = shell;
  return (
    <CardShell {...shell} className="vkg-q">
      <div className="vkg-row vkg-qhead">
        <GraphIcon name="hand" />
        <span className="vkg-label">{node.label}</span>
      </div>
      <span className="vkg-title" title={node.title}>
        {node.title}
      </span>
      <div className="vkg-row" style={{ justifyContent: 'space-between' }}>
        <span className="vkg-holds">держит {node.holds}</span>
        <button
          type="button"
          className="vkg-answer"
          onClick={(e) => {
            e.stopPropagation();
            onAnswer(node.id);
          }}
          onMouseEnter={() => onAnswerHover(node.id)}
          onMouseLeave={() => onAnswerHover(null)}
          onFocus={() => onAnswerHover(node.id)}
          onBlur={() => onAnswerHover(null)}
        >
          Ответить
        </button>
      </div>
    </CardShell>
  );
}
