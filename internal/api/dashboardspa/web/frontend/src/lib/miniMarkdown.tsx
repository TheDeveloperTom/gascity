import type { ReactNode } from 'react';

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
          <a key={key} href={safe} target="_blank" rel="noopener noreferrer" className="underline">
            {label}
          </a>
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

export function renderMiniMarkdown(source: string): ReactNode {
  return parseBlocks(source).map((block, i) => {
    const key = `b${i}`;
    switch (block.kind) {
      case 'heading': {
        const children = renderInline(block.text, key);
        if (block.level === 1) return <h1 key={key}>{children}</h1>;
        if (block.level === 2) return <h2 key={key}>{children}</h2>;
        return <h3 key={key}>{children}</h3>;
      }
      case 'ul':
      case 'ol': {
        const items = block.items.map((item, j) => (
          <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
        ));
        return block.kind === 'ul' ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>;
      }
      case 'p':
        return <p key={key}>{renderInline(block.lines.join(' '), key)}</p>;
    }
  });
}
