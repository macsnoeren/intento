import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  contactCreateRequestSchema,
  type ContactPublic,
  type VocabularyItemPublic,
} from '@intento/shared';
import { ApiRequestError, apiUrl, type Api } from './api.ts';
import { Modal } from './Modal.tsx';

/**
 * Contacten van een gebruiker (N10.3, INTENTO-NEW-DESIGN §28, §29, §49).
 *
 * De mensen naar wie de gebruiker een bevestigde boodschap kan sturen: naam, relatie, een pictogram uit
 * de Vocabulary en een e-mailadres. Een contact wordt pas aangeboden als hij zelf bevestigde dat hij
 * berichten wil ontvangen (opt-in); tot dan staat er "wacht op bevestiging" en kan de mail opnieuw.
 * De volgorde hier is de vaste volgorde waarin de tablet de contacten aanbiedt zolang Experience uit
 * staat. Voor de beheerder en een gekoppelde begeleider.
 */

type Editing = { contact: ContactPublic | null };

function status(contact: ContactPublic): { text: string; className: string } {
  if (!contact.active) return { text: 'Uit', className: 'badge badge--revoked' };
  if (!contact.emailVerified)
    return { text: 'Wacht op bevestiging', className: 'badge badge--warn' };
  return { text: 'Bevestigd', className: 'badge badge--active' };
}

export function ContactsPanel({
  api,
  userId,
  userName,
}: {
  api: Api;
  userId: string;
  userName: string;
}): React.JSX.Element {
  const [contacts, setContacts] = useState<ContactPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<ContactPublic | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setContacts((await api.listContacts(userId)).contacts);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
    }
  }, [api, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(id: string, action: () => Promise<unknown>, done?: string): Promise<void> {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Dat lukte niet.');
    } finally {
      setBusy(null);
    }
  }

  /** Eén plek omhoog of omlaag: de hele lijst krijgt een nette volgorde 0, 1, 2, … */
  function move(index: number, delta: -1 | 1): void {
    if (!contacts) return;
    const target = index + delta;
    if (target < 0 || target >= contacts.length) return;
    const order = [...contacts];
    const [moved] = order.splice(index, 1);
    if (!moved) return;
    order.splice(target, 0, moved);
    void run(moved.id, async () => {
      for (const [position, contact] of order.entries()) {
        if (contact.sortOrder !== position) {
          await api.updateContact(userId, contact.id, { sortOrder: position });
        }
      }
    });
  }

  return (
    <section className="panel" aria-label={`Contacten van ${userName}`}>
      <h2 className="panel__subtitle">Contacten</h2>
      <p className="muted">
        Naar wie {userName} een bevestigde boodschap kan sturen. Een contact krijgt eerst een e-mail
        en wordt pas aangeboden als hij die bevestigt. De volgorde hieronder is de volgorde op de
        tablet.
      </p>
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="form__ok" role="status">
          {notice}
        </p>
      ) : null}

      {contacts === null ? (
        <p className="muted">Laden…</p>
      ) : contacts.length === 0 ? (
        <p className="muted">Nog geen contacten.</p>
      ) : (
        <ul className="item-list">
          {contacts.map((contact, index) => {
            const badge = status(contact);
            const isBusy = busy === contact.id;
            return (
              <li key={contact.id} className="item-row" aria-label={contact.name}>
                <div className="item-row__image">
                  {contact.symbol?.imageUrl ? (
                    <img src={apiUrl(contact.symbol.imageUrl)} alt="" width={56} height={56} />
                  ) : (
                    <span className="muted">Geen pictogram</span>
                  )}
                </div>
                <div className="record__body">
                  <span className="record__title">
                    {contact.name}
                    {contact.relation ? <span className="muted"> · {contact.relation}</span> : null}
                  </span>
                  <span className="record__meta">
                    {contact.email} · <span className={badge.className}>{badge.text}</span>
                  </span>
                </div>
                <div className="item-row__actions">
                  <button
                    className="button"
                    type="button"
                    aria-label={`${contact.name} omhoog`}
                    disabled={isBusy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="button"
                    type="button"
                    aria-label={`${contact.name} omlaag`}
                    disabled={isBusy || index === contacts.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  {!contact.emailVerified ? (
                    <button
                      className="button"
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        void run(
                          contact.id,
                          () => api.resendContactVerification(userId, contact.id),
                          `De bevestigingsmail is opnieuw naar ${contact.email} gestuurd.`,
                        )
                      }
                    >
                      Opnieuw versturen
                    </button>
                  ) : null}
                  <button
                    className="button"
                    type="button"
                    disabled={isBusy}
                    onClick={() => setEditing({ contact })}
                  >
                    Wijzigen
                  </button>
                  <button
                    className="button"
                    type="button"
                    disabled={isBusy}
                    onClick={() => setRemoving(contact)}
                  >
                    Verwijderen
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="form__actions">
        <button
          className="button button--primary"
          type="button"
          onClick={() => setEditing({ contact: null })}
        >
          + Contact toevoegen
        </button>
      </div>

      {editing ? (
        <Modal
          title={editing.contact ? `${editing.contact.name} wijzigen` : 'Contact toevoegen'}
          onClose={() => setEditing(null)}
        >
          <ContactForm
            api={api}
            userId={userId}
            contact={editing.contact}
            onCancel={() => setEditing(null)}
            onSaved={(saved, emailSent) => {
              setEditing(null);
              setNotice(
                emailSent
                  ? `${saved.name} is opgeslagen. Er is een bevestigingsmail naar ${saved.email} gestuurd.`
                  : `${saved.name} is opgeslagen.`,
              );
              void load();
            }}
          />
        </Modal>
      ) : null}

      {removing ? (
        <Modal title={`${removing.name} verwijderen?`} onClose={() => setRemoving(null)}>
          <p>
            {userName} kan dan geen berichten meer naar {removing.name} sturen.
          </p>
          <div className="form__actions">
            <button
              className="button button--danger"
              type="button"
              onClick={() => {
                const contact = removing;
                setRemoving(null);
                void run(contact.id, () => api.deleteContact(userId, contact.id));
              }}
            >
              Ja, verwijderen
            </button>
            <button className="button" type="button" onClick={() => setRemoving(null)}>
              Annuleren
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

/** Toevoegen of wijzigen: naam, relatie, e-mail, actief en een pictogram uit de Vocabulary. */
function ContactForm({
  api,
  userId,
  contact,
  onCancel,
  onSaved,
}: {
  api: Api;
  userId: string;
  contact: ContactPublic | null;
  onCancel: () => void;
  onSaved: (contact: ContactPublic, emailSent: boolean) => void;
}): React.JSX.Element {
  const [name, setName] = useState(contact?.name ?? '');
  const [relation, setRelation] = useState(contact?.relation ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [active, setActive] = useState(contact?.active ?? true);
  const [symbol, setSymbol] = useState(contact?.symbol ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const parsed = contactCreateRequestSchema.safeParse({
      name,
      relation: relation.trim() ? relation : null,
      email: email.trim(),
      vocabularyItemId: symbol?.id ?? null,
    });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      setError(
        field === 'email'
          ? 'Vul een geldig e-mailadres in.'
          : field === 'name'
            ? 'Vul een naam in (hooguit 60 tekens).'
            : (parsed.error.issues[0]?.message ?? 'Controleer de invoer.'),
      );
      return;
    }
    setBusy(true);
    try {
      if (contact) {
        const saved = await api.updateContact(userId, contact.id, {
          name: parsed.data.name,
          relation: parsed.data.relation ?? null,
          email: parsed.data.email,
          vocabularyItemId: parsed.data.vocabularyItemId ?? null,
          active,
        });
        onSaved(saved, parsed.data.email !== contact.email);
      } else {
        onSaved(await api.createContact(userId, parsed.data), true);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Opslaan mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" aria-label="Contact" noValidate onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span className="field__label">Naam (zoals de gebruiker hem kent, bv. "Mama")</span>
        <input
          className="field__input"
          name="name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Relatie (bv. moeder, broer, begeleider)</span>
        <input
          className="field__input"
          name="relation"
          value={relation}
          maxLength={40}
          onChange={(e) => setRelation(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">E-mailadres</span>
        <input
          className="field__input"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {contact && email.trim().toLowerCase() !== contact.email ? (
        <p className="muted">
          Een nieuw adres krijgt een bevestigingsmail; tot dan wordt dit contact niet aangeboden.
        </p>
      ) : null}
      <SymbolPicker api={api} chosen={symbol} onChoose={setSymbol} />
      {contact ? (
        <label className="toggle">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Aanbieden op de tablet</span>
        </label>
      ) : null}
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form__actions">
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button className="button" type="button" onClick={onCancel}>
          Annuleren
        </button>
      </div>
    </form>
  );
}

/** Een pictogram kiezen uit de Vocabulary van de organisatie (zoeken op woord). */
function SymbolPicker({
  api,
  chosen,
  onChoose,
}: {
  api: Api;
  chosen: ContactPublic['symbol'];
  onChoose: (symbol: ContactPublic['symbol']) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VocabularyItemPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(): Promise<void> {
    const q = query.trim();
    if (!q) return;
    setError(null);
    try {
      setResults((await api.listVocabulary({ q, pageSize: 12 })).items);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Zoeken mislukt.');
    }
  }

  return (
    <fieldset className="field">
      <legend className="field__label">Pictogram</legend>
      <p className="muted">
        {chosen ? (
          <>
            Gekozen: <strong>{chosen.label}</strong>{' '}
            <button className="button--link" type="button" onClick={() => onChoose(null)}>
              weghalen
            </button>
          </>
        ) : (
          'Nog geen pictogram.'
        )}
      </p>
      <div className="symbol-picker__search">
        <input
          className="field__input"
          type="search"
          aria-label="Pictogram zoeken"
          placeholder="Bijvoorbeeld: moeder, broer, opa"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter zoekt, en verstuurt niet het hele contactformulier.
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
        />
        <button className="button" type="button" onClick={() => void search()}>
          Zoeken
        </button>
      </div>
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {results && results.length === 0 ? <p className="muted">Niets gevonden.</p> : null}
      {results && results.length > 0 ? (
        <ul className="symbol-grid" aria-label="Pictogrammen">
          {results.map((item) => {
            const label = item.labels[0] ?? item.id;
            return (
              <li key={item.id}>
                <button
                  className="symbol-card"
                  type="button"
                  aria-label={label}
                  aria-pressed={chosen?.id === item.id}
                  onClick={() => onChoose({ id: item.id, label, imageUrl: item.imageUrl })}
                >
                  {item.imageUrl ? (
                    <img
                      className="symbol-card__image"
                      src={apiUrl(item.imageUrl)}
                      alt=""
                      width={64}
                      height={64}
                    />
                  ) : null}
                  <span className="symbol-card__label">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </fieldset>
  );
}
