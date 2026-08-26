import { useCallback, useEffect, useState } from 'react';
import type { AccountPublic, AacSymbol, AiConceptReview, ConceptProposal } from '@intento/shared';
import { ApiRequestError, apiUrl, type Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';

/**
 * Beheeromgeving — beoordelen van begrippen die de AI aandroeg (T7.3/T10.7, DESIGN §5.2, §7.6, FR-016).
 *
 * Twee lijsten, want er zijn sinds Fase 10 twee gevallen:
 *
 *  1. **Nieuwe woorden** (T10.7) — de AI droeg tijdens een gesprek een begrip aan dat niet bestond, en
 *     dat is meteen een bruikbaar pictogram geworden: de gebruiker moet zijn woord kúnnen kiezen. Wat
 *     blijvend in de bibliotheek komt, blijft echter aan de beheerder. Die kan het **behouden** (met een
 *     beter pictogram via de bibliotheekpagina), **samenvoegen** met een bestaand pictogram — dan wordt
 *     het een synoniem en blijft de bibliotheek vrij van bijna-duplicaten — of **verwijderen**.
 *  2. **Conceptvoorstellen** (T7.3) — begrippen die de gebruiker níet bereikten, bijvoorbeeld omdat
 *     nieuwe concepten uitstaan (`AI_ALLOW_NEW_CONCEPTS=false`) of omdat de term onbruikbaar was als
 *     concept. Die koppelt de beheerder aan een bestaand pictogram of wijst hij af.
 */

function statusLabel(status: ConceptProposal['status']): string {
  switch (status) {
    case 'PENDING':
      return 'Openstaand';
    case 'APPROVED':
      return 'Goedgekeurd';
    case 'REJECTED':
      return 'Afgewezen';
  }
}

/** Zoek-en-koppelblok voor één openstaand voorstel: zoek een pictogram en keur goed. */
function LinkForm({
  api,
  onApprove,
}: {
  api: Api;
  onApprove: (symbolId: string) => void | Promise<void>;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AacSymbol[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(): Promise<void> {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const { symbols } = await api.searchAac(q);
      setResults(symbols);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Zoeken mislukt.');
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="review__link">
      <div className="review__search">
        <input
          className="field__input"
          type="text"
          placeholder="Zoek een pictogram om aan te koppelen"
          aria-label="Zoek een pictogram"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSearch();
            }
          }}
        />
        <button
          className="button"
          type="button"
          onClick={() => void handleSearch()}
          disabled={!query.trim() || searching}
        >
          Zoeken
        </button>
      </div>
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul className="review__results">
          {results.map((symbol) => (
            <li key={symbol.id} className="review__result">
              <img src={apiUrl(symbol.imageUrl)} alt={symbol.label} width={40} height={40} />
              <span>{symbol.label}</span>
              <button
                className="button button--primary"
                type="button"
                onClick={() => void onApprove(symbol.id)}
                aria-label={`Koppelen aan ${symbol.label} en goedkeuren`}
              >
                Koppelen
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Zoek-en-kiesblok om een AI-concept met een bestaand pictogram samen te voegen. Bewust dezelfde vorm
 * als `LinkForm`, maar met een andere uitkomst: hier verdwijnt het losse concept.
 */
function MergeForm({
  api,
  onMerge,
}: {
  api: Api;
  onMerge: (targetSymbolId: string) => void | Promise<void>;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AacSymbol[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(): Promise<void> {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const { symbols } = await api.searchAac(q);
      setResults(symbols);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Zoeken mislukt.');
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="review__link">
      <div className="review__search">
        <input
          className="field__input"
          type="text"
          placeholder="Zoek het pictogram waarin dit begrip opgaat"
          aria-label="Zoek een pictogram om mee samen te voegen"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className="button"
          type="button"
          onClick={() => void handleSearch()}
          disabled={searching}
        >
          Zoeken
        </button>
      </div>
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul className="review__results">
          {results.map((symbol) => (
            <li key={symbol.id} className="review__result">
              <img src={apiUrl(symbol.imageUrl)} alt={symbol.label} width={40} height={40} />
              <span>{symbol.label}</span>
              <button
                className="button"
                type="button"
                onClick={() => void onMerge(symbol.id)}
                aria-label={`Samenvoegen met ${symbol.label}`}
              >
                Samenvoegen
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** De lijst met nog niet beoordeelde, door de AI aangedragen begrippen (T10.7). */
function NewConceptsSection({
  api,
  concepts,
  onChanged,
  onError,
}: {
  api: Api;
  concepts: AiConceptReview[];
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}): React.JSX.Element {
  async function act(action: () => Promise<unknown>, failure: string): Promise<void> {
    try {
      await action();
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : failure);
    }
  }

  return (
    <section className="panel" aria-label="Nieuwe woorden van de AI">
      <h2 className="panel__subtitle">Nieuwe woorden</h2>
      <p className="muted">
        Begrippen die de AI tijdens een gesprek aandroeg omdat ze nog niet in de bibliotheek
        stonden. Ze zijn meteen bruikbaar — de gebruiker ziet ze met een ✨-markering — maar wachten
        op jouw oordeel. Een beter pictogram kies je op de bibliotheekpagina.
      </p>
      {concepts.length === 0 ? (
        <p className="muted">Geen nieuwe woorden om te beoordelen.</p>
      ) : (
        <ul className="review-list">
          {concepts.map(({ symbol, timesChosen, reason }) => (
            <li key={symbol.id} className="review-list__item">
              <div className="review__head">
                <img src={apiUrl(symbol.imageUrl)} alt="" width={40} height={40} />
                <span className="review__concept">{symbol.label}</span>
                <span className="badge badge--pending">
                  {timesChosen === 1 ? '1 keer gekozen' : `${timesChosen} keer gekozen`}
                </span>
              </div>
              {reason ? <p className="review__reason muted">{reason}</p> : null}
              <div className="review__actions">
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => void act(() => api.keepAiConcept(symbol.id), 'Behouden mislukt.')}
                  aria-label={`${symbol.label} behouden in de bibliotheek`}
                >
                  Behouden
                </button>
                <MergeForm
                  api={api}
                  onMerge={(targetSymbolId) =>
                    act(() => api.mergeAiConcept(symbol.id, targetSymbolId), 'Samenvoegen mislukt.')
                  }
                />
                <button
                  className="button button--danger"
                  type="button"
                  onClick={() =>
                    void act(() => api.discardAiConcept(symbol.id), 'Verwijderen mislukt.')
                  }
                  aria-label={`${symbol.label} verwijderen`}
                >
                  Verwijderen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ConceptProposalsPage({
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
  const [proposals, setProposals] = useState<ConceptProposal[]>([]);
  const [aiConcepts, setAiConcepts] = useState<AiConceptReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [{ proposals: list }, { concepts }] = await Promise.all([
        api.listConceptProposals(),
        api.listAiConcepts(),
      ]);
      setProposals(list);
      setAiConcepts(concepts);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleApprove(id: string, symbolId: string): Promise<void> {
    setError(null);
    try {
      await api.approveConceptProposal(id, symbolId);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Goedkeuren mislukt.');
    }
  }

  async function handleReject(id: string): Promise<void> {
    setError(null);
    try {
      await api.rejectConceptProposal(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Afwijzen mislukt.');
    }
  }

  return (
    <AppShell
      account={account}
      title="Conceptvoorstellen"
      subtitle="Nieuwe begrippen die de AI aandroeg, wachtend op jouw oordeel."
      active="proposals"
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? null : (
        <NewConceptsSection
          api={api}
          concepts={aiConcepts}
          onChanged={refresh}
          onError={setError}
        />
      )}

      <section className="panel" aria-label="AI-conceptvoorstellen">
        <h2 className="panel__subtitle">Conceptvoorstellen</h2>
        <p className="muted">
          Begrippen die de AI voorstelde en die de gebruiker <strong>niet</strong> bereikten —
          bijvoorbeeld omdat nieuwe woorden uitstaan of omdat de term onbruikbaar was als concept.
          Koppel een voorstel aan een bestaand pictogram om het beschikbaar te maken voor de AI, of
          wijs het af.
        </p>
        {loading ? (
          <p className="muted">Laden…</p>
        ) : proposals.length === 0 ? (
          <p className="muted">Geen conceptvoorstellen.</p>
        ) : (
          <ul className="review-list">
            {proposals.map((proposal) => (
              <li key={proposal.id} className="review-list__item">
                <div className="review__head">
                  <span className="review__concept">{proposal.concept}</span>
                  <span className={`badge badge--${proposal.status.toLowerCase()}`}>
                    {statusLabel(proposal.status)}
                  </span>
                </div>
                <p className="review__reason muted">{proposal.reason}</p>
                {proposal.linkedSymbol ? (
                  <p className="muted">
                    Gekoppeld aan: <strong>{proposal.linkedSymbol.label}</strong>
                  </p>
                ) : null}
                {proposal.status === 'PENDING' ? (
                  <div className="review__actions">
                    <LinkForm
                      api={api}
                      onApprove={(symbolId) => handleApprove(proposal.id, symbolId)}
                    />
                    <button
                      className="button button--danger"
                      type="button"
                      onClick={() => void handleReject(proposal.id)}
                      aria-label={`Voorstel ${proposal.concept} afwijzen`}
                    >
                      Afwijzen
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
