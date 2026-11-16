import { describe, expect, it } from 'vitest';
import { splitCityRestarting } from './cityRestarting';

describe('splitCityRestarting', () => {
  it('folds «city not found or not running» errors into one calm flag', () => {
    const out = splitCityRestarting([
      'not_found: city not found or not running: devwork-platform',
      '404 not_found: city not found or not running: devwork-platform',
      null,
    ]);
    expect(out).toEqual({ restarting: true, rest: [] });
  });

  it('a city that is starting counts as restarting', () => {
    expect(splitCityRestarting(['unavailable: city devwork-platform is starting'])).toEqual({ restarting: true, rest: [] });
  });

  it('every other error stays as it was', () => {
    expect(splitCityRestarting(['not_found: bead not found', 'boom', undefined])).toEqual({
      restarting: false,
      rest: ['not_found: bead not found', 'boom'],
    });
  });
});
