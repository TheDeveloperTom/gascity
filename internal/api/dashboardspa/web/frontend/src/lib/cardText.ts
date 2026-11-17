import { structureDescription } from './structureDescription';

// Owner 17.11: a card's description must read as a document. Tasks are
// written as plain lines with our section names («Что сделать», «Готово,
// когда», «Справка» …) and machine lines (origin, message ids, hashes) at the
// end. This turns such text into the markdown the mini renderer draws:
//   - a known section name alone on a line (any of «Name», «Name:»,
//     «**Name:**», «## Name») becomes a `##` heading;
//   - plain lines under «Готово, когда» / «Как поймём, что готово» become bullets;
//   - paths, commit hashes, bead ids and owner:msg ids become inline code;
//   - machine lines and a «Служебное» section go to `details` («Подробнее»);
//   - markdown images leave the text and go to `images`.
// Display only: the stored description is never rewritten.

/** Section names that start a heading. */
export const SECTION_HEADS: readonly string[] = [
  'Что сделать',
  'Что меняем и зачем',
  'Готово, когда',
  'Как поймём, что готово',
  'Справка',
  'Связь',
  'Откуда',
  'Статус',
];
/** Sections whose plain lines are a checklist. */
const LIST_HEADS = new Set(['Готово, когда', 'Как поймём, что готово']);
/** A section that is machine detail as a whole. */
const MACHINE_HEAD = 'Служебное';
/** Lines that are machine detail wherever they stand. */
const MACHINE_LINE = /^(?:Происхождение|Origin|Без связей)(?=[\s:.]|$)|^owner:msg:\d+\s*$/iu;

const BOLD_LEAD = /^\s*\*\*[^*\n]+:\*\*/;
const BULLET_OR_NUMBER = /^\s*(?:[-*]|\d+[.)])\s+/;
const IMAGE = /!\[[^\]\n]*\]\((https:\/\/[^\s)]+)\)/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const HEAD_RE = new RegExp(
  `^\\s*(?:#{1,3}\\s+)?(?:\\*\\*)?(${[...SECTION_HEADS, MACHINE_HEAD].map(escapeRe).join('|')})(?:\\s*:)?(?:\\*\\*)?(?:\\s*:)?(?:\\s+(.*))?$`,
  'u',
);

// Protected spans first (code, markdown links, bare URLs), then the tokens.
const PROTECTED = /(`[^`\n]*`|\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/\S+)/g;
const TOKEN = new RegExp(
  [
    // owner:msg:<id>
    String.raw`owner:msg:\d+`,
    // a path with a slash and an extension, or a bare file name with a code extension
    String.raw`(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,6}`,
    String.raw`[\w-]+(?:\.[\w-]+)*\.(?:tsx?|jsx?|mjs|go|py|sh|md|json|toml|ya?ml|sql|css|html)`,
    // bead ids: prefix-<id with a digit>, with optional .N parts
    String.raw`[a-z]{2,4}-(?=[a-z0-9]*\d)[a-z0-9]{2,}(?:\.\d+)*`,
    // commit hashes: 7–40 hex with a letter and a digit
    String.raw`(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}`,
  ]
    .map((p) => `(?<![\\w/.:-])(?:${p})(?![\\w/-])`)
    .join('|'),
  'gu',
);

/** Inline code around paths, hashes and ids; code, links and URLs stay as they are. */
export function codeTokens(line: string): string {
  return line
    .split(PROTECTED)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(TOKEN, (m) => `\`${m}\``)))
    .join('');
}

export interface CardText {
  /** Markdown for the renderer. */
  body: string;
  /** Machine lines for the «Подробнее» toggle. */
  details: string[];
  /** https image URLs found in the text. */
  images: string[];
}

export function prepareCardText(raw: string): CardText {
  const images: string[] = [];
  const text = structureDescription(raw).replace(IMAGE, (_m, url: string) => {
    images.push(url);
    return '';
  });
  const out: string[] = [];
  const details: string[] = [];
  let section: string | null = null;
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    const head = HEAD_RE.exec(line);
    // «**Name:** text» is already a readable lead-in: it stays bold.
    if (head !== null && !(line.trimStart().startsWith('**') && (head[2] ?? '').trim().length > 0)) {
      section = head[1] ?? null;
      const rest = (head[2] ?? '').trim();
      if (section === MACHINE_HEAD) {
        if (rest.length > 0) details.push(codeTokens(rest));
        continue;
      }
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      out.push(`## ${section}`);
      if (rest.length > 0) out.push(listed(rest, section));
      continue;
    }
    if (section === MACHINE_HEAD) {
      if (line.trim().length > 0) details.push(codeTokens(line.trim()));
      continue;
    }
    // Another heading or a bold lead-in ends a checklist section.
    if (/^\s*#{1,6}\s/.test(line) || BOLD_LEAD.test(line)) section = null;
    if (MACHINE_LINE.test(line.trim())) {
      details.push(codeTokens(line.trim()));
      continue;
    }
    out.push(line.trim().length === 0 ? '' : listed(line, section));
  }
  return { body: collapseBlank(out).join('\n'), details, images };
}

function listed(line: string, section: string | null): string {
  const coded = codeTokens(line);
  if (section !== null && LIST_HEADS.has(section) && !BULLET_OR_NUMBER.test(line)) {
    return `- ${coded.trim()}`;
  }
  return coded;
}

function collapseBlank(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (l === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(l);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

const IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.(?:png|jpe?g|gif|webp)$/i;

/**
 * Image URLs for a card's `devwork.attachments` (a JSON list of file names the
 * city copied next to the card). Only our own city serves them, so a peer card
 * (no city) has none.
 */
export function attachmentUrls(
  metadata: Readonly<Record<string, string>> | undefined,
  where: { city?: string | undefined; beadId: string },
): string[] {
  const raw = metadata?.['devwork.attachments'];
  if (raw === undefined || where.city === undefined || where.city.length === 0) return [];
  let names: unknown;
  try {
    names = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(names)) return [];
  return names
    .filter((n): n is string => typeof n === 'string' && IMAGE_NAME.test(n) && !n.includes('..'))
    .map(
      (n) =>
        `/api/city/${encodeURIComponent(where.city ?? '')}/attachments/${encodeURIComponent(where.beadId)}/${encodeURIComponent(n)}`,
    );
}
