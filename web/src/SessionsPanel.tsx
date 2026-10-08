import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { ReviewTurn, SessionListResponse, SessionReview } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Gesprekken van één gebruiker terugzien (N14.1, INTENTO-NEW-DESIGN §26, §27, §49).
 *
 * Eerst het overzicht (nieuwste eerst); een gesprek openen toont per beurt drie kolommen naast elkaar:
 * **Getoond** (wat er op het scherm stond), **Gekozen** (wat de gebruiker deed) en **Gedacht** (wat de
 * agents concludeerden) — zoals ze zijn opgeslagen, nooit samengevoegd — met daaronder de
 * agentbeslissingen: welke agent, gelukt of terugval, model, promptversie en duur.
 */

const STATUS_LABELS = { active: 'Loopt nog', confirmed: 'Bevestigd', stopped: 'Gestopt' } as const;

const KIND_LABELS: Record<string, string> = {
  question: 'Vraag',
  confirm_message: '"Bedoel je …?"',
  share_ask: '"Wil je dit sturen?"',
  share_contact: 'Contactvraag',
  confirm_send: '"Naar … sturen?"',
  ask_stop: '"Wil je stoppen?"',
  done: 'Klaar',
  stopped: 'Gestopt',
};

const MODE_LABELS: Record<string, string> = { binary: 'ja/nee', multi: 'tegels' };

const DECISION_LABELS: Record<string, string> = {
  success: 'gelukt',
  fallback: 'terugval op regels',
  failed: 'mislukt',
  invalid: 'verworpen door de backend',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('nl-NL', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function seconds(ms: number | null): string {
  return ms === null
    ? ''
    : ` · ${(ms / 1000).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} s`;
}

function percent(confidence: number | null): string {
  return confidence === null ? '' : ` · zekerheid ${Math.round(confidence * 100)}%`;
}

/** Wat de gebruiker deed, in gewone woorden. */
function observedText(turn: ReviewTurn, event: ReviewTurn['observed'][number]): string {
  const time = seconds(event.responseTimeMs);
  switch (event.type) {
    case 'start':
      return 'Gesprek gestart';
    case 'answer_yes':
      return `JA${time}`;
    case 'answer_no':
      return `NEE${time}`;
    case 'select_option': {
      const option = turn.presented?.options.find((o) => o.ref === event.optionRef);
      const place = event.position === null ? '' : ` (plek ${event.position + 1})`;
      return `Koos ${option?.label ?? 'een tegel'}${place}${time}`;
    }
    case 'none_of_these':
      return `Geen van deze${time}`;
    case 'back':
      return '↩ Terug';
    case 'stop':
      return '⏹ Stoppen';
    default:
      return event.type;
  }
}

const hypothesesSchema = z.object({
  hypotheses: z.array(z.object({ label: z.string(), confidence: z.number() })),
});
const modeChangeSchema = z.object({
  from: z.string().nullable(),
  to: z.string(),
  reason: z.string(),
});
const notesSchema = z.object({ notes: z.array(z.object({ text: z.string() })) });

/** Wat een agent concludeerde, kort. Onbekende soorten als ingekorte JSON. */
function inferredText(kind: string, payload: unknown): string {
  if (kind === 'intent_hypotheses') {
    const parsed = hypothesesSchema.safeParse(payload);
    if (parsed.success) {
      return parsed.data.hypotheses
        .slice(0, 5)
        .map((h) => `${h.label} ${Math.round(h.confidence * 100)}%`)
        .join(', ');
    }
  }
  if (kind === 'mode_change') {
    const parsed = modeChangeSchema.safeParse(payload);
    if (parsed.success) {
      const to = MODE_LABELS[parsed.data.to] ?? parsed.data.to;
      const from = parsed.data.from
        ? `${MODE_LABELS[parsed.data.from] ?? parsed.data.from} → `
        : '';
      return `Vorm: ${from}${to} (${parsed.data.reason})`;
    }
  }
  if (kind === 'experience_note') {
    const parsed = notesSchema.safeParse(payload);
    if (parsed.success) return parsed.data.notes.map((n) => n.text).join(' ') || 'Geen observatie';
  }
  const text = JSON.stringify(payload);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function Turn({ turn }: { turn: ReviewTurn }): React.JSX.Element {
  const shown = turn.presented;
  return (
    <li className="review-turn" aria-label={`Beurt ${turn.turn}`}>
      <h3 className="review-turn__title">Beurt {turn.turn}</h3>
      <div className="review-turn__columns">
        <section aria-label="Getoond">
          <h4 className="review-turn__heading">Getoond</h4>
          {shown ? (
            <>
              <p className="record__title">{shown.text}</p>
              <p className="record__meta">
                {KIND_LABELS[shown.kind] ?? shown.kind} · {MODE_LABELS[shown.mode] ?? shown.mode}
              </p>
              {shown.options.length > 0 ? (
                <ol className="review-turn__options">
                  {shown.options.map((option) => (
                    <li key={option.ref}>
                      {option.label ?? option.ref}
                      {option.representation === 'stand_in' ? ' (vervanger)' : ''}
                    </li>
                  ))}
                </ol>
              ) : null}
            </>
          ) : (
            <p className="muted">—</p>
          )}
        </section>
        <section aria-label="Gekozen">
          <h4 className="review-turn__heading">Gekozen</h4>
          {turn.observed.length > 0 ? (
            <ul className="review-turn__options">
              {turn.observed.map((event, index) => (
                <li key={`${event.type}-${index}`}>{observedText(turn, event)}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">—</p>
          )}
        </section>
        <section aria-label="Gedacht">
          <h4 className="review-turn__heading">Gedacht</h4>
          {turn.inferred.length > 0 ? (
            <ul className="review-turn__options">
              {turn.inferred.map((inference, index) => (
                <li key={`${inference.kind}-${index}`}>
                  {inferredText(inference.kind, inference.payload)}
                  <span className="record__meta">
                    {' '}
                    ({inference.agent}
                    {percent(inference.confidence)})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">—</p>
          )}
        </section>
      </div>
      {turn.decisions.length > 0 ? (
        <ul className="review-turn__decisions" aria-label="Agentbeslissingen">
          {turn.decisions.map((decision, index) => (
            <li key={`${decision.agent}-${index}`} className="record__meta">
              {decision.agent}: {DECISION_LABELS[decision.status] ?? decision.status} ·{' '}
              {decision.model ?? 'regels'}
              {decision.promptVersion ? ` (${decision.promptVersion})` : ''} · {decision.latencyMs}{' '}
              ms{decision.reason ? ` · ${decision.reason}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Review({
  api,
  sessionId,
  onBack,
}: {
  api: Api;
  sessionId: string;
  onBack: () => void;
}): React.JSX.Element {
  const [review, setReview] = useState<SessionReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getSessionReview(sessionId)
      .then((loaded) => {
        if (active) setReview(loaded);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      });
    return () => {
      active = false;
    };
  }, [api, sessionId]);

  return (
    <section className="panel" aria-label="Gesprek terugzien">
      <button className="detail-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Alle gesprekken
      </button>
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {review === null && !error ? <p className="muted">Laden…</p> : null}
      {review ? (
        <>
          <h2 className="panel__subtitle">
            Gesprek van {when(review.session.startedAt)} · {STATUS_LABELS[review.session.status]}
          </h2>
          <p className="muted">
            Per beurt wat er getoond werd, wat {review.session.user.name} deed en wat Intento
            daaruit opmaakte. Gedacht is een conclusie, geen feit.
          </p>
          <ol className="review-list">
            {review.turns.map((turn) => (
              <Turn key={turn.turn} turn={turn} />
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}

const PAGE_SIZE = 25;

export function SessionsPanel({
  api,
  userId,
  userName,
}: {
  api: Api;
  userId: string;
  userName: string;
}): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [sessions, setSessions] = useState<SessionListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .listUserSessions(userId, { page, pageSize: PAGE_SIZE })
      .then((loaded) => {
        if (active) setSessions(loaded);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      });
    return () => {
      active = false;
    };
  }, [api, userId, page]);

  if (selected) {
    return <Review api={api} sessionId={selected} onBack={() => setSelected(null)} />;
  }

  const pages = sessions ? Math.max(1, Math.ceil(sessions.total / sessions.pageSize)) : 1;
  return (
    <section className="panel" aria-label="Gesprekken">
      <h2 className="panel__subtitle">Gesprekken</h2>
      <p className="muted">
        De gesprekken van {userName} binnen de bewaartermijn. Open er een om per beurt terug te zien
        wat er gebeurde.
      </p>
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {sessions === null && !error ? <p className="muted">Laden…</p> : null}
      {sessions && sessions.items.length === 0 ? (
        <p className="muted">{userName} heeft nog geen gesprekken.</p>
      ) : null}
      {sessions && sessions.items.length > 0 ? (
        <ul className="record-list">
          {sessions.items.map((session) => (
            <li key={session.id}>
              <button className="record" type="button" onClick={() => setSelected(session.id)}>
                <span className="record__body">
                  <span className="record__title">{when(session.startedAt)}</span>
                  <span className="record__meta">
                    {STATUS_LABELS[session.status]} ·{' '}
                    {session.screens === 1 ? '1 scherm' : `${session.screens} schermen`}
                  </span>
                </span>
                <span className="record__chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {pages > 1 ? (
        <div className="form__actions">
          <button
            className="button"
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Nieuwer
          </button>
          <span className="muted">
            Pagina {page} van {pages}
          </span>
          <button
            className="button"
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Ouder
          </button>
        </div>
      ) : null}
    </section>
  );
}
