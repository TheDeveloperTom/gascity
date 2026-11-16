import type { ReactNode } from 'react';
import { ExternalLink } from '../vk/ExternalLink';

// A small markdown renderer for card descriptions (dashboard v3, Safety):
// paragraphs, **bold**, *em*, `code`, `-` and `1.` lists, `#`–`###` headings
// and https links. It builds React elements only — never HTML strings, never
// raw-HTML injection — so any markup in the source stays visible text.

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s\n][^*\n]*\*)|(\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\))/g;

function safeHttps(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.username === '' && url.password === ''
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${index}`;
    index += 1;
    const [whole, code, bold, em, link, label, href] = match;
    if (code !== undefined) {
      out.push(<code key={key}>{code.slice(1, -1)}</code>);
    } else if (bold !== undefined) {
      out.push(<strong key={key}>{bold.slice(2, -2)}</strong>);
    } else if (em !== undefined) {
      out.push(<em key={key}>{em.slice(1, -1)}</em>);
    } else if (link !== undefined && label !== undefined && href !== undefined) {
      const safe = safeHttps(href);
      out.push(
        safe === null ? (
          whole
        ) : (
          <ExternalLink key={key} href={safe} className="underline">
            {label}
          </ExternalLink>
        ),
      );
    }
    last = start + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'p'; lines: string[] };

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current !== null) blocks.push(current);
    current = null;
  };
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      const level = (heading[1]?.length ?? 1) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, text: heading[2] ?? '' });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    const kind = bullet !== null ? 'ul' : numbered !== null ? 'ol' : null;
    if (kind !== null) {
      const item = (bullet ?? numbered)?.[1] ?? '';
      const open = current as Block | null;
      if (open !== null && open.kind === kind) {
        open.items.push(item);
      } else {
        flush();
        current = { kind, items: [item] };
      }
      continue;
    }
    const open = current as Block | null;
    if (open !== null && open.kind === 'p') {
      open.lines.push(line.trim());
    } else {
      flush();
      current = { kind: 'p', lines: [line.trim()] };
    }
  }
  flush();
  return blocks;
}

/**
 * Styles for a rendered description: Tailwind's preflight resets headings,
 * bold and list bullets, so a container must give them back (polish2 16.11:
 * the drawer read as one flat paragraph).
 */
export const MARKDOWN_CLASS = [
  'flex flex-col gap-2 [overflow-wrap:anywhere]',
  '[&_h1]:mt-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-vk-text-high',
  '[&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-vk-text-high',
  '[&_h3]:mt-2 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-vk-text-high',
  '[&_h4]:mt-2 [&_h4]:font-semibold [&_h4]:text-vk-text-high [&_h5]:mt-2 [&_h5]:font-semibold [&_h5]:text-vk-text-high',
  '[&_strong]:font-semibold [&_strong]:text-vk-text-high',
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_code]:rounded-sm [&_code]:bg-vk-bg-panel [&_code]:px-1 [&_code]:font-vk-mono [&_code]:text-[13px]',
].join(' ');

export interface MiniMarkdownOptions {
  /**
   * The level a `#` heading renders at (review M-4: inside the card drawer the
   * title is an h2, so `#` starts at h3). Default 1.
   */
  headingFrom?: 1 | 2 | 3;
}

export function renderMiniMarkdown(source: string, options: MiniMarkdownOptions = {}): ReactNode {
  const shift = (options.headingFrom ?? 1) - 1;
  return parseBlocks(source).map((block, i) => {
    const key = `b${i}`;
    switch (block.kind) {
      case 'heading': {
        const children = renderInline(block.text, key);
        const level = Math.min(6, block.level + shift);
        if (level === 1) return <h1 key={key}>{children}</h1>;
        if (level === 2) return <h2 key={key}>{children}</h2>;
        if (level === 3) return <h3 key={key}>{children}</h3>;
        if (level === 4) return <h4 key={key}>{children}</h4>;
        return <h5 key={key}>{children}</h5>;
      }
      case 'ul':
      case 'ol': {
        const items = block.items.map((item, j) => (
          <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
        ));
        return block.kind === 'ul' ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>;
      }
      case 'p':
        // polish2 16.11 (owner): a line break inside a paragraph is kept (the
        // card descriptions are one «**Lead:** text» per line).
        return (
          <p key={key}>
            {block.lines.flatMap((line, j) => [
              ...(j > 0 ? [<br key={`${key}-br${j}`} />] : []),
              ...renderInline(line, `${key}-${j}`),
            ])}
          </p>
        );
    }
  });
}
