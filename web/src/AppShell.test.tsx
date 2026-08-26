import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountPublic } from '@intento/shared';
import { AppShell } from './AppShell.tsx';

/**
 * Tests voor het vaste raamwerk om elke ingelogde pagina (T17.1): menu, kopbalk, inhoud.
 */

function account(overrides: Partial<AccountPublic> = {}): AccountPublic {
  return {
    id: 'acc-1',
    email: 'ada@intento.local',
    role: 'ADMIN',
    organizationId: 'org-1',
    name: 'Ada de Beheerder',
    emailVerified: true,
    mustChangePassword: false,
    isOperator: false,
    ...overrides,
  };
}

describe('app-raamwerk', () => {
  it('zet de paginatitel als enige kop en toont wie je bent', () => {
    render(
      <AppShell
        account={account()}
        title="Gebruikersbeheer"
        subtitle="De mensen die met Intento communiceren."
        active="users"
        onNavigate={() => {}}
        onLogout={() => {}}
      >
        <p>inhoud</p>
      </AppShell>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Gebruikersbeheer' })).toBeTruthy();
    expect(screen.getByText('De mensen die met Intento communiceren.')).toBeTruthy();
    expect(screen.getByText('Ada de Beheerder')).toBeTruthy();
    // De rol staat erbij: op een gedeelde werkplek moet zichtbaar zijn met wiens rechten je kijkt.
    expect(screen.getByText(/Beheerder · ada@intento\.local/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Uitloggen' })).toBeTruthy();
  });

  it('valt terug op het e-mailadres als het account geen naam heeft', () => {
    render(
      <AppShell account={account({ name: null })} title="Dashboard" onLogout={() => {}}>
        <p>inhoud</p>
      </AppShell>,
    );
    expect(screen.getAllByText('ada@intento.local').length).toBeGreaterThan(0);
  });

  it('toont het menu met de actieve pagina gemarkeerd en navigeert', () => {
    const visited: string[] = [];
    render(
      <AppShell
        account={account()}
        title="Dashboard"
        active="dashboard"
        onNavigate={(view) => visited.push(view)}
        onLogout={() => {}}
      >
        <p>inhoud</p>
      </AppShell>,
    );

    const nav = screen.getByRole('navigation', { name: 'Beheer' });
    expect(
      within(nav).getByRole('button', { name: 'Dashboard' }).getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(within(nav).getByRole('button', { name: 'Gebruikers' }));
    expect(visited).toEqual(['users']);
  });

  it('toont zonder navigatiefunctie geen menu, maar wel het merk', () => {
    render(
      <AppShell account={account()} title="Operatorconsole" onLogout={() => {}}>
        <p>inhoud</p>
      </AppShell>,
    );

    expect(screen.queryByRole('navigation', { name: 'Beheer' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Menu/ })).toBeNull();
    expect(screen.getByText('Intento')).toBeTruthy();
  });

  it('schuift het menu op een smal scherm open en weer dicht', () => {
    render(
      <AppShell
        account={account()}
        title="Dashboard"
        active="dashboard"
        onNavigate={() => {}}
        onLogout={() => {}}
      >
        <p>inhoud</p>
      </AppShell>,
    );

    const menuButton = screen.getByRole('button', { name: /Menu/ });
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    // De knop wijst naar het menu dat hij bedient; anders weet een schermlezer niet wat er opengaat.
    expect(menuButton.getAttribute('aria-controls')).toBe('hoofdmenu');

    fireEvent.click(menuButton);
    expect(menuButton.getAttribute('aria-expanded')).toBe('true');

    // Buiten het menu tikken sluit het weer.
    fireEvent.click(screen.getByRole('button', { name: 'Menu sluiten' }));
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
  });

  it('sluit het menu zodra er een bestemming gekozen is', () => {
    render(
      <AppShell
        account={account()}
        title="Dashboard"
        active="dashboard"
        onNavigate={() => {}}
        onLogout={() => {}}
      >
        <p>inhoud</p>
      </AppShell>,
    );

    const menuButton = screen.getByRole('button', { name: /Menu/ });
    fireEvent.click(menuButton);
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Beheer' })).getByRole('button', {
        name: 'Gebruikers',
      }),
    );
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
  });

  it('geeft een begeleider het korte menu', () => {
    render(
      <AppShell
        account={account({ role: 'CAREGIVER', name: 'Bram Begeleider' })}
        title="Vraag stellen"
        active="question"
        onNavigate={() => {}}
        onLogout={() => {}}
      >
        <p>inhoud</p>
      </AppShell>,
    );

    const nav = screen.getByRole('navigation', { name: 'Beheer' });
    expect(within(nav).getByRole('button', { name: 'Mijn account' })).toBeTruthy();
    expect(within(nav).queryByRole('button', { name: 'Gebruikers' })).toBeNull();
    expect(screen.getByText(/Begeleider · ada@intento\.local/)).toBeTruthy();
  });
});
