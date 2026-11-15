import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { agentDisplayName } from './agentNames';

describe('agentDisplayName', () => {
  afterEach(() => setLocale('en'));

  it('names the role, not the session', () => {
    expect(agentDisplayName('superpowers__implementer-gcg-session-d1b5c0ffee')).toBe('Implementer');
    expect(agentDisplayName('mayor')).toBe('Mayor');
    expect(agentDisplayName('devwork/core.control-dispatcher')).toBe('Dispatcher');
    expect(agentDisplayName('devwork/superpowers__reviewer-2')).toBe('Reviewer');
    expect(agentDisplayName('devwork/run-operator')).toBe('Run operator');
  });

  it('uses the template when the name says nothing', () => {
    expect(agentDisplayName('gc-2568', 'devwork/mayor')).toBe('Mayor');
  });

  it('falls back to the last path segment without the session suffix', () => {
    expect(agentDisplayName('devwork/librarian-gcg-session-abc123')).toBe('librarian');
  });

  it('speaks russian', () => {
    setLocale('ru');
    expect(agentDisplayName('mayor')).toBe('Мэр');
    expect(agentDisplayName('superpowers__implementer')).toBe('Исполнитель');
  });
});
