import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { StatusBadge } from './StatusBadge';
import { OwnerPlate } from './home/OwnerPlate';

// Final review Minors 7 and 8: one style per action, and no className
// override that only wins by Tailwind's emit order.

afterEach(() => cleanup());

describe('StatusBadge size', () => {
  it('md is a larger pill without a className override', () => {
    const { container } = render(<StatusBadge tone="ok" label="Supervisor healthy" size="md" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('text-body');
    expect(root.className).toContain('px-3');
    expect(root.className).not.toMatch(/\btext-label\b/);
    expect(root.className).not.toMatch(/\bpx-2\b/);
  });

  it('defaults to the label-size pill', () => {
    const { container } = render(<StatusBadge tone="ok" label="ok" />);
    expect((container.firstElementChild as HTMLElement).className).toContain('text-label');
  });
});

describe('one style per action', () => {
  // OWNER-HOME-PLAN Task 8: the Home board became the enamel plate, where the
  // one action style is the white outline button on the plate.
  it('Open on the plate is the on-plate outline button', () => {
    render(
      <MemoryRouter>
        <OwnerPlate
          items={[
            {
              id: 'a',
              domain: 'beads',
              severity: 'attention',
              audience: 'owner',
              title: 't',
              href: '/beads',
            },
          ]}
          readiness={{ state: 'ready' }}
        />
      </MemoryRouter>,
    );
    const open = screen.getByRole('link', { name: 'Open' });
    expect(open.className).toContain('text-on-plate');
    expect(open.className).toContain('border-on-plate');
    expect(open.className).not.toContain('text-primary');
  });

  it('Compose is the filled primary action, like New bead', () => {
    const mail = readFileSync(join(process.cwd(), 'src/routes/Mail.tsx'), 'utf8');
    expect(mail).toMatch(/<Button[^>]*tone="accent"[^]*?Compose\s*<\/Button>/);
  });

  // Minor 10: an 8 % amber wash reads khaki on the cool ground. The banner
  // keeps its amber border and amber lead word; the fill is the panel white.
  it('the config banner has no amber wash', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    const banner = app.slice(app.indexOf('function ConfigErrorBanner'));
    expect(banner.slice(0, 400)).not.toMatch(/bg-warn\//);
    expect(banner.slice(0, 400)).toContain('border-warn/');
  });

  it('Health overview pills use the size prop, not a className override', () => {
    const health = readFileSync(join(process.cwd(), 'src/routes/Health.tsx'), 'utf8');
    expect(health).not.toContain('className="px-3 py-1 text-body"');
  });
});
