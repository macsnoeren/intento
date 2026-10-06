import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchManifest, GlobalSymbolsError } from './global-symbols.js';

/**
 * Manifest van een Global Symbols-set (N2.4, INTENTO-NEW-DESIGN §15.1 stap 1), tegen een nep-API.
 */

const SETS = [
  {
    id: 13,
    slug: 'mulberry',
    name: 'Mulberry Symbols',
    publisher: 'Steve Lee',
    publisher_url: 'https://mulberrysymbols.org/',
    status: 'published',
    licence: {
      name: 'Creative Commons BY SA 4.0',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      version: '4.0',
      properties: 'by-sa',
    },
    featured_level: 1,
  },
];

function picto(id: number) {
  return {
    id,
    part_of_speech: id % 2 ? 'noun' : 'verb',
    image_url: `https://globalsymbols.com/uploads/${id}.svg`,
    native_format: 'svg',
    labels: [
      { language: 'eng', text: `word ${id}`, text_diacritised: null },
      { language: 'deu', text: `Wort ${id}`, text_diacritised: null },
      { language: 'bul', text: 'дума', text_diacritised: null },
    ],
  };
}

describe('fetchManifest', () => {
  let server: Server | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  async function fakeApi(
    total: number,
    pageOverride?: (page: number) => unknown,
  ): Promise<{ url: string; pages: number[] }> {
    const pages: number[] = [];
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/symbolsets') return res.end(JSON.stringify(SETS));
      if (url.pathname === '/api/v1/pictos') {
        const page = Number(url.searchParams.get('page'));
        const perPage = Number(url.searchParams.get('per_page'));
        pages.push(page);
        const custom = pageOverride?.(page);
        if (custom !== undefined) return res.end(JSON.stringify(custom));
        const start = (page - 1) * perPage + 1;
        const items = [];
        for (let id = start; id < start + perPage && id <= total; id += 1) items.push(picto(id));
        return res.end(JSON.stringify({ items, total, deletions: null, last_updated: null }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/v1`, pages };
  }

  it('loopt alle pagina’s af en bewaart id, woordsoort, afbeelding, formaat en eng/deu/fra', async () => {
    const api = await fakeApi(7);
    const manifest = await fetchManifest('mulberry', { apiUrl: api.url, perPage: 3, delayMs: 0 });

    expect(api.pages).toEqual([1, 2, 3]);
    expect(manifest.total).toBe(7);
    expect(manifest.items.map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(manifest.items[0]).toEqual({
      id: 1,
      part_of_speech: 'noun',
      image_url: 'https://globalsymbols.com/uploads/1.svg',
      format: 'svg',
      labels: { eng: 'word 1', deu: 'Wort 1', fra: null },
    });
    expect(manifest).toMatchObject({
      slug: 'mulberry',
      name: 'Mulberry Symbols',
      publisher: 'Steve Lee',
      licence: { properties: 'by-sa', version: '4.0' },
    });
  });

  it('stopt na een volle laatste pagina als het totaal bereikt is', async () => {
    const api = await fakeApi(6);
    await fetchManifest('mulberry', { apiUrl: api.url, perPage: 3, delayMs: 0 });
    expect(api.pages).toEqual([1, 2]);
  });

  it('weigert een pagina met een onverwachte vorm', async () => {
    const api = await fakeApi(5, (page) =>
      page === 2 ? { items: [{ id: 'x' }], total: 5 } : undefined,
    );
    await expect(
      fetchManifest('mulberry', { apiUrl: api.url, perPage: 3, delayMs: 0 }),
    ).rejects.toThrow(/Pagina 2 heeft een onverwachte vorm/);
  });

  it('weigert een niet-https afbeeldings-URL', async () => {
    const api = await fakeApi(1, () => ({
      items: [{ ...picto(1), image_url: 'http://x/1.svg' }],
      total: 1,
    }));
    await expect(fetchManifest('mulberry', { apiUrl: api.url, delayMs: 0 })).rejects.toThrow(
      GlobalSymbolsError,
    );
  });

  it('weigert een onvolledige set', async () => {
    const api = await fakeApi(5, (page) => (page === 2 ? { items: [], total: 5 } : undefined));
    await expect(
      fetchManifest('mulberry', { apiUrl: api.url, perPage: 3, delayMs: 0 }),
    ).rejects.toThrow(/Onvolledig: 3 van 5/);
  });

  it('weigert een onbekende set', async () => {
    const api = await fakeApi(1);
    await expect(fetchManifest('bestaat-niet', { apiUrl: api.url, delayMs: 0 })).rejects.toThrow(
      /bestaat niet/,
    );
  });
});
