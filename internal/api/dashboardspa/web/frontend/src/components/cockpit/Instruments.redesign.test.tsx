import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Gauge, Odometer, PipelineBar } from './Instruments';

const SEGMENTS = [
  { key: 'pending', label: 'queued', count: 3, href: '/runs' },
  { key: 'active', label: 'running', count: 2, href: '/runs' },
  { key: 'waiting', label: 'waiting', count: 1, href: '/runs' },
  { key: 'canceling', label: 'stopping', count: 1, href: '/runs' },
] as const;

describe('cockpit instruments (redesign)', () => {
  afterEach(() => cleanup());

  it('gauge without a reading draws only the track', () => {
    const { container } = render(
      <MemoryRouter>
        <Gauge label="tokens / min" value={null} max={10} formatted="—" href="/activity" />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('svg line')).toHaveLength(1);
    expect(container.textContent).toContain('—');
  });

  it('gauge with a reading draws track and fill', () => {
    const { container } = render(
      <MemoryRouter>
        <Gauge label="active sessions" value={5} max={10} formatted="5" href="/agents" />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('svg line')).toHaveLength(2);
  });

  it('odometer is not zero-padded', () => {
    const { container } = render(<Odometer label="model calls today" value={107} />);
    expect(container.textContent).toContain('107');
    expect(container.textContent).not.toContain('0107');
  });

  it('pipeline signal tones', () => {
    render(
      <MemoryRouter>
        <PipelineBar segments={SEGMENTS} available />
      </MemoryRouter>,
    );
    const segments = screen.getAllByTestId('pipeline-track-segment');
    expect(segments).toHaveLength(4);
    expect(segments[1]?.className).toContain('bg-ok');
    expect(segments[2]?.className).toContain('bg-warn');
  });

  it('a zero-count segment is an empty slot, not a signal', () => {
    render(
      <MemoryRouter>
        <PipelineBar
          segments={[
            { key: 'active', label: 'running', count: 4, href: '/runs' },
            { key: 'waiting', label: 'waiting', count: 0, href: '/runs' },
          ]}
          available
        />
      </MemoryRouter>,
    );
    const [running, waiting] = screen.getAllByTestId('pipeline-track-segment');
    expect(running?.className).toContain('bg-ok');
    expect(waiting?.className).toContain('bg-rule');
    expect(waiting?.className).not.toContain('bg-warn');
  });

  it('unavailable pipeline draws an empty track', () => {
    render(
      <MemoryRouter>
        <PipelineBar segments={SEGMENTS} available={false} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('pipeline-empty-track')).toBeTruthy();
    expect(screen.queryAllByTestId('pipeline-track-segment')).toHaveLength(0);
  });
});
