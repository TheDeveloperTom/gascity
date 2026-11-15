import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AttentionProvider } from '../../attention/context';
import { NowProvider } from '../../contexts/NowContext';
import { AgentPanel } from '../AgentPanel';
import { ThreadMessage } from './ThreadMessage';
import type { SupervisorMailItem } from '../../supervisor/mailReads';

// Signal & Pavement, Mail (DESIGN-PLAN §6.8, R16, C15). New presentation
// behaviour only; Mail.test.tsx and Mail.render.test.tsx keep the old contract.

afterEach(cleanup);

function withProviders(node: React.ReactNode) {
  return render(
    <MemoryRouter>
      <NowProvider intervalMs={1_000_000}>
        <AttentionProvider contributors={[]}>{node}</AttentionProvider>
      </NowProvider>
    </MemoryRouter>,
  );
}

describe('inbox rail', () => {
  it('names the toggle by what it does and keeps aria-expanded', () => {
    withProviders(
      <AgentPanel
        buckets={[
          { tier: 'you', aliases: ['stephanie'] },
          { tier: 'active', aliases: ['mechanic'] },
        ]}
        loading={false}
        sessionsUnavailable={false}
        value="stephanie"
        onChange={() => {}}
        onReset={() => {}}
        isOperator
      />,
    );

    const open = screen.getByRole('button', { name: /^Choose inbox/ });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(open.textContent).not.toMatch(/[▸▾]/);
    expect(screen.queryByRole('searchbox', { name: 'Find an agent' })).toBeNull();

    fireEvent.click(open);

    const hide = screen.getByRole('button', { name: /^Hide inbox list/ });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    expect(hide.textContent).not.toMatch(/[▸▾]/);
    expect(screen.getByRole('searchbox', { name: 'Find an agent' })).toBeTruthy();
  });
});

describe('thread body is prose', () => {
  const message: SupervisorMailItem = {
    id: 'm-1',
    from: 'mayor',
    to: 'human',
    subject: 'drill27: ещё 2 копии от main',
    body: 'Исполнитель (gcg-246785): dw-nqma\nsecond line',
    created_at: '2026-06-01T10:00:00Z',
    read: false,
  } as SupervisorMailItem;

  it('sets the body in the sans at reading size, wrapping', () => {
    const { container } = withProviders(<ThreadMessage message={message} />);
    const pre = container.querySelector('pre') as HTMLElement;
    expect(pre.className).toContain('font-sans');
    expect(pre.className).toContain('text-reading');
    expect(pre.className).toContain('whitespace-pre-wrap');
  });

  it('shows the agent-content notice inline, not as a pill', () => {
    withProviders(<ThreadMessage message={message} />);
    const notice = screen.getByText(/agent-generated/).closest('span[class*="inline-flex"]');
    expect(notice).not.toBeNull();
    expect((notice as HTMLElement).className).not.toContain('rounded-full');
  });

  it('drops caps from the message header', () => {
    const { container } = withProviders(<ThreadMessage message={message} />);
    const header = container.querySelector('article header') as HTMLElement;
    expect(header.innerHTML).not.toMatch(/\buppercase\b|\btracking-wid/);
  });
});
