import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveChart, linePath, type ChartSeries } from './LiveChart';

afterEach(cleanup);

const NOW = 1_000_000;
const pts = (pairs: Array<[number, number | null]>) =>
  pairs.map(([sec, v]) => ({ at: NOW - sec * 1000, v }));

function series(values: ChartSeries['points'], over: Partial<ChartSeries> = {}): ChartSeries {
  return {
    id: 'busy',
    label: 'Busy',
    color: 'var(--viz-1)',
    kind: 'area',
    points: values,
    ...over,
  };
}

describe('linePath', () => {
  const x = (at: number) => (at - (NOW - 60_000)) / 1000;
  const y = (v: number) => 100 - v;

  it('draws one move-to per run, breaking at a polling gap and at missing values', () => {
    const d = linePath(
      pts([
        [60, 10],
        [57, 20],
        [20, 30],
        [17, null],
        [14, 40],
        [11, 50],
      ]),
      x,
      y,
      15_000,
    );
    expect(d.match(/M/g)).toHaveLength(3);
  });
});

describe('LiveChart', () => {
  it('says it is still collecting before two samples exist', () => {
    render(
      <LiveChart
        label="CPU"
        series={[series(pts([[0, 30]]))]}
        now={NOW}
        windowMs={900_000}
        formatValue={(v) => `${v}%`}
      />,
    );
    expect(screen.getByText('Collecting data…')).toBeTruthy();
  });

  it('names its latest values for screen readers', () => {
    render(
      <LiveChart
        label="CPU"
        series={[
          series(
            pts([
              [6, 20],
              [3, 25],
              [0, 30],
            ]),
          ),
        ]}
        now={NOW}
        windowMs={900_000}
        formatValue={(v) => `${v}%`}
      />,
    );
    expect(screen.getByRole('img', { name: /CPU.*Busy 30%/ })).toBeTruthy();
  });

  it('reads every series at the hovered moment', () => {
    render(
      <LiveChart
        label="CPU"
        series={[
          series(
            pts([
              [6, 20],
              [3, 25],
              [0, 30],
            ]),
          ),
          series(
            pts([
              [6, 40],
              [3, 41],
              [0, 42],
            ]),
            { id: 'load', label: 'Load', kind: 'line' },
          ),
        ]}
        now={NOW}
        windowMs={900_000}
        formatValue={(v) => `${v}%`}
      />,
    );
    const chart = screen.getByRole('img', { name: /CPU/ });
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    const tip = screen.getByRole('status');
    expect(tip.textContent).toContain('25%');
    expect(tip.textContent).toContain('41%');
  });

  it('caps the axis so a runaway load does not flatten the other series', () => {
    render(
      <LiveChart
        label="CPU"
        series={[
          series(
            pts([
              [6, 2000],
              [3, 2200],
              [0, 2300],
            ]),
          ),
        ]}
        now={NOW}
        windowMs={900_000}
        formatValue={(v) => `${v}%`}
        yCap={200}
      />,
    );
    expect(screen.getByText('200%')).toBeTruthy();
    expect(screen.queryByText('2300%')).toBeNull();
    expect(screen.getByRole('img', { name: /Busy 2300%/ })).toBeTruthy();
  });
});
