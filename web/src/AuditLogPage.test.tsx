import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountPublic, AuditLogListResponse } from '@intento/shared';
import { AuditLogPage } from './AuditLogPage.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor de audit-log-pagina (T8.2). Draaien tegen een in-memory `Api` (de server-kant is met
 * API-tests gedekt). Toetst dat acties leesbaar tonen, een mislukking als zodanig gemarkeerd wordt en
 * de lege staat netjes is.
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

function fakeApi(response: AuditLogListResponse): Api {
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return { ...base, listAuditLogs: () => Promise.resolve(response) };
}

describe('audit-log-pagina', () => {
  it('toont acties met leesbare labels en markeert een mislukte login', async () => {
    const api = fakeApi({
      entries: [
        {
          id: 'a-1',
          action: 'user.settings.update',
          outcome: 'success',
          accountId: 'acc-1',
          targetType: 'user',
          targetId: 'u-1',
          metadata: null,
          createdAt: '2026-07-12T09:00:00.000Z',
        },
        {
          id: 'a-2',
          action: 'auth.login',
          outcome: 'failure',
          accountId: null,
          targetType: null,
          targetId: null,
          metadata: { reason: 'invalid_credentials' },
          createdAt: '2026-07-12T08:00:00.000Z',
        },
      ],
    });
    render(
      <AuditLogPage api={api} account={adminAccount} onLogout={() => {}} onNavigate={() => {}} />,
    );

    expect(await screen.findByText('Instellingen aangepast')).toBeTruthy();
    expect(screen.getByText('Ingelogd')).toBeTruthy();
    expect(screen.getByText('Mislukt')).toBeTruthy();
  });

  it('toont een lege staat als er nog geen acties zijn', async () => {
    const api = fakeApi({ entries: [] });
    render(
      <AuditLogPage api={api} account={adminAccount} onLogout={() => {}} onNavigate={() => {}} />,
    );

    expect(await screen.findByText('Nog geen geregistreerde acties.')).toBeTruthy();
  });
});
