import { describe, expect, it } from 'vitest';

import { bareRedirectTarget } from './cityRedirect';

const loc = (pathname: string, search = '', hash = '') => ({ pathname, search, hash });

describe('bareRedirectTarget', () => {
  it('keeps the view and the query', () => {
    expect(bareRedirectTarget('devwork-platform', loc('/beads', '?bead=dw-4xn4b'))).toBe(
      '/city/devwork-platform/beads?bead=dw-4xn4b',
    );
  });

  it('bare root goes home', () => {
    expect(bareRedirectTarget('devwork-platform', loc('/'))).toBe('/city/devwork-platform/');
  });

  it('keeps a nested path and the hash', () => {
    expect(
      bareRedirectTarget(
        'devwork-platform',
        loc('/runs/gcg-153601', '?scope_kind=rig&scope_ref=devwork', '#n'),
      ),
    ).toBe('/city/devwork-platform/runs/gcg-153601?scope_kind=rig&scope_ref=devwork#n');
  });

  it('collapses repeated slashes', () => {
    expect(bareRedirectTarget('devwork-platform', loc('//beads/'))).toBe(
      '/city/devwork-platform/beads/',
    );
  });

  it('a city segment without a valid name goes home', () => {
    expect(bareRedirectTarget('devwork-platform', loc('/city', '?x=1'))).toBe(
      '/city/devwork-platform/?x=1',
    );
    expect(bareRedirectTarget('devwork-platform', loc('/city/', '?x=1'))).toBe(
      '/city/devwork-platform/?x=1',
    );
  });

  it('encodes the city name', () => {
    expect(bareRedirectTarget('my city', loc('/agents'))).toBe('/city/my%20city/agents');
  });
});
