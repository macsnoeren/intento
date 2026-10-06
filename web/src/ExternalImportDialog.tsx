import { useState } from 'react';
import {
  VOCABULARY_CONTEXTS,
  type ExternalSymbol,
  type VocabularyContext,
  type VocabularyItemPublic,
} from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import { CONTEXT_LABELS, splitList } from './VocabularyItemDetail.tsx';
import { licenseLabel } from './VocabularyPage.tsx';

/** Een conceptsleutel uit een (Engelse) naam: "Feel Dizzy" → "feel_dizzy". */
function conceptFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/**
 * Een symbool importeren uit een externe bron (N8.6, INTENTO-NEW-DESIGN §15, §49).
 *
 * De beheerder zoekt, ziet per resultaat de licentie en kiest een resultaat met een **toegestane**
 * licentie; andere resultaten zijn gemarkeerd en niet te kiezen. Daarna geeft hij het Nederlandse
 * woord en de concepten. Licentie en afbeelding haalt de server zelf opnieuw bij de bron.
 */
export function ExternalImportDialog({
  api,
  onCreated,
  onCancel,
}: {
  api: Api;
  onCreated: (item: VocabularyItemPublic) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [results, setResults] = useState<ExternalSymbol[] | null>(null);
  const [chosen, setChosen] = useState<ExternalSymbol | null>(null);
  const [label, setLabel] = useState('');
  const [synonyms, setSynonyms] = useState('');
  const [concepts, setConcepts] = useState('');
  const [contexts, setContexts] = useState<VocabularyContext[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setChosen(null);
    try {
      setResults((await api.searchExternal(q)).results);
      setSearched(q);
    } catch (err) {
      setResults(null);
      setError(err instanceof ApiRequestError ? err.message : 'Zoeken mislukt.');
    } finally {
      setBusy(false);
    }
  }

  function choose(result: ExternalSymbol): void {
    if (!result.allowed) return;
    setChosen(result);
    setLabel('');
    setConcepts(conceptFrom(result.name));
    setError(null);
  }

  const conceptList = splitList(concepts);
  const ready = chosen !== null && label.trim().length > 0 && conceptList.length > 0;

  async function importChosen(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!chosen || !ready) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await api.importExternal({
          query: searched,
          id: chosen.id,
          label: label.trim(),
          synonyms: splitList(synonyms),
          concepts: conceptList,
          contexts,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Importeren mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="external-import">
      <form className="form toolbar__search" role="search" onSubmit={(e) => void search(e)}>
        <label className="field">
          <span className="field__label">Zoeken in OpenSymbols</span>
          <input
            className="field__input"
            type="search"
            name="external-q"
            value={query}
            placeholder="Bijvoorbeeld: dizzy, opa, fiets"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button className="button" type="submit" disabled={busy || !query.trim()}>
          Zoeken
        </button>
      </form>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      {results && results.length === 0 ? (
        <p className="muted">Niets gevonden voor "{searched}".</p>
      ) : null}

      {results && results.length > 0 && !chosen ? (
        <ul className="external-results" aria-label="Resultaten">
          {results.map((result) => (
            <li key={result.id}>
              <button
                className={`external-result${result.allowed ? '' : ' external-result--blocked'}`}
                type="button"
                disabled={!result.allowed || busy}
                aria-label={`${result.name} (${licenseLabel(result.licenseKey)})`}
                onClick={() => choose(result)}
              >
                <img className="external-result__image" src={result.imageUrl} alt="" />
                <span className="external-result__name">{result.name}</span>
                <span className="badge">
                  {result.licenseKey === 'UNKNOWN'
                    ? result.license
                    : licenseLabel(result.licenseKey)}
                </span>
                {result.allowed ? null : (
                  <span className="badge badge--warn">Licentie niet toegestaan</span>
                )}
                {result.author ? (
                  <span className="external-result__meta">{result.author}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {chosen ? (
        <form className="form" aria-label="Importeren" onSubmit={(e) => void importChosen(e)}>
          <div className="external-chosen">
            <img className="external-result__image" src={chosen.imageUrl} alt={chosen.name} />
            <div>
              <p className="external-result__name">{chosen.name}</p>
              <p className="muted">
                {licenseLabel(chosen.licenseKey)}
                {chosen.author ? ` · ${chosen.author}` : ''}
              </p>
              <button className="link-button" type="button" onClick={() => setChosen(null)}>
                Ander resultaat kiezen
              </button>
            </div>
          </div>
          <label className="field">
            <span className="field__label">Woord (Nederlands)</span>
            <input
              className="field__input"
              name="label"
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Synoniemen (met komma's)</span>
            <input
              className="field__input"
              name="synonyms"
              value={synonyms}
              onChange={(e) => setSynonyms(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Concepten (Engels, kleine letters)</span>
            <input
              className="field__input"
              name="concepts"
              value={concepts}
              onChange={(e) => setConcepts(e.target.value)}
            />
          </label>
          <fieldset className="field">
            <legend className="field__label">Contexten</legend>
            <div className="choice-row">
              {VOCABULARY_CONTEXTS.map((context) => (
                <label key={context} className="choice">
                  <input
                    type="checkbox"
                    checked={contexts.includes(context)}
                    onChange={(e) =>
                      setContexts((list) =>
                        e.target.checked ? [...list, context] : list.filter((c) => c !== context),
                      )
                    }
                  />
                  <span>{CONTEXT_LABELS[context]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="form__actions">
            <button className="button" type="button" onClick={onCancel}>
              Annuleren
            </button>
            <button className="button button--primary" type="submit" disabled={!ready || busy}>
              Importeren
            </button>
          </div>
        </form>
      ) : (
        <div className="form__actions">
          <button className="button" type="button" onClick={onCancel}>
            Sluiten
          </button>
        </div>
      )}
    </div>
  );
}
