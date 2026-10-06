import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  AccountPublic,
  OrganizationSettings,
  UpdateOrganizationSettings,
} from '@intento/shared';
import { OrganizationPage } from './OrganizationPage.tsx';
import type { Api } from './api.ts';

/** Pagina Organisatie: bewaartermijn (N3.3, INTENTO-NEW-DESIGN §53). */

const admin: AccountPublic = {
  id: 'acc-1',
  email: 'admin@intento.local',
  role: 'ADMIN',
  organizationId: 'org-1',
  name: null,
  emailVerified: true,
  mustChangePassword: false,
  isOperator: false,
};

function fakeApi(initial: OrganizationSettings) {
  const update = vi.fn((body: UpdateOrganizationSettings) =>
    Promise.resolve({
      retentionDays: body.retentionDays ?? initial.retentionDaysDefault,
      retentionDaysDefault: initial.retentionDaysDefault,
      usesDefault: body.retentionDays === null,
    }),
  );
  const base = new Proxy({}, { get: () => () => Promise.reject(new Error('x')) }) as Api;
  const api: Api = {
    ...base,
    getOrganizationSettings: () => Promise.resolve(initial),
    updateOrganizationSettings: update,
  };
  return { api, update };
}

describe('Organisatie — bewaartermijn', () => {
  it('toont de standaard en slaat een eigen termijn op', async () => {
    const { api, update } = fakeApi({
      retentionDays: 90,
      retentionDaysDefault: 90,
      usesDefault: true,
    });
    render(
      <OrganizationPage api={api} account={admin} onLogout={() => {}} onNavigate={() => {}} />,
    );
    const standard = await screen.findByRole('checkbox', {
      name: /Standaard gebruiken \(90 dagen\)/,
    });
    expect(screen.queryByLabelText(/Aantal dagen/)).toBeNull();

    fireEvent.click(standard);
    fireEvent.change(screen.getByLabelText(/Aantal dagen/), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ retentionDays: 30 }));
    expect((await screen.findByRole('status')).textContent).toContain('30 dagen');
  });

  it('weigert een termijn buiten 7–365 zonder te versturen', async () => {
    const { api, update } = fakeApi({
      retentionDays: 30,
      retentionDaysDefault: 90,
      usesDefault: false,
    });
    render(
      <OrganizationPage api={api} account={admin} onLogout={() => {}} onNavigate={() => {}} />,
    );
    fireEvent.change(await screen.findByLabelText(/Aantal dagen/), { target: { value: '400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/tussen 7 en 365/);
    expect(update).not.toHaveBeenCalled();
  });
});
