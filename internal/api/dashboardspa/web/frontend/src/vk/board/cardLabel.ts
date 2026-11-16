// vk11 card lane (16.11): the card's short mono label («M04 #3», «M04 ВВ-6»,
// «M04 приёмка», «Один тип», «Город») and its title with that label removed,
// as on the approved canvas (Cards / Main). Never the raw bead id.

export interface CardLabelInput {
  title: string;
  /** The bead's `milestone:` label value («M04»), if any. */
  milestone?: string | null;
  /** The parent epic's title, when the parent is an epic. */
  epicTitle?: string | null;
  /** The bead id: a child id «dw-….3» supplies the sub-number of «#3» → «#3.3». */
  id?: string | null;
}

export interface CardLabel {
  /** Short mono label, or null when nothing short can be derived. */
  label: string | null;
  /** The title with the derived prefix removed (never repeats the label). */
  title: string;
}

const MS = String.raw`M\d{2}[a-z]?`;
const NUM = String.raw`(?:#\d+(?:\.\d+)?[A-Za-z]?|ВВ-\d+)`;
const SEP = String.raw`\s*[:—–]\s*`;

// «M03 #2 / Task 6: …», «M04 — …», «M04 Task 5E — …», «M04 / 0b — …», «M01: …»
const HEAD = new RegExp(
  String.raw`^(${MS})(?:\s+(${NUM}))?(?:\s+Task\s+\w+|\s*\/\s*(?:Task\s+)?[\wА-Яа-яЁё-]{1,12})?(?:${SEP}|\s+(?=\S))`,
  'u',
);
// «…, раунд 1: M04 #3 — Сделать …», «стоит: dw-vb7qk (M00 #3) с 18:55»
const MID = new RegExp(String.raw`(?<![\p{L}\p{N}])(${MS})\s+(${NUM})(?![\p{L}\p{N}])`, 'u');
// «dw-mqfcx.5 часть 2: …» — a bead id leading the title says nothing to the owner.
const ID_HEAD = /^[a-z]{2,4}-[a-z0-9]+(?:\.\d+)*(?:\s+часть\s+\d+)?\s*[:—–]\s*/iu;
// «Город: …», «Мэр: …» — one capitalised word before a colon.
const WORD_HEAD = /^(\p{Lu}[\p{L}]{1,11}):\s+/u;
const VV = /ВВ-\d+/u;

const ID_SUB = /\.(\d+)$/u;

/** «#3» + id «dw-….3» → «#3.3»; a title sub-number («#3.2») or a ВВ stays as is. */
function withSubNumber(num: string, id: string | null): string {
  if (!/^#\d+$/u.test(num) || id === null) return num;
  const sub = ID_SUB.exec(id);
  return sub === null ? num : `${num}.${sub[1] as string}`;
}

function capitalise(text: string): string {
  const first = text.charAt(0);
  return first.toLocaleUpperCase('ru') + text.slice(1);
}

/** «Один тип пользователя» → «Один тип»: the epic's first two words. */
export function shortEpicName(epicTitle: string): string | null {
  const words = epicTitle
    .replace(/\(.*$/u, '')
    .split(/[\s:—–,]+/u)
    .filter((w) => w.length > 0);
  if (words.length === 0) return null;
  return words.slice(0, 2).join(' ');
}

export function cardLabel({ title, milestone = null, epicTitle = null, id = null }: CardLabelInput): CardLabel {
  let text = title.trim().replace(/^Land\s+/u, '');
  let stripped = false;
  const idHead = ID_HEAD.exec(text);
  if (idHead !== null && idHead[0].length < text.length) {
    text = text.slice(idHead[0].length);
    stripped = true;
  }

  const head = HEAD.exec(text);
  if (head !== null && head[0].length < text.length) {
    const ms = head[1] as string;
    const num = head[2];
    const rest = capitalise(text.slice(head[0].length));
    if (num !== undefined) {
      // «M03 #2 / Task 6» already names the task; only a bare «M04 #3» takes the id's «.3».
      const named = /\/|\bTask\b/u.test(head[0]);
      return { label: `${ms} ${named ? num : withSubNumber(num, id)}`, title: rest };
    }
    if (/^приёмка/iu.test(rest)) return { label: `${ms} приёмка`, title: rest };
    // «ответ владельца на ВВ-6 (…)» names the question; «(… после ВВ-1)» only mentions one.
    const vv = VV.exec(rest.replace(/\([^)]*\)/gu, ''));
    if (vv !== null) return { label: `${ms} ${vv[0]}`, title: rest };
    return { label: ms, title: rest };
  }

  const mid = MID.exec(text);
  if (mid !== null) {
    const token = mid[0];
    const after = text.slice(mid.index + token.length);
    const sep = /^\s*[—–]\s*/u.exec(after);
    // «…: M04 #3 — Сделать …» drops the token with its dash; a parenthesised
    // or inline mention stays in the title (it reads as prose).
    const cleaned =
      sep !== null ? text.slice(0, mid.index) + after.slice(sep[0].length) : text;
    return {
      // A mid-title token names another task, so this bead's id says nothing about it.
      label: `${mid[1]} ${mid[2] as string}`,
      title: stripped ? capitalise(cleaned) : cleaned,
    };
  }

  const out = stripped ? capitalise(text) : text;
  if (milestone !== null && milestone.length > 0) return { label: milestone, title: out };
  if (epicTitle !== null && epicTitle.trim().length > 0) {
    const epic = shortEpicName(epicTitle);
    if (epic !== null) return { label: epic, title: out };
  }
  const word = WORD_HEAD.exec(out);
  if (word !== null && word[0].length < out.length) {
    return { label: word[1] as string, title: capitalise(out.slice(word[0].length)) };
  }
  return { label: null, title: out };
}
