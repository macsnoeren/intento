import { useState } from 'react';
import type { AccountPublic } from '@intento/shared';
import { AdminNav, type AdminView, type NavRole } from './AdminNav.tsx';
import { BrandLockup, BrandMark, BRAND_NAME, BRAND_PAYOFF } from './Brand.tsx';

/**
 * Het vaste raamwerk om elke ingelogde pagina heen (T17.1): zijbalk met het menu, kopbalk met de
 * paginatitel en rechts wie je bent, en daaronder de inhoud van de pagina.
 *
 * Waarom één component en niet per pagina een eigen kop: tot T17.1 herhaalde elke pagina dezelfde
 * twintig regels kop-JSX, en dat liep uiteen — de ene pagina toonde de AI-indicator, de andere niet,
 * en "Vraag stellen" zette het menu op een andere plek dan de rest. Eén raamwerk houdt de app op elke
 * pagina hetzelfde, en een nieuwe pagina hoeft alleen nog te zeggen hoe hij heet.
 *
 * Zonder `onNavigate` valt de zijbalk weg (de kopbalk toont dan het logo). Dat is de losse weergave:
 * een pagina die buiten het menu om getoond wordt, bijvoorbeeld in een component-test.
 *
 * Op een smal scherm schuift de zijbalk weg achter een menuknop. De knoppen blijven dan gewoon in de
 * DOM staan — alleen de weergave verandert — zodat toetsenbord en schermlezer hetzelfde menu houden.
 */
export function AppShell({
  account,
  title,
  subtitle,
  active,
  onNavigate,
  onLogout,
  status,
  children,
}: {
  account: AccountPublic;
  /** Paginatitel; wordt de `<h1>` van de pagina. */
  title: string;
  /** Eén regel die zegt waar de pagina voor is. Optioneel — laat 'm weg als de titel het al zegt. */
  subtitle?: string;
  /** Welke menu-ingang actief is. Niet nodig in de losse weergave (zonder `onNavigate`). */
  active?: AdminView;
  /** Ontbreekt deze, dan toont de pagina geen menu (losse weergave). */
  onNavigate?: (view: AdminView) => void;
  onLogout: () => void;
  /** Ruimte voor een statusindicator in de kopbalk (bv. "AI denkt mee"). */
  status?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const role: NavRole = account.role === 'ADMIN' ? 'ADMIN' : 'CAREGIVER';
  const roleLabel = account.role === 'ADMIN' ? 'Beheerder' : 'Begeleider';

  const classes = ['app-shell'];
  if (!onNavigate) classes.push('app-shell--bare');
  if (menuOpen) classes.push('app-shell--menu-open');

  return (
    <div className={classes.join(' ')}>
      {onNavigate ? (
        <aside className="app-sidebar" id="hoofdmenu">
          <div className="app-sidebar__brand">
            <BrandLockup height={30} />
          </div>
          <AdminNav
            active={active ?? 'dashboard'}
            role={role}
            onNavigate={(view) => {
              // Op een smal scherm ligt het menu over de pagina heen; na een keuze hoort het weg.
              setMenuOpen(false);
              onNavigate(view);
            }}
          />
          <p className="app-sidebar__payoff">{BRAND_PAYOFF}</p>
        </aside>
      ) : null}

      <div className="app-main">
        <header className="app-topbar">
          {onNavigate ? (
            <button
              type="button"
              className="app-topbar__menu"
              aria-expanded={menuOpen}
              aria-controls="hoofdmenu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">☰</span> Menu
            </button>
          ) : (
            <span className="app-topbar__brand">
              <BrandMark size={36} />
              <span className="app-topbar__brand-name">{BRAND_NAME}</span>
            </span>
          )}

          <div className="app-topbar__heading">
            <h1 className="app-topbar__title">{title}</h1>
            {subtitle ? <p className="app-topbar__subtitle">{subtitle}</p> : null}
          </div>

          <div className="app-topbar__account">
            {status}
            <span className="app-account">
              <span className="app-account__name">{account.name ?? account.email}</span>
              <span className="app-account__role">
                {roleLabel}
                {account.name ? ` · ${account.email}` : ''}
              </span>
            </span>
            <button className="button" type="button" onClick={onLogout}>
              Uitloggen
            </button>
          </div>
        </header>

        <main className="app-content">{children}</main>
      </div>

      {/* Klikvlak achter het opengeschoven menu: overal buiten het menu tikken sluit het weer. */}
      {menuOpen ? (
        <button
          type="button"
          className="app-scrim"
          aria-label="Menu sluiten"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
    </div>
  );
}
