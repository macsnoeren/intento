import { useState, type FormEvent } from 'react';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Eigen wachtwoord wijzigen (T2.5, DESIGN §2, §9.4).
 *
 * Vooral bedoeld voor de begeleider die met het **tijdelijke** wachtwoord uit T2.4 binnenkomt: dat
 * wachtwoord is door de beheerder aangemaakt en bij hem bekend, dus het hoort meteen vervangen te
 * worden. Elk ingelogd account (ADMIN én CAREGIVER) ziet dit paneel in zijn eigen weergave.
 *
 * Het huidige wachtwoord moet mee (her-authenticatie op de server) en de bevestiging van het
 * nieuwe wachtwoord wordt hier — puur als tikfoutbescherming — al vergeleken; de echte
 * sterkte-eis (`strongPasswordSchema`) en alle controles gebeuren op de server.
 */
export function ChangePasswordPanel({ api }: { api: Api }): React.JSX.Element {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = repeat.length > 0 && repeat !== newPassword;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (mismatch) {
      setError('De twee nieuwe wachtwoorden zijn niet gelijk.');
      return;
    }
    setBusy(true);
    try {
      const { revokedSessions } = await api.changePassword({ currentPassword, newPassword });
      // Velden meteen leegmaken: geen wachtwoord dat op een onbeheerd scherm blijft staan.
      setCurrentPassword('');
      setNewPassword('');
      setRepeat('');
      setDone(
        revokedSessions > 0
          ? `Wachtwoord gewijzigd. Andere apparaten (${revokedSessions}) zijn uitgelogd en moeten opnieuw inloggen.`
          : 'Wachtwoord gewijzigd. Gebruik voortaan je nieuwe wachtwoord.',
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Wijzigen mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Wachtwoord wijzigen">
      <h2 className="panel__subtitle">Wachtwoord wijzigen</h2>
      <p className="muted">
        Kies een eigen wachtwoord van minstens 12 tekens. Ben je begonnen met een tijdelijk
        wachtwoord van je beheerder? Vervang het hier — dan kent alleen jij het nog. Je blijft op
        dit apparaat ingelogd; andere apparaten moeten opnieuw inloggen.
      </p>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="form__ok" role="status">
          {done}
        </p>
      ) : null}

      <form
        className="form"
        onSubmit={(e) => void handleSubmit(e)}
        aria-label="Wachtwoord wijzigen"
      >
        <label className="field">
          <span className="field__label">Huidig wachtwoord</span>
          <input
            className="field__input"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Nieuw wachtwoord</span>
          <input
            className="field__input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Nieuw wachtwoord herhalen</span>
          <input
            className="field__input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            required
          />
        </label>
        {mismatch ? (
          <p className="muted">De twee nieuwe wachtwoorden zijn nog niet gelijk.</p>
        ) : null}
        <button
          className="button button--primary"
          type="submit"
          disabled={busy || !currentPassword || newPassword.length < 12 || mismatch}
        >
          Wachtwoord wijzigen
        </button>
      </form>
    </section>
  );
}
