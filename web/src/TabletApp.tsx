import { useEffect, useRef, useState } from 'react';
import type {
  AacSymbol,
  ConversationConfirmResponse,
  ConversationGenerateResponse,
  ConversationStateResponse,
  DeviceSessionResponse,
  UserPublic,
} from '@intento/shared';
import { ApiRequestError, apiUrl, httpApi, isAiWaitingError, type DeviceApi } from './api.ts';

/** Wachttijd (ms) waarop we terugvallen als de backend er geen meestuurt. */
const DEFAULT_WAIT_MS = 3000;

/** Belofte die na `ms` milliseconden oplost; gebruikt om tussen polls rustig te wachten (T5.7). */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Rustige wachtstand terwijl een AI-worker de aanvraag oppakt (T5.7, DESIGN §9.4: "even wachten"
 * i.p.v. een harde fout). De backend antwoordt bij een volle wachtrij met `503 AI_WORKER_BUSY`
 * (of `AI_WORKER_UNAVAILABLE`); de app toont dan dit scherm en polt de laatste actie automatisch
 * opnieuw tot er een vraag/voorstel terugkomt. `position` (indien bekend) geeft de plek in de rij.
 */
function WaitingScreen({ position }: { position?: number }): React.JSX.Element {
  return (
    <main className="tablet">
      <section className="tablet__waiting" role="status" aria-live="polite">
        <p className="tablet__waiting-icon" aria-hidden="true">
          ⏳
        </p>
        <h1 className="tablet__prompt">Even geduld…</h1>
        <p className="muted">Ik denk rustig na. Zodra ik zover ben, gaat het vanzelf verder.</p>
        {typeof position === 'number' && position > 1 ? (
          <p className="muted">Nog even wachten — je bent bijna aan de beurt (plek {position}).</p>
        ) : null}
      </section>
    </main>
  );
}

/**
 * Ondersteuningsmodus-indicator (T7.2, DESIGN §3.3, FR-011). Staat de gebruiker in ondersteuningsmodus
 * (`supportMode` in het communicatieprofiel), dan tikt de begeleider aan namens de gebruiker — de
 * betekenis blijft van de gebruiker. De app toont dat expliciet zodat het voor iedereen zichtbaar is.
 * Rendert niets als de modus uitstaat.
 */
function SupportModeBanner({ active }: { active: boolean }): React.JSX.Element | null {
  if (!active) return null;
  return (
    <p className="tablet__support" role="note">
      <span aria-hidden="true">🤝 </span>Ondersteuningsmodus actief
    </p>
  );
}

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
 * in het profiel aanstaat (T2.4).
 *
 * Wanneer de route een eindconcept bereikt (`done`), toont de app het **voorstelscherm** (T4.3):
 * de gekozen pictogramreeks + de gegenereerde zin met ✅ Bevestigen / ❌ Nee. Bevestigen rondt de
 * sessie af en slaat de boodschap op; ❌ start de **correctieflow** (T5.4): de server heranalyseert de
 * route, rolt de vermoedelijke foutstap terug en toont een gerichtere hervraag — niet terug naar het
 * begin, en het afgewezen concept wordt niet opnieuw aangeboden (er wordt niets opgeslagen).
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
  const [confirmed, setConfirmed] = useState<ConversationConfirmResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<{ position?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Voorkomt state-updates na unmount tijdens een lopende poll-lus (T5.7): de wachtlus kan seconden
  // duren, en de tablet kan intussen weg-navigeren.
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Verpakt een gesprekscall die een nieuwe toestand teruggeeft: fouten netjes tonen, dubbele taps
  // blokkeren en een eventueel bevestigd-scherm opheffen (we keren terug naar de keuzeflow).
  //
  // Reageert de backend met een AI-wachtrij-503 (`AI_WORKER_BUSY`/`AI_WORKER_UNAVAILABLE`, T5.7),
  // dan tonen we geen fout maar een rustige wachtstand en proberen we dezelfde actie na de
  // voorgestelde wachttijd automatisch opnieuw, tot er een echt antwoord (vraag/voorstel) komt.
  async function run(action: () => Promise<ConversationStateResponse>): Promise<void> {
    setError(null);
    setBusy(true);
    setConfirmed(null);
    try {
      for (;;) {
        try {
          const next = await action();
          if (!mountedRef.current) return;
          setWaiting(null);
          setState(next);
          return;
        } catch (err) {
          if (!isAiWaitingError(err)) throw err;
          if (!mountedRef.current) return;
          setWaiting({ position: err.position });
          await delay(err.retryAfterMs ?? DEFAULT_WAIT_MS);
          if (!mountedRef.current) return;
          // Volgende ronde: dezelfde actie opnieuw pollen.
        }
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setWaiting(null);
      setError(err instanceof ApiRequestError ? err.message : 'Er ging iets mis. Probeer opnieuw.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  // Een gesprek beginnen: eerst kijken of een begeleider een vraag heeft klaargezet (vraagmodus, T7.1);
  // zo ja, dan pakt de app die vraag op ("verschijnt in de gebruikersapp"), anders start een vrij gesprek.
  async function beginConversation(): Promise<ConversationStateResponse> {
    const pending = await api.getPendingQuestion();
    return pending.state ?? api.startConversation();
  }

  // Eenmalig bij binnenkomst (of bij een nieuwe `api`) een gesprek beginnen.
  useEffect(() => {
    void run(() => beginConversation());
  }, [api]);

  // Na bevestiging: de opgeslagen boodschap tonen met de mogelijkheid opnieuw te beginnen.
  if (confirmed) {
    return (
      <main className="tablet">
        <section className="tablet__done">
          <h1 className="tablet__prompt">Boodschap bevestigd</h1>
          <p className="tablet__message">{confirmed.message}</p>
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={() => void run(() => beginConversation())}
          >
            Opnieuw beginnen
          </button>
        </section>
      </main>
    );
  }

  // Wachten op een AI-worker (T5.7): rustige wachtstand i.p.v. een fout; de poll-lus in `run`
  // herstelt automatisch zodra er een antwoord is.
  if (waiting) {
    return <WaitingScreen position={waiting.position} />;
  }

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

  // Route bij een eindconcept: het voorstelscherm neemt het over (genereert zelf de boodschap).
  if (state.done) {
    return (
      <ProposalScreen
        api={api}
        sessionId={state.sessionId}
        showText={profile.showText}
        supportMode={profile.supportMode}
        onConfirmed={setConfirmed}
        onReject={() => void run(() => api.conversationCorrection(state.sessionId))}
      />
    );
  }

  const hasHistory = state.history.length > 0;
  // De engine levert de volledige kindset; de tablet toont er hooguit `iconsPerScreen`. Welke opties
  // getoond worden is in T4.2 simpelweg de eerste N; de AI kiest later de meest relevante (T5.2).
  const options = state.question ? state.question.options.slice(0, profile.iconsPerScreen) : [];

  return (
    <main className="tablet">
      <SupportModeBanner active={profile.supportMode} />

      {state.caregiverQuestion ? (
        <p className="tablet__question" role="note">
          <span aria-hidden="true">🗨️ </span>
          Je begeleider vraagt: <strong>{state.caregiverQuestion}</strong>
        </p>
      ) : null}

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
      ) : null}

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
 * Voorstelscherm (T4.3, DESIGN §5.2): toont de gekozen pictogramreeks + de geformuleerde zin, met
 * ✅ Bevestigen en ❌ Nee. Genereert de boodschap zelf bij binnenkomst (`/generate`, vluchtig — er wordt
 * niets opgeslagen tot bevestiging). Bevestigen rondt de sessie af (`onConfirmed`); ❌ start de
 * correctieflow (`onReject` → `/correction`, T5.4): een gerichtere hervraag, waarna er niets bewaard is.
 */
function ProposalScreen({
  api,
  sessionId,
  showText,
  supportMode,
  onConfirmed,
  onReject,
}: {
  api: DeviceApi;
  sessionId: string;
  showText: boolean;
  supportMode: boolean;
  onConfirmed: (result: ConversationConfirmResponse) => void;
  onReject: () => void;
}): React.JSX.Element {
  const [proposal, setProposal] = useState<ConversationGenerateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<{ position?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bij binnenkomst het voorstel ophalen. `active` voorkomt een state-update na unmount.
  // Ook `/generate` loopt via de AI-orchestrator en kan een wachtrij-503 geven (T5.7): dan tonen we
  // de rustige wachtstand en pollen we automatisch opnieuw tot de zin er is.
  useEffect(() => {
    let active = true;
    void (async () => {
      for (;;) {
        try {
          const result = await api.conversationGenerate(sessionId);
          if (!active) return;
          setWaiting(null);
          setProposal(result);
          return;
        } catch (err) {
          if (!active) return;
          if (isAiWaitingError(err)) {
            setWaiting({ position: err.position });
            await delay(err.retryAfterMs ?? DEFAULT_WAIT_MS);
            if (!active) return;
            continue;
          }
          setError(
            err instanceof ApiRequestError ? err.message : 'Er ging iets mis. Probeer opnieuw.',
          );
          return;
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [api, sessionId]);

  async function confirm(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      onConfirmed(await api.conversationConfirm(sessionId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Er ging iets mis. Probeer opnieuw.');
      setBusy(false);
    }
  }

  if (waiting) {
    return <WaitingScreen position={waiting.position} />;
  }

  if (!proposal) {
    return (
      <main className="tablet">
        {error ? (
          <p className="form__error" role="alert">
            {error}
          </p>
        ) : (
          <p className="muted">Even nadenken…</p>
        )}
      </main>
    );
  }

  return (
    <main className="tablet">
      <SupportModeBanner active={supportMode} />

      <div className="proposal__symbols" aria-hidden="true">
        {proposal.symbols.map((symbol, index) => (
          <img
            key={`${symbol.id}-${index}`}
            className="proposal__symbol"
            src={apiUrl(symbol.imageUrl)}
            alt=""
            width={96}
            height={96}
          />
        ))}
      </div>

      <h1 className="tablet__prompt">{proposal.message}</h1>
      {showText ? <p className="muted">Klopt dit?</p> : null}

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="proposal__actions">
        <button
          className="button button--primary"
          type="button"
          disabled={busy}
          aria-label="Bevestigen"
          onClick={() => void confirm()}
        >
          ✅ Ja
        </button>
        <button
          className="button"
          type="button"
          disabled={busy}
          aria-label="Nee, klopt niet"
          onClick={onReject}
        >
          ❌ Nee
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
