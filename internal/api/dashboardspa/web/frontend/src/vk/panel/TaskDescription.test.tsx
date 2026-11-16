import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskDescription } from './TaskDescription';

afterEach(cleanup);

// Real text of dw-dp30 (live rig devwork, read 16.11): old free text, no headings.
const DW_DP30 =
  'Обещано Мэром 12.11 05:04Z комментарием на dw-233382da4ce5cfa9 («остаток M03 заново нарежу на конкретные задачи через план, учту ADR A7») и не сделано: задачей не стало, метка hold:mayor на карточку не встала (архив доски 12.11 05:05Z — только milestone:M03). 16.11 панель: ~15–19 задач M03 готовы, но не отданы 5 дней. Сделать: план остатка M03 под ADR A7 (один тип пользователя) по разделу «Как рождается план»; задачи, не зависящие от старой схемы, — прочитать и предложить к раздаче; вопрос владельцу кнопками 9fe1bcdea378de731f917f72 («Перенарежь» / «Раздай как есть»).';

const STRUCTURED = [
  '## Что сделать',
  'Перенарезать остаток M03 под одного пользователя.',
  '- прочитать задачи',
  '- предложить к раздаче',
  '',
  '## Почему',
  'Задачи M03 стоят пять дней.',
  '',
  '## Готово, когда',
  'План лежит в доске.',
  '',
  '## Нужно от владельца',
  'Выбрать: перенарезать или раздать как есть.',
  '',
  '## Справка',
  'Обещано на dw-233382da4ce5cfa9, вопрос 9fe1bcdea378de731f917f72, ветка vkg/rel16, 12.11 05:04Z.',
].join('\n');

/** Every non-space character of the source, in order (nothing lost, nothing added). */
function letters(s: string): string {
  return s.replace(/\s+/g, '');
}

describe('TaskDescription: structured text', () => {
  it('renders the contract sections as headings with paragraphs and lists', () => {
    render(<TaskDescription text={STRUCTURED} />);
    for (const h of ['Что сделать', 'Почему', 'Готово, когда', 'Нужно от владельца']) {
      expect(screen.getByRole('heading', { name: h })).toBeTruthy();
    }
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['прочитать задачи', 'предложить к раздаче']);
    expect(screen.getByText('Задачи M03 стоят пять дней.').tagName).toBe('P');
  });

  it('shows «Справка» as a secondary, muted section; short ones are open', () => {
    render(<TaskDescription text={STRUCTURED} />);
    const ref = screen.getByTestId('task-description-reference');
    expect(ref.tagName).toBe('DETAILS');
    expect(ref.className).toMatch(/text-vk-text-low/);
    expect(ref.className).toMatch(/text-sm/);
    expect((ref as HTMLDetailsElement).open).toBe(true);
  });

  it('collapses a long «Справка» by default', () => {
    const long = `${STRUCTURED}\n${Array.from({ length: 12 }, (_, i) => `- файл src/a${i}.ts`).join('\n')}`;
    render(<TaskDescription text={long} />);
    const ref = screen.getByTestId('task-description-reference') as HTMLDetailsElement;
    expect(ref.open).toBe(false);
    expect(ref.querySelector('summary')?.textContent).toContain('Справка');
  });
});

describe('TaskDescription: legacy free text (dw-dp30)', () => {
  it('keeps every word and splits the wall into short paragraphs', () => {
    const { container } = render(<TaskDescription text={DW_DP30} />);
    expect(letters(container.textContent ?? '')).toBe(letters(DW_DP30));
    expect(container.querySelectorAll('p').length).toBeGreaterThanOrEqual(2);
  });

  it('shows ids, hashes and timestamps in the muted mono face', () => {
    render(<TaskDescription text={DW_DP30} />);
    const mono = Array.from(document.querySelectorAll('[data-token]')).map((el) => el.textContent);
    expect(mono).toEqual(
      expect.arrayContaining(['dw-233382da4ce5cfa9', '9fe1bcdea378de731f917f72', '12.11 05:04Z', '12.11 05:05Z']),
    );
    const id = document.querySelector('[data-token="hash"]');
    expect(id?.className).toMatch(/font-vk-mono/);
    expect(id?.className).toMatch(/text-vk-text-low/);
  });

  it('makes ids of tickets on the board clickable', () => {
    const onOpenBead = vi.fn();
    render(
      <TaskDescription text={DW_DP30} knownIds={new Set(['dw-233382da4ce5cfa9'])} onOpenBead={onOpenBead} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'dw-233382da4ce5cfa9' }));
    expect(onOpenBead).toHaveBeenCalledWith('dw-233382da4ce5cfa9');
  });

  it('keeps an id that is not on the board as plain mono text', () => {
    render(<TaskDescription text={DW_DP30} knownIds={new Set()} onOpenBead={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'dw-233382da4ce5cfa9' })).toBeNull();
    expect(screen.getByText('dw-233382da4ce5cfa9').getAttribute('data-token')).toBe('id');
  });

  it('keeps existing line breaks', () => {
    const { container } = render(<TaskDescription text={'Первая строка.\nВторая строка.'} />);
    expect(container.querySelectorAll('br').length).toBe(1);
  });
});

describe('TaskDescription: hostile text', () => {
  it('renders angle brackets as text, never as markup', () => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script> <b>bold</b>';
    const { container } = render(<TaskDescription text={evil} />);
    expect(container.querySelector('img, script, b')).toBeNull();
    expect(container.textContent).toContain('<script>alert(2)</script>');
  });

  it('does not turn a javascript: link into a link', () => {
    const { container } = render(<TaskDescription text={'Смотри [сюда](javascript:alert(1)) и [док](https://example.com/a).'} />);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com/a']);
    expect(container.textContent).toContain('[сюда](javascript:alert(1))');
  });

  it('lets a very long unbroken string wrap anywhere', () => {
    const { container } = render(<TaskDescription text={`x${'y'.repeat(5000)}`} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/overflow-wrap:anywhere/);
    expect(letters(container.textContent ?? '')).toBe(`x${'y'.repeat(5000)}`);
  });
});

// REL17 finding 1 (16.11): a long one-line description is broken at sentence
// ends. A sentence that begins like a list marker («3) …», «7. …», «- …»,
// «# …») must never begin a paragraph, or the drawer reads it as a list or a
// heading and the «3)» is lost («1.» appears instead).
describe('a sentence that looks like a list marker', () => {
  // Each sentence is longer than a paragraph's target, so the splitter must
  // break right before every one of them.
  const long = (head: string) => `${head} ${'слово '.repeat(45).trim()}.`;
  it('keeps «3) c» in place and draws no ordered list', () => {
    const text = [long('Сначала сделать вот это'), long('2) второе действие'), long('3) третье действие')].join(' ');
    const { container } = render(<TaskDescription text={text} />);
    expect(container.textContent).toContain('3) третье действие');
    expect(container.textContent).toContain('2) второе действие');
    expect(container.querySelector('ol')).toBeNull();
    expect(container.querySelector('ul')).toBeNull();
  });

  it('keeps «7. Текст», «- пункт» and «# заметка» as running text', () => {
    const text = [long('Итог такой'), long('7. Текст продолжения'), long('- пункт без списка'), long('# заметка в строке')].join(' ');
    const { container } = render(<TaskDescription text={text} />);
    expect(container.textContent).toContain('7. Текст продолжения');
    expect(container.textContent).toContain('- пункт без списка');
    expect(container.textContent).toContain('# заметка в строке');
    expect(container.querySelector('ol, ul, h1, h2, h3, h4, h5, h6')).toBeNull();
  });

  it('still breaks a long text at ordinary sentence ends', () => {
    const text = [long('Первое'), long('Второе'), long('Третье')].join(' ');
    const { container } = render(<TaskDescription text={text} />);
    expect(container.querySelectorAll('p').length).toBeGreaterThan(1);
  });
});
