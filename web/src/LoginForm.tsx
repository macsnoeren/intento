import { useState, type FormEvent } from 'react';
import type { AuthResponse } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import { AuthLayout } from './AuthLayout.tsx';

/**
 * Login-scherm voor de beheeromgeving. Roept `POST /auth/login` aan en geeft het ingelogde
 * account door aan de bovenliggende app. Fouten (verkeerd wachtwoord, lockout, rate limit)
 * worden getoond met de melding uit de backend.
 */
export function LoginForm({
  api,
  onLoggedIn,
  onRegister,
}: {
  api: Api;
  onLoggedIn: (auth: AuthResponse) => void;
  /** Optioneel: schakelt naar het zelfaanmeldscherm (T1.3). */
  onRegister?: () => void;
}): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onLoggedIn(await api.login(email, password));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Inloggen mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Inloggen"
      intro="De beheeromgeving van Intento — voor beheerders en begeleiders."
    >
      <form className="form" onSubmit={(e) => void handleSubmit(e)} aria-label="Inloggen">
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
          <span className="field__label">Wachtwoord</span>
          <input
            className="field__input"
            type="password"
            autoComplete="current-password"
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
          {busy ? 'Bezig…' : 'Inloggen'}
        </button>
      </form>
      {onRegister ? (
        <p className="auth__alt">
          Nog geen omgeving?{' '}
          <button className="button button--link" type="button" onClick={onRegister}>
            Nieuwe omgeving aanmelden
          </button>
        </p>
      ) : null}
    </AuthLayout>
  );
}
