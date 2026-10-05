import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountPublic, DashboardResponse } from '@intento/shared';
import { DashboardPage } from './DashboardPage.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor het beheerdashboard (T7.3). Draaien tegen een in-memory `Api` (de server-kant is
 * met API-tests gedekt). Toetst dat de tellingen tonen.
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
  it('toont de tellingen', async () => {
    const api = fakeApi({
      users: { total: 3, active: 2 },
      caregivers: { total: 1 },
    });
    render(
      <DashboardPage api={api} account={adminAccount} onLogout={() => {}} onNavigate={() => {}} />,
    );

    // Tellingen zichtbaar.
    expect(await screen.findByText('3')).toBeTruthy();
    expect(screen.getByText('2 actief')).toBeTruthy();
    // Geen tegel meer voor conceptvoorstellen (N0.3).
    expect(screen.queryByText('Openstaande voorstellen')).toBeNull();
  });
});
