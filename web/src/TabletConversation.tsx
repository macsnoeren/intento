import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommunicationTurn, TabletOption } from '@intento/shared';
import { ApiRequestError, apiUrl, type DeviceApi } from './api.ts';
import { BrandMark } from './Brand.tsx';

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

export function TabletConversation({
  api,
  showText,
  footer,
}: {
  api: DeviceApi;
  /** Labels onder de pictogrammen tonen (instelling `showText`). */
  showText: boolean;
  /** Wat onder het startscherm staat (de link naar de bronnen). */
  footer?: React.ReactNode;
}): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [turn, setTurn] = useState<CommunicationTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  /** Voert een handeling uit; bij een verouderd scherm haalt hij het actuele scherm op. */
  const act = useCallback(
    async (action: () => Promise<CommunicationTurn | null>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        setTurn(await action());
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 409) {
          // Al beantwoord (dubbele tik) of het gesprek is voorbij: toon wat de backend nu heeft.
          setTurn(await api.currentConversation().catch(() => null));
        } else {
          setError(errorMessage(err));
        }
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  const start = (): Promise<void> => act(() => api.startConversation());

  const answer = (current: CommunicationTurn, given: Answer): Promise<void> =>
    act(() =>
      api.answerConversation(current.sessionId, {
        turn: current.turn,
        ...given,
        responseTimeMs: Math.max(0, Math.round(Date.now() - shownAt.current)),
      }),
    );

  const back = (current: CommunicationTurn): Promise<void> =>
    act(() => api.goBack(current.sessionId, current.turn));

  const stop = (current: CommunicationTurn): Promise<void> =>
    act(async () => {
      await api.stopConversation(current.sessionId);
      return null;
    });

  if (loading) {
    return <p className="muted tablet__waiting">Even geduld…</p>;
  }

  const alert = error ? (
    <p className="form__error tablet__error" role="alert">
      {error}
    </p>
  ) : null;

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
    return (
      <>
        <section className="tablet__done">
          <p className="tablet__message">{presentation.message ?? presentation.text}</p>
          <button className="button button--primary" type="button" onClick={() => setTurn(null)}>
            Nieuw gesprek
          </button>
        </section>
        {alert}
      </>
    );
  }

  if (presentation.mode === 'multi' && CHOICE_KINDS.has(presentation.kind)) {
    // Multi-icon volgt in fase N7; tot dan kan de gebruiker hier alleen stoppen.
    return (
      <>
        <section className="tablet__waiting">
          <h1 className="tablet__prompt">{presentation.text}</h1>
          <p className="muted">Deze vorm komt binnenkort.</p>
        </section>
        {alert}
        {controls}
      </>
    );
  }

  const pictogram = presentation.options[0];
  return (
    <>
      <section className="binary">
        {pictogram ? <Pictogram option={pictogram} showText={showText} /> : null}
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
