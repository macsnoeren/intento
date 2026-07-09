import { useState, type FormEvent } from 'react';
import { organizationTypeSchema, type AuthResponse, type OrganizationType } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Zelfaanmeldscherm (T1.3, DESIGN §2, §3.7 stap 1). Een nieuwe bezoeker meldt in één keer een
 * organisatie/familie aan én maakt het eerste ADMIN-account. Roept `POST /auth/register` aan; bij
 * succes is de bezoeker meteen ingelogd en geeft de bovenliggende app het account door.
 *
 * De validatie leunt op de server (gedeelde zod-schema's); dit formulier doet alleen lichte
 * hints (`required`, `minLength`) zodat de gebruiker snel feedback krijgt. Foutmeldingen komen
 * uit de backend (o.a. de neutrale melding bij een reeds bestaand e-mailadres).
 */

const TYPE_LABELS: Record<OrganizationType, string> = {
  family: 'Familie',
  care: 'Zorginstelling',
  personal: 'Persoonlijk',
};

export function RegisterForm({
  api,
  onRegistered,
  onBackToLogin,
}: {
  api: Api;
  onRegistered: (auth: AuthResponse) => void;
  onBackToLogin: () => void;
}): React.JSX.Element {
  const [organizationName, setOrganizationName] = useState('');
  const [organizationType, setOrganizationType] = useState<OrganizationType>('family');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onRegistered(
        await api.register({ organizationName, organizationType, adminName, email, password }),
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Aanmelden mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="panel panel--narrow">
      <h1 className="panel__title">Intento — nieuwe omgeving</h1>
      <form className="form" onSubmit={(e) => void handleSubmit(e)} aria-label="Aanmelden">
        <label className="field">
          <span className="field__label">Naam van de organisatie of familie</span>
          <input
            className="field__input"
            type="text"
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Soort omgeving</span>
          <select
            className="field__input"
            value={organizationType}
            onChange={(e) => setOrganizationType(organizationTypeSchema.parse(e.target.value))}
          >
            {organizationTypeSchema.options.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Jouw naam (beheerder)</span>
          <input
            className="field__input"
            type="text"
            autoComplete="name"
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">E-mail</span>
          <input
            className="field__input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Wachtwoord (minstens 12 tekens)</span>
          <input
            className="field__input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? (
          <p className="form__error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Bezig…' : 'Omgeving aanmaken'}
        </button>
      </form>
      <button className="button" type="button" onClick={onBackToLogin}>
        Al een account? Inloggen
      </button>
    </main>
  );
}
