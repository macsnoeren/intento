import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AacSymbol,
  ConversationConfirmResponse,
  ConversationGenerateResponse,
  ConversationStateResponse,
  DeviceSessionResponse,
  UserPublic,
} from '@intento/shared';
import { ApiRequestError, apiUrl, httpApi, isAiWaitingError, type DeviceApi } from './api.ts';
import { createBrowserSpeech, silentSpeech, type SpeechPort } from './speech.ts';
import { hintText, pickHint, type HintKey } from './speech-hints.ts';
import { AuthLayout } from './AuthLayout.tsx';
import { AiStatusBadge } from './AiStatusBadge.tsx';
import { BrandMark, BRAND_NAME } from './Brand.tsx';

/**
 * Vaste kopbalk van de gebruikersapp (T17.1): linksboven het beeldmerk met de naam, rechtsboven wie
 * er op deze tablet communiceert (en waar van toepassing de AI-indicator).
 *
 * Uit de gebruikerstest: op een gedeelde tablet was nergens te zien wélke app dit is en voor wie hij
 * openstaat. De balk is bewust klein en grijs — het keuzescherm eronder moet de aandacht houden — en
 * bevat geen kop-element, zodat de vraag op het scherm de enige `<h1>` blijft.
 */
function TabletHeader({
  userName,
  children,
}: {
  /** De gebruiker van deze tablet; ontbreekt op schermen van vóór het koppelen. */
  userName?: string;
  /** Extra's rechts in de balk, bv. de AI-indicator. */
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="tablet__header">
      <span className="tablet__brand">
        <BrandMark size={34} />
        <span className="tablet__brand-name">{BRAND_NAME}</span>
      </span>
      <span className="tablet__identity">
        {userName ? <span className="tablet__user">{userName}</span> : null}
        {children}
      </span>
    </header>
  );
}

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
function WaitingScreen({
  position,
  userName,
}: {
  position?: number;
  userName?: string;
}): React.JSX.Element {
  return (
    <main className="tablet">
      <TabletHeader userName={userName} />
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
 * "Nog eens" — herhaalt hardop wat er op dit scherm staat (T18.3).
 *
 * Eén keer horen is voor deze doelgroep vaak te weinig, en de gebruiker mag niet afhankelijk zijn van
 * het toeval dat hij op het juiste moment oplette. De knop verschijnt alleen als spraak aanstaat.
 */
function SpeakAgainButton({
  onSpeak,
  disabled,
}: {
  onSpeak: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <button
      className="button"
      type="button"
      disabled={disabled}
      aria-label="Nog een keer voorlezen"
      onClick={onSpeak}
    >
      🔊 Nog eens
    </button>
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
export function TabletApp({
  api = httpApi,
  speech,
}: {
  api?: DeviceApi;
  /**
   * Spraakuitvoer (T18.3); standaard de echte browser-spraaklaag, injecteerbaar zodat tests kunnen
   * controleren wát er uitgesproken wordt zonder een audio-element (dat in jsdom niet speelt).
   */
  speech?: SpeechPort;
} = {}): React.JSX.Element {
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

  /**
   * De apparaatsessie (en dus het communicatieprofiel) opnieuw ophalen (T18.6).
   *
   * De sessie werd alleen bij het opstarten geladen, waarna de tablet tot een herlaad van de pagina op
   * dát profiel bleef staan. Uit de praktijk: een begeleider zette de stem op Nathalie terwijl de tablet
   * openstond; de tablet bleef de oude keuze gebruiken ("Stem van het apparaat") en het leek alsof de
   * stemkeuze niet werkte. Mislukt het ophalen (even geen netwerk), dan houden we het profiel dat we
   * hebben: doorgaan met oude instellingen is beter dan een gesprek afbreken.
   */
  const refreshSession = useCallback(async (): Promise<void> => {
    try {
      setSession(await api.deviceMe());
    } catch (err) {
      if (!(err instanceof ApiRequestError)) throw err;
    }
  }, [api]);

  // Een tablet wordt neergelegd en weer opgepakt; dat is het tweede natuurlijke moment om te kijken of
  // de begeleider iets aan de instellingen veranderd heeft. (Het eerste is een nieuw gesprek, hieronder.)
  useEffect(() => {
    if (!session || typeof document === 'undefined') return;
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void refreshSession();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [session, refreshSession]);

  if (checking) {
    return (
      <AuthLayout title="Even geduld">
        <p className="muted">Bezig met laden…</p>
      </AuthLayout>
    );
  }

  if (!session) {
    return <DeviceLinkScreen api={api} onLinked={setSession} />;
  }

  return (
    <ConversationScreen
      api={api}
      user={session.user}
      speech={speech}
      onRefreshSession={refreshSession}
    />
  );
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
    <AuthLayout
      title="Tablet koppelen"
      intro="Voer de koppelcode in die je in de beheeromgeving hebt aangemaakt."
    >
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
    </AuthLayout>
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
  speech: injectedSpeech,
  onRefreshSession,
}: {
  api: DeviceApi;
  user: UserPublic;
  speech?: SpeechPort;
  /** Haalt het communicatieprofiel opnieuw op bij een nieuw gesprek (T18.6). */
  onRefreshSession?: () => void | Promise<void>;
}): React.JSX.Element {
  const profile = user.communicationProfile;

  // Spraakuitvoer (T18.3). De stem komt uit het profiel; staat spraak uit, dan blijft alles stil.
  // De poort wordt één keer gebouwd per (api, stem): een nieuwe poort per render zou de wachtrij en
  // de opgehaalde fragmenten telkens weggooien.
  const speech = useMemo<SpeechPort>(() => {
    if (injectedSpeech) return injectedSpeech;
    if (!profile.speechEnabled) return silentSpeech;
    return createBrowserSpeech({
      voice: profile.speechVoice,
      fetchAudio: (text) => api.speakText(text),
    });
  }, [injectedSpeech, api, profile.speechEnabled, profile.speechVoice]);
  const speaks = profile.speechEnabled;

  /** Spreekt uit wat er staat — maar alleen als deze gebruiker dat wil. */
  function say(text: string | readonly string[]): void {
    if (speaks) speech.speak(text);
  }

  // Onthoudt wélke toestand er al voorgelezen is. Bewust de toestand zelf en niet de vraagtekst: elk
  // antwoord van de server is een nieuw object, dus na "↩ Terug" klinkt dezelfde vraag wél opnieuw
  // (de gebruiker komt op een nieuw scherm en moet hem weer horen), terwijl een tweede render van
  // hetzelfde scherm stil blijft — onder `<StrictMode>` mount React elk component twee keer, en dan
  // zou elke vraag dubbel beginnen.
  const spokenStateRef = useRef<ConversationStateResponse | null>(null);
  // Tellers voor de bedieningszetjes (T18.4): hoeveel keuzeschermen er in dit gesprek langskwamen en
  // welk zetje het laatst klonk. Refs, want ze mogen geen hertekening veroorzaken.
  const screenCountRef = useRef(0);
  const lastHintRef = useRef<HintKey | null>(null);
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
    // Elke actie komt uit een tik van de gebruiker; dat is precies het moment waarop Safari op iOS
    // geluid toestaat (T18.3). Daarna mag de app ook uit zichzelf spreken.
    if (speaks) speech.unlock();
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
    // Een nieuw gesprek begint ook voor de bedieningszetjes opnieuw (T18.4).
    screenCountRef.current = 0;
    lastHintRef.current = null;
    spokenStateRef.current = null;
    speech.stop();
    void run(() => beginConversation());
  }

  /**
   * "Opnieuw beginnen" zoals de gebruiker hem aantikt. Een nieuw gesprek is het natuurlijke moment om
   * ook het profiel opnieuw op te halen (T18.6): wijzigt een begeleider de stem of het aantal opties,
   * dan geldt dat vanaf het volgende gesprek — zonder dat iemand de tablet hoeft te verversen.
   */
  function restartByUser(): void {
    void onRefreshSession?.();
    restart();
  }

  // Eenmalig bij binnenkomst (of bij een nieuwe `api`) een gesprek beginnen.
  useEffect(() => {
    restart();
  }, [api]);

  // De vraag op het scherm voorlezen zodra hij verschijnt (T18.3), en daar af en toe een gesproken
  // zetje over de bediening achteraan plakken (T18.4). Bewust twee losse zinnen en niet één samengevoegde
  // tekst: het zetje komt ná de vraag en nooit erdoorheen, en de knop "Nog eens" herhaalt alleen de vraag.
  const prompt = state?.question?.prompt ?? null;
  useEffect(() => {
    if (!speaks || !prompt || !state) return;
    if (spokenStateRef.current === state) return;
    spokenStateRef.current = state;
    screenCountRef.current += 1;

    const zinnen = [prompt];
    if (profile.speechHints) {
      const optionCount = state.question?.options.length ?? 0;
      const hint = pickHint({
        screenCount: screenCountRef.current,
        lastHint: lastHintRef.current,
        // Alleen over knoppen die op dít scherm ook echt staan (zie de opbouw van de balk hieronder).
        hasMoreChoices: optionCount > Math.max(1, profile.iconsPerScreen),
        canSkip: Boolean(state.question),
        canGoBack: state.history.length > 0,
      });
      if (hint) {
        lastHintRef.current = hint;
        zinnen.push(hintText(hint));
      }
    }
    say(zinnen);
  }, [prompt, state, speaks, profile.speechHints, profile.iconsPerScreen]);

  // De bevestigde boodschap uitspreken (T18.3): dit is het moment waarop de gebruiker iets zegt.
  const confirmedMessage = confirmed?.message ?? null;
  useEffect(() => {
    if (confirmedMessage) say(confirmedMessage);
  }, [confirmedMessage, speaks]);

  // Bij het verlaten van het scherm stopt wat er nog klinkt; anders praat de tablet door over een
  // scherm dat er niet meer is.
  useEffect(() => () => speech.stop(), [speech]);

  // Na bevestiging: de opgeslagen boodschap tonen met de mogelijkheid opnieuw te beginnen.
  if (confirmed) {
    return (
      <main className="tablet">
        <TabletHeader userName={user.name} />
        <section className="tablet__done">
          <h1 className="tablet__prompt">Boodschap bevestigd</h1>
          <p className="tablet__message">{confirmed.message}</p>
          <div className="tablet__bar">
            {speaks ? <SpeakAgainButton onSpeak={() => say(confirmed.message)} /> : null}
            <button
              className="button button--primary"
              type="button"
              disabled={busy}
              onClick={restartByUser}
            >
              Opnieuw beginnen
            </button>
          </div>
        </section>
      </main>
    );
  }

  // Wachten op een AI-worker (T5.7): rustige wachtstand i.p.v. een fout; de poll-lus in `run`
  // herstelt automatisch zodra er een antwoord is.
  if (waiting) {
    return <WaitingScreen position={waiting.position} userName={user.name} />;
  }

  if (!state) {
    return (
      <main className="tablet">
        <TabletHeader userName={user.name} />
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
        userName={user.name}
        showText={profile.showText}
        supportMode={profile.supportMode}
        speech={speech}
        speaks={speaks}
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
  // Het concept dat de AI als **gok** aandraagt (T16.3, strategie `guess`); `null` bij elke andere
  // strategie. Buiten de map gelezen zodat de smalle typering van `state.question` behouden blijft.
  const guessConcept = state.question?.guess ?? null;
  const perScreen = Math.max(1, profile.iconsPerScreen);
  const pageCount = Math.max(1, Math.ceil(allOptions.length / perScreen));
  const page = Math.min(optionPage, pageCount - 1);
  const options = allOptions.slice(page * perScreen, page * perScreen + perScreen);
  const hasMoreOptions = pageCount > 1;
  const onLastPage = page === pageCount - 1;

  return (
    <main className="tablet">
      {/* Naam van de app en van de gebruiker (T17.1), plus zichtbaar of er echt een AI meedenkt
          (T9.4) — anders is niet te zien dat de app op de deterministische mock draait of dat er
          geen worker actief is. */}
      <TabletHeader userName={user.name}>
        <AiStatusBadge api={api} />
      </TabletHeader>

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
                // De gok van de AI (T16.3, strategie `guess`): één gemarkeerde tegel tússen de gewone
                // pictogrammen. De server wijst hem aan; de gebruiker tikt hem zelf aan of niet.
                guess={guessConcept === symbol.concept}
                onSelect={() => void run(() => api.conversationNext(state.sessionId, symbol.id))}
              />
            ))}
          </div>
        </>
      ) : null}

      <div className="tablet__bar">
        {speaks && state.question ? (
          <SpeakAgainButton onSpeak={() => say(state.question?.prompt ?? '')} disabled={busy} />
        ) : null}
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
        <button
          className="button tablet__bar-end"
          type="button"
          disabled={busy}
          onClick={restartByUser}
        >
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
  userName,
  showText,
  supportMode,
  speech,
  speaks,
  onConfirmed,
  onReject,
}: {
  api: DeviceApi;
  sessionId: string;
  /** Voor de kopbalk (T17.1); het voorstelscherm hoort er niet anders uit te zien dan de rest. */
  userName: string;
  showText: boolean;
  supportMode: boolean;
  /** Spraakpoort van het gespreksscherm (T18.3), zodat beide schermen dezelfde stem en wachtrij delen. */
  speech: SpeechPort;
  /** Staat spraak aan voor deze gebruiker? */
  speaks: boolean;
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

  // De voorgestelde zin uitspreken zodra hij er staat (T18.3). Dit is de zin die de gebruiker gaat
  // bevestigen; hem horen is hier belangrijker dan waar ook — wie niet leest, kan hem anders niet
  // beoordelen.
  const message = proposal?.message ?? null;
  useEffect(() => {
    if (speaks && message) speech.speak(message);
  }, [speaks, message, speech]);

  async function confirm(): Promise<void> {
    // Binnen de tik: hier mag iOS het geluid nog vrijgeven (T18.3).
    if (speaks) speech.unlock();
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
    return <WaitingScreen position={waiting.position} userName={userName} />;
  }

  if (!proposal) {
    return (
      <main className="tablet">
        <TabletHeader userName={userName} />
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
      <TabletHeader userName={userName} />
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
        {speaks ? (
          <SpeakAgainButton onSpeak={() => speech.speak(proposal.message)} disabled={busy} />
        ) : null}
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
  guess = false,
  onSelect,
}: {
  symbol: AacSymbol;
  showText: boolean;
  disabled: boolean;
  /** Is dit de **gok** van de AI (T16.3)? Dan wordt de tegel zichtbaar anders aangeboden. */
  guess?: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  // Twee markeringen die allebei zeggen "dit komt van de AI, niet uit de kast":
  //
  // - een **nieuw woord** (T10.6, DESIGN §7.6 trap 3) is aangedragen omdat het begrip nog niet in de
  //   bibliotheek stond;
  // - een **gok** (T16.3, strategie `guess`) is wat de AI dénkt dat de gebruiker bedoelt. Die staat
  //   bewust tússen de andere pictogrammen en niet als kant-en-klare boodschap: zo blijft het een
  //   aanbod dat de gebruiker zelf aantikt (DESIGN §2, §3.1).
  //
  // Beide staan ook in het `aria-label`, zodat de markering niet alleen visueel is.
  const text = guess ? `Ik denk: ${symbol.label}` : symbol.label;
  const label = symbol.isNew ? `${text} (nieuw woord)` : text;
  const className = ['option', guess ? 'option--guess' : null, symbol.isNew ? 'option--new' : null]
    .filter((part) => part !== null)
    .join(' ');
  return (
    <button
      className={className}
      type="button"
      disabled={disabled}
      aria-label={label}
      onClick={onSelect}
    >
      {guess ? (
        <span className="option__badge" aria-hidden="true" title="Gok van de AI">
          🎯
        </span>
      ) : symbol.isNew ? (
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
      {showText ? <span className="option__label">{text}</span> : null}
    </button>
  );
}
