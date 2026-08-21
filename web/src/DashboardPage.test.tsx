import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountPublic, DashboardResponse } from '@intento/shared';
import { DashboardPage } from './DashboardPage.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor het beheerdashboard (T7.3). Draaien tegen een in-memory `Api` (de server-kant is
 * met API-tests gedekt). Toetst dat de tellingen en recente activiteit tonen en dat de tegel
 * "openstaande voorstellen" naar de reviewlijst navigeert.
 */

const adminAccount: AccountPublic = {
  id: 'acc-1',
  email: 'admin@intento.local',
  role: 'ADMIN',
  organizationId: 'org-1',
  name: null,
  emailVerified: true,
  mustChangePassword: false,
  isOperator: false,
};

function fakeApi(dashboard: DashboardResponse): Api {
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return {
    ...base,
    getDashboard: () => Promise.resolve(dashboard),
  };
}

describe('beheerdashboard', () => {
  it('toont de tellingen en recente activiteit', async () => {
    const api = fakeApi({
      users: { total: 3, active: 2 },
      caregivers: { total: 1 },
      pendingProposals: 4,
      recentActivity: [
        {
          sessionId: 's-1',
          userId: 'u-1',
          userName: 'Sanne',
          status: 'COMPLETED',
          mode: 'free',
          messageCount: 1,
          startedAt: '2026-07-12T09:00:00.000Z',
        },
      ],
    });
    render(<DashboardPage api={api} account={adminAccount} onLogout={() => {}} onNavigate={() => {}} />);

    // Tellingen zichtbaar.
    expect(await screen.findByText('3')).toBeTruthy();
    expect(screen.getByText('2 actief')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    // Recente activiteit toont de gebruiker en status, zonder communicatie-inhoud.
    expect(screen.getByText('Sanne')).toBeTruthy();
    expect(screen.getByText('Afgerond')).toBeTruthy();
  });

  it('navigeert vanaf de tegel naar de conceptvoorstellen', async () => {
    let navigatedTo: string | null = null;
    const api = fakeApi({
      users: { total: 0, active: 0 },
      caregivers: { total: 0 },
      pendingProposals: 2,
      recentActivity: [],
    });
    render(
      <DashboardPage
        api={api}
        account={adminAccount}
        onLogout={() => {}}
        onNavigate={(view) => {
          navigatedTo = view;
        }}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: /openstaande conceptvoorstellen bekijken/i }),
    );
    expect(navigatedTo).toBe('proposals');
  });
});
