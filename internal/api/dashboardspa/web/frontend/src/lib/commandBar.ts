// ⌘K open state (vk lane 4, owner): a tiny module store, so the top nav
// (lane 5) and the phone «Поиск» tab can open the palette without a context.
import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

function setOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => open;
const serverSnapshot = () => false;

export function openCommandBar(): void {
  setOpen(true);
}

export function closeCommandBar(): void {
  setOpen(false);
}

export function toggleCommandBar(): void {
  setOpen(!open);
}

export function useCommandBarOpen(): [boolean, (open: boolean) => void] {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return [value, setOpen];
}
