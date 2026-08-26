import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BRAND_ASSETS, BrandLockup, BrandLogo, BrandMark } from './Brand.tsx';

/**
 * Huisstijltests (T17.1). Twee dingen die stilletjes kapot kunnen: een logobestand dat niet (meer)
 * bestaat — dan staat er een gebroken plaatje in de kopbalk zonder dat een test klaagt — en een
 * alt-tekst die verdwijnt of juist dubbel gaat.
 */

/**
 * De `web/`-map op schijf. Wordt vanaf de werkmap omhoog gezocht in plaats van uit
 * `import.meta.url` afgeleid: onder jsdom is dat een `http://`-URL, geen bestandspad.
 */
function webRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(join(dir, 'public', 'brand'))) return dir;
    if (existsSync(join(dir, 'web', 'public', 'brand'))) return join(dir, 'web');
    dir = dirname(dir);
  }
  throw new Error('De map web/ is niet gevonden vanaf de werkmap.');
}

/** Pad in `web/public/` waar de browser `/…` op uitkomt. */
function publicFile(path: string): string {
  return join(webRoot(), 'public', path.replace(/^\//, ''));
}

describe('huisstijl', () => {
  it('verwijst naar logobestanden die echt bestaan', () => {
    for (const path of Object.values(BRAND_ASSETS)) {
      expect(existsSync(publicFile(path)), `ontbreekt: web/public${path}`).toBe(true);
    }
  });

  it('heeft de favicons en het app-manifest waar index.html ze verwacht', () => {
    const html = readFileSync(join(webRoot(), 'index.html'), 'utf8');
    const referenced = [...html.matchAll(/(?:href|content)="(\/[^"]+\.(?:png|ico|webmanifest))"/g)]
      .map((match) => match[1])
      .filter((path): path is string => path !== undefined);
    expect(referenced.length).toBeGreaterThan(0);
    for (const path of referenced) {
      expect(existsSync(publicFile(path)), `ontbreekt: web/public${path}`).toBe(true);
    }
  });

  it('houdt het beeldmerk stil voor schermlezers waar de naam er als tekst naast staat', () => {
    const { container } = render(
      <>
        <BrandMark />
        <span>Intento</span>
      </>,
    );
    // Eén keer "Intento" in de toegankelijke inhoud: de tekst, niet ook nog het plaatje.
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(screen.queryAllByAltText('Intento')).toHaveLength(0);
  });

  it('noemt zichzelf wél waar het logo alleen staat', () => {
    render(<BrandLockup />);
    expect(screen.getByAltText('Intento')).toBeTruthy();
  });

  it('geeft het volledige logo een alt-tekst mét payoff en vaste afmetingen', () => {
    render(<BrandLogo width={200} />);
    const logo = screen.getByAltText('Intento — Jouw stem. Jouw verhaal.');
    // Vaste afmetingen voorkomen dat de pagina verspringt zodra het logo geladen is.
    expect(logo.getAttribute('width')).toBe('200');
    expect(Number(logo.getAttribute('height'))).toBeGreaterThan(0);
  });
});
