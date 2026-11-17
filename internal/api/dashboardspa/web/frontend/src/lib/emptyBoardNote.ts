// owner 17.11: a filter that leaves the board empty still draws the board
// (its columns at 0) and says, honestly, why it is empty. For a peer's board
// the reason is his city's connection: live and sending nothing, or no
// connection (the service's fetch_error, or our live link not up).

import { t } from '../i18n';
import { asOfClock, type OwnerFilter, type PeerBoardSource } from './boardOwner';

export function emptyBoardNote(filter: OwnerFilter, peers: readonly PeerBoardSource[]): string {
  const generic = t('No tasks in this filter right now');
  if (filter === 'all' || filter === 'me') return generic;
  const peer = peers.find((p) => p.owner === filter);
  // His board has cards: the other filters (project, epic) emptied it.
  if (peer === undefined || peer.cards.length > 0) return generic;
  const whose = peer.label;
  const fetchError = peer.fetchError?.trim() ?? '';
  if (fetchError.length > 0) return t('No connection to the city of {whose}: {error}', { whose, error: fetchError });
  if (peer.live !== null && peer.live.state !== 'live') {
    const why =
      peer.live.error?.trim() ||
      (peer.live.state === 'reconnecting' ? t('reconnecting') : t('the city is offline'));
    return t('No connection to the city of {whose}: {error}', { whose, error: why });
  }
  const time = asOfClock(peer.fetchedAt ?? peer.asOf);
  return peer.live !== null
    ? t('The city of {whose} sends no tasks right now · connection live, updated {time}', { whose, time })
    : t('The city of {whose} sends no tasks right now · updated {time}', { whose, time });
}
