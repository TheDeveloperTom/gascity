import type { SessionStructuredMessage } from 'gas-city-dashboard-shared/gc-supervisor';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { describeAgentNow } from './agentNow';

// V6: «Сейчас» comes from the session's latest structured message.

beforeEach(() => setLocale('ru'));
afterEach(() => setLocale('en'));

const AT = '2026-11-15T12:25:00Z';

function assistant(blocks: unknown[]): SessionStructuredMessage {
  return {
    role: 'assistant',
    id: 'm-1',
    status: 'final',
    timestamp: AT,
    blocks,
  } as SessionStructuredMessage;
}

describe('describeAgentNow', () => {
  it('bash description wins', () => {
    const now = describeAgentNow([
      assistant([
        {
          type: 'tool_use',
          name: 'Bash',
          input: { kind: 'command', command: 'npm test', description: 'Run frontend tests' },
        },
      ]),
    ]);
    expect(now).toEqual({ text: 'Run frontend tests', sinceIso: AT, raw: 'npm test' });
  });

  it('bash without description', () => {
    const now = describeAgentNow([
      assistant([
        { type: 'tool_use', name: 'Bash', input: { kind: 'command', command: 'ls -la' } },
      ]),
    ]);
    expect(now?.text).toBe('выполняет команду');
    expect(now?.raw).toBe('ls -la');
  });

  it('edit names the file', () => {
    const now = describeAgentNow([
      assistant([
        {
          type: 'tool_use',
          name: 'Edit',
          file_path: 'src/lib/x.ts',
          input: { kind: 'file', file_path: 'src/lib/x.ts' },
        },
      ]),
    ]);
    expect(now?.text).toBe('правит файл src/lib/x.ts');
  });

  it('write names the file', () => {
    const now = describeAgentNow([
      assistant([
        {
          type: 'tool_use',
          name: 'Write',
          input: { kind: 'write', file_path: 'docs/plan.md', text: '# plan' },
        },
      ]),
    ]);
    expect(now?.text).toBe('пишет файл docs/plan.md');
  });

  it('text after tools: the last complete sentence, never a cut-off start', () => {
    // 16.11 owner: «mayor · воротах кормилец относит к ожидающим владельца…»
    // came from keeping the last 120 characters.
    const text =
      'Проверил доску и журнал ворот за ночь. Карточку, застрявшую на воротах, кормилец относит к ожидающим владельца, а не к упавшим.';
    const now = describeAgentNow([
      assistant([
        { type: 'tool_use', name: 'Bash', input: { kind: 'command', command: 'ls' } },
        { type: 'text', text },
      ]),
    ]);
    expect(now?.text).toBe(
      'Карточку, застрявшую на воротах, кормилец относит к ожидающим владельца, а не к упавшим.',
    );
  });

  it('a long last sentence is cut at a word boundary with an ellipsis', () => {
    const sentence = `Начало мысли ${'слово '.repeat(40)}конец.`;
    const now = describeAgentNow([assistant([{ type: 'text', text: `Коротко. ${sentence}` }])]);
    expect(now?.text.startsWith('Начало мысли слово')).toBe(true);
    expect(now?.text.endsWith('…')).toBe(true);
    expect(now?.text.length).toBeLessThanOrEqual(121);
    expect(now?.text).not.toMatch(/\s…$/);
    expect(now?.text.slice(0, -1)).toMatch(/слово$/);
  });

  it('uses the last non-empty line, without a markdown marker', () => {
    const now = describeAgentNow([
      assistant([{ type: 'text', text: 'Итог прогона:\n\n- все 40 тестов зелёные\n' }]),
    ]);
    expect(now?.text).toBe('все 40 тестов зелёные');
  });

  it('one unbroken long token is cut with an ellipsis too', () => {
    const now = describeAgentNow([assistant([{ type: 'text', text: 'x'.repeat(300) }])]);
    expect(now?.text).toBe(`${'x'.repeat(120)}…`);
  });

  it('thinking only', () => {
    const now = describeAgentNow([assistant([{ type: 'thinking', thinking: '' }])]);
    expect(now?.text).toBe('думает');
  });

  it('no messages gives null', () => {
    expect(describeAgentNow([])).toBeNull();
  });
});
