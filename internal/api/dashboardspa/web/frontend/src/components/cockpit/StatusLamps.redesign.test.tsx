import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { StatusLamps, type StatusLamp } from './Instruments';

// Self-critique (Task 11, "remove one accessory"): a healthy lamp already says
// so with its green shape. Painting its value green too is colour as
// wallpaper and dilutes the one lamp that needs a look. Only warning values
// keep their signal colour; the shape always carries the state.

afterEach(() => cleanup());

const lamps: StatusLamp[] = [
  { key: 'feed', label: 'live feed', value: 'connected', state: 'healthy', href: '/activity' },
  { key: 'mail', label: 'mail', value: '3 unread', state: 'warning', href: '/mail' },
];

function renderLamps() {
  return render(
    <MemoryRouter>
      <StatusLamps lamps={lamps} />
    </MemoryRouter>,
  );
}

describe('StatusLamps colour discipline', () => {
  it('a healthy value is quiet ink; its shape stays green', () => {
    renderLamps();
    const link = screen.getByRole('link', { name: 'live feed: healthy, connected' });
    const value = screen.getByText('connected');
    expect(value.className).toContain('text-fg-muted');
    expect(value.className).not.toContain('text-ok');
    expect(link.querySelector('span[aria-hidden]')?.className).toContain('text-ok');
  });

  it('a warning value keeps its signal colour', () => {
    renderLamps();
    expect(screen.getByText('3 unread').className).toContain('text-warn');
  });
});
