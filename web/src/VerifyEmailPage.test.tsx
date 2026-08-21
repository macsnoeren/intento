import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { VerifyEmailResponse } from '@intento/shared';
import { VerifyEmailPage } from './VerifyEmailPage.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor de verificatiepagina (T1.4). Het verificatietoken is **eenmalig**: de pagina mag
 * het daarom hooguit één keer inwisselen. Ging dat mis, dan slaagde de eerste POST (account
 * geverifieerd) en kreeg de tweede terecht "ongeldig of verlopen" — de gebruiker zag een fout
 * terwijl de verificatie gelukt was.
 */

/** Nep-`Api` met alléén `verifyEmail`; de pagina raakt geen ander endpoint aan. */
function fakeApi(verify: (token: string) => Promise<VerifyEmailResponse>): Api {
  return { verifyEmail: verify } as unknown as Api;
}

/** Server-antwoord op een geldig token. */
function verified(): Promise<VerifyEmailResponse> {
  return Promise.resolve({ verified: true } as VerifyEmailResponse);
}

/**
 * Eenmalig token, zoals de server het behandelt: de eerste inwisseling slaagt, elke volgende
 * krijgt de neutrale fout.
 */
function singleUseApi(): { api: Api; calls: () => number } {
  let used = false;
  const verify = vi.fn(async () => {
    if (used) {
      throw new ApiRequestError(
        400,
        'INVALID_TOKEN',
        'Deze verificatielink is ongeldig of verlopen. Vraag een nieuwe aan.',
      );
    }
    used = true;
    return verified();
  });
  return { api: fakeApi(verify), calls: () => verify.mock.calls.length };
}

describe('VerifyEmailPage', () => {
  it('wisselt het token in en meldt dat het adres bevestigd is', async () => {
    const verify = vi.fn(() => verified());

    render(<VerifyEmailPage api={fakeApi(verify)} token="token-abc" onDone={() => {}} />);

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(verify).toHaveBeenCalledWith('token-abc');
    expect(verify).toHaveBeenCalledTimes(1);
  });

  // De bug uit de praktijk: onder `<StrictMode>` (main.tsx, dev) mount React elk component dubbel,
  // dus draaide het effect twee keer en verstuurde het hetzelfde eenmalige token twee keer.
  it('verstuurt het eenmalige token ook onder StrictMode maar één keer', async () => {
    const { api, calls } = singleUseApi();

    render(
      <StrictMode>
        <VerifyEmailPage api={api} token="token-abc" onDone={() => {}} />
      </StrictMode>,
    );

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(calls()).toBe(1);
  });

  it('toont de foutmelding van de server bij een echt ongeldig token', async () => {
    const verify = vi.fn(() =>
      Promise.reject(
        new ApiRequestError(
          400,
          'INVALID_TOKEN',
          'Deze verificatielink is ongeldig of verlopen. Vraag een nieuwe aan.',
        ),
      ),
    );

    render(<VerifyEmailPage api={fakeApi(verify)} token="fout" onDone={() => {}} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('ongeldig of verlopen');
    // Hint voor het geval de link al eerder is geopend: dan is het adres al bevestigd.
    expect(screen.getByText(/waarschijnlijk al bevestigd/)).toBeTruthy();
  });

  it('toont een nette fout als de verbinding faalt', async () => {
    const verify = vi.fn(() => Promise.reject(new Error('offline')));

    render(<VerifyEmailPage api={fakeApi(verify)} token="token-abc" onDone={() => {}} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Verifiëren mislukt');
  });

  it('wisselt een nieuw token wél in als het token verandert', async () => {
    const verify = vi.fn(() => verified());
    const { rerender } = render(
      <VerifyEmailPage api={fakeApi(verify)} token="token-1" onDone={() => {}} />,
    );
    await screen.findByRole('status');

    rerender(<VerifyEmailPage api={fakeApi(verify)} token="token-2" onDone={() => {}} />);

    await waitFor(() => expect(verify).toHaveBeenCalledTimes(2));
    expect(verify).toHaveBeenLastCalledWith('token-2');
  });
});
