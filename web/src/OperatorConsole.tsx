import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  AccountPublic,
  OperatorOrganization,
  OperatorOrganizationDetail,
  OrganizationType,
} from '@intento/shared';
import { ApiRequestError, httpApi, type Api } from './api.ts';
import { LoginForm } from './LoginForm.tsx';

/**
 * Platform-operatorconsole (T8.3, DESIGN §9.1, §9.4, §10.4, ADR-0011).
 *
 * Bewust een **aparte routetak** naast de beheeromgeving en de tablet-app: `/operator` heeft een
 * eigen scherm, eigen navigatie en geen enkele knop naar het gewone beheer. Reden is dezelfde als
 * op de server — dit is het enige deel van Intento dat over de tenant-grens heen kijkt, en dat
 * hoort een plek te zijn waar je bewust naartoe gaat, niet een extra tabblad dat je per ongeluk
 * openklikt terwijl je je eigen organisatie beheert.
 *
 * Wat je hier ziet is **beheermetadata**: welke omgevingen er zijn, hoe groot ze zijn, of ze actief
 * zijn, en welke logins erin zitten. Geen boodschappen, geen gesprekken, geen persoonlijke context,
 * en zelfs geen namen van gebruikers — de communicerende persoon blijft binnen zijn eigen omgeving
 * (DESIGN §2, §9.4). De server dwingt dat af; de UI toont domweg niet meer dan ze krijgt.
 *
 * De ingang is niet de beveiliging: `isOperator` op het account bepaalt alleen of we de console
 * tonen. De echte grens is `operatorAuthorize` op de server, die elke call apart weigert (403
 * `NOT_OPERATOR`) — vandaar dat we een 403 hier gewoon als "geen toegang" tonen in plaats van te
 * vertrouwen op wat de client denkt te weten.
 */

const TYPE_LABELS: Record<OrganizationType, string> = {
  family: 'Familie',
  care: 'Zorginstelling',
  personal: 'Persoonlijk',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('nl-NL');
}

/** Het paneel dat een operator ziet zodra hij is ingelogd: lijst, aanmaken, detail. */
function OperatorPanel({
  api,
  account,
  onLogout,
}: {
  api: Api;
  account: AccountPublic;
  onLogout: () => void;
}): React.JSX.Element {
  const [organizations, setOrganizations] = useState<OperatorOrganization[]>([]);
  const [detail, setDetail] = useState<OperatorOrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // De server kan alsnog 403 geven (vlag ingetrokken, niet in de platformorganisatie): dan geen lijst.
  const [forbidden, setForbidden] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<OrganizationType>('care');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { organizations: list } = await api.listOperatorOrganizations();
      setOrganizations(list);
      setForbidden(false);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'NOT_OPERATOR') {
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
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.createOperatorOrganization({ name: trimmed, type });
      setName('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Aanmaken mislukt.');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(organization: OperatorOrganization): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (organization.active) {
        await api.deactivateOperatorOrganization(organization.id);
      } else {
        await api.activateOperatorOrganization(organization.id);
      }
      await refresh();
      // Staat het detail van deze organisatie open, dan meteen meeverversen.
      if (detail?.organization.id === organization.id) {
        setDetail(await api.getOperatorOrganization(organization.id));
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Wijzigen mislukt.');
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenDetail(id: string): Promise<void> {
    setError(null);
    try {
      setDetail(await api.getOperatorOrganization(id));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Openen mislukt.');
    }
  }

  if (forbidden) {
    return (
      <main className="panel panel--narrow">
        <h1 className="panel__title">Operatorconsole</h1>
        <p>
          Dit account heeft geen platform-operatorrechten. De operatorconsole is voorbehouden aan de
          platformbeheerder; gewoon beheer van je eigen organisatie doe je in de beheeromgeving.
        </p>
        <button className="button" type="button" onClick={onLogout}>
          Uitloggen
        </button>
      </main>
    );
  }

  return (
    <main className="admin">
      <header className="admin__header">
        <div>
          <h1 className="panel__title">Operatorconsole</h1>
          <p className="muted">Platformbeheer over alle omgevingen heen.</p>
        </div>
        <div className="admin__account">
          <span>{account.email}</span>
          <button className="button" type="button" onClick={onLogout}>
            Uitloggen
          </button>
        </div>
      </header>

      <p className="muted">
        Hier beheer je omgevingen: aanmaken, en stoppen of hervatten bij misbruik. Communicatie,
        persoonlijke context en namen van gebruikers zijn hier bewust niet zichtbaar — die blijven
        binnen de omgeving zelf.
      </p>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="panel" aria-label="Nieuwe omgeving">
        <h2 className="panel__subtitle">Nieuwe omgeving</h2>
        <form className="form form--inline" onSubmit={(event) => void handleCreate(event)}>
          <label className="field">
            <span className="field__label">Naam</span>
            <input
              className="field__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Soort</span>
            <select
              className="field__input"
              value={type}
              onChange={(event) => setType(event.target.value as OrganizationType)}
            >
              {(Object.keys(TYPE_LABELS) as OrganizationType[]).map((value) => (
                <option key={value} value={value}>
                  {TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <div className="form__actions">
            <button className="button button--primary" type="submit" disabled={busy}>
              Aanmaken
            </button>
          </div>
        </form>
        <p className="muted">
          De omgeving start zonder accounts. De beheerder ervan meldt zich zelf aan; een operator
          maakt geen inloggegevens in andermans omgeving.
        </p>
      </section>

      {loading ? (
        <p className="muted">Laden…</p>
      ) : (
        <section className="panel" aria-label="Omgevingen">
          <h2 className="panel__subtitle">Omgevingen ({organizations.length})</h2>
          <ul className="token-list">
            {organizations.map((organization) => (
              <li key={organization.id} className="token-list__item">
                <div className="token-list__info">
                  <span className="token-list__name">{organization.name}</span>
                  <span
                    className={`badge ${organization.active ? 'badge--active' : 'badge--revoked'}`}
                  >
                    {organization.active ? 'Actief' : 'Gedeactiveerd'}
                  </span>
                  {organization.isPlatform ? <span className="badge">Platform</span> : null}
                  <span className="muted">
                    {TYPE_LABELS[organization.type]} · {organization.userCount} gebruikers ·{' '}
                    {organization.accountCount} logins · sinds {formatDate(organization.createdAt)}
                  </span>
                </div>
                <div className="form__actions">
                  <button
                    className="button"
                    type="button"
                    onClick={() => void handleOpenDetail(organization.id)}
                  >
                    Details
                  </button>
                  {/* De platformorganisatie kan niet gestopt worden: dat zou de console zelf
                      buitensluiten. De server weigert het ook (400). */}
                  {organization.isPlatform ? null : (
                    <button
                      className={`button ${organization.active ? 'button--danger' : ''}`}
                      type="button"
                      disabled={busy}
                      onClick={() => void handleToggleActive(organization)}
                    >
                      {organization.active ? 'Deactiveren' : 'Activeren'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail ? (
        <section className="panel" aria-label={`Details ${detail.organization.name}`}>
          <div className="panel__head">
            <h2 className="panel__subtitle">{detail.organization.name}</h2>
            <button className="button" type="button" onClick={() => setDetail(null)}>
              Sluiten
            </button>
          </div>

          <h3 className="panel__subtitle">Logins ({detail.accounts.length})</h3>
          <ul className="token-list">
            {detail.accounts.map((entry) => (
              <li key={entry.id} className="token-list__item">
                <div className="token-list__info">
                  <span className="token-list__name">{entry.email}</span>
                  <span className="badge">{entry.role}</span>
                  {entry.isOperator ? <span className="badge">Operator</span> : null}
                  {entry.emailVerified ? null : (
                    <span className="badge badge--warn">Niet bevestigd</span>
                  )}
                  {entry.mustChangePassword ? (
                    <span className="badge badge--warn">Tijdelijk wachtwoord</span>
                  ) : null}
                  <span className="muted">sinds {formatDate(entry.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>

          <h3 className="panel__subtitle">Gebruikers ({detail.users.length})</h3>
          <p className="muted">
            Alleen aantal en status: namen van gebruikers verlaten hun eigen omgeving niet.
          </p>
          <ul className="token-list">
            {detail.users.map((user) => (
              <li key={user.id} className="token-list__item">
                <div className="token-list__info">
                  <span className="token-list__name">{user.id}</span>
                  <span className={`badge ${user.active ? 'badge--active' : 'badge--expired'}`}>
                    {user.active ? 'Actief' : 'Inactief'}
                  </span>
                  <span className="muted">sinds {formatDate(user.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

/**
 * Toegangspoort van de console: sessie ophalen, anders inloggen. `api` is injecteerbaar zodat tests
 * een in-memory backend meegeven.
 */
export function OperatorConsole({ api = httpApi }: { api?: Api } = {}): React.JSX.Element {
  const [account, setAccount] = useState<AccountPublic | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { account: me } = await api.me();
        if (active) setAccount(me);
      } catch (err) {
        // 401 = niet ingelogd (verwacht); we tonen dan het loginscherm.
        if (!(err instanceof ApiRequestError)) throw err;
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  async function handleLogout(): Promise<void> {
    try {
      await api.logout();
    } finally {
      setAccount(null);
    }
  }

  if (checking) {
    return (
      <main className="panel panel--narrow">
        <p className="muted">Laden…</p>
      </main>
    );
  }

  if (!account) {
    // Bewust zonder "meld een nieuwe organisatie aan": zelfaanmelding hoort bij de beheeromgeving.
    return <LoginForm api={api} onLoggedIn={({ account: me }) => setAccount(me)} />;
  }

  return <OperatorPanel api={api} account={account} onLogout={() => void handleLogout()} />;
}
