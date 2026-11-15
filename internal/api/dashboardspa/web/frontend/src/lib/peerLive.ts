import { t } from '../i18n';
import { asOfClock, type PeerBoardSource } from './boardOwner';

// BOARD-LIVE L7 (Review Focus 4): the status lines above the board for one
// peer city. «Not online» and «since» use OUR receive time (`fetched_at`)
// and Tailscale's `LastSeen` (`peer_last_seen`), never the peer's own clock;
// the peer's `as_of` is shown only as the data's label («данные на HH:MM»).

const ms = (iso: string | null | undefined): number => {
  const v = iso == null ? Number.NaN : Date.parse(iso);
  return Number.isFinite(v) ? v : Number.NaN;
};

/** The lines to show for this peer; empty while its board is live. */
export function peerStatusLines(peer: PeerBoardSource): string[] {
  const live = peer.live;
  if (live === null) {
    // a peer not yet upgraded: today's rule (snapshot age)
    return peer.stale ? [t('{owner} Mac is offline since {time}', { owner: peer.label, time: asOfClock(peer.asOf) })] : [];
  }
  const out: string[] = [];
  if (live.error === 'auth') {
    out.push(t('{owner} city does not accept our key — pair the cities again', { owner: peer.label }));
  }
  if (live.state === 'offline') {
    const since = live.peerLastSeen ?? peer.fetchedAt ?? live.since;
    if (since !== null) out.push(t('{owner} Mac is offline since {time}', { owner: peer.label, time: asOfClock(since) }));
  }
  const asOf = live.asOf ?? peer.asOf;
  const seen = ms(live.peerLastSeen);
  if (live.state !== 'live' && seen > ms(asOf)) {
    out.push(
      t('data as of {time}; {name} was online until {seen} — changes may be missing', {
        time: asOfClock(asOf),
        name: peer.name,
        seen: asOfClock(live.peerLastSeen ?? ''),
      }),
    );
  }
  return out;
}
