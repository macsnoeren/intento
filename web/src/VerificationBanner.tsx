import { useState } from 'react';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Herinneringsbanner (T1.4) voor een ingelogd account dat zijn e-mailadres nog niet heeft
 * bevestigd. Toont een "opnieuw versturen"-knop die `POST /auth/verify-email/resend` aanroept.
 * De backend antwoordt altijd neutraal (geen account-enumeratie), dus we tonen een generieke
 * bevestiging ongeacht de uitkomst.
 */
export function VerificationBanner({ api, email }: { api: Api; email: string }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function resend(): Promise<void> {
    setError(null);
    setState('busy');
    try {
      await api.resendVerification(email);
      setState('sent');
    } catch (err) {
      setState('idle');
      setError(err instanceof ApiRequestError ? err.message : 'Versturen mislukt.');
    }
  }

  return (
    <div className="banner banner--warning" role="alert">
      <span>
        Je e-mailadres is nog niet bevestigd. Sommige acties zijn geblokkeerd tot je verifieert.
      </span>{' '}
      {state === 'sent' ? (
        <span>Als het adres bekend is, is er een nieuwe verificatiemail verstuurd.</span>
      ) : (
        <button
          className="button button--link"
          type="button"
          onClick={() => void resend()}
          disabled={state === 'busy'}
        >
          {state === 'busy' ? 'Bezig…' : 'Verificatiemail opnieuw versturen'}
        </button>
      )}
      {error ? (
        <span className="form__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
