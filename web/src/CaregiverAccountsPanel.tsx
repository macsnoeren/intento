import { useState, type FormEvent } from 'react';
import type { CreateCaregiverResponse } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Begeleider-account aanmaken (T2.4, DESIGN §2, §5.2, FR-017).
 *
 * Tot nu toe ontstonden er alleen ADMIN-accounts (seed + zelfaanmelding), waardoor de
 * koppelweergave van T2.2 leeg bleef met de tekst "maak eerst een begeleider aan" — zonder plek om
 * dat te doen. Dit paneel is die plek: een beheerder vult naam + e-mail in, de **server** maakt het
 * account (rol vast op CAREGIVER, eigen organisatie) en genereert een tijdelijk wachtwoord.
 *
 * Dat wachtwoord wordt hier — net als de koppelcode van T2.3 — **één keer** getoond en is daarna
 * niet meer op te vragen (de backend bewaart alleen de argon2id-hash). Vandaar de expliciete
 * waarschuwing en de oproep om het via een veilig kanaal door te geven.
 */
export function CaregiverAccountsPanel({
  api,
  onCreated,
}: {
  api: Api;
  /** Meldt de beheeromgeving dat de begeleiderlijst (koppelweergave, T2.2) ververst moet worden. */
  onCreated: () => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [created, setCreated] = useState<CreateCaregiverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.createCaregiverAccount({ name: name.trim(), email: email.trim() });
      setCreated(result);
      setName('');
      setEmail('');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Aanmaken mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Begeleider aanmaken">
      <h2 className="panel__subtitle">Begeleider aanmaken</h2>
      <p className="muted">
        Een begeleider krijgt een eigen login. Koppel hem daarna bij een gebruiker onder “Gekoppelde
        begeleiders” — pas dan ziet hij die gebruiker.
      </p>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      <form
        className="form"
        onSubmit={(e) => void handleSubmit(e)}
        aria-label="Begeleider toevoegen"
      >
        <label className="field">
          <span className="field__label">Naam</span>
          <input
            className="field__input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">E-mailadres</span>
          <input
            className="field__input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <button
          className="button button--primary"
          type="submit"
          disabled={busy || !name.trim() || !email.trim()}
        >
          Begeleider aanmaken
        </button>
      </form>

      {created ? (
        <div className="device-code" role="status">
          <p className="muted">
            Account voor <strong>{created.account.name ?? created.account.email}</strong>{' '}
            aangemaakt. Geef dit tijdelijke wachtwoord via een veilig kanaal door — het is hierna
            niet meer op te vragen:
          </p>
          <p className="temporary-password">{created.temporaryPassword}</p>
          <p className="muted">
            De begeleider logt hiermee in op {created.account.email} en krijgt een e-mail om zijn
            adres te bevestigen.
          </p>
        </div>
      ) : null}
    </section>
  );
}
