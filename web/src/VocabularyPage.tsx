import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AccountPublic, VocabularyItemPublic, VocabularyListResponse } from '@intento/shared';
import { ApiRequestError, apiUrl, type Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';

/**
 * Beheeromgeving — Vocabulary (INTENTO-NEW-DESIGN §15, §49).
 *
 * De symbolen die deze organisatie kan gebruiken: de startset van het platform plus de eigen items.
 * Een tegel toont het pictogram, het label, de licentie en de bron — een pictogram is nooit de enige
 * aanduiding. Met ruim 3.400 symbolen in de bron is zoeken en bladeren nodig; de backend pagineert.
 */

const PAGE_SIZE = 24;

/** Leesbare licentienaam bij een licentiesleutel ("CC-BY-SA-4.0" → "CC BY-SA 4.0"). */
export function licenseLabel(key: string): string {
  if (key === 'own') return 'Eigen afbeelding';
  const match = /^CC-(.+?)-(\d+(?:\.\d+)?)$/.exec(key);
  if (match) return `CC ${match[1]} ${match[2]}`;
  return key === 'CC0' ? 'CC0' : key;
}

function sourceLabel(item: VocabularyItemPublic): string {
  if (item.source === 'own') return 'Eigen afbeelding';
  return item.license.sourceName ?? 'Onbekende bron';
}

function VocabularyTile({ item }: { item: VocabularyItemPublic }): React.JSX.Element {
  const label = item.labels[0] ?? '';
  return (
    <div className="symbol-card" aria-label={label}>
      {item.imageUrl ? (
        <img className="symbol-card__image" src={apiUrl(item.imageUrl)} alt="" loading="lazy" />
      ) : (
        <span className="symbol-card__image" aria-hidden="true" />
      )}
      <span className="symbol-card__label">{label}</span>
      <span className="badge">{licenseLabel(item.license.key)}</span>
      <span className="symbol-card__meta">{sourceLabel(item)}</span>
      {item.labelStatus === 'machine' ? (
        <span className="badge badge--warn">Machinevertaling</span>
      ) : null}
    </div>
  );
}

export function VocabularyPage({
  api,
  account,
  onLogout,
  onNavigate,
}: {
  api: Api;
  account: AccountPublic;
  onLogout: () => void;
  onNavigate: (view: AdminView) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<VocabularyListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.listVocabulary({ q: query || undefined, page, pageSize: PAGE_SIZE }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
    } finally {
      setLoading(false);
    }
  }, [api, query, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <AppShell
      account={account}
      title="Vocabulary"
      subtitle="De symbolen die tijdens een gesprek gebruikt kunnen worden, met licentie en bron."
      active="vocabulary"
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      <div className="toolbar">
        <form className="form toolbar__search" role="search" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Zoeken</span>
            <input
              className="field__input"
              type="search"
              name="q"
              value={search}
              placeholder="Woord, synoniem of concept"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button className="button" type="submit">
            Zoeken
          </button>
        </form>
      </div>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !data ? (
        <p className="muted">Laden…</p>
      ) : data && data.items.length === 0 ? (
        <p className="muted">
          {query ? `Geen symbolen gevonden voor "${query}".` : 'De Vocabulary is nog leeg.'}
        </p>
      ) : data ? (
        <section className="panel" aria-label="Symbolen">
          <p className="muted" role="status">
            {data.total} {data.total === 1 ? 'symbool' : 'symbolen'}
            {query ? ` voor "${query}"` : ''}
          </p>
          <ul className="symbol-grid">
            {data.items.map((item) => (
              <li key={item.id}>
                <VocabularyTile item={item} />
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav className="pager" aria-label="Pagina's">
              <button
                className="button"
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                Vorige
              </button>
              <span className="muted">
                Pagina {data.page} van {pages}
              </span>
              <button
                className="button"
                type="button"
                disabled={page >= pages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Volgende
              </button>
            </nav>
          ) : null}
        </section>
      ) : null}
    </AppShell>
  );
}
