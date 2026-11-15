// Seam (vk lane 0b). Owner: lane 3. Other lanes import, never edit.

/** Every task that waits on taskId, directly or through others (BFS over waitersOf). */
export function transitiveWaiters(
  taskId: string,
  waitersOf: ReadonlyMap<string, readonly string[]>,
): string[] {
  const seen = new Set<string>([taskId]);
  const out: string[] = [];
  const queue: string[] = [taskId];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    if (id === undefined) continue;
    for (const waiter of waitersOf.get(id) ?? []) {
      if (seen.has(waiter)) continue;
      seen.add(waiter);
      out.push(waiter);
      queue.push(waiter);
    }
  }
  return out;
}
