import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Icon } from './icons';
import { Modal } from './Modal';
import { PageAlerts } from './PageAlerts';
import { PageHeader } from './PageHeader';
import { StatusBadge, type StatusTone } from './StatusBadge';
import { TranscriptBox } from './TranscriptBox';

// Signal & Pavement shared primitives (DESIGN-PLAN §7). New presentation
// behaviour only; the existing component tests keep pinning the old contract.

beforeEach(() => {
  // TranscriptBox reads prefers-reduced-motion; jsdom has no matchMedia.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});
afterEach(cleanup);

const TONES: StatusTone[] = ['ok', 'warn', 'stuck', 'neutral'];

describe('StatusBadge pill', () => {
  it.each(TONES)('%s renders a truncating pill with one status shape', (tone) => {
    const { container } = render(<StatusBadge tone={tone} label="running" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('rounded-full');
    expect(root.className).toContain('max-w-full');
    expect(root.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
    expect(within(root).getByText('running').className).toContain('truncate');
  });

  it('renders a text glyph instead of the shape when one is given', () => {
    const { container } = render(<StatusBadge tone="warn" label="partial" glyph="◐" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.textContent).toContain('◐');
    expect(root.querySelectorAll('svg')).toHaveLength(0);
  });

  it('inline variant has no pill', () => {
    const { container } = render(<StatusBadge tone="ok" label="live" variant="inline" />);
    expect((container.firstElementChild as HTMLElement).className).not.toContain('rounded-full');
  });

  it('passes className through', () => {
    const { container } = render(<StatusBadge tone="ok" label="live" className="w-28" />);
    expect((container.firstElementChild as HTMLElement).className).toContain('w-28');
  });
});

describe('Modal', () => {
  it('sits on a scrim overlay, puts the close button first and closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="review">
        body
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    const overlay = dialog.parentElement as HTMLElement;
    expect(overlay.className).toContain('bg-scrim/50');
    expect(overlay.className).not.toContain('bg-fg/30');
    expect(within(dialog).getAllByRole('button')[0]?.getAttribute('aria-label')).toBe('Close');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Escape layering', () => {
  it('collapses an expanded transcript first and keeps the modal open', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="peek">
        <TranscriptBox>text</TranscriptBox>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expand transcript' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('PageHeader', () => {
  it('renders a back link above the h1 and never a nav', () => {
    const { container } = render(
      <MemoryRouter>
        <PageHeader
          title="mol-adopt-pr-v2"
          back={
            <Link to="/runs">
              <span aria-hidden="true">← </span>Runs
            </Link>
          }
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Runs' })).toBeTruthy();
    expect(container.querySelector('nav')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('text-headline');
  });
});

describe('PageAlerts', () => {
  it('renders nothing without messages', () => {
    expect(render(<PageAlerts messages={[]} />).container.firstChild).toBeNull();
    cleanup();
    expect(render(<PageAlerts messages={[null, '']} />).container.firstChild).toBeNull();
  });

  it('renders one alert line per message', () => {
    render(<PageAlerts messages={['a', 'b']} />);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });
});

describe('Button', () => {
  it('keeps disabled and title', () => {
    render(
      <Button disabled title="t">
        x
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'x' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('title')).toBe('t');
  });

  it('accent tone is the blue primary action', () => {
    render(<Button tone="accent">Send</Button>);
    expect(screen.getByRole('button', { name: 'Send' }).className).toContain('bg-primary');
  });
});

describe('Icon', () => {
  it('renders a decorative svg', () => {
    const { container } = render(<Icon name="home" />);
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});
