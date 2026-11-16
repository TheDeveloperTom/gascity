import type { DiscussContext } from '../lib/discussWithMayor';
import { CommentWriteError, postPeerBoards } from './peerCommentWrites';

// B10 (16.11): «Обсудить с Мэром» notifies the Mayor. Our own city service
// `peer-boards` runs `gc devwork owner discuss` (mail to mayor with notify and
// dedup per id) behind the same write gate as the topic routes:
//   POST /v1/discuss {kind: "bead"|"needs", id, title?, summary?}
//     → 200 {url} (or {ok, chat_url?}) | 400/403/502 {error}
// The url is informational: the button has already opened #мэр itself.
// Errors collapse to two codes: `disabled` (403/405: writes are switched off
// here) and `failed` (anything else).

export async function postDiscuss(ctx: DiscussContext): Promise<string | null> {
  let payload: unknown;
  try {
    payload = await postPeerBoards('discuss', {
      kind: ctx.kind === 'need' ? 'needs' : 'bead',
      id: ctx.beadId,
      title: ctx.title,
      summary: ctx.summary,
    });
  } catch (err) {
    if (err instanceof CommentWriteError && err.code === 'disabled') throw err;
    throw new CommentWriteError('failed');
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const url = typeof p.url === 'string' ? p.url : p.chat_url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}
