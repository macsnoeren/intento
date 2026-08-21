import { useCallback, useEffect, useState } from 'react';
import type { AccountPublic, AacSymbol, ConceptProposal } from '@intento/shared';
import { ApiRequestError, apiUrl, type Api } from './api.ts';
import { AdminNav, type AdminView } from './AdminNav.tsx';

/**
 * Beheeromgeving — reviewlijst van AI-conceptvoorstellen (T7.3, DESIGN §5.2, §6.2, §7.6, FR-016).
 *
 * De validatielaag (T5.2) legt een voorstel vast telkens als de AI een begrip aandroeg dat niet in de
 * AAC-bibliotheek bestaat: de optie **bereikte de gebruiker nooit** en het begrip komt hier ter
 * beoordeling. De beheerder koppelt het aan een bestaand pictogram (waarna de AI het via de
 * validatielaag mag aanbieden — FR-016) of wijst het af.
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { proposals: list } = await api.listConceptProposals();
      setProposals(list);
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
    <main className="admin">
      <header className="admin__header">
        <div>
          <h1 className="panel__title">Conceptvoorstellen</h1>
          <AdminNav active="proposals" onNavigate={onNavigate} />
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

      <section className="panel" aria-label="AI-conceptvoorstellen">
        <p className="muted">
          Nieuwe begrippen die de AI voorstelde maar (nog) niet in de bibliotheek staan. Ze
          bereikten de gebruiker nooit. Koppel een voorstel aan een bestaand pictogram om het
          beschikbaar te maken voor de AI, of wijs het af.
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
    </main>
  );
}
