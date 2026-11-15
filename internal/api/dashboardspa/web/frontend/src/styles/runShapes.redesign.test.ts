import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Redesign (Signal & Pavement, Task 8, ruling R17): run steps are one calm
// card shape. Every construct keeps its class name, but all share an 8px
// radius; solid for steps, dashed for containers, dotted for control. No
// double borders, outlines, pill radii or background stripes.
//
// Paths resolve through fileURLToPath because Vite rewrites
// `new URL(rel, import.meta.url)` into an asset URL under Vitest.

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'index.css'), 'utf8');

function shapeBlocks(): Map<string, string> {
  const blocks = new Map<string, string>();
  const re = /\.formula-run-node-shape-([a-z-]+)\s*\{([^}]*)\}/g;
  for (const match of css.matchAll(re)) {
    blocks.set(match[1] as string, match[2] as string);
  }
  return blocks;
}

const EXPECTED_BORDER: Record<string, string> = {
  root: '2px solid',
  step: '1px solid',
  retry: '1px solid',
  'check-loop': '1px solid',
  scope: '1px dashed',
  condition: '1px dashed',
  fanout: '1px dashed',
  expansion: '1px dashed',
  control: '1px dotted',
};

describe('run node shapes', () => {
  it('defines every construct shape', () => {
    expect([...shapeBlocks().keys()].sort()).toEqual(Object.keys(EXPECTED_BORDER).sort());
  });

  it('every shape is an 8px card with no double border or outline', () => {
    for (const [name, body] of shapeBlocks()) {
      expect(body, name).toMatch(/border-radius:\s*8px\s*;/);
      expect(body, name).not.toMatch(/double/);
      expect(body, name).not.toMatch(/outline:/);
      expect(body, name).not.toMatch(/9999px/);
      expect(body, name).not.toMatch(/background-image/);
    }
  });

  it('solid for steps, dashed for containers, dotted for control', () => {
    const blocks = shapeBlocks();
    for (const [name, border] of Object.entries(EXPECTED_BORDER)) {
      const [width, style] = border.split(' ');
      const body = blocks.get(name) ?? '';
      expect(body, name).toMatch(new RegExp(`border-width:\\s*${width}\\s*;`));
      expect(body, name).toMatch(new RegExp(`border-style:\\s*${style}\\s*;`));
    }
  });
});
