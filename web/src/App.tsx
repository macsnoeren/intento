import { useEffect, useState } from 'react';
import type { AccountPublic } from '@intento/shared';
import { ApiRequestError, httpApi, type Api } from './api.ts';
import { LoginForm } from './LoginForm.tsx';
import { RegisterForm } from './RegisterForm.tsx';
import { AdminUsersPage } from './AdminUsersPage.tsx';
import { DashboardPage } from './DashboardPage.tsx';
import { AuditLogPage } from './AuditLogPage.tsx';
import { VocabularyPage } from './VocabularyPage.tsx';
import { AttributionsPage } from './AttributionsPage.tsx';
import { OrganizationPage } from './OrganizationPage.tsx';
import { AccountPage } from './AccountPage.tsx';
import { VerifyEmailPage } from './VerifyEmailPage.tsx';
import { VerificationBanner } from './VerificationBanner.tsx';
import { ChangePasswordPanel } from './ChangePasswordPanel.tsx';
import type { AdminView } from './AdminNav.tsx';
import { AuthLayout } from './AuthLayout.tsx';

/**
 * Leest een verificatietoken (`?token=…`) uit de huidige URL (de link uit de verificatiemail,
 * T1.4). `null` als er geen token in de URL staat. Injecteerbaar (`search`) voor tests.
 */
function readVerificationToken(search: string = window.location.search): string | null {
  const token = new URLSearchParams(search).get('token');
  return token && token.length > 0 ? token : null;
}

/**
 * Beheeromgeving (fase 2). Regelt de sessie-toestand: eerst `GET /auth/me`; bij een geldige
 * sessie de juiste weergave, anders het login-scherm. Het gebruikersbeheer is voor
 * beheerders (INTENTO-NEW-DESIGN §49). De gebruikersapp en begeleiderinterface volgen in latere fases.
 *
 * `api` is injecteerbaar zodat tests een in-memory backend kunnen meegeven.
 */
export function App({
  api = httpApi,
  initialVerificationToken = readVerificationToken(),
}: {
  api?: Api;
  /** Verificatietoken uit de URL; injecteerbaar in tests. */
  initialVerificationToken?: string | null;
} = {}): React.JSX.Element {
  const [account, setAccount] = useState<AccountPublic | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<AdminView>('users');
  // Ongeauthenticeerde weergave: inloggen of zelf een nieuwe omgeving aanmelden.
  const [authScreen, setAuthScreen] = useState<'login' | 'register'>('login');
  // Verificatietoken uit de e-maillink: zolang gezet tonen we de verificatiepagina.
  const [verificationToken, setVerificationToken] = useState<string | null>(
    initialVerificationToken,
  );

  async function refreshAccount(): Promise<void> {
    try {
      const { account: me } = await api.me();
      setAccount(me);
    } catch (err) {
      if (!(err instanceof ApiRequestError)) throw err;
      setAccount(null);
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { account: me } = await api.me();
        if (active) setAccount(me);
      } catch (err) {
        // 401 = niet ingelogd (verwacht); andere fouten negeren we hier en tonen het loginscherm.
        if (!(err instanceof ApiRequestError)) throw err;
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  async function handleLogout(): Promise<void> {
    try {
      await api.logout();
    } finally {
      setAccount(null);
    }
  }

  // Verificatielink uit de mail: eerst het token inwisselen, daarna terug naar de app.
  if (verificationToken) {
    return (
      <VerifyEmailPage
        api={api}
        token={verificationToken}
        onDone={() => {
          // Token uit de URL halen zodat een refresh 'm niet opnieuw inwisselt, en de
          // accountstatus verversen (emailVerified kan nu gewijzigd zijn).
          if (typeof window !== 'undefined') {
            window.history.replaceState(null, '', window.location.pathname);
          }
          setVerificationToken(null);
          void refreshAccount();
        }}
      />
    );
  }

  if (checking) {
    return (
      <AuthLayout title="Even geduld">
        <p className="muted">Bezig met laden…</p>
      </AuthLayout>
    );
  }

  if (!account) {
    if (authScreen === 'register') {
      return (
        <RegisterForm
          api={api}
          onRegistered={({ account: me }) => setAccount(me)}
          onBackToLogin={() => setAuthScreen('login')}
        />
      );
    }
    return (
      <LoginForm
        api={api}
        onLoggedIn={({ account: me }) => setAccount(me)}
        onRegister={() => setAuthScreen('register')}
      />
    );
  }

  // Tijdelijk wachtwoord: dit account draait nog op het wachtwoord dat de beheerder bij het
  // aanmaken te zien kreeg. De server laat dan alleen `GET /auth/me` en `POST /auth/password`
  // toe, dus elke gewone weergave zou vol 403's staan. Daarom één blokkerend scherm met precies de
  // uitweg erin — geen zachte banner die je kunt wegkijken, want tot de wissel kent een tweede
  // persoon dit wachtwoord.
  if (account.mustChangePassword) {
    return (
      <AuthLayout
        title="Kies eerst een eigen wachtwoord"
        intro="Je kwam binnen met een tijdelijk wachtwoord van je beheerder — die kent het dus ook. Kies hieronder een eigen wachtwoord; daarna staat de rest van Intento voor je open."
      >
        <ChangePasswordPanel api={api} onChanged={() => void refreshAccount()} />
        <button className="button" type="button" onClick={() => void handleLogout()}>
          Uitloggen
        </button>
      </AuthLayout>
    );
  }

  // Herinneringsbanner zolang het e-mailadres niet is bevestigd.
  const banner = account.emailVerified ? null : (
    <VerificationBanner api={api} email={account.email} />
  );

  // Begeleider (CAREGIVER): een eigen, korter menu. De vraagmodus is vervallen (ontwerp besluit 10);
  // instellingen en contacten van gekoppelde gebruikers komen terug in N3.4 en N10.3.
  if (account.role === 'CAREGIVER') {
    return (
      <>
        {banner}
        {view === 'vocabulary' ? (
          <VocabularyPage
            api={api}
            account={account}
            onLogout={() => void handleLogout()}
            onNavigate={setView}
          />
        ) : view === 'sources' ? (
          <AttributionsPage
            api={api}
            account={account}
            onLogout={() => void handleLogout()}
            onNavigate={setView}
          />
        ) : (
          <AccountPage
            api={api}
            account={account}
            onLogout={() => void handleLogout()}
            onNavigate={setView}
          />
        )}
      </>
    );
  }

  if (account.role !== 'ADMIN') {
    return (
      <>
        {banner}
        <AuthLayout title="Welkom bij Intento" intro="Deze rol heeft nog geen eigen weergave.">
          <button className="button" type="button" onClick={() => void handleLogout()}>
            Uitloggen
          </button>
        </AuthLayout>
      </>
    );
  }

  if (view === 'dashboard') {
    return (
      <>
        {banner}
        <DashboardPage
          api={api}
          account={account}
          onLogout={() => void handleLogout()}
          onNavigate={setView}
        />
      </>
    );
  }
  if (view === 'account') {
    return (
      <>
        {banner}
        <AccountPage
          api={api}
          account={account}
          onLogout={() => void handleLogout()}
          onNavigate={setView}
        />
      </>
    );
  }

  if (view === 'vocabulary') {
    return (
      <>
        {banner}
        <VocabularyPage
          api={api}
          account={account}
          onLogout={() => void handleLogout()}
          onNavigate={setView}
        />
      </>
    );
  }

  if (view === 'sources') {
    return (
      <>
        {banner}
        <AttributionsPage
          api={api}
          account={account}
          onLogout={() => void handleLogout()}
          onNavigate={setView}
        />
      </>
    );
  }

  if (view === 'organization') {
    return (
      <>
        {banner}
        <OrganizationPage
          api={api}
          account={account}
          onLogout={() => void handleLogout()}
          onNavigate={setView}
        />
      </>
    );
  }

  if (view === 'audit-logs') {
    return (
      <>
        {banner}
        <AuditLogPage
          api={api}
          account={account}
          onLogout={() => void handleLogout()}
          onNavigate={setView}
        />
      </>
    );
  }

  return (
    <>
      {banner}
      <AdminUsersPage
        api={api}
        account={account}
        onLogout={() => void handleLogout()}
        onNavigate={setView}
      />
    </>
  );
}
