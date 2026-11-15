import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderMiniMarkdown } from './miniMarkdown';

afterEach(cleanup);

function html(source: string): HTMLElement {
  const { container } = render(<div>{renderMiniMarkdown(source)}</div>);
  return container.firstElementChild as HTMLElement;
}

describe('renderMiniMarkdown', () => {
  it('bold, lists, headings render as elements', () => {
    const root = html(
      [
        '# Заголовок',
        '### Подзаголовок',
        '',
        'Текст с **жирным**, *курсивом* и `кодом`.',
        '',
        '- первый',
        '- второй',
        '',
        '1. раз',
        '2. два',
      ].join('\n'),
    );
    expect(root.querySelector('h1')?.textContent).toBe('Заголовок');
    expect(root.querySelector('h3')?.textContent).toBe('Подзаголовок');
    expect(root.querySelector('p strong')?.textContent).toBe('жирным');
    expect(root.querySelector('p em')?.textContent).toBe('курсивом');
    expect(root.querySelector('p code')?.textContent).toBe('кодом');
    expect([...root.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual([
      'первый',
      'второй',
    ]);
    expect([...root.querySelectorAll('ol > li')].map((li) => li.textContent)).toEqual([
      'раз',
      'два',
    ]);
  });

  it('markdown never injects HTML', () => {
    const root = html(
      [
        '<img src=x onerror="alert(1)">',
        '',
        '[x](javascript:alert(1)) and <script>alert(2)</script>',
        '',
        'see [the PR](https://github.com/o/r/pull/1) and [plain](http://example.com)',
      ].join('\n'),
    );
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(root.textContent).toContain('<script>alert(2)</script>');
    const links = [...root.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('https://github.com/o/r/pull/1');
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[0]?.textContent).toBe('the PR');
    expect(root.textContent).toContain('[x](javascript:alert(1))');
  });
});
