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
import { AiStatusBadge } from './AiStatusBadge.tsx';

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
 * één keuze per scherm. Toont per scherm hooguit `iconsPerScreen` opties uit het communicatieprofiel —
 * de rest blijft bereikbaar via "Meer keuzes" (T9.6) — en de tekstlabels alleen als `showText`
 * aanstaat. `↩ Terug` maakt de laatste keuze ongedaan, "🤷 Staat er niet bij" slaat dit punt over (T9.12)
 * en "✅ Dit is genoeg" rondt af met de route zoals hij is (T10.11); de contextindicator (broodkruimel van
 * het afgelegde pad) verschijnt alleen als `contextIndicator` in het profiel aanstaat (T2.4).
 *
 * Wanneer de route een eindconcept bereikt (`done`), toont de app het **voorstelscherm** (T4.3):
 * de gekozen pictogramreeks + de gegenereerde zin met ✅ Bevestigen / ❌ Nee. Bevestigen rondt de
 * sessie af en slaat de boodschap op; ❌ start de **correctieflow** (T5.4/T10.10): de server rolt precies
 * één stap terug en toont een nieuwe vraag op dat punt — niet terug naar het begin, en het afgewezen
 * concept wordt niet opnieuw aangeboden (er wordt niets opgeslagen).
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
  // Welke "pagina" met opties op dit scherm staat (T9.6). Het profiel bepaalt hoeveel pictogrammen er
  // tegelijk mogen staan (`iconsPerScreen`); de overige opties zijn via "Meer keuzes" bereikbaar in
  // plaats van stilzwijgend weg te vallen. Elke nieuwe vraag begint weer op pagina 0.
  const [optionPage, setOptionPage] = useState(0);

  // Voorkomt state-updates na unmount tijdens een lopende poll-lus (T5.7): de wachtlus kan seconden
  // duren, en de tablet kan intussen weg-navigeren. De vlag gaat in de effectbody weer op `true`,
  // niet alleen bij de declaratie (T8.5): onder `<StrictMode>` mount React elk component dubbel
  // (mount → unmount → remount), en zonder deze regel bleef de vlag na de gesimuleerde unmount
  // `false` — waarna elke setState werd overgeslagen en het scherm eeuwig op "Laden…" bleef staan.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
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
          // Nieuwe vraag = weer bij de eerste, meest waarschijnlijke opties beginnen (T9.6).
          setOptionPage(0);
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

  /**
   * Een (nieuw) gesprek starten. De oude toestand gaat er **eerst** uit (T9.13): `run` haalt alleen het
   * bevestigd-scherm weg, en zolang het nieuwe gesprek nog onderweg is stond de oude `state` er dan nog —
   * met `done: true`. Daardoor mountte het voorstelscherm opnieuw op de zojuist **bevestigde** sessie en
   * riep het `/generate` aan, wat "Dit gesprek is al afgerond." (409) gaf, precies zoals in de
   * gebruikerstest. Met `state = null` toont de app netjes het laadscherm tot het nieuwe gesprek er is.
   */
  function restart(): void {
    setState(null);
    void run(() => beginConversation());
  }

  // Eenmalig bij binnenkomst (of bij een nieuwe `api`) een gesprek beginnen.
  useEffect(() => {
    restart();
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
            onClick={restart}
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
  // De engine/AI levert de volledige, op zekerheid geordende kandidatenset; het communicatieprofiel
  // bepaalt hoeveel pictogrammen er tegelijk op het scherm mogen (`iconsPerScreen`). Tot T9.6 werden de
  // overige opties simpelweg afgekapt — met vijf intenties en de standaard van vier viel "Iets zeggen"
  // daardoor onzichtbaar weg en was die nooit te kiezen. Nu blijven de schermen even rustig, maar zijn
  // de resterende opties via "Meer keuzes" bereikbaar (rondlopend terug naar de eerste pagina).
  const allOptions = state.question ? state.question.options : [];
  const perScreen = Math.max(1, profile.iconsPerScreen);
  const pageCount = Math.max(1, Math.ceil(allOptions.length / perScreen));
  const page = Math.min(optionPage, pageCount - 1);
  const options = allOptions.slice(page * perScreen, page * perScreen + perScreen);
  const hasMoreOptions = pageCount > 1;
  const onLastPage = page === pageCount - 1;

  return (
    <main className="tablet">
      {/* Zichtbaar of er echt een AI meedenkt (T9.4) — anders is niet te zien dat de app op de
          deterministische mock draait of dat er geen worker actief is. */}
      <div className="tablet__status">
        <AiStatusBadge api={api} />
      </div>

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
        {hasMoreOptions ? (
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => setOptionPage((current) => (current + 1) % pageCount)}
          >
            {onLastPage ? '↺ Eerste keuzes' : '➕ Meer keuzes'}
          </button>
        ) : null}
        {/* Uitweg als het juiste pictogram er niet tussen staat (T9.12). Bewust een knop in de balk en
            geen extra pictogram in het keuzeraster: dat raster bevat uitsluitend AAC-concepten die
            samen de boodschap vormen, en dit is bediening. */}
        {state.question ? (
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() => api.conversationCorrection(state.sessionId, 'no_fitting_option'))
            }
          >
            🤷 Staat er niet bij
          </button>
        ) : null}

        {/* "Dit is genoeg" (T10.11): de route zegt al genoeg, ook al zou de AI nog willen verfijnen.
            Sinds T10.10 stelt de server pas een boodschap voor als er niets meer te verfijnen valt —
            zonder deze knop zou "Ik wil eten." onbereikbaar zijn, terwijl dat in AAC een volwaardige
            boodschap is. De server bepaalt wanneer de knop mag verschijnen (`canFinish`): pas na een
            eigen keuze van de gebruiker, want een boodschap uit alleen het anker van de begeleider is
            niet van hem (DESIGN §2). */}
        {state.canFinish ? (
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={() => void run(() => api.conversationEnough(state.sessionId))}
          >
            ✅ Dit is genoeg
          </button>
        ) : null}

        {/* Helemaal opnieuw beginnen (T10.12). Stond alleen op het bevestigd-scherm, dus wie midden in
            een gesprek vastliep had geen uitweg: "↩ Terug" gaat één stap, maar niet terug naar af. Een
            gebruiker die merkt dat het spoor bijster is, moet niet eerst een boodschap hoeven bevestigen
            die hij niet bedoelt. Rechts in de balk, weg van de keuzeknoppen. */}
        <button className="button tablet__bar-end" type="button" disabled={busy} onClick={restart}>
          🔄 Opnieuw beginnen
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
    // Een fout van een vórige sessie mag hier niet blijven staan (T9.13): het voorstelscherm bleef
    // anders "Dit gesprek is al afgerond." tonen nadat er allang een nieuw gesprek liep.
    setError(null);
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
  // Een nieuw woord (T10.6, DESIGN §7.6 trap 3) is door de AI aangedragen omdat het begrip nog niet in
  // de bibliotheek stond. Dat wordt zichtbaar gemarkeerd: de gebruiker mag zien dat dit geen vertrouwd
  // pictogram is maar een suggestie — hij kiest het nog steeds zelf (DESIGN §7.8). De markering staat
  // ook in het `aria-label`, zodat ze niet alleen visueel is.
  const label = symbol.isNew ? `${symbol.label} (nieuw woord)` : symbol.label;
  return (
    <button
      className={symbol.isNew ? 'option option--new' : 'option'}
      type="button"
      disabled={disabled}
      aria-label={label}
      onClick={onSelect}
    >
      {symbol.isNew ? (
        <span className="option__badge" aria-hidden="true" title="Nieuw woord">
          ✨
        </span>
      ) : null}
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
