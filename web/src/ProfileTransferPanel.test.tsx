import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileImportRequest, UserPublic } from '@intento/shared';
import { ProfileExportPanel, ProfileImportPanel } from './ProfileTransferPanel.tsx';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Web-tests voor profielexport/-import (T8.1). Draaien tegen een in-memory `Api`: de exportknop
 * downloadt de versleutelde payload als bestand, het importpaneel leest een gekozen bestand en maakt
 * er een nieuwe gebruiker mee aan. De versleuteling/roundtrip zelf is server-side gedekt.
 */

function baseApi(overrides: Partial<Api>): Api {
  const notImplemented = () =>
    Promise.reject(new ApiRequestError(500, 'NOT_IMPLEMENTED', 'niet in deze test'));
  const base = new Proxy({}, { get: () => notImplemented }) as Api;
  return { ...base, ...overrides };
}

const importedUser: UserPublic = {
  id: 'u-new',
  name: 'Emma',
  organizationId: 'org-1',
  active: true,
  createdAt: '2026-07-12T10:00:00.000Z',
  communicationProfile: {
    iconsPerScreen: 4,
    showText: true,
    aiLearningEnabled: true,
    supportMode: false,
    contextIndicator: true,
    conversationStrategy: 'refine',
  },
};

describe('ProfileExportPanel (T8.1)', () => {
  beforeEach(() => {
    // jsdom kent geen createObjectURL; stub het zodat de download-flow werkt.
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('exporteert en start een download van de versleutelde payload', async () => {
    const exportProfile = vi.fn(() =>
      Promise.resolve({ data: 'v1:cipher', filename: 'intento-profiel-u-1.intento' }),
    );
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<ProfileExportPanel api={baseApi({ exportProfile })} userId="u-1" userName="Emma" />);

    fireEvent.click(screen.getByRole('button', { name: 'Profiel exporteren' }));

    await waitFor(() => expect(exportProfile).toHaveBeenCalledWith('u-1'));
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('toont een foutmelding als exporteren mislukt', async () => {
    const exportProfile = vi.fn(() =>
      Promise.reject(new ApiRequestError(403, 'FORBIDDEN', 'Geen toegang.')),
    );
    render(<ProfileExportPanel api={baseApi({ exportProfile })} userId="u-1" userName="Emma" />);

    fireEvent.click(screen.getByRole('button', { name: 'Profiel exporteren' }));
    await screen.findByText('Geen toegang.');
  });
});

describe('ProfileImportPanel (T8.1)', () => {
  it('leest het bestand en importeert het profiel als nieuwe gebruiker', async () => {
    let received: ProfileImportRequest | null = null;
    const importProfile = vi.fn((body: ProfileImportRequest) => {
      received = body;
      return Promise.resolve(importedUser);
    });
    const onImported = vi.fn();

    render(<ProfileImportPanel api={baseApi({ importProfile })} onImported={onImported} />);

    const file = new File(['  v1:cipher  '], 'profiel.intento', {
      type: 'application/octet-stream',
    });
    fireEvent.change(screen.getByLabelText('Profielbestand kiezen'), { target: { files: [file] } });

    await waitFor(() => expect(importProfile).toHaveBeenCalled());
    // Whitespace uit het bestand wordt getrimd voordat het naar de server gaat.
    expect(received).toEqual({ data: 'v1:cipher' });
    expect(onImported).toHaveBeenCalledWith(importedUser);
    await screen.findByText(/Emma/);
  });

  it('toont een foutmelding bij een ongeldig bestand', async () => {
    const importProfile = vi.fn(() =>
      Promise.reject(new ApiRequestError(400, 'IMPORT_INVALID', 'Ongeldig bestand.')),
    );
    render(<ProfileImportPanel api={baseApi({ importProfile })} onImported={vi.fn()} />);

    const file = new File(['rommel'], 'profiel.intento');
    fireEvent.change(screen.getByLabelText('Profielbestand kiezen'), { target: { files: [file] } });

    await screen.findByText('Ongeldig bestand.');
  });
});
