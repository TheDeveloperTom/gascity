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

  it('text after tools', () => {
    const long = `${'a'.repeat(200)} конец мысли`;
    const now = describeAgentNow([
      assistant([
        { type: 'tool_use', name: 'Bash', input: { kind: 'command', command: 'ls' } },
        { type: 'text', text: long },
      ]),
    ]);
    expect(now?.text).toBe(long.slice(-120));
    expect(now?.text).toHaveLength(120);
  });

  it('thinking only', () => {
    const now = describeAgentNow([assistant([{ type: 'thinking', thinking: '' }])]);
    expect(now?.text).toBe('думает');
  });

  it('no messages gives null', () => {
    expect(describeAgentNow([])).toBeNull();
  });
});
