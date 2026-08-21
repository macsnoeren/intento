import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AccountPublic, WorkerTokenPublic } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import { AdminNav, type AdminView } from './AdminNav.tsx';

/**
 * Beheeromgeving — worker-tokenbeheer (T5.8, DESIGN §5.2, §9.4, ADR-0010). Een worker-token is een
 * **platform-/infrastructuur**-credential (los van gebruikers/tenants) waarmee een externe AI-worker
 * (T5.6) jobs van de wachtrij mag verwerken. Alleen een ADMIN van de platformorganisatie mag ze
 * beheren; is dat niet zo, dan geeft de backend 403 `NOT_PLATFORM_ADMIN` en tonen we een uitleg
 * i.p.v. de lijst.
 *
 * Het **rauwe** token verlaat de server alleen bij aanmaken en wordt hier **één keer** getoond —
 * daarna kent de server alleen de hash. Vandaar de nadrukkelijke "bewaar nu"-melding.
 */

/** Menselijke status-badge per token (afgeleid op de server uit revoked/expired). */
function statusLabel(status: WorkerTokenPublic['status']): string {
  switch (status) {
    case 'active':
      return 'Actief';
    case 'revoked':
      return 'Ingetrokken';
    case 'expired':
      return 'Verlopen';
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('nl-NL');
}

export function WorkerTokensPage({
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
  const [tokens, setTokens] = useState<WorkerTokenPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Als de ingelogde admin geen platformbeheerder is, weigert de backend (403); dan geen lijst/formulier.
  const [forbidden, setForbidden] = useState(false);
  const [name, setName] = useState('');
  const [ttlDays, setTtlDays] = useState('');
  // Het rauwe token van de zojuist aangemaakte credential — één keer te zien.
  const [freshToken, setFreshToken] = useState<{ name: string; token: string } | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { tokens: list } = await api.listWorkerTokens();
      setTokens(list);
      setForbidden(false);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'NOT_PLATFORM_ADMIN') {
        setForbidden(true);
      } else {
        setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      }
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    const ttl = ttlDays.trim() ? Number(ttlDays.trim()) : undefined;
    if (ttl !== undefined && (!Number.isInteger(ttl) || ttl <= 0)) {
      setError('Geldigheid moet een positief aantal dagen zijn.');
      return;
    }
    try {
      const { workerToken, token } = await api.createWorkerToken({
        name: trimmed,
        ...(ttl !== undefined ? { ttlDays: ttl } : {}),
      });
      setFreshToken({ name: workerToken.name, token });
      setName('');
      setTtlDays('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Aanmaken mislukt.');
    }
  }

  async function handleRevoke(id: string): Promise<void> {
    setError(null);
    try {
      await api.revokeWorkerToken(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Intrekken mislukt.');
    }
  }

  return (
    <main className="admin">
      <header className="admin__header">
        <div>
          <h1 className="panel__title">Worker-tokens</h1>
          <AdminNav active="worker-tokens" onNavigate={onNavigate} />
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

      {forbidden ? (
        <section className="panel">
          <p className="muted">
            Worker-tokens zijn platforminfrastructuur en kunnen alleen door een platformbeheerder
            worden beheerd. Jouw beheerdersaccount heeft die rol niet.
          </p>
        </section>
      ) : (
        <div className="admin__grid">
          <section className="panel" aria-label="Worker-token aanmaken">
            <h2 className="panel__subtitle">Nieuw worker-token</h2>
            <p className="muted">
              Een worker-token laat een externe AI-worker jobs van de wachtrij verwerken. Bewaar het
              rauwe token meteen: het wordt maar één keer getoond.
            </p>
            <form
              className="form"
              onSubmit={(e) => void handleCreate(e)}
              aria-label="Worker-token aanmaken"
            >
              <label className="field">
                <span className="field__label">Naam</span>
                <input
                  className="field__input"
                  type="text"
                  placeholder="bv. gpu-node-1"
                  aria-label="Naam van het worker-token"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span className="field__label">Geldigheid (dagen, optioneel)</span>
                <input
                  className="field__input"
                  type="number"
                  min={1}
                  placeholder="leeg = verloopt niet"
                  aria-label="Geldigheid in dagen"
                  value={ttlDays}
                  onChange={(e) => setTtlDays(e.target.value)}
                />
              </label>
              <button className="button button--primary" type="submit" disabled={!name.trim()}>
                Token aanmaken
              </button>
            </form>

            {freshToken ? (
              <div className="panel panel--highlight" role="status">
                <p>
                  Token voor <strong>{freshToken.name}</strong> aangemaakt. Kopieer het nu — het
                  wordt niet opnieuw getoond:
                </p>
                <code className="token-reveal">{freshToken.token}</code>
                <button className="button" type="button" onClick={() => setFreshToken(null)}>
                  Verbergen
                </button>
              </div>
            ) : null}
          </section>

          <section className="panel" aria-label="Worker-tokens">
            <h2 className="panel__subtitle">Bestaande tokens</h2>
            {loading ? (
              <p className="muted">Laden…</p>
            ) : tokens.length === 0 ? (
              <p className="muted">Nog geen worker-tokens. Maak er hierboven één aan.</p>
            ) : (
              <ul className="token-list">
                {tokens.map((token) => (
                  <li key={token.id} className="token-list__item">
                    <div className="token-list__info">
                      <span className="token-list__name">{token.name}</span>
                      <span className={`badge badge--${token.status}`}>
                        {statusLabel(token.status)}
                      </span>
                      <span className="muted">{token.scopes.join(', ')}</span>
                      <span className="muted">
                        Laatst gezien: {formatDate(token.lastSeenAt)} · Vervalt:{' '}
                        {token.expiresAt ? formatDate(token.expiresAt) : 'nooit'}
                      </span>
                    </div>
                    {token.status === 'active' ? (
                      <button
                        type="button"
                        className="button button--danger"
                        onClick={() => void handleRevoke(token.id)}
                        aria-label={`Worker-token ${token.name} intrekken`}
                      >
                        Intrekken
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
