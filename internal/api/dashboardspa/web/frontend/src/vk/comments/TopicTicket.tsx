import { Link } from 'react-router';
import { t } from '../../i18n';
import type { PeerTopic } from '../../supervisor/peerBoardReads';

// BOARD-LIVE L7 / L11: the ticket the Mayor linked to a topic, «→ задача <id>».
// Review N-1: a link into our board only on OUR own topic (`mine`, set by our
// city service) — his ticket names a card on HIS board. The id is already a
// checked bead id (peerBoardReads drops anything else). It never creates a
// task and posts nothing: «Сделать задачей» is the owner's button.

const CHIP =
  'inline-flex h-11 items-center rounded-sm border border-vk-border bg-vk-bg-secondary px-2.5 text-sm text-vk-text-high md:h-8';

export function TopicTicket({ topic }: { topic: PeerTopic }) {
  const id = topic.ticket;
  if (id === null) return null;
  const label = t('→ task {id}', { id });
  if (!topic.mine) return <span className={CHIP}>{label}</span>;
  return (
    <Link to={`/beads?${new URLSearchParams({ bead: id }).toString()}`} className={`${CHIP} focus-mark`}>
      {label}
    </Link>
  );
}
