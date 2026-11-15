/** Joins class names, dropping falsy parts: `cn('a', on && 'b', undefined)`. */
export function cn(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
}
