// The dashboard renders Russian by default (src/i18n resolveInitialLocale), so
// the e2e specs assert the Russian copy. `ru(en)` looks the English source
// string up in the same dictionaries, merged in the same order as
// src/i18n/index.ts, and interpolates `{name}` the same way; a key with no
// Russian entry falls back to English, exactly as the app does.
//
// The dictionaries are imported directly (not src/i18n/index.ts, which pulls
// in browser storage and the client-error reporter).

import { RU as RU_CORE, type RuPlural } from '../../src/i18n/ru';
import { RU_BOARD } from '../../src/i18n/ru.board';
import { RU_DEBUG } from '../../src/i18n/ru.debug';
import { RU_H1 } from '../../src/i18n/ru.h1';
import { RU_HOME } from '../../src/i18n/ru.home';
import { RU_VK2 } from '../../src/i18n/ru.vk2';
import { RU_VK4 } from '../../src/i18n/ru.vk4';
import { RU_VK5 } from '../../src/i18n/ru.vk5';
import { RU_VK6 } from '../../src/i18n/ru.vk6';
import { RU_VKFINAL } from '../../src/i18n/ru.vkfinal';

const RU: Readonly<Record<string, string | RuPlural>> = {
  ...RU_CORE,
  ...RU_HOME,
  ...RU_BOARD,
  ...RU_DEBUG,
  ...RU_VK2,
  ...RU_VK4,
  ...RU_VK5,
  ...RU_VK6,
  ...RU_VKFINAL,
  ...RU_H1,
};

/** The Russian the dashboard renders for an English source string. */
export function ru(en: string, vars?: Readonly<Record<string, string | number>>): string {
  const hit = RU[en];
  const template = typeof hit === 'string' ? hit : en;
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}
