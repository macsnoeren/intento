import { useEffect, useState } from 'react';
import type { UserExperience } from '@intento/shared';
import { ApiRequestError, apiUrl, type Api } from './api.ts';
import { Modal } from './Modal.tsx';
import { INTERACTION_MODE_OPTIONS } from './SettingsForm.tsx';

/**
 * Wat Intento van één gebruiker geleerd heeft, in gewone taal (N12.3, INTENTO-NEW-DESIGN §22, §49):
 * welke pictogrammen hij vaak kiest, naar wie hij vaak stuurt en welke vorm tot een bericht leidde.
 * Bewijs, geen waarheid: het zet dingen eerder in beeld, maar verbergt nooit iets. Met "Ervaring wissen"
 * begint Intento opnieuw met leren (na een bevestiging, want het is niet terug te draaien).
 */

function when(iso: string): string {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' });
}

function times(n: number): string {
  return n === 1 ? '1 keer' : `${n} keer`;
}

const MODE_LABELS = new Map(INTERACTION_MODE_OPTIONS.map((option) => [option.key, option.label]));

export function ExperiencePanel({
  api,
  userId,
  userName,
}: {
  api: Api;
  userId: string;
  userName: string;
}): React.JSX.Element {
  const [experience, setExperience] = useState<UserExperience | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getUserExperience(userId)
      .then((loaded) => {
        if (active) setExperience(loaded);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
      });
    return () => {
      active = false;
    };
  }, [api, userId]);

  async function clear(): Promise<void> {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      await api.clearUserExperience(userId);
      setExperience(await api.getUserExperience(userId));
      setCleared(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Wissen mislukt.');
    } finally {
      setBusy(false);
    }
  }

  const symbols = experience?.symbols.filter((s) => s.chosen > 0) ?? [];
  const contacts = experience?.contacts.filter((c) => c.chosen > 0) ?? [];
  const modes = experience?.modes ?? [];
  const empty =
    experience !== null &&
    experience.symbolCount === 0 &&
    experience.contacts.length === 0 &&
    modes.length === 0;

  return (
    <section className="panel" aria-label="Ervaring">
      <h2 className="panel__subtitle">Wat Intento geleerd heeft</h2>
      <p className="muted">
        Na elk gesprek telt Intento wat {userName} koos. Wat vaak gekozen wordt, komt eerder in
        beeld; er verdwijnt nooit iets. Het is bewijs, geen waarheid.
      </p>

      {experience && !experience.enabled ? (
        <p className="muted" role="status">
          Leren staat uit voor {userName}: er wordt niets meer onthouden of gebruikt. Aanzetten kan
          bij Instellingen.
        </p>
      ) : null}
      {cleared ? (
        <p className="form__ok" role="status">
          De ervaring van {userName} is gewist.
        </p>
      ) : null}
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      {experience === null && !error ? <p className="muted">Laden…</p> : null}
      {empty ? <p className="muted">Intento heeft nog niets geleerd van {userName}.</p> : null}

      {symbols.length > 0 ? (
        <>
          <h3 className="panel__subtitle">Pictogrammen die {userName} vaak kiest</h3>
          <ul className="item-list" aria-label="Pictogrammen">
            {symbols.map((symbol) => (
              <li key={symbol.id} className="item-row" aria-label={symbol.label}>
                <div className="item-row__image">
                  {symbol.imageUrl ? (
                    <img src={apiUrl(symbol.imageUrl)} alt="" width={56} height={56} />
                  ) : null}
                </div>
                <div className="record__body">
                  <span className="record__title">{symbol.label}</span>
                  <span className="record__meta">
                    {times(symbol.chosen)} gekozen, van de {times(symbol.presented)} dat het te zien
                    was{symbol.lastUsedAt ? ` · laatst ${when(symbol.lastUsedAt)}` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {contacts.length > 0 ? (
        <>
          <h3 className="panel__subtitle">Naar wie {userName} vaak stuurt</h3>
          <ul className="record-list" aria-label="Contacten">
            {contacts.map((contact) => (
              <li key={contact.id} className="record">
                <div className="record__body">
                  <span className="record__title">{contact.name}</span>
                  <span className="record__meta">
                    {times(contact.chosen)} verstuurd
                    {contact.lastUsedAt ? ` · laatst ${when(contact.lastUsedAt)}` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {modes.length > 0 ? (
        <>
          <h3 className="panel__subtitle">Hoe het gesprek ging</h3>
          <ul className="record-list" aria-label="Vormen">
            {modes.map((mode) => (
              <li key={mode.mode} className="record">
                <div className="record__body">
                  <span className="record__title">{MODE_LABELS.get(mode.mode) ?? mode.mode}</span>
                  <span className="record__meta">
                    {mode.presented === 1 ? '1 gesprek' : `${mode.presented} gesprekken`},{' '}
                    {times(mode.chosen)} tot een bevestigd bericht
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {experience && !empty ? (
        <div className="form__actions">
          <button
            className="button button--danger"
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Ervaring wissen
          </button>
        </div>
      ) : null}

      {confirming ? (
        <Modal title={`Ervaring van ${userName} wissen?`} onClose={() => setConfirming(false)}>
          <p>
            Intento vergeet wat {userName} vaak koos en begint opnieuw met leren. Dit is niet terug
            te draaien.
          </p>
          <div className="form__actions">
            <button className="button button--danger" type="button" onClick={() => void clear()}>
              Ja, wissen
            </button>
            <button className="button" type="button" onClick={() => setConfirming(false)}>
              Annuleren
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
