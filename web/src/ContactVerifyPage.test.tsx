import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContactVerifyPage } from './ContactVerifyPage.tsx';
import { ApiRequestError, type Api } from './api.ts';

/** Openbare bevestigingspagina voor een contact (N10.2, opt-in V5). */

function fakeApi(valid: boolean): { api: Api; confirmed: string[] } {
  const confirmed: string[] = [];
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return {
    confirmed,
    api: {
      ...base,
      checkContactVerification: () => Promise.resolve({ valid }),
      confirmContact(token) {
        confirmed.push(token);
        return Promise.resolve();
      },
    },
  };
}

describe('contact bevestigen', () => {
  it('geeft pas toestemming na de klik op "Ja"', async () => {
    const { api, confirmed } = fakeApi(true);
    render(<ContactVerifyPage api={api} token="t-123" />);
    const yes = await screen.findByRole('button', { name: 'Ja, ik wil berichten ontvangen' });
    expect(confirmed).toEqual([]); // openen alleen verandert niets
    fireEvent.click(yes);
    expect(await screen.findByText(/Je ontvangt voortaan berichten/)).toBeTruthy();
    expect(confirmed).toEqual(['t-123']);
  });

  it('zegt het als de link niet meer werkt', async () => {
    const { api, confirmed } = fakeApi(false);
    render(<ContactVerifyPage api={api} token="oud" />);
    expect((await screen.findByRole('alert')).textContent).toContain('werkt niet meer');
    expect(screen.queryByRole('button')).toBeNull();
    expect(confirmed).toEqual([]);
  });

  it('zonder token: meteen de melding', async () => {
    const { api } = fakeApi(true);
    render(<ContactVerifyPage api={api} token="" />);
    expect((await screen.findByRole('alert')).textContent).toContain('werkt niet meer');
  });
});
