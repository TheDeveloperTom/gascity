import { t } from '../../i18n';

// Owner 17.11: mentions in the card conversation box. The city reads them
// (boardsync xtopics.mentioned_mayors): `@мэр` asks our own Mayor, `@мэр-<имя>`
// (the person's genitive, name or login) asks that city's Mayor for facts, and
// `@<человек>` is the human→human ping. The box only suggests and inserts.

export interface MentionOption {
  /** Inserted after `@`. */
  token: string;
  /** Who it reaches, shown next to the token. */
  caption: string;
}

export interface MentionPeer {
  login: string;
  /** «Ричард». */
  name: string;
  /** The genitive, «Ричарда». */
  label: string;
}

export function mentionOptions(peers: readonly MentionPeer[]): MentionOption[] {
  return [
    { token: 'мэр', caption: t('Your Mayor') },
    ...peers.map((p) => ({ token: `мэр-${p.label.toLowerCase()}`, caption: t('Mayor of {owner}', { owner: p.label }) })),
    ...peers.map((p) => ({ token: p.name.toLowerCase(), caption: p.name })),
  ];
}

const WORD = /[\p{L}\p{N}_.-]/u;

/** The `@word` being typed at `caret`: where its `@` is and what follows it. */
export function activeMention(value: string, caret: number): { start: number; query: string } | null {
  let i = caret;
  while (i > 0 && WORD.test(value[i - 1]!)) i -= 1;
  if (i === 0 || value[i - 1] !== '@') return null;
  const at = i - 1;
  if (at > 0 && (WORD.test(value[at - 1]!) || value[at - 1] === '@')) return null; // an e-mail, «a@b»
  if (caret < value.length && WORD.test(value[caret]!)) return null; // inside a word
  return { start: at, query: value.slice(i, caret) };
}

const fold = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

export function filterMentions(options: readonly MentionOption[], query: string): MentionOption[] {
  const q = fold(query);
  return options.filter((o) => fold(o.token).startsWith(q));
}

/** Replaces `@query` (from `start` to `caret`) with `@token ` and returns the new caret. */
export function insertMention(value: string, start: number, caret: number, token: string): { value: string; caret: number } {
  const head = `${value.slice(0, start)}@${token} `;
  return { value: head + value.slice(caret), caret: head.length };
}
