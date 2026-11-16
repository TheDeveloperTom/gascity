/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

// polish2 16.11 (owner): no English UI text in the Russian dashboard. This
// scans every non-test .tsx for JSX text and text attributes (placeholder,
// aria-label, title, alt, label, caption) written as a bare English literal,
// i.e. not passed through t().
//
// LEFT lists the files that still have such text, with their EXACT count
// (review M-6): a fix must lower the number here, so it can never creep back
// up; a new file with English fails. Each entry says why it is left.

const SOURCES = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx', '!../test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const LEFT: Readonly<Record<string, { max: number; why: string }>> = {
  // False positives: code, commands or a title PageHeader translates itself.
  'routes/Mail.tsx': { max: 1, why: 'title="Mail" goes through PageHeader tIfKnown' },
  'routes/Runs.tsx': { max: 1, why: 'title="Runs" goes through PageHeader tIfKnown' },
  'components/mail/ComposeModal.tsx': { max: 1, why: 'placeholder lists agent names' },
  'components/icons.tsx': { max: 4, why: 'icon-name object keys, not text' },
  'vk/CommandBar.tsx': { max: 2, why: 'the «esc» key cap' },
  'vk/board/KanbanCard.tsx': { max: 1, why: 'a template literal, not text' },
  'CityBootstrap.tsx': {
    max: 7,
    why: 'first-run `gc init` instructions; no city exists for the owner to see them',
  },
  // Operator debug pages behind «Ещё» (not the owner's two sections).
  'routes/Health.tsx': { max: 62, why: 'debug page «Здоровье»' },
  'routes/Activity.tsx': { max: 25, why: 'debug page «Активность»' },
  'routes/Agents.tsx': { max: 13, why: 'debug page «Агенты»' },
  'routes/AgentDetail.tsx': { max: 9, why: 'debug page, one agent' },
  'routes/FormulaRunDetail.tsx': { max: 13, why: 'debug page, one run' },
  'routes/AmbientHome.tsx': { max: 7, why: 'old home, not routed for the owner' },
  'components/AgentPanel.tsx': { max: 10, why: 'Mail «reading as» panel (operator)' },
  'components/SessionPeek.tsx': { max: 5, why: 'agent transcript peek (debug)' },
  'components/StructuredLivePeek.tsx': { max: 2, why: 'agent transcript peek (debug)' },
  'components/TranscriptBox.tsx': { max: 5, why: 'agent transcript (debug)' },
  'components/structured/StructuredTranscript.tsx': { max: 5, why: 'agent transcript (debug)' },
  'components/agent/AgentBeadsAssigned.tsx': { max: 4, why: 'debug page «Агенты»' },
  'components/agent/AgentChatThread.tsx': { max: 4, why: 'debug page «Агенты»' },
  'components/agent/AgentLivePeek.tsx': { max: 1, why: 'debug page «Агенты»' },
  'components/agent/AgentMetadata.tsx': { max: 1, why: 'debug page «Агенты»' },
  'components/run/FormulaRunDiagram.tsx': { max: 3, why: 'run graph (Runs debug)' },
  'components/run/FormulaRunNode.tsx': { max: 1, why: 'run graph (Runs debug)' },
  'components/run/FormulaRunTabs.tsx': { max: 3, why: 'run detail tabs (Runs debug)' },
  'components/run/LaneCard.tsx': { max: 3, why: 'run lane card (Runs debug)' },
  'components/run/RunMap.tsx': { max: 8, why: 'run lanes (Runs debug)' },
  'components/run/RunNodeSessionPanel.tsx': { max: 9, why: 'run node session (Runs debug)' },
};

function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

/** Bare English UI text in one .tsx source. */
export function englishLiterals(source: string): string[] {
  const code = source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/.*$/gm, blank);
  const out: string[] = [];
  for (const m of code.matchAll(/(?<!=)>([^<>{}]*?)(?=<\/|\s<[A-Za-z]|\{)/g)) {
    const text = (m[1] ?? '').trim();
    if (/[A-Za-z]{2,}/.test(text) && !/[=;()]|&&|\|\|/.test(text)) out.push(text);
  }
  for (const m of code.matchAll(
    /\s(?:placeholder|aria-label|title|alt|label|caption)="([^"]*[A-Za-z]{2,}[^"]*)"/g,
  )) {
    out.push(`@${m[1] ?? ''}`);
  }
  return out;
}

describe('no bare English UI text (polish2)', () => {
  it('the scanner sees JSX text and attributes, and skips t() calls', () => {
    expect(englishLiterals('<p>Loading thread.</p>')).toEqual(['Loading thread.']);
    expect(englishLiterals('<input placeholder="Search mail" />')).toEqual(['@Search mail']);
    expect(englishLiterals("<p>{t('Loading thread.')}</p>")).toEqual([]);
    expect(englishLiterals('<p>Загружаю</p>')).toEqual([]);
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
  });

  it('only the listed files keep English, exactly as many as listed', () => {
    const over: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      const file = path.replace(/^\.\.\//, '');
      const found = englishLiterals(source);
      const max = LEFT[file]?.max ?? 0;
      if (found.length !== max)
        over.push(`${file}: ${found.length}, listed ${max}: ${found.slice(0, 3).join(' | ')}`);
    }
    expect(over).toEqual([]);
  });
});
