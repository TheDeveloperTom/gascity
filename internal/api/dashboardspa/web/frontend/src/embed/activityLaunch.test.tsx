// vk-final part 5 (ACTIVITY-LINKS.md §3): a ticket link the Mayor posts
// opens that card inside the Activity. The SDK is mocked at its package
// boundary; the gateway is a stubbed fetch.
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ customId: null as string | null, instanceId: 'inst-1' }));

vi.mock('@discord/embedded-app-sdk', () => ({
  DiscordSDK: class {
    instanceId = m.instanceId;
    customId = m.customId;
    platform = 'desktop';
    commands = {
      authorize: async () => ({ code: 'code-1' }),
      authenticate: async () => ({ user: { id: 'u' } }),
      openExternalLink: async () => ({ opened: true }),
    };
    ready() {
      return Promise.resolve();
    }
  },
}));

import { resetActivityPlumbingForTests } from '../lib/apiBase';
import { bootActivity } from './activitySdk';
import { captureLaunch, parseLaunchCustomId, takeLaunchBead } from './activitySession';
import { LaunchCardOpener } from './LaunchCardOpener';

function tokenFetch(): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ session: 'S1', access_token: 'tok', user_id: 'u1', role: 'owner' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  resetActivityPlumbingForTests();
  window.sessionStorage.clear();
  m.customId = null;
  m.instanceId = 'inst-1';
});
afterEach(() => {
  cleanup();
  resetActivityPlumbingForTests();
});

describe('launch parameter', () => {
  it('accepts only bead:<id>', () => {
    expect(parseLaunchCustomId('bead:dw-ab12')).toBe('dw-ab12');
    expect(parseLaunchCustomId('bead:gc-1.2_x')).toBe('gc-1.2_x');
    for (const bad of [null, '', 'dw-ab12', 'bead:', 'bead:../x', 'bead:a b', `bead:${'a'.repeat(65)}`, 'card:dw-1']) {
      expect(parseLaunchCustomId(bad)).toBeNull();
    }
  });

  it('bootActivity captures sdk.customId with the instance; it is consumed once per instance', async () => {
    m.customId = 'bead:dw-ab12';
    await bootActivity('client-1', tokenFetch());
    expect(takeLaunchBead()).toBe('dw-ab12');
    expect(takeLaunchBead()).toBeNull();
    // a reload inside the same instance does not reopen it
    captureLaunch('bead:dw-ab12', 'inst-1');
    expect(takeLaunchBead()).toBeNull();
    // a new instance does
    captureLaunch('bead:dw-ab12', 'inst-2');
    expect(takeLaunchBead()).toBe('dw-ab12');
  });

  it('anything else is ignored silently', async () => {
    m.customId = 'javascript:alert(1)';
    await bootActivity('client-1', tokenFetch());
    expect(takeLaunchBead()).toBeNull();
  });

  it('storage that throws still consumes in memory', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    captureLaunch('bead:dw-1', 'inst-9');
    expect(takeLaunchBead()).toBe('dw-1');
    expect(takeLaunchBead()).toBeNull();
    spy.mockRestore();
  });
});

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{`${loc.pathname}${loc.search}|${JSON.stringify(loc.state)}`}</p>;
}

describe('LaunchCardOpener', () => {
  it('navigates client-side to /beads with bead merged into the launch query', () => {
    captureLaunch('bead:dw-ab12', 'inst-1');
    const view = render(
      <MemoryRouter initialEntries={['/?frame_id=f1&instance_id=inst-1&platform=desktop']}>
        <LaunchCardOpener />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    const where = view.getByTestId('where').textContent ?? '';
    const [path, state] = where.split('|');
    const url = new URL(path!, 'http://x');
    expect(url.pathname).toBe('/beads');
    expect(url.searchParams.get('frame_id')).toBe('f1');
    expect(url.searchParams.get('instance_id')).toBe('inst-1');
    expect(url.searchParams.get('bead')).toBe('dw-ab12');
    expect(JSON.parse(state!)).toEqual({ launchBead: 'dw-ab12' });
  });

  it('no launch card: nothing changes', () => {
    const view = render(
      <MemoryRouter initialEntries={['/?frame_id=f1']}>
        <LaunchCardOpener />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(view.getByTestId('where').textContent).toBe('/?frame_id=f1|null');
  });
});
