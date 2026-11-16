import { useEffect, useState } from 'react';

/**
 * Review I-1 (H1 16.11): a hold that keeps content back to avoid layout shift
 * (`holding`), released after `capMs` from mount even if what it waits for
 * never answers. A slow supervisor must not hide the diagnostics.
 */
export function useCappedHold(holding: boolean, capMs: number): boolean {
  const [capped, setCapped] = useState(false);
  useEffect(() => {
    if (!holding || capped) return;
    const timer = setTimeout(() => setCapped(true), capMs);
    return () => clearTimeout(timer);
  }, [holding, capped, capMs]);
  return holding && !capped;
}
