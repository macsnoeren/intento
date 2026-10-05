import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdminNav, groupsForRole, labelForView, type AdminView } from './AdminNav.tsx';

/**
 * Menutests (T17.1). Het menu is de plattegrond van de app: mist een rol een ingang, dan is die
 * bestemming onbereikbaar; staat er een ingang te veel, dan loopt iemand tegen een 403 aan.
 */
describe('hoofdmenu', () => {
  it('toont de beheerder alle bestemmingen, gegroepeerd naar wat hij komt doen', () => {
    render(<AdminNav active="dashboard" onNavigate={() => {}} />);
    const nav = screen.getByRole('navigation', { name: 'Beheer' });

    for (const label of ['Dashboard', 'Gebruikers', 'Audit-log', 'Mijn account']) {
      expect(within(nav).getByRole('button', { name: label }), label).toBeTruthy();
    }

    // De groepen zijn benoemd, zodat een schermlezer de indeling meekrijgt.
    expect(within(nav).getByRole('group', { name: 'Organisatie' })).toBeTruthy();
    expect(within(nav).getByRole('group', { name: 'Platform' })).toBeTruthy();
  });

  it("toont geen menu-items van verdwenen pagina's (N0.3)", () => {
    render(<AdminNav active="dashboard" onNavigate={() => {}} />);
    const nav = screen.getByRole('navigation', { name: 'Beheer' });
    for (const label of [
      'Begeleiden',
      'Gesprekken',
      'AAC-bibliotheek',
      'Conceptvoorstellen',
      'Worker-tokens',
      'AI-activiteit',
    ]) {
      expect(within(nav).queryByRole('button', { name: label }), label).toBeNull();
    }
  });

  it('geeft een begeleider alleen zijn eigen account', () => {
    render(<AdminNav active="account" role="CAREGIVER" onNavigate={() => {}} />);
    const nav = screen.getByRole('navigation', { name: 'Beheer' });

    expect(within(nav).getAllByRole('button')).toHaveLength(1);
    expect(within(nav).getByRole('button', { name: 'Mijn account' })).toBeTruthy();
    // Geen ingangen naar beheer dat de server hem toch weigert.
    expect(within(nav).queryByRole('button', { name: 'Gebruikers' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Worker-tokens' })).toBeNull();
    // En geen lege groepskoppen die daarvan overblijven.
    expect(within(nav).queryByRole('group', { name: 'Platform' })).toBeNull();
  });

  it('markeert de huidige pagina en meldt elke keuze door', () => {
    const visited: AdminView[] = [];
    render(<AdminNav active="users" onNavigate={(view) => visited.push(view)} />);
    const nav = screen.getByRole('navigation', { name: 'Beheer' });

    expect(
      within(nav).getByRole('button', { name: 'Gebruikers' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(nav).getByRole('button', { name: 'Audit-log' }).getAttribute('aria-current'),
    ).toBeNull();

    fireEvent.click(within(nav).getByRole('button', { name: 'Audit-log' }));
    expect(visited).toEqual(['audit-logs']);
  });

  it('gebruikt voor elke bestemming hetzelfde label als de menuknop', () => {
    for (const group of groupsForRole('ADMIN')) {
      for (const item of group.items) {
        expect(labelForView(item.view)).toBe(item.label);
      }
    }
  });
});
