import type { RuPlural } from './ru';

// polish2 16.11 (owner's live findings): Russian strings keyed by the English
// source string. Only the polish2 lane adds keys here.
export const RU_POLISH2: Readonly<Record<string, string | RuPlural>> = {
  'City (service)': 'Город (служебное)',
  '{rig} product': 'Продукт {rig}',
};
