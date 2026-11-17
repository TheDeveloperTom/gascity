import type { RuPlural } from './ru';

// owner 17.11: a card the Mayor paused (hold:mayor / hold:external). Only the
// pause lane adds keys here.
export const RU_PAUSE: Readonly<Record<string, string | RuPlural>> = {
  '⏸ Paused': '⏸ На паузе',
  'Paused: {summary}': 'На паузе: {summary}',
  'Paused by {who}, {when}': 'Поставил на паузу: {who}, {when}',
  'Paused, no reason given': 'На паузе, причина не записана',
};
