import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Manifest } from './global-symbols.js';
import { downloadSetImages, readImageIndex } from './images.js';

/**
 * Afbeeldingen van de startset downloaden (N2.6, INTENTO-NEW-DESIGN §15.1 stap 2, §53), tegen een
 * lokale nep-server.
 */

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>';
const EVIL =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe('downloadSetImages', () => {
  let server: Server;
  let base: string;
  let storageDir: string;
  let requests: string[];

  beforeEach(async () => {
    requests = [];
    storageDir = await mkdtemp(join(tmpdir(), 'intento-images-'));
    server = createServer((req, res) => {
      requests.push(req.url ?? '');
      if (req.url === '/1.svg') return res.end(SVG);
      if (req.url === '/2.png') return res.end(PNG);
      if (req.url === '/big.svg') return res.end(`${SVG}${' '.repeat(5000)}`);
      if (req.url === '/evil.svg') return res.end(EVIL);
      if (req.url === '/redirect.svg') {
        res.writeHead(302, { location: '/1.svg' });
        return res.end();
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(storageDir, { recursive: true, force: true });
  });

  function manifest(urls: Record<number, string>): Manifest {
    return {
      slug: 'testset',
      name: 'Testset',
      publisher: null,
      publisher_url: null,
      licence: { name: 'CC BY-SA 4.0', url: null, version: '4.0', properties: 'by-sa' },
      source: base,
      total: Object.keys(urls).length,
      items: Object.entries(urls).map(([id, url]) => ({
        id: Number(id),
        part_of_speech: 'noun',
        image_url: url,
        format: url.endsWith('.png') ? 'png' : 'svg',
        labels: { eng: `w${id}`, deu: null, fra: null },
      })),
    };
  }

  const options = () => ({
    storageDir,
    allowHttp: true,
    allowedHosts: ['127.0.0.1'],
    maxBytes: 2048,
  });

  it('slaat goede afbeeldingen op met sha256 en weigert de rest met een reden', async () => {
    const report = await downloadSetImages(
      manifest({
        1: `${base}/1.svg`,
        2: `${base}/2.png`,
        3: `${base}/big.svg`,
        4: `${base}/evil.svg`,
        5: `${base}/missing.svg`,
        6: `${base}/redirect.svg`,
      }),
      options(),
    );

    expect(report.downloaded).toBe(2);
    expect(report.rejected).toEqual([
      { id: 3, reason: expect.stringMatching(/te groot/) as unknown as string },
      { id: 4, reason: expect.stringMatching(/verboden element/) as unknown as string },
      { id: 5, reason: 'status 404' },
      { id: 6, reason: expect.stringMatching(/download mislukt/) as unknown as string },
    ]);
    const index = await readImageIndex(storageDir, 'testset');
    expect(Object.keys(index)).toEqual(['1', '2']);
    expect(index['1']).toMatchObject({
      assetPath: 'seed/testset/1.svg',
      mimeType: 'image/svg+xml',
    });
    expect(index['2']).toMatchObject({
      assetPath: 'seed/testset/2.png',
      mimeType: 'image/png',
      bytes: PNG.length,
    });
    expect(index['1']!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(join(storageDir, 'seed/testset/1.svg'), 'utf8')).toBe(SVG);
  });

  it('weigert een andere host en http zonder het te proberen', async () => {
    const report = await downloadSetImages(
      manifest({ 1: 'https://evil.example/1.svg', 2: `${base}/1.svg` }),
      { storageDir, allowedHosts: ['127.0.0.1'] },
    );
    expect(report.rejected).toEqual([
      { id: 1, reason: 'onbekende host evil.example' },
      { id: 2, reason: 'alleen https' },
    ]);
    expect(requests).toEqual([]);
  });

  it('downloadt bij een tweede run niets opnieuw', async () => {
    const set = manifest({ 1: `${base}/1.svg`, 2: `${base}/2.png` });
    await downloadSetImages(set, options());
    const before = requests.length;
    const second = await downloadSetImages(set, options());
    expect(second).toEqual({ downloaded: 0, skipped: 2, rejected: [] });
    expect(requests.length).toBe(before);
  });
});
