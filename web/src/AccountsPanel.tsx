import { useCallback, useEffect, useState } from 'react';
import type { AccountPublic, ResetAccountPasswordResponse } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Accountlijst van de organisatie (T2.6/T2.7, DESIGN §2, §5.2, §9.4).
 *
 * De beheerder maakt begeleiders aan met een **tijdelijk** wachtwoord (T2.4) dat hij zelf te zien
 * krijgt. Zolang de begeleider dat niet vervangt, kennen twee mensen die login — en tot T2.6 was
 * dat nergens zichtbaar. Deze lijst maakt het zichtbaar: per login een markering "tijdelijk
 * wachtwoord" (blijft tot de houder zelf een wachtwoord kiest) en "e-mail niet bevestigd" (T1.4).
 *
 * **T2.7 voegt de weg terug toe.** Raakt iemand zijn tijdelijke wachtwoord kwijt (of loopt hij vast
 * op de lockout), dan kan hij niets meer: inloggen lukt niet en zonder sessie is "wachtwoord
 * wijzigen" onbereikbaar. De knop hieronder laat de **server** een nieuw tijdelijk wachtwoord
 * genereren en trekt alle sessies van dat account in. De beheerder kiest dus nog steeds nooit het
 * wachtwoord van een ander — dat blijft de kern van T2.5 — hij geeft een sleutel af die de houder
 * bij de eerstvolgende login zelf moet vervangen. Voor het **eigen** account staat er bewust geen
 * knop: dat loopt via "Wachtwoord wijzigen", mét het huidige wachtwoord.
 *
 * Omdat de actie sessies van een collega afkapt, zit er een bevestigingsstap tussen: één klik zet
 * de knop om in "Weet je het zeker?", pas de tweede voert 'm uit.
 */
export function AccountsPanel({
  api,
  refreshToken,
  currentAccountId,
}: {
  api: Api;
  /** Wijzigt zodra er elders een account is aangemaakt (T2.4), zodat de lijst meteen klopt. */
  refreshToken: number;
  /** Het eigen account — krijgt geen resetknop (T2.7); zie de toelichting hierboven. */
  currentAccountId: string;
}): React.JSX.Element {
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Account waarvoor de resetknop op "Weet je het zeker?" staat (T2.7).
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [issued, setIssued] = useState<ResetAccountPasswordResponse | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { accounts: list } = await api.listAccounts();
      setAccounts(list);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  async function handleReset(accountId: string): Promise<void> {
    setError(null);
    setIssued(null);
    setBusyId(accountId);
    try {
      const result = await api.resetAccountPassword(accountId);
      setIssued(result);
      setConfirmingId(null);
      // Verversen zodat de markering "tijdelijk wachtwoord" meteen weer in de lijst staat.
      await refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Uitgeven mislukt.');
    } finally {
      setBusyId(null);
    }
  }

  const pending = accounts.filter((account) => account.mustChangePassword).length;

  return (
    <section className="panel" aria-label="Logins in deze organisatie">
      <h2 className="panel__subtitle">Logins</h2>
      <p className="muted">
        Alle accounts van deze organisatie. Een login met de markering{' '}
        <strong>tijdelijk wachtwoord</strong> draait nog op het wachtwoord dat jij bij het aanmaken
        te zien kreeg — die persoon kan pas verder als hij zelf een wachtwoord kiest. Is iemand zijn
        wachtwoord kwijt, geef dan een nieuw tijdelijk wachtwoord uit; hij wordt dan overal
        uitgelogd.
      </p>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      {issued ? (
        <div className="device-code" role="status">
          <p className="muted">
            Nieuw tijdelijk wachtwoord voor{' '}
            <strong>{issued.account.name ?? issued.account.email}</strong>. Geef het via een veilig
            kanaal door — het is hierna niet meer op te vragen:
          </p>
          <p className="temporary-password">{issued.temporaryPassword}</p>
          <p className="muted">
            {issued.revokedSessions === 0
              ? 'Er stonden geen sessies open. '
              : issued.revokedSessions === 1
                ? '1 openstaande sessie is ingetrokken. '
                : `${issued.revokedSessions} openstaande sessies zijn ingetrokken. `}
            Bij de eerstvolgende login kiest deze persoon meteen zelf een wachtwoord.
          </p>
        </div>
      ) : null}

      {loading ? (
        <p className="muted">Laden…</p>
      ) : accounts.length === 0 ? (
        <p className="muted">Nog geen logins in deze organisatie.</p>
      ) : (
        <>
          {pending > 0 ? (
            <p className="muted" role="status">
              {pending === 1
                ? '1 login zit nog op een tijdelijk wachtwoord.'
                : `${pending} logins zitten nog op een tijdelijk wachtwoord.`}
            </p>
          ) : null}
          <ul className="token-list">
            {accounts.map((account) => (
              <li key={account.id} className="token-list__item">
                <div className="token-list__info">
                  <span className="token-list__name">{account.name ?? account.email}</span>
                  <span className="muted">
                    {account.email} · {account.role === 'ADMIN' ? 'beheerder' : 'begeleider'}
                  </span>
                </div>
                <div className="token-list__info">
                  {account.mustChangePassword ? (
                    <span className="badge badge--warn">tijdelijk wachtwoord</span>
                  ) : null}
                  {account.emailVerified ? null : (
                    <span className="badge badge--expired">e-mail niet bevestigd</span>
                  )}
                  {account.id === currentAccountId ? (
                    <span className="muted">jouw login</span>
                  ) : confirmingId === account.id ? (
                    <>
                      <button
                        className="button button--danger"
                        type="button"
                        disabled={busyId === account.id}
                        onClick={() => void handleReset(account.id)}
                      >
                        {`Ja, ${account.name ?? account.email} uitloggen`}
                      </button>
                      <button
                        className="button"
                        type="button"
                        onClick={() => setConfirmingId(null)}
                      >
                        Annuleren
                      </button>
                    </>
                  ) : (
                    <button
                      className="button"
                      type="button"
                      onClick={() => setConfirmingId(account.id)}
                    >
                      {`Nieuw tijdelijk wachtwoord voor ${account.name ?? account.email}`}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
