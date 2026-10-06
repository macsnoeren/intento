import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Geen dode CSS (N4.14): elke klasse in `styles.css` staat ergens als klassenaam in een component.
 * Na de herbouw bleef er een flinke laag stijl van de oude gespreksflow achter; deze test voorkomt dat
 * dat opnieuw gebeurt. Een klassenaam telt als gebruikt als hij als los woord in een string voorkomt
 * (`className="a b"`, `` `a ${…}` ``, `'a'`).
 */

const SRC = dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('styles.css', () => {
  it('bevat geen klassen die geen component gebruikt', () => {
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/url\([^)]*\)/g, '');
    const classes = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]));

    const used = new Set<string>();
    for (const file of [...sources(SRC), join(SRC, '..', 'index.html')]) {
      const text = readFileSync(file, 'utf8');
      for (const literal of text.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)) {
        const value = literal[1] ?? literal[2] ?? literal[3] ?? '';
        for (const word of value.split(/[\s${}?:()'"]+/)) if (word) used.add(word);
      }
    }

    expect([...classes].filter((name) => name && !used.has(name)).sort()).toEqual([]);
  });
});
