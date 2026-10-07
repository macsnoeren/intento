import { useEffect, useState } from 'react';
import { ApiRequestError, httpApi, type Api } from './api.ts';
import { AuthLayout } from './AuthLayout.tsx';

/**
 * Openbare bevestigingspagina voor een contact (N10.2, INTENTO-NEW-DESIGN §28, V5).
 *
 * Het contact komt hier via de link in de bevestigingsmail (`/contact-bevestigen?token=…`). De pagina
 * kijkt eerst alleen of de link nog werkt (een GET die niets verandert) en vraagt dan expliciet om een
 * klik op "Ja": pas die POST geeft toestemming. Zo kan een mailscanner die links vooraf opent geen
 * toestemming geven namens het contact. Er staat niets op over de gebruiker of de organisatie.
 */
export function ContactVerifyPage({
  api = httpApi,
  token = new URLSearchParams(window.location.search).get('token') ?? '',
}: {
  api?: Api;
  token?: string;
}): React.JSX.Element {
  const [state, setState] = useState<'checking' | 'ready' | 'busy' | 'done' | 'invalid'>(
    'checking',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!token) {
      setState('invalid');
      return;
    }
    api
      .checkContactVerification(token)
      .then(({ valid }) => {
        if (active) setState(valid ? 'ready' : 'invalid');
      })
      .catch(() => {
        if (active) setState('invalid');
      });
    return () => {
      active = false;
    };
  }, [api, token]);

  async function confirm(): Promise<void> {
    setState('busy');
    setError(null);
    try {
      await api.confirmContact(token);
      setState('done');
    } catch (err) {
      setState('ready');
      setError(
        err instanceof ApiRequestError ? err.message : 'Dat lukte niet. Probeer het opnieuw.',
      );
    }
  }

  return (
    <AuthLayout title="Berichten ontvangen via Intento">
      {state === 'checking' ? <p className="muted">Even kijken…</p> : null}
      {state === 'ready' || state === 'busy' ? (
        <>
          <p>
            Iemand die moeilijk kan praten, wil je met Intento een bericht kunnen sturen. Wil je die
            berichten per e-mail ontvangen?
          </p>
          {error ? (
            <p className="form__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form__actions">
            <button
              className="button button--primary"
              type="button"
              disabled={state === 'busy'}
              onClick={() => void confirm()}
            >
              Ja, ik wil berichten ontvangen
            </button>
          </div>
          <p className="muted">Wil je dit niet? Sluit dan deze pagina; er gebeurt dan niets.</p>
        </>
      ) : null}
      {state === 'done' ? (
        <p role="status">Dank je. Je ontvangt voortaan berichten per e-mail.</p>
      ) : null}
      {state === 'invalid' ? (
        <p className="form__error" role="alert">
          Deze link werkt niet meer: hij is al gebruikt of verlopen. Vraag degene die je toevoegde
          om een nieuwe bevestigingsmail.
        </p>
      ) : null}
    </AuthLayout>
  );
}
