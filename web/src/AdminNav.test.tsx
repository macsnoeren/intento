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

    for (const label of [
      'Dashboard',
      'Begeleiden',
      'Gesprekken',
      'Gebruikers',
      'AAC-bibliotheek',
      'Conceptvoorstellen',
      'Worker-tokens',
      'AI-activiteit',
      'Audit-log',
      'Mijn account',
    ]) {
      expect(within(nav).getByRole('button', { name: label }), label).toBeTruthy();
    }

    // De groepen zijn benoemd, zodat een schermlezer de indeling meekrijgt.
    expect(within(nav).getByRole('group', { name: 'Communicatie' })).toBeTruthy();
    expect(within(nav).getByRole('group', { name: 'Platform' })).toBeTruthy();
  });

  it('geeft een begeleider alleen begeleiden en zijn eigen account', () => {
    render(<AdminNav active="question" role="CAREGIVER" onNavigate={() => {}} />);
    const nav = screen.getByRole('navigation', { name: 'Beheer' });

    expect(within(nav).getByRole('button', { name: 'Begeleiden' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Mijn account' })).toBeTruthy();
    // Geen ingangen naar beheer dat de server hem toch weigert.
    expect(within(nav).queryByRole('button', { name: 'Gebruikers' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Worker-tokens' })).toBeNull();
    // En geen lege groepskoppen die daarvan overblijven.
    expect(within(nav).queryByRole('group', { name: 'Platform' })).toBeNull();
  });

  it('markeert de huidige pagina en meldt elke keuze door', () => {
    const visited: AdminView[] = [];
    render(<AdminNav active="aac" onNavigate={(view) => visited.push(view)} />);
    const nav = screen.getByRole('navigation', { name: 'Beheer' });

    expect(
      within(nav).getByRole('button', { name: 'AAC-bibliotheek' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(nav).getByRole('button', { name: 'Gebruikers' }).getAttribute('aria-current'),
    ).toBeNull();

    fireEvent.click(within(nav).getByRole('button', { name: 'Gesprekken' }));
    expect(visited).toEqual(['conversations']);
  });

  it('gebruikt voor elke bestemming hetzelfde label als de menuknop', () => {
    for (const group of groupsForRole('ADMIN')) {
      for (const item of group.items) {
        expect(labelForView(item.view)).toBe(item.label);
      }
    }
  });
});
