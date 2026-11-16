import { useEffect, useRef, useState } from 'react';

/**
 * The value, changed at most once per `ms`: the first value shows at once,
 * a burst of changes inside a window lands as its latest value at the
 * window's end. (All-tickets graph, ALL-README rule 16: live data re-lays
 * the graph out at most every few seconds.) A new `flushKey` (another read
 * landed, say) shows the value at once.
 */
export function useThrottledValue<T>(value: T, ms: number, flushKey: string = ''): T {
  const [shown, setShown] = useState(value);
  const lastAt = useRef(Date.now());
  const keyRef = useRef(flushKey);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (Object.is(value, shown)) return undefined;
    const wait = lastAt.current + ms - Date.now();
    if (wait <= 0 || keyRef.current !== flushKey) {
      keyRef.current = flushKey;
      lastAt.current = Date.now();
      setShown(value);
      return undefined;
    }
    const timer = setTimeout(() => {
      lastAt.current = Date.now();
      setShown(latest.current);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, shown, ms, flushKey]);
  return shown;
}
