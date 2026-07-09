import { useEffect, useState } from 'react';
import type { AccountPublic } from '@intento/shared';
import { ApiRequestError, httpApi, type Api } from './api.ts';
import { LoginForm } from './LoginForm.tsx';
import { AdminUsersPage } from './AdminUsersPage.tsx';
import { AacLibraryPage } from './AacLibraryPage.tsx';
import type { AdminView } from './AdminNav.tsx';

/**
 * Beheeromgeving (fase 2). Regelt de sessie-toestand: eerst `GET /auth/me`; bij een geldige
 * sessie de juiste weergave, anders het login-scherm. Het gebruikersbeheer is voor
 * beheerders (DESIGN §2, §5.2). De gebruikersapp en begeleiderinterface volgen in latere fases.
 *
 * `api` is injecteerbaar zodat tests een in-memory backend kunnen meegeven.
 */
export function App({ api = httpApi }: { api?: Api } = {}): React.JSX.Element {
  const [account, setAccount] = useState<AccountPublic | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<AdminView>('users');

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

  if (checking) {
    return (
      <main className="panel panel--narrow">
        <p className="muted">Laden…</p>
      </main>
    );
  }

  if (!account) {
    return <LoginForm api={api} onLoggedIn={({ account: me }) => setAccount(me)} />;
  }

  if (account.role !== 'ADMIN') {
    return (
      <main className="panel panel--narrow">
        <h1 className="panel__title">Intento</h1>
        <p>Alleen beheerders hebben toegang tot het gebruikersbeheer.</p>
        <button className="button" type="button" onClick={() => void handleLogout()}>
          Uitloggen
        </button>
      </main>
    );
  }

  if (view === 'aac') {
    return (
      <AacLibraryPage
        api={api}
        account={account}
        onLogout={() => void handleLogout()}
        onNavigate={setView}
      />
    );
  }

  return (
    <AdminUsersPage
      api={api}
      account={account}
      onLogout={() => void handleLogout()}
      onNavigate={setView}
    />
  );
}
