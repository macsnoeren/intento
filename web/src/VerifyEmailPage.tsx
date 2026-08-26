import { useEffect, useRef, useState } from 'react';
import { ApiRequestError, type Api } from './api.ts';
import { AuthLayout } from './AuthLayout.tsx';

/**
 * Verificatiepagina (T1.4). De verificatiemail bevat een link naar de web-app met `?token=…`;
 * deze pagina wisselt dat token in via `POST /auth/verify-email` en toont het resultaat. Zo
 * gebeurt de statuswijziging op een POST (niet op de kale GET van de linkklik zelf), terwijl de
 * gebruiker toch gewoon op de link in de mail kan klikken.
 *
 * `onDone` brengt de gebruiker terug naar de normale app (login/beheer), waar het account
 * inmiddels als geverifieerd geldt.
 *
 * Het token is **eenmalig**: een tweede inwisseling van hetzelfde token faalt per definitie. Deze
 * pagina mag het dus hooguit één keer versturen — zie de dedupe-ref hieronder.
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

  // Onthoudt welk token al is ingewisseld, zodat het effect het bij een tweede uitvoering niet
  // opnieuw verstuurt. Nodig omdat React onder `<StrictMode>` (main.tsx, dev) elk component dubbel
  // mount (mount → unmount → remount) en het effect dus twee keer draait: de eerste POST slaagde
  // en maakte het eenmalige token op, waarna de tweede POST terecht "ongeldig of verlopen" kreeg —
  // het account wás geverifieerd, maar de gebruiker zag een foutmelding. Een `active`-vlag lost dit
  // niet op: die onderdrukt alleen het *resultaat* van de eerste POST, niet de tweede POST zelf.
  // Een ref (geen state) omdat de waarde geen hertekening hoort te veroorzaken en meteen na de
  // remount al gezet moet zijn. Verandert het token toch (andere link in hetzelfde tabblad), dan
  // wisselen we dat nieuwe token wél in.
  const exchangedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (exchangedTokenRef.current === token) return;
    exchangedTokenRef.current = token;
    void (async () => {
      try {
        await api.verifyEmail(token);
        setStatus('ok');
      } catch (err) {
        setStatus('error');
        setMessage(
          err instanceof ApiRequestError
            ? err.message
            : 'Verifiëren mislukt. Probeer het later opnieuw.',
        );
      }
    })();
    // Bewust geen opruimvlag: een setState na unmount is in React 18+ een no-op (geen waarschuwing),
    // en juist het onderdrukken van het antwoord veroorzaakte hier de verkeerde foutmelding.
  }, [api, token]);

  return (
    <AuthLayout title="E-mailadres bevestigen">
      {status === 'busy' ? <p className="muted">Bezig met bevestigen…</p> : null}
      {status === 'ok' ? (
        <p role="status">Je e-mailadres is bevestigd. Je kunt nu alle functies gebruiken.</p>
      ) : null}
      {status === 'error' ? (
        <>
          <p className="form__error" role="alert">
            {message}
          </p>
          {/* Een gebruikte link levert dezelfde neutrale fout op als een onbekende (geen
              enumeratie). Deze hint voorkomt dat iemand met een al bevestigd adres blijft
              hangen op "vraag een nieuwe aan". */}
          <p className="muted">
            Heb je deze link al eerder geopend? Dan is je e-mailadres waarschijnlijk al bevestigd en
            kun je gewoon inloggen.
          </p>
        </>
      ) : null}
      {status !== 'busy' ? (
        <button className="button button--primary" type="button" onClick={onDone}>
          Doorgaan
        </button>
      ) : null}
    </AuthLayout>
  );
}
