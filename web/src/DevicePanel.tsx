import { useState } from 'react';
import type { DeviceCodeResponse } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Het adres waarop de gebruikersapp draait: hetzelfde web-adres met `tablet` erachter (zie
 * `routes.tsx`). Injecteerbaar in tests. Buiten de browser (SSR/test zonder DOM) valt hij terug op het
 * pad alleen, zodat er nooit een half adres wordt getoond.
 *
 * Het pad komt uit `import.meta.env.BASE_URL` en is niet hardgecodeerd: staat de app achter een
 * reverse proxy onder een prefix (`https://host/intento/`), dan hoort de begeleider dát adres op de
 * tablet in te tikken en niet `https://host/tablet`. BASE_URL eindigt altijd op een slash.
 */
export function tabletUrl(origin: string | undefined = globalThis.location?.origin): string {
  const path = `${import.meta.env.BASE_URL}tablet`;
  return origin ? `${origin.replace(/\/+$/, '')}${path}` : path;
}

/**
 * Tablet koppelen aan een gebruiker (T2.3, DESIGN §3.7 stap 5, §5.2, FR-018). Een beheerder
 * genereert hier een koppelcode; die code wordt één keer getoond en voert de begeleider op de
 * tablet in (`POST /devices/link`), waarna het apparaat direct in de gebruikersapp start zonder
 * dagelijkse login. De code is eenmalig en verloopt — daarom staat er een duidelijke waarschuwing
 * en tonen we het vervalmoment. De code is daarna niet opnieuw op te vragen (alleen gehasht in de db).
 *
 * Naast de code staat het **adres** waarop de code ingevoerd wordt (T9.2): in de gebruikerstest bleek
 * de code op zichzelf niet genoeg — zonder het pad `/tablet` weet je niet waar je hem kwijt moet.
 */
export function DevicePanel({
  api,
  userId,
  userName,
}: {
  api: Api;
  userId: string;
  userName: string;
}): React.JSX.Element {
  const [result, setResult] = useState<DeviceCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleGenerate(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      setResult(await api.generateDeviceCode(userId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Genereren mislukt.');
    } finally {
      setBusy(false);
    }
  }

  const expiresAt = result ? new Date(result.expiresAt) : null;

  return (
    <section className="panel" aria-label={`Tablet koppelen voor ${userName}`}>
      <h2 className="panel__subtitle">Tablet koppelen</h2>
      <p className="muted">
        Genereer een koppelcode en voer die in op de tablet. Daarna start de tablet direct in de app
        zonder dagelijkse login.
      </p>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        className="button button--primary"
        type="button"
        onClick={() => void handleGenerate()}
        disabled={busy}
      >
        {result ? 'Nieuwe koppelcode' : 'Koppelcode genereren'}
      </button>

      {result && expiresAt ? (
        <div className="device-code" role="status">
          <p className="muted">Open op de tablet dit adres:</p>
          <p className="device-code__url">{tabletUrl()}</p>
          <p className="muted">…en voer daar deze code in (eenmalig):</p>
          <p className="device-code__value">{result.code}</p>
          <p className="muted">
            Geldig tot{' '}
            {expiresAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}. Een
            nieuwe code laten genereren maakt deze ongeldig.
          </p>
        </div>
      ) : null}
    </section>
  );
}
