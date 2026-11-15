import type {
  SessionStructuredBlock,
  SessionStructuredMessage,
} from 'gas-city-dashboard-shared/gc-supervisor';
import { t } from '../i18n';

export { sessionForBead } from '../attention/beadsNeedingAttention';

// «Сейчас» (dashboard v3, ruling V6): what an agent is doing, read from its
// latest structured message. A Bash call says its own description (the
// engine keeps it since dashboard v3; until it is reinstalled a call reads
// «выполняет команду» and the command sits behind «подробнее»), Edit and
// Write name the file, otherwise the latest assistant text is cut to 120
// characters, and thinking alone reads «думает».

export interface AgentNow {
  text: string;
  sinceIso: string | null;
  /** The command or text behind «подробнее»; null when the text says it all. */
  raw: string | null;
}

export const AGENT_NOW_TEXT_LIMIT = 120;

const EDIT_TOOLS: ReadonlySet<string> = new Set([
  'edit',
  'multiedit',
  'notebookedit',
  'apply_patch',
]);
const WRITE_TOOLS: ReadonlySet<string> = new Set(['write']);

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toolNow(block: Extract<SessionStructuredBlock, { type: 'tool_use' }>): {
  text: string;
  raw: string | null;
} {
  // The generated client may predate the engine field; read it structurally.
  const input = (block.input ?? {}) as Record<string, unknown>;
  const kind = str(input.kind);
  const name = str(block.name).toLowerCase();
  const file = str(input.file_path) || str(block.file_path);
  if (kind === 'command' || name === 'bash') {
    const command = str(input.command);
    const description = str(input.description);
    return {
      text: description.length > 0 ? description : t('running a command'),
      raw: command.length > 0 ? command : null,
    };
  }
  if (kind === 'write' || WRITE_TOOLS.has(name)) {
    return {
      text: file.length > 0 ? t('writing file {file}', { file }) : t('writing a file'),
      raw: null,
    };
  }
  if (kind === 'patch' || EDIT_TOOLS.has(name)) {
    return {
      text: file.length > 0 ? t('editing file {file}', { file }) : t('editing a file'),
      raw: null,
    };
  }
  if (kind === 'file' && file.length > 0) {
    return { text: t('reading file {file}', { file }), raw: null };
  }
  const label = str(block.name);
  return {
    text: label.length > 0 ? t('using tool {name}', { name: label }) : t('using a tool'),
    raw: null,
  };
}

function lastChars(text: string): string {
  return text.length > AGENT_NOW_TEXT_LIMIT ? text.slice(-AGENT_NOW_TEXT_LIMIT) : text;
}

export function describeAgentNow(messages: readonly SessionStructuredMessage[]): AgentNow | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message === undefined || message.role !== 'assistant') continue;
    const sinceIso = message.timestamp ?? null;
    let sawThinking = false;
    for (let j = message.blocks.length - 1; j >= 0; j -= 1) {
      const block = message.blocks[j];
      if (block === undefined) continue;
      if (block.type === 'tool_use') return { ...toolNow(block), sinceIso };
      if (block.type === 'text') {
        const text = str(block.text);
        if (text.length > 0) return { text: lastChars(text), sinceIso, raw: null };
      }
      if (block.type === 'thinking') sawThinking = true;
    }
    if (sawThinking) return { text: t('thinking'), sinceIso, raw: null };
  }
  return null;
}
