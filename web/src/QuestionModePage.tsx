import { useEffect, useState, type FormEvent } from 'react';
import type {
  AacSymbol,
  AccountPublic,
  CaregiverConversationView,
  UserPublic,
} from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import { AiStatusBadge } from './AiStatusBadge.tsx';
import { ChangePasswordPanel } from './ChangePasswordPanel.tsx';
import { AdminNav, type AdminView } from './AdminNav.tsx';

/**
 * Begeleiderinterface — **vraagmodus** (T7.1, DESIGN §3.2, §5.2, FR-012).
 *
 * Een begeleider stelt een gekoppelde gebruiker een vraag ("Wat wil je drinken?"). De begeleider kiest:
 *  1. de **gebruiker** (alleen aan hem gekoppelde gebruikers verschijnen — de backend filtert);
 *  2. de letterlijke **vraag**;
 *  3. een **onderwerp** (AAC-topic, bv. "Drinken") waarvan de mogelijke antwoorden komen; te kiezen
 *     uit de lijst met onderwerpen die antwoordopties hebben (`GET /aac/topics`, T9.7) of op te
 *     zoeken via de AAC-zoekfunctie.
 *
 * Versturen roept `POST /question/start` aan: de vraag verschijnt daarna in de gebruikersapp op de
 * tablet, waar de gebruiker het antwoord zelf samenstelt en bevestigt. De begeleider bevestigt nooit
 * namens de gebruiker (DESIGN §2, §3.3).
 *
 * Sinds T9.1 is dit scherm er ook voor een **beheerder**: in kleine organisaties is de beheerder vaak
 * zelf de begeleider aan tafel. Geeft de aanroeper `onNavigate` mee, dan verschijnt de beheernavigatie
 * erboven en gedraagt de pagina zich als beheertab; zonder die prop is het de kale begeleiderweergave
 * (inclusief het eigen-wachtwoordpaneel, want dat is voor een begeleider zijn enige scherm).
 */
export function QuestionModePage({
  api,
  account,
  onLogout,
  onNavigate,
  watchPollMs,
}: {
  api: Api;
  account: AccountPublic;
  onLogout: () => void;
  /** Aanwezig in de beheeromgeving (T9.1): toont de beheernavigatie boven deze pagina. */
  onNavigate?: (view: AdminView) => void;
  /** Verversinterval (ms) van het meekijkpaneel (T9.3); injecteerbaar zodat tests niet hoeven te wachten. */
  watchPollMs?: number;
}): React.JSX.Element {
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [userId, setUserId] = useState('');
  const [question, setQuestion] = useState('');
  const [topicQuery, setTopicQuery] = useState('');
  const [results, setResults] = useState<AacSymbol[]>([]);
  const [anchor, setAnchor] = useState<AacSymbol | null>(null);
  // Alle onderwerpen die daadwerkelijk antwoordopties hebben (T9.7). Zonder deze lijst was het
  // onderwerp alleen via zoeken te vinden en bleef de verstuurknop grijs zonder aanwijsbare reden.
  const [topics, setTopics] = useState<AacSymbol[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { users: list } = await api.listQuestionUsers();
        if (!active) return;
        setUsers(list);
        if (list.length > 0) setUserId((prev) => prev || list[0]!.id);
      } catch (err) {
        if (active) setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  // Onderwerpen (met antwoordopties) ophalen voor de keuzelijst (T9.7). Mislukt dit, dan blijft de
  // zoekfunctie gewoon werken — daarom geen harde fout, alleen een lege lijst.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { topics: list } = await api.listAacTopics();
        if (active) setTopics(list);
      } catch {
        if (active) setTopics([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  async function handleSearch(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (topicQuery.trim().length === 0) return;
    try {
      const { symbols } = await api.searchAac(topicQuery.trim());
      setResults(symbols);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Zoeken mislukt.');
    }
  }

  async function handleSend(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSent(null);
    if (!userId || question.trim().length === 0 || !anchor) return;
    setBusy(true);
    try {
      await api.startQuestion({ userId, question: question.trim(), anchorConcept: anchor.concept });
      const target = users.find((u) => u.id === userId);
      setSent(`Vraag verstuurd naar ${target?.name ?? 'de gebruiker'}.`);
      setQuestion('');
      setAnchor(null);
      setTopicQuery('');
      setResults([]);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Versturen mislukt.');
    } finally {
      setBusy(false);
    }
  }

  // Wat ontbreekt er nog voordat de vraag verstuurd kan worden? Tot T9.7 stond de knop simpelweg grijs
  // zonder uitleg — met vijf mogelijke oorzaken (geen gebruiker, lege vraag, geen onderwerp).
  const missing: string[] = [];
  if (!userId) missing.push('een gebruiker');
  if (question.trim().length === 0) missing.push('een vraag');
  if (!anchor) missing.push('een onderwerp');

  return (
    <main className="admin">
      <header className="admin__header">
        <h1 className="panel__title">Vraag stellen</h1>
        <div className="admin__account">
          <AiStatusBadge api={api} />
          <span>{account.email}</span>
          <button className="button" type="button" onClick={onLogout}>
            Uitloggen
          </button>
        </div>
      </header>

      {/* In de beheeromgeving (T9.1) hoort deze pagina bij de andere beheertabs. */}
      {onNavigate ? <AdminNav active="question" onNavigate={onNavigate} /> : null}

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {sent ? (
        <p className="form__ok" role="status">
          {sent}
        </p>
      ) : null}

      {users.length === 0 ? (
        <section className="panel">
          <p className="muted">
            Je bent nog niet aan een gebruiker gekoppeld. Vraag de beheerder je te koppelen.
          </p>
        </section>
      ) : (
        <form
          className="panel form"
          aria-label="Vraag stellen"
          onSubmit={(e) => void handleSend(e)}
        >
          <label className="field">
            <span className="field__label">Gebruiker</span>
            <select
              className="field__input"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Vraag</span>
            <input
              className="field__input"
              type="text"
              placeholder="Bijvoorbeeld: Wat wil je drinken?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              required
            />
          </label>

          <fieldset className="field">
            <legend className="field__label">Onderwerp (mogelijke antwoorden)</legend>
            <p className="muted">
              De antwoorden komen uit dit onderwerp. Kies er één uit de lijst, of zoek er een op.
            </p>

            {topics.length > 0 ? (
              <select
                className="field__input"
                aria-label="Onderwerp kiezen uit de lijst"
                value={anchor?.id ?? ''}
                onChange={(e) => {
                  setAnchor(topics.find((topic) => topic.id === e.target.value) ?? null);
                  setResults([]);
                }}
              >
                <option value="">— Kies een onderwerp —</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.glyph} {topic.label}
                  </option>
                ))}
              </select>
            ) : null}

            <div className="form form--inline" role="group" aria-label="Onderwerp opzoeken">
              <input
                className="field__input"
                type="text"
                placeholder="Zoek een onderwerp, bv. drinken"
                aria-label="Onderwerp zoeken"
                value={topicQuery}
                onChange={(e) => setTopicQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleSearch(e);
                  }
                }}
              />
              <button
                className="button"
                type="button"
                onClick={(e) => void handleSearch(e)}
                disabled={topicQuery.trim().length === 0}
              >
                Zoeken
              </button>
            </div>

            {anchor ? (
              <p className="muted">
                Gekozen onderwerp: <strong>{anchor.label}</strong>{' '}
                <button
                  className="button button--link"
                  type="button"
                  onClick={() => setAnchor(null)}
                >
                  wijzigen
                </button>
              </p>
            ) : results.length > 0 ? (
              <ul className="topic-results">
                {results.map((symbol) => (
                  <li key={symbol.id}>
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        setAnchor(symbol);
                        setResults([]);
                      }}
                    >
                      {symbol.glyph} {symbol.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </fieldset>

          <div className="form__actions">
            <button
              className="button button--primary"
              type="submit"
              disabled={busy || missing.length > 0}
            >
              Vraag versturen
            </button>
            {missing.length > 0 ? (
              <p className="muted" role="note">
                Kies eerst {missing.join(' en ')} om de vraag te kunnen versturen.
              </p>
            ) : null}
          </div>
        </form>
      )}

      {userId ? <ConversationWatch api={api} userId={userId} pollMs={watchPollMs} /> : null}

      {/* Eigen wachtwoord wijzigen (T2.5). Een begeleider komt binnen met een tijdelijk wachtwoord
          dat zijn beheerder kent (T2.4); dit is zijn enige weergave, dus staat het paneel hier. In de
          beheeromgeving (T9.1) staat het al op "Mijn account" — dan laten we het hier weg. */}
      {onNavigate ? null : <ChangePasswordPanel api={api} />}
    </main>
  );
}

/** Standaardinterval (ms) waarmee het meekijkpaneel zichzelf ververst (T9.3). */
const WATCH_POLL_MS = 4000;

/**
 * Meekijken met het lopende gesprek (T7.2, DESIGN §3.3, §5.2, FR-011). De begeleider ziet **read-only**
 * de gesprekcontext van de gekoppelde gebruiker: of de gebruiker in ondersteuningsmodus staat, een
 * eventuele eigen vraag en het afgelegde pad (broodkruimel). Bewust géén keuze-/bevestigknoppen: kiezen
 * en bevestigen kan uitsluitend de gebruiker zelf op de tablet (server-side afgedwongen).
 *
 * Het paneel ververst zichzelf (T9.3). In T7.2 gebeurde dat alleen op een knop, om geen ongevraagd
 * verkeer te maken — maar meekijken met een gesprek dat je zelf moet aanklikken om te zien bewegen is
 * geen meekijken: in de gebruikerstest bleek dit onbruikbaar. Het interval is bewust rustig en de
 * aanroep is licht (een snapshot uit de opgeslagen stappen, géén AI-aanroep). De handmatige knop blijft
 * als directe verversing. Bij een fout blijft de laatst bekende stand staan met een melding erbij,
 * zodat één hikje het beeld niet wist; het pollen loopt gewoon door.
 */
function ConversationWatch({
  api,
  userId,
  pollMs = WATCH_POLL_MS,
}: {
  api: Api;
  userId: string;
  /** Verversinterval in ms; `0` = alleen handmatig. Tests zetten hem laag i.p.v. echt te wachten. */
  pollMs?: number;
}): React.JSX.Element {
  const [view, setView] = useState<CaregiverConversationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bij het wisselen van gebruiker het oude beeld wissen zodat we nooit context van een andere gebruiker tonen.
  useEffect(() => {
    setView(null);
    setError(null);
  }, [userId]);

  // Automatisch meekijken: meteen ophalen en daarna op interval, zolang dit paneel in beeld is.
  useEffect(() => {
    let active = true;

    async function load(): Promise<void> {
      try {
        const next = await api.viewUserConversation(userId);
        if (!active) return;
        setView(next);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(err instanceof ApiRequestError ? err.message : 'Meekijken mislukt.');
      }
    }

    void load();
    if (pollMs <= 0) {
      return () => {
        active = false;
      };
    }
    const timer = setInterval(() => void load(), pollMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, userId, pollMs]);

  async function refresh(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      setView(await api.viewUserConversation(userId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Meekijken mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Meekijken met het gesprek">
      <div className="form form--inline">
        <h2 className="panel__title">Meekijken met het gesprek</h2>
        <button className="button" type="button" onClick={() => void refresh()} disabled={busy}>
          Nu verversen
        </button>
      </div>
      <p className="muted">
        {pollMs > 0
          ? `Dit scherm werkt zichzelf elke ${Math.round(pollMs / 1000)} seconden bij.`
          : 'Ververs handmatig om de laatste stand te zien.'}
      </p>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      {view ? (
        <>
          {view.supportMode ? (
            <p className="tablet__support" role="note">
              <span aria-hidden="true">🤝 </span>Ondersteuningsmodus actief
            </p>
          ) : null}

          {view.session ? (
            <>
              {view.session.caregiverQuestion ? (
                <p className="muted">
                  Jouw vraag: <strong>{view.session.caregiverQuestion}</strong>
                </p>
              ) : null}

              {/* Wélke aanpak draait er (T11.6, DESIGN §7.10)? Met meerdere strategieën is "waarom
                  doet de AI dit?" niet te beantwoorden zonder dat te weten. Alleen het label — de
                  parameters en de prompt horen niet op het scherm van de begeleider. */}
              <p className="muted">
                Aanpak: <strong>{view.session.strategy.label}</strong>
              </p>

              {view.session.history.length > 0 ? (
                <nav className="breadcrumb" aria-label="Gekozen pad">
                  {view.session.history.map((step) => (
                    <span key={step.order} className="breadcrumb__item">
                      <span aria-hidden="true">{step.symbol.glyph}</span> {step.symbol.label}
                    </span>
                  ))}
                </nav>
              ) : (
                <p className="muted">Er is nog geen keuze gemaakt.</p>
              )}
            </>
          ) : (
            <p className="muted">Er loopt op dit moment geen gesprek.</p>
          )}
        </>
      ) : null}
    </section>
  );
}
