import { useCallback, useEffect, useState } from 'react';
import type { AccountPublic } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Accountlijst van de organisatie (T2.6, DESIGN §2, §5.2, §9.4).
 *
 * De beheerder maakt begeleiders aan met een **tijdelijk** wachtwoord (T2.4) dat hij zelf te zien
 * krijgt. Zolang de begeleider dat niet vervangt, kennen twee mensen die login — en tot nu toe was
 * dat nergens zichtbaar. Deze lijst maakt het zichtbaar: per login een markering "tijdelijk
 * wachtwoord" (blijft tot de houder zelf een wachtwoord kiest) en "e-mail niet bevestigd" (T1.4).
 *
 * Bewust alléén tonen, geen knop om het wachtwoord te resetten: een beheerder kan het wachtwoord
 * van een ander nooit zetten (dat is de kern van T2.5). Hij ziet hier wie hij eraan moet herinneren.
 */
export function AccountsPanel({
  api,
  refreshToken,
}: {
  api: Api;
  /** Wijzigt zodra er elders een account is aangemaakt (T2.4), zodat de lijst meteen klopt. */
  refreshToken: number;
}): React.JSX.Element {
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const pending = accounts.filter((account) => account.mustChangePassword).length;

  return (
    <section className="panel" aria-label="Logins in deze organisatie">
      <h2 className="panel__subtitle">Logins</h2>
      <p className="muted">
        Alle accounts van deze organisatie. Een login met de markering{' '}
        <strong>tijdelijk wachtwoord</strong> draait nog op het wachtwoord dat jij bij het aanmaken
        te zien kreeg — die persoon kan pas verder als hij zelf een wachtwoord kiest.
      </p>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
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
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
