import { Link } from 'react-router';
import { t } from '../../i18n';
import type { PeerTopic } from '../../supervisor/peerBoardReads';

// BOARD-LIVE L7 / L11: the ticket the Mayor linked to a topic, «→ задача <id>».
// Review N-1: the id is already a checked bead id (peerBoardReads drops
// anything else). It never creates a task and posts nothing: «Сделать
// задачей» is the owner's button.
// BOARD-LIVE L14: both cities use `dw` ids, so the link follows `ticket_ref`
// (city, rig, id): our city → our card; the peer we read this topic from →
// his card (`peer:<login>:<rig>:<id>`); any other city → text only. Without
// `ticket_ref` (an older city service) only OUR own topic links (N-1).

const CHIP =
  'inline-flex h-11 items-center rounded-sm border border-vk-border bg-vk-bg-secondary px-2.5 text-sm text-vk-text-high md:h-8';

/** The board key a ticket opens, or null when it must stay text. */
export function ticketBeadKey(
  topic: PeerTopic,
  ownLogin: string | null,
  peerLogin: string,
): string | null {
  const id = topic.ticket;
  if (id === null) return null;
  const ref = topic.ticketRef;
  if (ref === null) return topic.mine ? id : null;
  if (ref.id !== id) return null;
  if (ownLogin !== null && ref.city === ownLogin) return id;
  if (ref.city === peerLogin) return `peer:${ref.city}:${ref.rig}:${ref.id}`;
  return null;
}

export function TopicTicket({
  topic,
  ownLogin,
  peerLogin,
}: {
  topic: PeerTopic;
  ownLogin: string | null;
  peerLogin: string;
}) {
  const id = topic.ticket;
  if (id === null) return null;
  const label = t('→ task {id}', { id });
  const key = ticketBeadKey(topic, ownLogin, peerLogin);
  if (key === null) return <span className={CHIP}>{label}</span>;
  return (
    <Link to={`/beads?${new URLSearchParams({ bead: key }).toString()}`} className={`${CHIP} focus-mark`}>
      {label}
    </Link>
  );
}
