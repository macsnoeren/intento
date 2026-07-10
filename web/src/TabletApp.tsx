import { useEffect, useState } from 'react';
import type {
  AacSymbol,
  ConversationStateResponse,
  DeviceSessionResponse,
  UserPublic,
} from '@intento/shared';
import { ApiRequestError, apiUrl, httpApi, type DeviceApi } from './api.ts';

/**
 * Gebruikersapp op de tablet (T4.2, DESIGN §5.1–5.3, FR-001/003).
 *
 * Dit is de **derde interface** naast de beheeromgeving (`App.tsx`) en de latere
 * begeleiderinterface. Ze draait op **device-auth**: het apparaat is aan één gebruiker gekoppeld
 * (T2.3) en start daarna direct in de gespreksflow zonder dagelijkse login. Bij het openen wordt
 * eerst de apparaat-sessie opgehaald (`GET /device/me`); ontbreekt die, dan verschijnt het
 * koppelscherm om een koppelcode in te wisselen.
 *
 * De gespreksflow zelf loopt op de gescripte engine (T4.1) achter dezelfde interface die later de
 * AI-orchestrator krijgt. Deze UI toont per scherm precies één vraag met grote pictogramopties,
 * begrensd door het communicatieprofiel (`iconsPerScreen`, `showText`), en biedt altijd `↩ Terug`.
 *
 * `api` is injecteerbaar zodat tests een in-memory backend kunnen meegeven.
 */
export function TabletApp({ api = httpApi }: { api?: DeviceApi } = {}): React.JSX.Element {
  const [session, setSession] = useState<DeviceSessionResponse | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const found = await api.deviceMe();
        if (active) setSession(found);
      } catch (err) {
        // 401 = nog geen gekoppeld apparaat (verwacht) → koppelscherm. Andere fouten negeren we
        // hier en tonen eveneens het koppelscherm.
        if (!(err instanceof ApiRequestError)) throw err;
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  if (checking) {
    return (
      <main className="panel panel--narrow">
        <p className="muted">Laden…</p>
      </main>
    );
  }

  if (!session) {
    return <DeviceLinkScreen api={api} onLinked={setSession} />;
  }

  return <ConversationScreen api={api} user={session.user} />;
}

/**
 * Koppelscherm: de tablet is nog niet gekoppeld. De begeleider genereert een koppelcode in de
 * beheeromgeving (T2.3); die wordt hier ingewisseld voor een apparaat-token. Na succes start de
 * gebruikersapp direct.
 */
function DeviceLinkScreen({
  api,
  onLinked,
}: {
  api: DeviceApi;
  onLinked: (session: DeviceSessionResponse) => void;
}): React.JSX.Element {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onLinked(await api.linkDevice(code));
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Koppelen mislukt. Probeer het opnieuw.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="panel panel--narrow">
      <h1 className="panel__title">Intento</h1>
      <p>Voer de koppelcode in die je in de beheeromgeving hebt aangemaakt.</p>
      <form className="form" aria-label="Tablet koppelen" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span className="field__label">Koppelcode</span>
          <input
            className="field__input"
            name="code"
            autoComplete="off"
            autoCapitalize="characters"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        {error ? (
          <p className="form__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form__actions">
          <button
            className="button button--primary"
            type="submit"
            disabled={busy || code.trim().length === 0}
          >
            Koppelen
          </button>
        </div>
      </form>
    </main>
  );
}

/**
 * Gespreksscherm: startscherm (intentie-categorieën) en keuzescherm (vraag + N pictogramopties),
 * één keuze per scherm. Toont de opties begrensd tot `iconsPerScreen` uit het communicatieprofiel
 * en de tekstlabels alleen als `showText` aanstaat. `↩ Terug` maakt de laatste keuze ongedaan; de
 * contextindicator (broodkruimel van het afgelegde pad) verschijnt alleen als `contextIndicator`
 * in het profiel aanstaat (T2.4). Wanneer de route een eindconcept bereikt (`done`), is
 * er (nog) geen volgende vraag — het voorstellen/bevestigen van een boodschap volgt in T4.3.
 */
function ConversationScreen({
  api,
  user,
}: {
  api: DeviceApi;
  user: UserPublic;
}): React.JSX.Element {
  const profile = user.communicationProfile;
  const [state, setState] = useState<ConversationStateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Verpakt een gesprekscall: fouten netjes tonen en dubbele taps blokkeren tijdens het laden.
  async function run(action: () => Promise<ConversationStateResponse>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      setState(await action());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Er ging iets mis. Probeer opnieuw.');
    } finally {
      setBusy(false);
    }
  }

  // Eenmalig bij binnenkomst (of bij een nieuwe `api`) een gesprek starten.
  useEffect(() => {
    void run(() => api.startConversation());
  }, [api]);

  if (!state) {
    return (
      <main className="tablet">
        {error ? (
          <p className="form__error" role="alert">
            {error}
          </p>
        ) : (
          <p className="muted">Laden…</p>
        )}
      </main>
    );
  }

  const hasHistory = state.history.length > 0;
  // De engine levert de volledige kindset; de tablet toont er hooguit `iconsPerScreen`. Welke opties
  // getoond worden is in T4.2 simpelweg de eerste N; de AI kiest later de meest relevante (T5.2).
  const options = state.question ? state.question.options.slice(0, profile.iconsPerScreen) : [];

  return (
    <main className="tablet">
      {hasHistory && profile.contextIndicator ? (
        <nav className="breadcrumb" aria-label="Gekozen pad">
          {state.history.map((step) => (
            <span key={step.order} className="breadcrumb__item">
              <span aria-hidden="true">{step.symbol.glyph}</span> {step.symbol.label}
            </span>
          ))}
        </nav>
      ) : null}

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      {state.question ? (
        <>
          <h1 className="tablet__prompt">{state.question.prompt}</h1>
          <div className="option-grid" role="group" aria-label={state.question.prompt}>
            {options.map((symbol) => (
              <OptionButton
                key={symbol.id}
                symbol={symbol}
                showText={profile.showText}
                disabled={busy}
                onSelect={() => void run(() => api.conversationNext(state.sessionId, symbol.id))}
              />
            ))}
          </div>
        </>
      ) : (
        <section className="tablet__done">
          <h1 className="tablet__prompt">Klaar met kiezen</h1>
          <p className="muted">
            Het voorstellen en bevestigen van de boodschap komt in een volgende stap.
          </p>
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={() => void run(() => api.startConversation())}
          >
            Opnieuw beginnen
          </button>
        </section>
      )}

      <div className="tablet__bar">
        <button
          className="button"
          type="button"
          disabled={busy || !hasHistory}
          onClick={() => void run(() => api.conversationBack(state.sessionId))}
        >
          ↩ Terug
        </button>
      </div>
    </main>
  );
}

/**
 * Eén grote pictogramkeuze: afbeelding (altijd) met optioneel tekstlabel eronder. Groot klikvlak,
 * voorbereid op beperkte motoriek en toekomstige oogbesturing (DESIGN §5.1). De afbeelding heeft
 * altijd een tekstalternatief (`alt`) voor toegankelijkheid, ook als de zichtbare tekst uitstaat.
 */
function OptionButton({
  symbol,
  showText,
  disabled,
  onSelect,
}: {
  symbol: AacSymbol;
  showText: boolean;
  disabled: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      className="option"
      type="button"
      disabled={disabled}
      aria-label={symbol.label}
      onClick={onSelect}
    >
      <img
        className="option__image"
        src={apiUrl(symbol.imageUrl)}
        alt=""
        width={120}
        height={120}
      />
      {showText ? <span className="option__label">{symbol.label}</span> : null}
    </button>
  );
}
