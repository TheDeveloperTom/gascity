import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ActivityTrace } from './Instruments';

// Final review Minor 2: with no samples the trace drew an empty 64 px band.
// Hide the band until there is a line to draw; the figure and its accessible
// name stay, and "collecting samples" still says why.

afterEach(() => cleanup());

describe('ActivityTrace band', () => {
  it('draws no band before there are samples', () => {
    render(<ActivityTrace samples={[]} available />);
    const figure = screen.getByRole('figure', { name: /recent model activity/ });
    expect(figure.querySelector('svg')).toBeNull();
    expect(figure.textContent).toContain('collecting samples');
  });

  it('draws the band once samples exist', () => {
    render(<ActivityTrace samples={[1, 3, 2]} available />);
    const figure = screen.getByRole('figure', { name: /recent model activity: 2 invocations/ });
    expect(figure.querySelector('svg polyline')).not.toBeNull();
  });
});
