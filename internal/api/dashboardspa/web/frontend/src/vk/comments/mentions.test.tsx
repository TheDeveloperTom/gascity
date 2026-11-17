import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../../i18n';
import { CommentComposer } from './CommentThread';
import { activeMention, filterMentions, insertMention, mentionOptions } from './mentions';

// Owner 17.11: `@` in the card conversation box suggests мэр (our own Mayor),
// мэр-<peer> (the peer's Mayor, by the genitive the city resolves) and <peer
// person> (the human→human ping); picking one inserts the token.

const PEERS = [{ login: 'peer', name: 'Ричард', label: 'Ричарда' }];

beforeEach(() => {
  setLocale('ru');
  resetMissing();
});
afterEach(() => {
  cleanup();
  setLocale('en');
});

describe('mention helpers', () => {
  it('options: own Mayor, the peer Mayor, the peer person', () => {
    expect(mentionOptions(PEERS).map((o) => o.token)).toEqual(['мэр', 'мэр-ричарда', 'ричард']);
  });

  it('the @word under the caret, not an e-mail or a finished word', () => {
    expect(activeMention('привет @мэ', 10)).toEqual({ start: 7, query: 'мэ' });
    expect(activeMention('@', 1)).toEqual({ start: 0, query: '' });
    expect(activeMention('a@мэ', 4)).toBeNull();
    expect(activeMention('@мэр готово', 11)).toBeNull();
  });

  it('filters by prefix and inserts the token with a trailing space', () => {
    const opts = mentionOptions(PEERS);
    expect(filterMentions(opts, 'мэр-').map((o) => o.token)).toEqual(['мэр-ричарда']);
    expect(filterMentions(opts, 'Ри').map((o) => o.token)).toEqual(['ричард']);
    expect(insertMention('ну @мэ глянь', 3, 6, 'мэр')).toEqual({ value: 'ну @мэр  глянь', caret: 8 });
  });
});

describe('CommentComposer mentions', () => {
  function box() {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CommentComposer label="Комментарий" placeholder="…" onSubmit={onSubmit} mentions={mentionOptions(PEERS)} />,
    );
    return screen.getByRole('textbox', { name: 'Комментарий' }) as HTMLTextAreaElement;
  }

  it('typing @ shows the list; a click inserts the token', () => {
    const area = box();
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.change(area, { target: { value: 'вопрос @' } });
    const list = screen.getByRole('listbox', { name: 'Упомянуть' });
    expect(list.textContent).toContain('@мэр-ричарда');
    expect(list.textContent).toContain('Мэр Ричарда');
    fireEvent.mouseDown(screen.getByRole('option', { name: /@мэр-ричарда/ }));
    expect(area.value).toBe('вопрос @мэр-ричарда ');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(collectMissing()).toEqual([]);
  });

  it('Enter picks the highlighted option and does not send; Escape closes', () => {
    const area = box();
    fireEvent.change(area, { target: { value: '@мэ' } });
    fireEvent.keyDown(area, { key: 'ArrowDown' });
    fireEvent.keyDown(area, { key: 'Enter' });
    expect(area.value).toBe('@мэр-ричарда ');
    fireEvent.change(area, { target: { value: '@мэр-ричарда @' } });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(area, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('without the prop there is no list', () => {
    render(<CommentComposer label="Б" placeholder="…" onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Б' }), { target: { value: '@' } });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
