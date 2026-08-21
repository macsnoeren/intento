import type { AccountPublic } from '@intento/shared';
import type { Api } from './api.ts';
import { AdminNav, type AdminView } from './AdminNav.tsx';
import { ChangePasswordPanel } from './ChangePasswordPanel.tsx';

/**
 * Beheeromgeving — **eigen account** (T2.5, DESIGN §5.2, §9.4). De plek waar een ingelogd account
 * zijn eigen gegevens beheert; nu alleen het wachtwoord. Bewust een eigen tab en niet verstopt in
 * het gebruikersbeheer: dat gaat over *andere* mensen, dit over jezelf.
 */
export function AccountPage({
  api,
  account,
  onLogout,
  onNavigate,
}: {
  api: Api;
  account: AccountPublic;
  onLogout: () => void;
  onNavigate: (view: AdminView) => void;
}): React.JSX.Element {
  return (
    <main className="admin">
      <header className="admin__header">
        <div>
          <h1 className="panel__title">Mijn account</h1>
          <AdminNav active="account" onNavigate={onNavigate} />
        </div>
        <div className="admin__account">
          <span>{account.email}</span>
          <button className="button" type="button" onClick={onLogout}>
            Uitloggen
          </button>
        </div>
      </header>

      <section className="panel" aria-label="Accountgegevens">
        <h2 className="panel__subtitle">Gegevens</h2>
        <p className="muted">
          {account.name ? `${account.name} · ` : ''}
          {account.email} · rol {account.role === 'ADMIN' ? 'beheerder' : 'begeleider'} ·{' '}
          {account.emailVerified ? 'e-mailadres bevestigd' : 'e-mailadres nog niet bevestigd'}
        </p>
      </section>

      <ChangePasswordPanel api={api} />
    </main>
  );
}
