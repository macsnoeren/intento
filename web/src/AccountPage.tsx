import type { AccountPublic } from '@intento/shared';
import type { Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';
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
    <AppShell
      account={account}
      title="Mijn account"
      subtitle="Je eigen gegevens en wachtwoord."
      active="account"
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      <section className="panel" aria-label="Accountgegevens">
        <h2 className="panel__subtitle">Gegevens</h2>
        <p className="muted">
          {account.name ? `${account.name} · ` : ''}
          {account.email} · rol {account.role === 'ADMIN' ? 'beheerder' : 'begeleider'} ·{' '}
          {account.emailVerified ? 'e-mailadres bevestigd' : 'e-mailadres nog niet bevestigd'}
        </p>
      </section>

      {/* Platform-operator (T8.3): de console is een aparte routetak (`/operator`) en staat bewust
          níét als tab tussen het tenant-beheer — cross-tenant beheer hoort geen klik naast
          "Gebruikers" te zijn. Wel één expliciete link voor wie de bevoegdheid heeft, anders is de
          console onvindbaar. De link is geen beveiliging: de server weigert elke operator-call van
          een niet-operator. */}
      {account.isOperator ? (
        <section className="panel" aria-label="Platformbeheer">
          <h2 className="panel__subtitle">Platformbeheer</h2>
          <p className="muted">
            Dit account is platform-operator. De operatorconsole beheert omgevingen over
            organisaties heen en staat los van dit beheerscherm.
          </p>
          <a className="button" href="/operator">
            Operatorconsole openen
          </a>
        </section>
      ) : null}

      <ChangePasswordPanel api={api} />
    </AppShell>
  );
}
