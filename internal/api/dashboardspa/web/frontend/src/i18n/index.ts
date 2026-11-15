import { readBrowserStorage, writeBrowserStorage } from '../lib/browserStorage';
import { RU as RU_CORE, type RuPlural } from './ru';
import { RU_BOARD } from './ru.board';
import { RU_DEBUG } from './ru.debug';
import { RU_HOME } from './ru.home';
import { RU_VK2 } from './ru.vk2';
import { RU_VK4 } from './ru.vk4';
import { RU_VK5 } from './ru.vk5';
import { RU_VK6 } from './ru.vk6';
import { RU_VKFINAL } from './ru.vkfinal';

// A small gettext-style layer: the English string is the key, Russian lives
// in `ru.ts` plus one dictionary per dashboard-v3 lane (`ru.home.ts`,
// `ru.board.ts`, `ru.debug.ts`), and a key with no Russian entry falls back to
// English (and is recorded so a completeness test can list it).

const RU: Readonly<Record<string, string | RuPlural>> = {
  ...RU_CORE,
  ...RU_HOME,
  ...RU_BOARD,
  ...RU_DEBUG,
  // vk port lanes (one dictionary each; this file is frozen after lane 0b).
  ...RU_VK2,
  ...RU_VK4,
  ...RU_VK5,
  ...RU_VK6,
  ...RU_VKFINAL,
};

export type Locale = 'en' | 'ru';
export type Vars = Readonly<Record<string, string | number>>;
export type PluralForms = { one: string; other: string };

export const LOCALE_STORAGE_KEY = 'gascity:locale';
const COMPONENT = 'i18n';

// The owner reads Russian (dashboard v3): `ru` is the default, and English
// applies only when it is the stored choice. The browser language no longer
// decides; the parameter stays so callers keep one signature.
export function resolveInitialLocale(
  stored: string | null,
  _navigatorLanguage: string | undefined,
): Locale {
  if (stored === 'en' || stored === 'ru') return stored;
  return 'ru';
}

function readInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'ru';
  const stored = readBrowserStorage('localStorage', LOCALE_STORAGE_KEY, COMPONENT);
  return resolveInitialLocale(
    stored.status === 'found' ? stored.value : null,
    typeof navigator === 'undefined' ? undefined : navigator.language,
  );
}

let current: Locale = readInitialLocale();
applyDocumentLang(current);

const listeners = new Set<() => void>();
const missing = new Set<string>();

function applyDocumentLang(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
}

export function getLocale(): Locale {
  return current;
}

// Never throws: a blocked storage is reported by browserStorage and the
// choice still applies for this page load.
export function setLocale(locale: Locale): void {
  writeBrowserStorage('localStorage', LOCALE_STORAGE_KEY, locale, COMPONENT);
  applyDocumentLang(locale);
  if (locale === current) return;
  current = locale;
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function substitute(template: string, vars: Vars | undefined): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

export function t(en: string, vars?: Vars): string {
  if (current === 'en') return substitute(en, vars);
  const entry = RU[en];
  if (typeof entry === 'string') return substitute(entry, vars);
  missing.add(en);
  return substitute(en, vars);
}

// For strings that may be a label or a name (page titles): translate when a
// Russian entry exists, otherwise show as-is without recording it missing.
export function tIfKnown(text: string): string {
  if (current === 'en') return text;
  const entry = RU[text];
  return typeof entry === 'string' ? entry : text;
}

const ruRules = new Intl.PluralRules('ru');
const enRules = new Intl.PluralRules('en');

export function tn(n: number, forms: PluralForms, vars?: Vars): string {
  const all: Vars = { ...vars, n };
  if (current === 'en') {
    return substitute(enRules.select(n) === 'one' ? forms.one : forms.other, all);
  }
  const entry = RU[forms.other];
  if (entry && typeof entry === 'object') {
    const category = ruRules.select(n);
    // Fractions select "other"; Russian uses the genitive singular there,
    // which is the "few" form («1,5 дела»).
    const form = category === 'one' ? entry.one : category === 'many' ? entry.many : entry.few;
    return substitute(form, all);
  }
  missing.add(forms.other);
  return substitute(enRules.select(n) === 'one' ? forms.one : forms.other, all);
}

export function collectMissing(): readonly string[] {
  return Array.from(missing);
}

export function resetMissing(): void {
  missing.clear();
}
