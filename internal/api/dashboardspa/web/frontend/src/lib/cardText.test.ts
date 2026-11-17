import { describe, expect, it } from 'vitest';
import { attachmentUrls, codeTokens, prepareCardText } from './cardText';

// Owner 17.11 (asked ~10 times): a card's description must read as a
// document, not raw lines. The peer card in his screenshot came as plain
// lines with our section names and machine ids mixed in.

const PEER_CARD = [
  'Что сделать',
  'Надписи на кнопках в тёмной теме не читаются; сделать их контрастными.',
  'Готово, когда',
  'Тест lib/theme/fill-ink.test.ts зелёный',
  'Кнопки читаются в обеих темах',
  'Справка',
  'Скриншот владельца 17.11 18:58Z; правка Мэра: коммит 77ca4d0ac, PR #600; вопрос dw-c3a',
  'Происхождение: owner:msg:1572325038508474550',
  'Без связей: задача стоит одна',
].join('\n');

describe('prepareCardText', () => {
  it('turns our plain section names into headings, «Готово, когда» lines into bullets, and hides machine lines', () => {
    const out = prepareCardText(PEER_CARD);
    expect(out.body).toBe(
      [
        '## Что сделать',
        'Надписи на кнопках в тёмной теме не читаются; сделать их контрастными.',
        '',
        '## Готово, когда',
        '- Тест `lib/theme/fill-ink.test.ts` зелёный',
        '- Кнопки читаются в обеих темах',
        '',
        '## Справка',
        'Скриншот владельца 17.11 18:58Z; правка Мэра: коммит `77ca4d0ac`, PR #600; вопрос `dw-c3a`',
      ].join('\n'),
    );
    expect(out.details).toEqual([
      'Происхождение: `owner:msg:1572325038508474550`',
      'Без связей: задача стоит одна',
    ]);
  });

  it('accepts a colon, bold, or a markdown heading for the section names, and the other known names', () => {
    const out = prepareCardText(
      ['**Что меняем и зачем:**', 'текст', 'Как поймём, что готово:', '- уже пункт', 'новый пункт', 'Связь', 'dw-7q1'].join(
        '\n',
      ),
    );
    expect(out.body.split('\n')).toEqual([
      '## Что меняем и зачем',
      'текст',
      '',
      '## Как поймём, что готово',
      '- уже пункт',
      '- новый пункт',
      '',
      '## Связь',
      '`dw-7q1`',
    ]);
  });

  it('a section name with text after the colon becomes the heading plus that text', () => {
    expect(prepareCardText('Готово, когда: тест зелёный').body).toBe('## Готово, когда\n- тест зелёный');
    expect(prepareCardText('Откуда: из разговора с владельцем').body).toBe('## Откуда\nиз разговора с владельцем');
  });

  it('a «## Служебное» section goes under «Подробнее» whole', () => {
    const out = prepareCardText(['## Что сделать', 'X', '', '## Служебное', 'origin: owner:msg:1', 'commit 0123abcd'].join('\n'));
    expect(out.body).toBe('## Что сделать\nX');
    expect(out.details).toEqual(['origin: `owner:msg:1`', 'commit `0123abcd`']);
  });

  it('markdown images leave the text and become images', () => {
    const out = prepareCardText('Смотри ![скрин](https://cdn.example.com/a.png)\nдальше');
    expect(out.body).toBe('Смотри\nдальше');
    expect(out.images).toEqual(['https://cdn.example.com/a.png']);
  });

  it('a one-line legacy description still goes through the old structuring', () => {
    const out = prepareCardText('Основание: всё сломалось. Решение: починить.');
    expect(out.body).toContain('**Основание:**');
    expect(out.details).toEqual([]);
  });

  it('text with no known sections is left as it is', () => {
    expect(prepareCardText('просто\nдве строки').body).toBe('просто\nдве строки');
  });
});

describe('codeTokens', () => {
  it('wraps paths, hashes, bead ids and message ids, but not words, dates, numbers or links', () => {
    expect(codeTokens('файл internal/api/x.go и main.tsx, коммит 77ca4d0ac, de-3pva, owner:msg:15')).toBe(
      'файл `internal/api/x.go` и `main.tsx`, коммит `77ca4d0ac`, `de-3pva`, `owner:msg:15`',
    );
    expect(codeTokens('17.11 в 18:58Z, PR #600, 1572325038508474550, decade')).toBe(
      '17.11 в 18:58Z, PR #600, 1572325038508474550, decade',
    );
    expect(codeTokens('см. https://github.com/o/r/pull/600 и [PR](https://x.io/a/b.go)')).toBe(
      'см. https://github.com/o/r/pull/600 и [PR](https://x.io/a/b.go)',
    );
    expect(codeTokens('уже `lib/a.ts` в коде')).toBe('уже `lib/a.ts` в коде');
  });
});

describe('attachmentUrls', () => {
  it('serves our own card’s files from the city attachments endpoint', () => {
    expect(
      attachmentUrls({ 'devwork.attachments': '["1-image.png","2 shot.JPG"]' }, { city: 'dw', beadId: 'dw-1.2' }),
    ).toEqual(['/api/city/dw/attachments/dw-1.2/1-image.png', '/api/city/dw/attachments/dw-1.2/2%20shot.JPG']);
  });

  it('drops names that are not plain image file names, and bad metadata', () => {
    expect(
      attachmentUrls(
        { 'devwork.attachments': '["../secret.png","a/b.png","voice.ogg","ok.webp"]' },
        { city: 'dw', beadId: 'dw-1' },
      ),
    ).toEqual(['/api/city/dw/attachments/dw-1/ok.webp']);
    expect(attachmentUrls({ 'devwork.attachments': 'not json' }, { city: 'dw', beadId: 'dw-1' })).toEqual([]);
    expect(attachmentUrls(undefined, { city: 'dw', beadId: 'dw-1' })).toEqual([]);
  });

  it('without a city (a peer card) there is nothing we can serve', () => {
    expect(attachmentUrls({ 'devwork.attachments': '["1-image.png"]' }, { beadId: 'dw-1' })).toEqual([]);
  });
});

describe('prepareCardText keeps what already reads well', () => {
  it('a bold lead-in with text stays bold; a heading or a bold lead-in ends the checklist', () => {
    const out = prepareCardText(
      ['**Как поймём, что готово:** критерии', '**Сейчас:** импорт', '', '### Исходные сведения', 'строка'].join('\n'),
    );
    expect(out.body.split('\n')).toEqual([
      '**Как поймём, что готово:** критерии',
      '**Сейчас:** импорт',
      '',
      '### Исходные сведения',
      'строка',
    ]);
    const list = prepareCardText(['Готово, когда', 'пункт', '### Дальше', 'текст'].join('\n'));
    expect(list.body.split('\n')).toEqual(['## Готово, когда', '- пункт', '### Дальше', 'текст']);
  });
});
