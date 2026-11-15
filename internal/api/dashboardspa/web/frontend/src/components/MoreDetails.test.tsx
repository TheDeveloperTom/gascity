import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { MoreDetails } from './MoreDetails';

afterEach(() => {
  cleanup();
  setLocale('en');
});

describe('MoreDetails', () => {
  it('keeps the raw engine text behind «подробнее»', () => {
    setLocale('ru');
    const { container } = render(<MoreDetails raw="timed out after 2500ms" />);
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(screen.getByText('подробнее').tagName).toBe('SUMMARY');
    expect(details?.textContent).toContain('timed out after 2500ms');
  });

  it('renders nothing without raw text or children', () => {
    const { container } = render(<MoreDetails raw={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('takes a label', () => {
    render(<MoreDetails raw="x" label="команда" />);
    expect(screen.getByText('команда').tagName).toBe('SUMMARY');
  });
});
