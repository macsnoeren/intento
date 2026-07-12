import { useEffect, useState } from 'react';
import type { AccountPublic } from '@intento/shared';
import { ApiRequestError, httpApi, type Api } from './api.ts';
import { LoginForm } from './LoginForm.tsx';
import { RegisterForm } from './RegisterForm.tsx';
import { AdminUsersPage } from './AdminUsersPage.tsx';
import { QuestionModePage } from './QuestionModePage.tsx';
import { AacLibraryPage } from './AacLibraryPage.tsx';
import { WorkerTokensPage } from './WorkerTokensPage.tsx';
import { DashboardPage } from './DashboardPage.tsx';
import { AuditLogPage } from './AuditLogPage.tsx';
import { ConceptProposalsPage } from './ConceptProposalsPage.tsx';
import { VerifyEmailPage } from './VerifyEmailPage.tsx';
import { VerificationBanner } from './VerificationBanner.tsx';
import type { AdminView } from './AdminNav.tsx';

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
 * beheerders (DESIGN §2, §5.2). De gebruikersapp en begeleiderinterface volgen in latere fases.
 *
 * `api` is injecteerbaar zodat tests een in-memory backend kunnen meegeven.
 */
export function App({
  api = httpApi,
  initialVerificationToken = readVerificationToken(),
}: {
  api?: Api;
  /** Verificatietoken uit de URL (T1.4); injecteerbaar in tests. */
  initialVerificationToken?: string | null;
} = {}): React.JSX.Element {
  const [account, setAccount] = useState<AccountPublic | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<AdminView>('users');
  // Ongeauthenticeerde weergave: inloggen of zelf een nieuwe omgeving aanmelden (T1.3).
  const [authScreen, setAuthScreen] = useState<'login' | 'register'>('login');
  // Verificatietoken uit de e-maillink (T1.4): zolang gezet tonen we de verificatiepagina.
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

  // Verificatielink uit de mail (T1.4): eerst het token inwisselen, daarna terug naar de app.
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
      <main className="panel panel--narrow">
        <p className="muted">Laden…</p>
      </main>
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

  // Herinneringsbanner zolang het e-mailadres niet is bevestigd (T1.4).
  const banner = account.emailVerified ? null : (
    <VerificationBanner api={api} email={account.email} />
  );

  // Begeleider (CAREGIVER): de begeleiderinterface — nu de vraagmodus (T7.1, DESIGN §3.2, §5.2).
  if (account.role === 'CAREGIVER') {
    return (
      <>
        {banner}
        <QuestionModePage api={api} account={account} onLogout={() => void handleLogout()} />
      </>
    );
  }

  if (account.role !== 'ADMIN') {
    return (
      <main className="panel panel--narrow">
        {banner}
        <h1 className="panel__title">Intento</h1>
        <p>Deze rol heeft nog geen eigen weergave.</p>
        <button className="button" type="button" onClick={() => void handleLogout()}>
          Uitloggen
        </button>
      </main>
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

  if (view === 'proposals') {
    return (
      <>
        {banner}
        <ConceptProposalsPage
          api={api}
          account={account}
          onLogout={() => void handleLogout()}
          onNavigate={setView}
        />
      </>
    );
  }

  if (view === 'aac') {
    return (
      <>
        {banner}
        <AacLibraryPage
          api={api}
          account={account}
          onLogout={() => void handleLogout()}
          onNavigate={setView}
        />
      </>
    );
  }

  if (view === 'worker-tokens') {
    return (
      <>
        {banner}
        <WorkerTokensPage
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
