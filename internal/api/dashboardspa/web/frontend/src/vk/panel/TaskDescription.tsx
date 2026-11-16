import type { ReactNode } from 'react';
import { MARKDOWN_CLASS, renderMiniMarkdown, type TextRenderer } from '../../lib/miniMarkdown';
import { sentences, structureDescription } from '../../lib/structureDescription';
import { cn } from '../cn';

// The ticket description in the task drawer (16.11 owner: «one grey block,
// hard to read»). Rendering only — the text comes in as a string:
// - new tickets carry the contract sections «## Что сделать», «## Почему»,
//   «## Готово, когда», optional «## Нужно от владельца» and «## Справка»;
//   each becomes a heading with its paragraphs and lists, «Справка» smaller,
//   muted and collapsed when long;
// - old free text goes through the card formatter (structureDescription:
//   labels, enumerations, short paragraphs at sentence ends), word for word;
// - in both, ticket ids, hashes and timestamps show in the muted mono face,
//   and ids of tickets on the board open them, like the «Связи» rows.
// Everything is React text nodes (miniMarkdown): no HTML from the source,
// links only https through its safe-URL check.

export const SECTION_HEADINGS = [
  'Что сделать',
  'Почему',
  'Готово, когда',
  'Нужно от владельца',
  'Справка',
] as const;
const REFERENCE = 'Справка';
const SECTION_LINE = new RegExp(`^##\\s+(${SECTION_HEADINGS.join('|')})\\s*$`);

/** «Справка» longer than this starts collapsed. */
const REFERENCE_OPEN_CHARS = 280;
const REFERENCE_OPEN_LINES = 6;

interface Section {
  heading: string | null;
  body: string;
}

/** Contract sections, or null when the text has none (old free text). */
export function splitSections(text: string): Section[] | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (!lines.some((l) => SECTION_LINE.test(l.trim()))) return null;
  const out: Section[] = [];
  let cur: Section = { heading: null, body: '' };
  const push = () => {
    if (cur.heading !== null || cur.body.trim().length > 0) out.push({ ...cur, body: cur.body.trim() });
  };
  for (const line of lines) {
    const m = SECTION_LINE.exec(line.trim());
    if (m !== null) {
      push();
      cur = { heading: m[1] ?? '', body: '' };
    } else {
      cur.body += `${line}\n`;
    }
  }
  push();
  return out;
}

/** A paragraph longer than this is broken at its sentence ends. */
const LONG_PARAGRAPH_CHARS = 200;
const PARAGRAPH_TARGET_CHARS = 220;

/**
 * Breaks long single-line paragraphs of old text into short ones at sentence
 * ends (one or two sentences each). Lines, lists and headings stay as they
 * are; only the whitespace between sentences becomes a paragraph break.
 */
export function shortParagraphs(markdown: string): string {
  return markdown
    .split('\n\n')
    .flatMap((para) => {
      if (para.includes('\n') || para.length <= LONG_PARAGRAPH_CHARS || /^(?:#|[-*]\s|\d+[.)]\s)/.test(para)) {
        return [para];
      }
      const out: string[] = [];
      let cur = '';
      for (const sentence of sentences(para, { digitStart: true })) {
        if (cur.length > 0 && cur.length + sentence.length + 1 > PARAGRAPH_TARGET_CHARS) {
          out.push(cur);
          cur = sentence;
        } else {
          cur = cur.length > 0 ? `${cur} ${sentence}` : sentence;
        }
      }
      if (cur.length > 0) out.push(cur);
      return out;
    })
    .join('\n\n');
}

// Timestamps first (they contain digits a hash rule could take), then ids,
// then hashes and long numeric ids.
const TOKEN = new RegExp(
  [
    String.raw`(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?Z?|\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\s~?\d{1,2}:\d{2}Z?|~?\d{1,2}:\d{2}Z)`,
    String.raw`((?<![\w-])[a-z]{2,4}-[a-z0-9]{3,}(?![\w-]))`,
    String.raw`((?<![\w-])(?:(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}|\d{9,})(?![\w-]))`,
  ].join('|'),
  'g',
);

const MONO = 'font-vk-mono text-[13px] text-vk-text-low';

function tokenRenderer(knownIds: ReadonlySet<string>, onOpenBead?: (id: string) => void): TextRenderer {
  return (text, key) => {
    const out: ReactNode[] = [];
    let last = 0;
    let n = 0;
    for (const m of text.matchAll(TOKEN)) {
      const [whole, time, id, hash] = m;
      const at = m.index ?? 0;
      const k = `${key}-k${n}`;
      n += 1;
      let node: ReactNode = null;
      if (time !== undefined) {
        node = (
          <span key={k} data-token="time" className={MONO}>
            {whole}
          </span>
        );
      } else if (id !== undefined && knownIds.has(id) && onOpenBead !== undefined) {
        node = (
          <button
            key={k}
            type="button"
            data-token="id"
            onClick={() => onOpenBead(id)}
            className={cn(
              MONO,
              'rounded-sm underline decoration-dotted underline-offset-2 hover:bg-vk-bg-secondary hover:text-vk-text-high focus-mark',
            )}
          >
            {whole}
          </button>
        );
      } else if (id !== undefined && (/\d/.test(id) || knownIds.has(id))) {
        node = (
          <span key={k} data-token="id" className={MONO}>
            {whole}
          </span>
        );
      } else if (hash !== undefined) {
        node = (
          <span key={k} data-token="hash" className={MONO}>
            {whole}
          </span>
        );
      }
      if (node === null) continue;
      if (at > last) out.push(text.slice(last, at));
      out.push(node);
      last = at + whole.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };
}

export interface TaskDescriptionProps {
  text: string;
  /** Ids of the tickets on the board; those become clickable. */
  knownIds?: ReadonlySet<string>;
  onOpenBead?: (beadId: string) => void;
}

const NO_IDS: ReadonlySet<string> = new Set();

export function TaskDescription({ text, knownIds = NO_IDS, onOpenBead }: TaskDescriptionProps) {
  const renderText = tokenRenderer(knownIds, onOpenBead);
  const sections = splitSections(text);
  const root = `text-base text-vk-text-normal ${MARKDOWN_CLASS}`;
  if (sections === null) {
    return (
      <div data-testid="task-description" className={root}>
        {renderMiniMarkdown(shortParagraphs(structureDescription(text)), { headingFrom: 3, renderText })}
      </div>
    );
  }
  return (
    <div data-testid="task-description" className={cn(root, 'gap-3')}>
      {sections.map((s, i) => {
        const body = renderMiniMarkdown(s.body, { headingFrom: 4, renderText });
        if (s.heading === REFERENCE) {
          const long = s.body.length > REFERENCE_OPEN_CHARS || s.body.split('\n').length > REFERENCE_OPEN_LINES;
          return (
            <details
              key={i}
              data-testid="task-description-reference"
              open={!long}
              className={cn('flex flex-col gap-1 text-sm text-vk-text-low', MARKDOWN_CLASS)}
            >
              <summary className="cursor-pointer select-none font-medium text-vk-text-low hover:text-vk-text-high">
                {s.heading}
              </summary>
              {body}
            </details>
          );
        }
        return (
          <section key={i} className="flex flex-col gap-1.5">
            {s.heading !== null && <h3>{s.heading}</h3>}
            {body}
          </section>
        );
      })}
    </div>
  );
}
