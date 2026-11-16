// Display-only structuring of one-line card descriptions (16.11, owner: «a
// card is one wall of text»). Many beads migrated from the old city carry a
// long description with no line breaks at all. Before the mini-markdown
// renderer sees such text, this turns it into markdown:
//   - known section labels («Основание:», «QUESTION» …) start a paragraph, bold;
//   - an inline enumeration «… : 1) a; 2) b» (also «1. a» and «(1) a») becomes
//     the lead-in sentence plus a numbered list;
//   - remaining long text is split every 2–3 sentences.
// Text that already contains a newline is returned unchanged; the stored
// description is never rewritten.

/** Section labels that start a new paragraph. Extend here. */
export const SECTION_LABELS: readonly string[] = [
  'Основание',
  'Не входит',
  'Что случилось',
  'Чем мешает',
  'Что нужно от владельца',
  'Совет',
  'Для техники',
  'Причина',
  'Решение',
  'Итог',
];
/** Labels that count even without a trailing colon. */
const BARE_LABELS: readonly string[] = ['QUESTION', 'DECISION'];

const MAX_SENTENCES = 3;
const SOFT_PARAGRAPH_CHARS = 160;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Paren depth before each index (depth[i] = depth at the start of char i). */
function parenDepths(text: string): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (const ch of text) {
    depths.push(depth);
    if (ch === '(' || ch === '[') depth += 1;
    else if ((ch === ')' || ch === ']') && depth > 0) depth -= 1;
  }
  return depths;
}

/**
 * Sentences, split after .!?… followed by whitespace and a capital letter,
 * outside parentheses. `digitStart` also splits before a digit («… дней. 16.11
 * панель: …»), for the drawer where a sentence often opens with a date.
 */
export function sentences(text: string, options: { digitStart?: boolean } = {}): string[] {
  const depths = parenDepths(text);
  const out: string[] = [];
  let start = 0;
  const re = options.digitStart === true ? /[.!?…](\s+)(?=[\p{Lu}\d])/gu : /[.!?…](\s+)(?=\p{Lu})/gu;
  for (const m of text.matchAll(re)) {
    const end = (m.index ?? 0) + 1;
    if (depths[m.index ?? 0] !== 0) continue;
    out.push(text.slice(start, end));
    start = end + (m[1] ?? '').length;
  }
  const rest = text.slice(start);
  if (rest.trim().length > 0) out.push(rest);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Group sentences into paragraphs of 2–3 sentences. */
function chunk(list: string[]): string[] {
  const paras: string[] = [];
  let cur: string[] = [];
  for (const s of list) {
    cur.push(s);
    const len = cur.join(' ').length;
    if (cur.length >= MAX_SENTENCES || (cur.length >= 2 && len >= SOFT_PARAGRAPH_CHARS)) {
      paras.push(cur.join(' '));
      cur = [];
    }
  }
  if (cur.length > 0) paras.push(cur.join(' '));
  return paras;
}

interface Segment {
  label?: string | undefined;
  body: string;
}

function splitLabels(text: string): Segment[] {
  const names = [...SECTION_LABELS, ...BARE_LABELS].map(escapeRe).join('|');
  const re = new RegExp(`(^|[.!?…]\\s+)(${names})(:)?(?=\\s|$)`, 'gu');
  const depths = parenDepths(text);
  const segments: Segment[] = [];
  let bodyStart = 0;
  let currentLabel: string | undefined;
  for (const m of text.matchAll(re)) {
    const whole = m[0];
    const lead = m[1] ?? '';
    const name = m[2] ?? '';
    const colon = m[3];
    const at = (m.index ?? 0) + lead.length;
    if (depths[at] !== 0) continue;
    if (colon === undefined && !BARE_LABELS.includes(name)) continue;
    segments.push({ label: currentLabel, body: text.slice(bodyStart, at) });
    currentLabel = colon === undefined ? `**${name}**` : `**${name}:**`;
    bodyStart = (m.index ?? 0) + whole.length;
  }
  segments.push({ label: currentLabel, body: text.slice(bodyStart) });
  return segments
    .map((s) => ({ ...s, body: s.body.trim() }))
    .filter((s) => s.label !== undefined || s.body.length > 0);
}

interface Marker {
  n: number;
  start: number;
  end: number;
}

/** A consecutive 1, 2, … run of «1)», «1.» or «(1)» markers (≥2), or null. */
function findEnumeration(text: string): Marker[] | null {
  const depths = parenDepths(text);
  const all: Marker[] = [];
  for (const m of text.matchAll(/(^|\s)(?:\((\d{1,2})\)|(\d{1,2})[.)])\s/g)) {
    const start = (m.index ?? 0) + (m[1] ?? '').length;
    if (depths[start] !== 0) continue;
    all.push({ n: Number(m[2] ?? m[3]), start, end: (m.index ?? 0) + m[0].length });
  }
  const run: Marker[] = [];
  for (const mk of all) {
    if (mk.n === run.length + 1) run.push(mk);
  }
  return run.length >= 2 ? run : null;
}

function cleanItem(item: string): string {
  return item.trim().replace(/[;,]\s*$/, '').trim();
}

function structureSegment(seg: Segment): string[] {
  const paras: string[] = [];
  const markers = findEnumeration(seg.body);
  if (markers === null) {
    paras.push(...chunk(sentences(seg.body)));
  } else {
    const prefix = sentences(seg.body.slice(0, markers[0]?.start ?? 0));
    const lead = prefix.pop();
    paras.push(...chunk(prefix));
    if (lead !== undefined) paras.push(lead);
    const items: string[] = [];
    let tail = '';
    markers.forEach((mk, i) => {
      const next = markers[i + 1];
      let item = seg.body.slice(mk.end, next === undefined ? undefined : next.start);
      if (next === undefined) {
        const parts = sentences(item);
        item = parts.shift() ?? '';
        tail = parts.join(' ');
      }
      items.push(`${i + 1}. ${cleanItem(item)}`);
    });
    paras.push(items.join('\n'));
    if (tail.length > 0) paras.push(...chunk(sentences(tail)));
  }
  if (seg.label !== undefined) {
    const first = paras[0];
    if (first === undefined || /^\d+\. /.test(first)) paras.unshift(seg.label);
    else paras[0] = `${seg.label} ${first}`;
  }
  return paras;
}

/** Markdown for a one-line description; any text with a newline comes back as is. */
export function structureDescription(text: string): string {
  if (text.includes('\n') || text.trim().length === 0) return text;
  return splitLabels(text).flatMap(structureSegment).join('\n\n');
}
