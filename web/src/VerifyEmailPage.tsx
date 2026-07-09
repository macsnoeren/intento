import { useEffect, useState } from 'react';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Verificatiepagina (T1.4). De verificatiemail bevat een link naar de web-app met `?token=…`;
 * deze pagina wisselt dat token in via `POST /auth/verify-email` en toont het resultaat. Zo
 * gebeurt de statuswijziging op een POST (niet op de kale GET van de linkklik zelf), terwijl de
 * gebruiker toch gewoon op de link in de mail kan klikken.
 *
 * `onDone` brengt de gebruiker terug naar de normale app (login/beheer), waar het account
 * inmiddels als geverifieerd geldt.
 */
export function VerifyEmailPage({
  api,
  token,
  onDone,
}: {
  api: Api;
  token: string;
  onDone: () => void;
}): React.JSX.Element {
  const [status, setStatus] = useState<'busy' | 'ok' | 'error'>('busy');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await api.verifyEmail(token);
        if (active) setStatus('ok');
      } catch (err) {
        if (!active) return;
        setStatus('error');
        setMessage(
          err instanceof ApiRequestError
            ? err.message
            : 'Verifiëren mislukt. Probeer het later opnieuw.',
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [api, token]);

  return (
    <main className="panel panel--narrow">
      <h1 className="panel__title">E-mailadres bevestigen</h1>
      {status === 'busy' ? <p className="muted">Bezig met bevestigen…</p> : null}
      {status === 'ok' ? (
        <p role="status">Je e-mailadres is bevestigd. Je kunt nu alle functies gebruiken.</p>
      ) : null}
      {status === 'error' ? (
        <p className="form__error" role="alert">
          {message}
        </p>
      ) : null}
      {status !== 'busy' ? (
        <button className="button button--primary" type="button" onClick={onDone}>
          Doorgaan
        </button>
      ) : null}
    </main>
  );
}
