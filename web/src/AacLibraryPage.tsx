import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  aacCategorySchema,
  type AacCategory,
  type AacSymbolAdmin,
  type AacSymbolInput,
  type AccountPublic,
  type OpenSymbolsResult,
} from '@intento/shared';
import { ApiRequestError, apiUrl, type Api } from './api.ts';
import { AdminNav, type AdminView } from './AdminNav.tsx';

/**
 * Beheeromgeving — AAC-bibliotheek (T3.2, DESIGN §5.2, FR-015). Een beheerder kan hier de
 * gedeelde pictogrambibliotheek onderhouden: symbolen bekijken/zoeken en filteren op categorie,
 * symbolen toevoegen/bewerken/verwijderen (incl. afbeelding-upload) en begripsrelaties leggen.
 * Alle data loopt via de backend (`Api`); de bibliotheek is platformbreed gedeeld (niet
 * tenant-gebonden), dus beheer is voorbehouden aan ADMIN.
 */

/** Nederlandse labels bij de (vaste) categorie-taxonomie uit DESIGN §3. */
const CATEGORY_LABELS: Record<AacCategory, string> = {
  intent: 'Intentie',
  activity: 'Activiteit',
  feeling: 'Gevoel',
  body: 'Lichaamsdeel',
  food: 'Eten',
  drink: 'Drinken',
  person: 'Persoon',
  place: 'Plek',
  animal: 'Dier',
  object: 'Voorwerp',
  question: 'Vraagwoord',
  expression: 'Uiting',
  time: 'Tijdsbepaling',
};

const CATEGORY_OPTIONS = aacCategorySchema.options;

/** Splitst een komma-/regelgescheiden invoer in losse synoniemen (lege waarden vallen weg). */
function parseSynonyms(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function AacLibraryPage({
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
  const [symbols, setSymbols] = useState<AacSymbolAdmin[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { symbols: list } = await api.listAacSymbols({
        q: q.trim() || undefined,
        category: category || undefined,
      });
      setSymbols(list);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
    } finally {
      setLoading(false);
    }
  }, [api, q, category]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate(input: AacSymbolInput): Promise<void> {
    const created = await api.createAacSymbol(input);
    await refresh();
    setSelectedId(created.id);
  }

  async function handleDelete(id: string): Promise<void> {
    setError(null);
    try {
      await api.deleteAacSymbol(id);
      if (selectedId === id) setSelectedId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Verwijderen mislukt.');
    }
  }

  // Na een wijziging in het detail (bewerken, upload, relatie) herladen we en houden de selectie.
  async function handleChanged(updated: AacSymbolAdmin): Promise<void> {
    await refresh();
    setSelectedId(updated.id);
  }

  const selected = symbols.find((s) => s.id === selectedId) ?? null;

  return (
    <main className="admin">
      <header className="admin__header">
        <div>
          <h1 className="panel__title">AAC-bibliotheek</h1>
          <AdminNav active="aac" onNavigate={onNavigate} />
        </div>
        <div className="admin__account">
          <span>{account.email}</span>
          <button className="button" type="button" onClick={onLogout}>
            Uitloggen
          </button>
        </div>
      </header>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="admin__grid">
        <section className="panel" aria-label="Symbolen">
          <form
            className="form form--inline"
            onSubmit={(e) => {
              e.preventDefault();
              void refresh();
            }}
            aria-label="Symbolen zoeken"
            role="search"
          >
            <input
              className="field__input"
              type="search"
              placeholder="Zoek op concept, label of synoniem"
              aria-label="Zoekterm"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="field__input"
              aria-label="Filter op categorie"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Alle categorieën</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <button className="button" type="submit">
              Zoeken
            </button>
          </form>

          {loading ? (
            <p className="muted">Laden…</p>
          ) : symbols.length === 0 ? (
            <p className="muted">Geen symbolen gevonden.</p>
          ) : (
            <ul className="symbol-list">
              {symbols.map((symbol) => (
                <li
                  key={symbol.id}
                  className={`symbol-list__item${symbol.id === selectedId ? ' symbol-list__item--active' : ''}`}
                >
                  <button
                    type="button"
                    className="symbol-list__select"
                    aria-label={symbol.label}
                    onClick={() => setSelectedId(symbol.id)}
                  >
                    <img
                      className="symbol-list__image"
                      src={apiUrl(symbol.imageUrl)}
                      alt=""
                      width={40}
                      height={40}
                    />
                    <span className="symbol-list__text">
                      <span className="symbol-list__label">{symbol.label}</span>
                      <span className="muted symbol-list__meta">
                        {symbol.concept} · {CATEGORY_LABELS[symbol.category]}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="button button--danger"
                    onClick={() => void handleDelete(symbol.id)}
                    aria-label={`Symbool ${symbol.label} verwijderen`}
                  >
                    Verwijderen
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="admin__detail">
          <section className="panel" aria-label="Symbool toevoegen">
            <h2 className="panel__subtitle">Nieuw symbool</h2>
            <AacSymbolForm
              key="create"
              submitLabel="Toevoegen"
              onSubmit={handleCreate}
              resetOnSuccess
            />
          </section>

          {selected ? (
            <AacSymbolDetail
              key={selected.id}
              api={api}
              symbol={selected}
              allSymbols={symbols}
              onChanged={(updated) => void handleChanged(updated)}
            />
          ) : (
            <section className="panel">
              <p className="muted">Kies een symbool om het te bewerken en relaties te leggen.</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * Formulier voor het aanmaken én bewerken van een symbool. Synoniemen worden als
 * komma-gescheiden tekst ingevoerd. Bij succesvol aanmaken kan het formulier zichzelf legen
 * (`resetOnSuccess`); bij bewerken blijven de waarden staan.
 */
function AacSymbolForm({
  initial,
  submitLabel,
  onSubmit,
  resetOnSuccess = false,
}: {
  initial?: AacSymbolAdmin;
  submitLabel: string;
  onSubmit: (input: AacSymbolInput) => Promise<void>;
  resetOnSuccess?: boolean;
}): React.JSX.Element {
  const [concept, setConcept] = useState(initial?.concept ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [categoryValue, setCategoryValue] = useState<string>(initial?.category ?? 'object');
  const [glyph, setGlyph] = useState(initial?.glyph ?? '');
  const [synonyms, setSynonyms] = useState((initial?.synonyms ?? []).join(', '));
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setOk(false);
    setBusy(true);
    try {
      await onSubmit({
        concept,
        label,
        category: categoryValue as AacCategory,
        glyph,
        synonyms: parseSynonyms(synonyms),
      });
      setOk(true);
      if (resetOnSuccess) {
        setConcept('');
        setLabel('');
        setGlyph('');
        setSynonyms('');
        setCategoryValue('object');
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Opslaan mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={(e) => void handleSubmit(e)} aria-label={submitLabel}>
      <label className="field">
        <span className="field__label">Concept (sleutel)</span>
        <input
          className="field__input"
          type="text"
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="bv. do-activity"
          required
        />
      </label>
      <label className="field">
        <span className="field__label">Label (weergavetekst)</span>
        <input
          className="field__input"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="bv. Wandelen"
          required
        />
      </label>
      <label className="field">
        <span className="field__label">Categorie</span>
        <select
          className="field__input"
          value={categoryValue}
          onChange={(e) => setCategoryValue(e.target.value)}
        >
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">Glyph (emoji-fallback)</span>
        <input
          className="field__input"
          type="text"
          value={glyph}
          onChange={(e) => setGlyph(e.target.value)}
          placeholder="bv. 🚶"
          required
        />
      </label>
      <label className="field">
        <span className="field__label">Synoniemen (komma-gescheiden)</span>
        <input
          className="field__input"
          type="text"
          value={synonyms}
          onChange={(e) => setSynonyms(e.target.value)}
          placeholder="bv. lopen, wandeling"
        />
      </label>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="form__ok" role="status">
          Opgeslagen.
        </p>
      ) : null}

      <div className="form__actions">
        <button className="button button--primary" type="submit" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * Detailpaneel van een geselecteerd symbool: bewerken, afbeelding uploaden en relaties beheren.
 * De afbeelding-upload gaat via multipart naar de backend, die het bestandstype en de grootte
 * valideert; hier tonen we alleen de fout terug.
 */
function AacSymbolDetail({
  api,
  symbol,
  allSymbols,
  onChanged,
}: {
  api: Api;
  symbol: AacSymbolAdmin;
  allSymbols: AacSymbolAdmin[];
  onChanged: (updated: AacSymbolAdmin) => void;
}): React.JSX.Element {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [relError, setRelError] = useState<string | null>(null);
  const [childId, setChildId] = useState('');

  async function handleEdit(input: AacSymbolInput): Promise<void> {
    const updated = await api.updateAacSymbol(symbol.id, input);
    onChanged(updated);
  }

  async function handleUpload(file: File): Promise<void> {
    setUploadError(null);
    setUploading(true);
    try {
      const updated = await api.uploadAacImage(symbol.id, file);
      onChanged(updated);
    } catch (err) {
      setUploadError(err instanceof ApiRequestError ? err.message : 'Uploaden mislukt.');
    } finally {
      setUploading(false);
    }
  }

  async function handleAddRelation(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!childId) return;
    setRelError(null);
    try {
      const updated = await api.createAacRelation(symbol.id, childId);
      setChildId('');
      onChanged(updated);
    } catch (err) {
      setRelError(err instanceof ApiRequestError ? err.message : 'Relatie leggen mislukt.');
    }
  }

  async function handleRemoveRelation(relationId: string): Promise<void> {
    setRelError(null);
    try {
      await api.deleteAacRelation(relationId);
      onChanged(symbol);
    } catch (err) {
      setRelError(err instanceof ApiRequestError ? err.message : 'Relatie verwijderen mislukt.');
    }
  }

  // Kandidaat-kindsymbolen: alle andere symbolen die nog geen kind zijn van dit symbool.
  const existingChildIds = new Set(symbol.children.map((c) => c.symbol.id));
  const relationCandidates = allSymbols.filter(
    (s) => s.id !== symbol.id && !existingChildIds.has(s.id),
  );

  return (
    <>
      <section className="panel" aria-label={`Symbool bewerken: ${symbol.label}`}>
        <h2 className="panel__subtitle">Symbool bewerken</h2>
        <AacSymbolForm initial={symbol} submitLabel="Wijzigingen opslaan" onSubmit={handleEdit} />
      </section>

      <section className="panel" aria-label={`Afbeelding voor ${symbol.label}`}>
        <h2 className="panel__subtitle">Pictogram</h2>
        <div className="symbol-image">
          <img src={apiUrl(symbol.imageUrl)} alt={symbol.label} width={96} height={96} />
          <p className="muted">
            {symbol.hasImage
              ? 'Er is een afbeelding geüpload. Upload een nieuwe om te vervangen.'
              : 'Nog geen afbeelding; nu wordt de emoji-glyph getoond.'}
          </p>
        </div>
        {symbol.attribution ? (
          <p className="muted symbol-attribution">
            Bron: {symbol.attribution.author ?? 'onbekend'} — licentie {symbol.attribution.license}
            {symbol.attribution.sourceUrl ? (
              <>
                {' · '}
                <a href={symbol.attribution.sourceUrl} target="_blank" rel="noreferrer noopener">
                  bron
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        <label className="field">
          <span className="field__label">Afbeelding uploaden (PNG, JPEG of WebP)</span>
          <input
            className="field__input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUpload(file);
              e.target.value = '';
            }}
          />
        </label>
        {uploadError ? (
          <p className="form__error" role="alert">
            {uploadError}
          </p>
        ) : null}
      </section>

      <OpenSymbolsPanel api={api} symbol={symbol} onChanged={onChanged} />

      <section className="panel" aria-label={`Relaties voor ${symbol.label}`}>
        <h2 className="panel__subtitle">Relaties</h2>
        <p className="muted">
          Onderliggende concepten (dit symbool bevat …). Zo ontstaat de begrippenboom waarlangs de
          verfijning loopt.
        </p>

        {symbol.children.length === 0 ? (
          <p className="muted">Nog geen onderliggende concepten.</p>
        ) : (
          <ul className="relation-list">
            {symbol.children.map((edge) => (
              <li key={edge.relationId} className="relation-list__item">
                <span>
                  {edge.symbol.glyph} {edge.symbol.label}
                </span>
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => void handleRemoveRelation(edge.relationId)}
                  aria-label={`Relatie met ${edge.symbol.label} verwijderen`}
                >
                  Verwijderen
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="form form--inline"
          onSubmit={(e) => void handleAddRelation(e)}
          aria-label="Relatie toevoegen"
        >
          <select
            className="field__input"
            aria-label="Onderliggend concept"
            value={childId}
            onChange={(e) => setChildId(e.target.value)}
          >
            <option value="">Kies een onderliggend concept…</option>
            {relationCandidates.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.concept})
              </option>
            ))}
          </select>
          <button className="button button--primary" type="submit" disabled={!childId}>
            Relatie toevoegen
          </button>
        </form>

        {symbol.parents.length > 0 ? (
          <p className="muted">
            Bovenliggend: {symbol.parents.map((p) => p.symbol.label).join(', ')}
          </p>
        ) : null}

        {relError ? (
          <p className="form__error" role="alert">
            {relError}
          </p>
        ) : null}
      </section>
    </>
  );
}

/**
 * OpenSymbols-paneel (T3.3): een beheerder zoekt in de vrij te gebruiken OpenSymbols-bibliotheek
 * en koppelt een gevonden pictogram aan het geselecteerde symbool. De backend proxyt de zoekactie
 * én haalt de gekozen afbeelding server-side op (de client praat nooit rechtstreeks met de externe
 * dienst); hier tonen we alleen de resultaten met bronvermelding en de fout-/lege toestanden.
 */
function OpenSymbolsPanel({
  api,
  symbol,
  onChanged,
}: {
  api: Api;
  symbol: AacSymbolAdmin;
  onChanged: (updated: AacSymbolAdmin) => void;
}): React.JSX.Element {
  const [q, setQ] = useState(symbol.label);
  const [results, setResults] = useState<OpenSymbolsResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [attachingId, setAttachingId] = useState<string | null>(null);

  async function handleSearch(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!q.trim()) return;
    setError(null);
    setSearching(true);
    setResults(null);
    try {
      const { results: found } = await api.searchOpenSymbols(q.trim());
      setResults(found);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Zoeken bij OpenSymbols mislukt.');
    } finally {
      setSearching(false);
    }
  }

  async function handleAttach(result: OpenSymbolsResult): Promise<void> {
    setError(null);
    setAttachingId(result.id);
    try {
      const updated = await api.attachOpenSymbols(symbol.id, {
        imageUrl: result.imageUrl,
        license: result.license,
        licenseUrl: result.licenseUrl,
        author: result.author,
        authorUrl: result.authorUrl,
        sourceUrl: result.sourceUrl,
      });
      onChanged(updated);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Koppelen mislukt.');
    } finally {
      setAttachingId(null);
    }
  }

  return (
    <section className="panel" aria-label={`OpenSymbols zoeken voor ${symbol.label}`}>
      <h2 className="panel__subtitle">Zoek in OpenSymbols</h2>
      <p className="muted">
        Zoek een vrij te gebruiken pictogram in OpenSymbols en koppel het. De afbeelding wordt
        lokaal opgeslagen met bronvermelding en licentie.
      </p>

      <form
        className="form form--inline"
        onSubmit={(e) => void handleSearch(e)}
        aria-label="OpenSymbols zoeken"
        role="search"
      >
        <input
          className="field__input"
          type="search"
          placeholder="Zoekterm (bv. dog)"
          aria-label="OpenSymbols-zoekterm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="button" type="submit" disabled={searching}>
          {searching ? 'Zoeken…' : 'Zoek pictogram'}
        </button>
      </form>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      {results && results.length === 0 ? <p className="muted">Geen resultaten gevonden.</p> : null}

      {results && results.length > 0 ? (
        <ul className="opensymbols-results">
          {results.map((result) => (
            <li key={result.id} className="opensymbols-results__item">
              <img
                className="opensymbols-results__image"
                src={result.imageUrl}
                alt={result.name}
                width={64}
                height={64}
                loading="lazy"
              />
              <span className="opensymbols-results__meta">
                <span>{result.name}</span>
                <span className="muted">
                  {result.author ?? 'onbekend'} · {result.license}
                </span>
              </span>
              <button
                type="button"
                className="button button--primary"
                disabled={attachingId !== null}
                onClick={() => void handleAttach(result)}
                aria-label={`Koppel ${result.name} aan ${symbol.label}`}
              >
                {attachingId === result.id ? 'Koppelen…' : 'Koppelen'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
