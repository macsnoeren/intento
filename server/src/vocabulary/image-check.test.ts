import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkImage, type ImageCheckResult } from './image-check.js';

/**
 * Afbeeldingscontrole (N2.3, INTENTO-NEW-DESIGN §20). Per regel een goed en een kwaad voorbeeld, plus
 * een echte Mulberry-SVG (Mulberry Symbols © Steve Lee, CC BY-SA) die geaccepteerd moet worden.
 */

const OPTS = { maxBytes: 64 * 1024, allowSvg: true };
const svg = (body: string, rootAttrs = 'viewBox="0 0 10 10"'): Uint8Array =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${rootAttrs}>${body}</svg>`);
const GOOD = svg('<g><path d="M0 0h10v10H0z" fill="#50264c"/></g>');

function reason(result: ImageCheckResult): string {
  return result.ok ? 'ok' : result.reason;
}

describe('afbeeldingscontrole — SVG', () => {
  it('accepteert een echte Mulberry-SVG', () => {
    const mulberry = readFileSync(new URL('./fixtures/mulberry-vomit.svg', import.meta.url));
    expect(checkImage(mulberry, OPTS)).toEqual({
      ok: true,
      mimeType: 'image/svg+xml',
      extension: 'svg',
    });
  });

  it('accepteert een eenvoudige SVG, ook met XML-declaratie en commentaar', () => {
    expect(checkImage(GOOD, OPTS).ok).toBe(true);
    const withDecl = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- pictogram -->\n${Buffer.from(GOOD).toString()}`,
    );
    expect(reason(checkImage(withDecl, OPTS))).toBe('ok');
  });

  it('eist geldige XML', () => {
    expect(reason(checkImage(svg('<g><path d="M0 0"></g>'), OPTS))).toBe('geen geldige XML');
  });

  it('eist een <svg>-root', () => {
    expect(reason(checkImage(Buffer.from('<html><svg viewBox="0 0 1 1"/></html>'), OPTS))).toBe(
      'onbekend afbeeldingsformaat',
    );
  });

  it('eist een geldige viewBox', () => {
    expect(reason(checkImage(svg('<path d="M0 0"/>', 'width="10"'), OPTS))).toBe(
      'geen geldige viewBox',
    );
    expect(reason(checkImage(svg('<path d="M0 0"/>', 'viewBox="0 0 tien 10"'), OPTS))).toBe(
      'geen geldige viewBox',
    );
  });

  it('weigert <script>, ook genest en met een prefix', () => {
    expect(reason(checkImage(svg('<g><script>alert(1)</script></g>'), OPTS))).toMatch(
      /verboden element/,
    );
    expect(
      reason(
        checkImage(
          svg(
            '<svg:script>alert(1)</svg:script>',
            'viewBox="0 0 1 1" xmlns:svg="http://www.w3.org/2000/svg"',
          ),
          OPTS,
        ),
      ),
    ).toMatch(/verboden element/);
  });

  it('weigert <foreignObject> en animaties die attributen kunnen zetten', () => {
    expect(reason(checkImage(svg('<foreignObject><div/></foreignObject>'), OPTS))).toMatch(
      /verboden element/,
    );
    expect(
      reason(checkImage(svg('<a><set attributeName="href" to="javascript:alert(1)"/></a>'), OPTS)),
    ).toMatch(/verboden element|javascript/);
  });

  it('weigert on…-attributen', () => {
    expect(reason(checkImage(svg('<path d="M0 0" onclick="alert(1)"/>'), OPTS))).toMatch(
      /event-handler/,
    );
    expect(
      reason(checkImage(svg('<path d="M0 0"/>', 'viewBox="0 0 1 1" onload="x()"'), OPTS)),
    ).toMatch(/event-handler/);
  });

  it('weigert externe href/src, maar staat een fragment toe', () => {
    expect(reason(checkImage(svg('<use href="https://evil.example/x.svg#a"/>'), OPTS))).toMatch(
      /externe verwijzing/,
    );
    expect(
      reason(
        checkImage(
          svg(
            '<use xlink:href="//evil.example/x#a"/>',
            'viewBox="0 0 1 1" xmlns:xlink="http://www.w3.org/1999/xlink"',
          ),
          OPTS,
        ),
      ),
    ).toMatch(/externe verwijzing/);
    expect(
      reason(checkImage(svg('<defs><path id="p" d="M0 0"/></defs><use href="#p"/>'), OPTS)),
    ).toBe('ok');
  });

  it('weigert externe resources in stijlen', () => {
    expect(
      reason(checkImage(svg('<path d="M0 0" style="fill:url(https://evil.example/a)"/>'), OPTS)),
    ).toMatch(/externe resource/);
    expect(
      reason(checkImage(svg('<style>@import url(https://evil.example/a.css);</style>'), OPTS)),
    ).toMatch(/externe resource/);
    expect(reason(checkImage(svg('<path d="M0 0" fill="url(#gradient)"/>'), OPTS))).toBe('ok');
  });

  it('weigert javascript: in een willekeurig attribuut', () => {
    expect(
      reason(
        checkImage(
          svg('<a xlink:title="java script:x"><path d="M0 0" filter="javascript:alert(1)"/></a>'),
          OPTS,
        ),
      ),
    ).toMatch(/javascript/);
  });

  it('weigert entiteiten en een DOCTYPE met interne subset (XXE, "billion laughs")', () => {
    const xxe = Buffer.from(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1">&x;</svg>',
    );
    expect(reason(checkImage(xxe, OPTS))).not.toBe('ok');
    const entityOnly = Buffer.from('<svg viewBox="0 0 1 1"><!ENTITY x "y"></svg>');
    expect(reason(checkImage(entityOnly, OPTS))).not.toBe('ok');
  });

  it('accepteert een kale DOCTYPE zonder interne subset (zoals Fabric.js en Illustrator die schrijven)', () => {
    const fabric = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><path d="M0 0"/></svg>',
    );
    expect(reason(checkImage(fabric, OPTS))).toBe('ok');
  });

  it('accepteert een ingebedde rasterafbeelding, maar geen ingebedde SVG of externe bron', () => {
    const xlink = 'viewBox="0 0 1 1" xmlns:xlink="http://www.w3.org/1999/xlink"';
    expect(
      reason(
        checkImage(svg('<image xlink:href="data:image/png;base64,iVBORw0KGgo="/>', xlink), OPTS),
      ),
    ).toBe('ok');
    expect(
      reason(
        checkImage(svg('<image xlink:href="data:image/svg+xml;base64,PHN2Zz4="/>', xlink), OPTS),
      ),
    ).toMatch(/externe verwijzing/);
    expect(
      reason(checkImage(svg('<image xlink:href="https://evil.example/a.png"/>', xlink), OPTS)),
    ).toMatch(/externe verwijzing/);
  });

  it('accepteert een ingebed lettertype via url(data:…) in <style>', () => {
    const font = svg(
      "<style>@font-face{font-family:'X';src:url(data:;base64,T1RUTwAC)}</style><text>A</text>",
    );
    expect(reason(checkImage(font, OPTS))).toBe('ok');
  });

  it('weigert te groot', () => {
    expect(reason(checkImage(GOOD, { ...OPTS, maxBytes: 10 }))).toMatch(/te groot/);
  });

  it('weigert SVG als die niet is toegestaan (eigen uploads, V8)', () => {
    expect(reason(checkImage(GOOD, { ...OPTS, allowSvg: false }))).toBe(
      'alleen PNG, JPEG of WebP toegestaan',
    );
  });
});

describe('afbeeldingscontrole — PNG, JPEG, WebP', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const webp = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([20, 0, 0, 0]),
    Buffer.from('WEBPVP8 '),
  ]);

  it('herkent de magic bytes', () => {
    expect(checkImage(png, OPTS)).toMatchObject({ ok: true, mimeType: 'image/png' });
    expect(checkImage(jpeg, OPTS)).toMatchObject({ ok: true, mimeType: 'image/jpeg' });
    expect(checkImage(webp, OPTS)).toMatchObject({ ok: true, mimeType: 'image/webp' });
  });

  it('kijkt naar de inhoud, niet naar een naam of extensie', () => {
    expect(reason(checkImage(Buffer.from('GIF89a....'), OPTS))).toBe('onbekend afbeeldingsformaat');
    expect(reason(checkImage(Buffer.from('%PDF-1.7'), { ...OPTS, allowSvg: false }))).toBe(
      'alleen PNG, JPEG of WebP toegestaan',
    );
    // Een RIFF-container die geen WebP is (bv. WAV).
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([20, 0, 0, 0]),
      Buffer.from('WAVEfmt '),
    ]);
    expect(reason(checkImage(wav, { ...OPTS, allowSvg: false }))).not.toBe('ok');
  });

  it('weigert leeg en te groot', () => {
    expect(reason(checkImage(new Uint8Array(), OPTS))).toBe('leeg bestand');
    expect(reason(checkImage(png, { ...OPTS, maxBytes: 4 }))).toMatch(/te groot/);
  });
});
