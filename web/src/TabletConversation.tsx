import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommunicationTurn, TabletOption } from '@intento/shared';
import { ApiRequestError, apiUrl, type DeviceApi } from './api.ts';
import { BrandMark } from './Brand.tsx';
import type { SpeechPort } from './speech.ts';

/**
 * Het gesprek op de tablet (INTENTO-NEW-DESIGN §12, §48).
 *
 * De tablet is dom: hij toont wat de backend als presentatie teruggeeft en meldt terug wat de gebruiker
 * deed. Alles wat iets betekent (welke vraag, welk pictogram, wanneer "Bedoel je …?") komt van de
 * backend en de agentdienst. De tablet meet wel de reactietijd: hoe lang het scherm er stond voordat
 * de gebruiker antwoordde.
 */

type Answer = { answer: 'yes' | 'no' } | { optionRef: string } | { noneOfThese: true };

/** Schermen met tegels; alle andere vragen JA of NEE. */
const CHOICE_KINDS = new Set(['question', 'share_contact']);

function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Er ging iets mis.';
}

/**
 * De hulp is er even niet (§48, §52): de agentdienst is onbereikbaar of gaf een antwoord dat de backend
 * verwierp — of de backend zelf is even weg. Voor de gebruiker is dat hetzelfde: "Het lukt nu even
 * niet", met opnieuw proberen of stoppen.
 */
function isUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    ((error.status === 503 && error.code === 'AGENT_UNAVAILABLE') || error.status === 0)
  );
}

export function TabletConversation({
  api,
  showText,
  speech,
  speaks,
  footer,
}: {
  api: DeviceApi;
  /** Labels onder de pictogrammen tonen (instelling `showText`). */
  showText: boolean;
  /** De spraaklaag; spreekt alleen als `speaks` (instelling "voorlezen") aanstaat. */
  speech: SpeechPort;
  speaks: boolean;
  /** Wat onder het startscherm staat (de link naar de bronnen). */
  footer?: React.ReactNode;
}): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [turn, setTurn] = useState<CommunicationTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** De handeling die mislukte omdat de hulp er niet was; "Opnieuw proberen" doet hem nog eens. */
  const [retry, setRetry] = useState<(() => Promise<CommunicationTurn | null>) | null>(null);
  const shownAt = useRef(Date.now());

  // Een lopend gesprek hervatten (na herladen); anders het startscherm.
  useEffect(() => {
    let active = true;
    api
      .currentConversation()
      .then((current) => {
        if (active) setTurn(current);
      })
      .catch(() => {
        // Niet kunnen hervatten is geen ramp: dan begint de gebruiker opnieuw.
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [turn]);

  // Voorlezen (§48): op elk nieuw scherm precies de tekst die er staat — de vraag, of op Klaar de
  // bevestigde boodschap. Op het startscherm is er niets te zeggen.
  const spoken = turn ? spokenText(turn) : null;
  useEffect(() => {
    if (!speaks) return;
    if (spoken) speech.speak(spoken);
    else speech.stop();
  }, [spoken, turn, speaks, speech]);
  useEffect(() => () => speech.stop(), [speech]);

  /** Voert een handeling uit; bij een verouderd scherm haalt hij het actuele scherm op. */
  const act = useCallback(
    async (action: () => Promise<CommunicationTurn | null>): Promise<void> => {
      // Een tik is het moment om het geluid te ontgrendelen (Safari op iOS).
      if (speaks) speech.unlock();
      setBusy(true);
      setError(null);
      try {
        setTurn(await action());
        setRetry(null);
      } catch (err) {
        if (isUnavailable(err)) {
          // Het scherm blijft wat het was; de gebruiker kiest zelf: opnieuw of stoppen.
          setRetry(() => action);
        } else if (err instanceof ApiRequestError && err.status === 409) {
          // Al beantwoord (dubbele tik) of het gesprek is voorbij: toon wat de backend nu heeft.
          setRetry(null);
          setTurn(await api.currentConversation().catch(() => null));
        } else {
          setError(errorMessage(err));
        }
      } finally {
        setBusy(false);
      }
    },
    [api, speaks, speech],
  );

  const start = (): Promise<void> => act(() => api.startConversation());

  const answer = (current: CommunicationTurn, given: Answer): Promise<void> => {
    // Het antwoord ligt vast op het moment van de tik: "Opnieuw proberen" stuurt precies hetzelfde.
    const body = {
      turn: current.turn,
      ...given,
      responseTimeMs: Math.max(0, Math.round(Date.now() - shownAt.current)),
    };
    return act(() => api.answerConversation(current.sessionId, body));
  };

  const back = (current: CommunicationTurn): Promise<void> =>
    act(() => api.goBack(current.sessionId, current.turn));

  const stop = (current: CommunicationTurn): Promise<void> =>
    act(async () => {
      await api.stopConversation(current.sessionId);
      return null;
    });

  /** Stoppen vanaf "Het lukt nu even niet": lukt ook dat niet, dan toch terug naar het begin. */
  const giveUp = async (): Promise<void> => {
    const current = turn;
    setRetry(null);
    setTurn(null);
    if (current) await api.stopConversation(current.sessionId).catch(() => undefined);
  };

  if (loading) {
    return <p className="muted tablet__waiting">Even geduld…</p>;
  }

  const alert = error ? (
    <p className="form__error tablet__error" role="alert">
      {error}
    </p>
  ) : null;

  if (retry) {
    return (
      <section className="tablet__waiting tablet__unavailable" role="alert">
        <h1 className="tablet__prompt">Het lukt nu even niet</h1>
        <p className="muted">De hulp is even niet bereikbaar. Probeer het zo nog eens.</p>
        <div className="tablet__unavailable-actions">
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={() => void act(retry)}
          >
            Opnieuw proberen
          </button>
          <button className="button" type="button" disabled={busy} onClick={() => void giveUp()}>
            ⏹ Stoppen
          </button>
        </div>
      </section>
    );
  }

  if (!turn || turn.presentation.kind === 'stopped') {
    return (
      <>
        <section className="tablet__start">
          <button
            className="start-button"
            type="button"
            disabled={busy}
            onClick={() => void start()}
          >
            <BrandMark size={120} />
            <span className="start-button__label">Ik wil iets zeggen</span>
          </button>
          {alert}
        </section>
        {footer}
      </>
    );
  }

  const { presentation } = turn;
  const controls = (
    <ConversationBar
      canGoBack={turn.canGoBack}
      busy={busy}
      onBack={() => void back(turn)}
      onStop={() => void stop(turn)}
    />
  );

  if (presentation.kind === 'done') {
    // Klaar (§48): de bevestigde boodschap groot in beeld. Het gesprek is voorbij; geen Terug meer.
    return (
      <>
        <section className="tablet__done">
          <h1 className="tablet__message">{presentation.message ?? presentation.text}</h1>
          {speaks && spoken ? (
            <button className="button" type="button" onClick={() => speech.speak(spoken)}>
              🔊 Nog eens
            </button>
          ) : null}
          <button
            className="button button--primary tablet__new"
            type="button"
            disabled={busy}
            onClick={() => void start()}
          >
            Nieuw gesprek
          </button>
        </section>
        {alert}
      </>
    );
  }

  if (presentation.mode === 'multi' && CHOICE_KINDS.has(presentation.kind)) {
    // Multi-icon (§13): de vraag, 2 tot 8 tegels en "Geen van deze" — het is daar NEE.
    return (
      <>
        <section className="multi">
          <h1 className="tablet__prompt">{presentation.text}</h1>
          <ul className="tiles" data-count={presentation.options.length}>
            {presentation.options.map((option) => (
              <li key={option.ref}>
                <button
                  className="tile"
                  type="button"
                  disabled={busy}
                  aria-label={option.label}
                  onClick={() => void answer(turn, { optionRef: option.ref })}
                >
                  <Pictogram option={option} showText={showText} />
                </button>
              </li>
            ))}
          </ul>
          <button
            className="button none-button"
            type="button"
            disabled={busy}
            onClick={() => void answer(turn, { noneOfThese: true })}
          >
            Geen van deze
          </button>
        </section>
        {alert}
        {controls}
      </>
    );
  }

  // Binary vraag, "Bedoel je …?" en alle andere JA/NEE-schermen: pictogram(men), tekst, JA links,
  // NEE rechts. Bij een voorstel staan alle pictogrammen van de boodschap naast elkaar.
  return (
    <>
      <section className={presentation.kind === 'confirm_message' ? 'binary proposal' : 'binary'}>
        {presentation.options.length > 0 ? (
          <div className="pictograms">
            {presentation.options.map((option) => (
              <Pictogram key={option.ref} option={option} showText={showText} />
            ))}
          </div>
        ) : null}
        <h1 className="tablet__prompt">{presentation.text}</h1>
        <div className="binary__answers">
          <button
            className="answer-button answer-button--yes"
            type="button"
            disabled={busy}
            onClick={() => void answer(turn, { answer: 'yes' })}
          >
            <span aria-hidden="true">✔</span> JA
          </button>
          <button
            className="answer-button answer-button--no"
            type="button"
            disabled={busy}
            onClick={() => void answer(turn, { answer: 'no' })}
          >
            <span aria-hidden="true">✖</span> NEE
          </button>
        </div>
      </section>
      {alert}
      {controls}
    </>
  );
}

/** Wat er voorgelezen wordt: letterlijk de schermtekst, of op Klaar de boodschap. */
function spokenText(turn: CommunicationTurn): string | null {
  const { presentation } = turn;
  if (presentation.kind === 'stopped') return null;
  if (presentation.kind === 'done') return presentation.message ?? presentation.text;
  return presentation.text;
}

/** Eén pictogram met (als de instelling aanstaat) het woord eronder. */
function Pictogram({
  option,
  showText,
}: {
  option: TabletOption;
  showText: boolean;
}): React.JSX.Element {
  return (
    <figure className="pictogram">
      {option.imageUrl ? (
        <img
          className="pictogram__image"
          src={apiUrl(option.imageUrl)}
          alt={showText ? '' : option.label}
        />
      ) : (
        <span className="pictogram__image pictogram__image--empty" aria-hidden="true" />
      )}
      {showText ? <figcaption className="pictogram__label">{option.label}</figcaption> : null}
    </figure>
  );
}

/** ↩ Terug en ⏹ Stoppen: kleiner en apart van de antwoorden, want het is bediening (§12). */
function ConversationBar({
  canGoBack,
  busy,
  onBack,
  onStop,
}: {
  canGoBack: boolean;
  busy: boolean;
  onBack: () => void;
  onStop: () => void;
}): React.JSX.Element {
  return (
    <nav className="tablet__bar" aria-label="Bediening">
      {canGoBack ? (
        <button className="button" type="button" disabled={busy} onClick={onBack}>
          ↩ Terug
        </button>
      ) : null}
      <button className="button tablet__bar-end" type="button" disabled={busy} onClick={onStop}>
        ⏹ Stoppen
      </button>
    </nav>
  );
}
