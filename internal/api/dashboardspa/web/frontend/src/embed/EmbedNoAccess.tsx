import { useSyncExternalStore, type ReactNode } from 'react';
import { isDenied, subscribeDenied } from './session';

// Discord mode: once the gateway refuses this Discord user (403 at a
// re-sign-in; review M1) the board is replaced by «Нет доступа», the same
// words the boot shows for a 403 at first sign-in. The request seam already
// sends nothing more.

export function EmbedNoAccess({ children }: { children: ReactNode }) {
  const denied = useSyncExternalStore(subscribeDenied, isDenied, () => false);
  if (!denied) return <>{children}</>;
  return <p className="p-6 text-body">Нет доступа</p>;
}
