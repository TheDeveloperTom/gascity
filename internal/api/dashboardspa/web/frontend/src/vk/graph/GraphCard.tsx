import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { GraphIcon, type GraphIconName } from './icons';
import type { GraphNode, GraphNodeState } from './model';

// A task card on the graph (Graph-Epic, board-card anatomy): dot + mono label +
// avatar, one-line title, the reason chip. Selection, dimming and the hover
// tones are data attributes styled by graph.css.

export type CardTone = 'none' | 'hover' | 'near' | 'far' | 'go';

export interface CardBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const STATE_DOT: Record<GraphNodeState, string> = {
  in_work: '#22C55E',
  done: '#64748B',
  waits_owner: '#3B82F6',
  waits_task: '#3B82F6',
  free: '#3B82F6',
  nobody_took: '#3B82F6',
  failed: '#3B82F6',
};

export type ChipKind = 'owner' | 'task' | 'red' | 'free';

export function chipKind(state: GraphNodeState): ChipKind {
  if (state === 'waits_owner') return 'owner';
  if (state === 'nobody_took' || state === 'failed') return 'red';
  if (state === 'free') return 'free';
  return 'task';
}

const CHIP_ICON: Record<ChipKind, GraphIconName | null> = { owner: 'hand', task: 'slash', red: 'clock', free: null };

export function ReasonChip({ state, text, size = 13 }: { state: GraphNodeState; text: string; size?: number }) {
  const kind = chipKind(state);
  const icon = CHIP_ICON[kind];
  return (
    <span className="vkg-chip" data-kind={kind} style={{ fontSize: size }}>
      {icon !== null ? <GraphIcon name={icon} size={size} /> : null}
      <span>{text}</span>
    </span>
  );
}

export function StateDot({ state }: { state: GraphNodeState }) {
  return <span aria-hidden="true" className="vkg-dot" style={{ background: STATE_DOT[state] }} />;
}

export function Avatar({ assignee }: { assignee: string | null }) {
  if (assignee === null) {
    return <span className="vkg-avatar" data-who="none" aria-label="Без исполнителя" title="без исполнителя" />;
  }
  return (
    <span className="vkg-avatar" data-who="agent" aria-label={`Исполнитель: ${assignee}`} title={assignee}>
      {assignee.trim().charAt(0).toUpperCase() || 'И'}
    </span>
  );
}

export interface CardShellProps {
  node: GraphNode;
  box: CardBox;
  selected: boolean;
  dim: boolean;
  tone: CardTone;
  className?: string;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  children: ReactNode;
}

/** The positioned, focusable frame shared by task and question cards. */
export function CardShell({ node, box, selected, dim, tone, className, onSelect, onHover, children }: CardShellProps) {
  const style: CSSProperties = { left: box.x, top: box.y, width: box.w, height: box.h };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(node.id);
    }
  };
  return (
    <article
      className={`vkg-card${className ? ` ${className}` : ''}`}
      style={style}
      tabIndex={0}
      aria-label={`${node.label} ${node.title}`}
      aria-current={selected ? 'true' : undefined}
      data-node-id={node.id}
      data-dim={dim ? 'true' : 'false'}
      data-tone={tone}
      data-outside={node.outside ? 'true' : 'false'}
      title={node.outside ? 'снаружи эпика' : undefined}
      onClick={() => onSelect(node.id)}
      onKeyDown={onKeyDown}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
    >
      {children}
    </article>
  );
}

export type GraphCardProps = Omit<CardShellProps, 'children' | 'className'>;

export function GraphCard(props: GraphCardProps) {
  const { node } = props;
  return (
    <CardShell {...props}>
      <div className="vkg-row">
        <StateDot state={node.state} />
        <span className="vkg-label">{node.label}</span>
        <span style={{ flex: 1 }} />
        <Avatar assignee={node.assignee} />
      </div>
      <span className="vkg-title" title={node.title}>
        {node.title}
      </span>
      <div className="vkg-row" style={{ gap: 4 }}>
        {node.reason ? <ReasonChip state={node.state} text={node.reason} /> : null}
      </div>
    </CardShell>
  );
}
