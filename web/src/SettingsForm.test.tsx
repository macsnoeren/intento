import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SPEECH_VOICE,
  SPEECH_VOICE_CATALOG,
  type CommunicationProfile,
  type UpdateSettingsRequest,
  type UserPublic,
} from '@intento/shared';
import { SettingsForm } from './SettingsForm.tsx';

/**
 * Instellingenformulier (DESIGN §5.3), met de nadruk op de **stemkeuze** (T18.2): de begeleider kiest
 * een stem op gehoor, en beluisteren mag nooit al iets opslaan.
 */

function user(overrides: Partial<CommunicationProfile> = {}): UserPublic {
  return {
    id: 'u-1',
    name: 'Sanne',
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
      speechEnabled: false,
      speechVoice: DEFAULT_SPEECH_VOICE,
      speechHints: true,
      ...overrides,
    },
  };
}

describe('instellingen — stemkeuze', () => {
  it('toont elke stem uit de catalogus met een luisterknop', () => {
    render(<SettingsForm user={user()} onSave={vi.fn()} onPreviewVoice={vi.fn()} />);

    for (const voice of SPEECH_VOICE_CATALOG) {
      expect(screen.getByRole('button', { name: `${voice.label} beluisteren` })).toBeTruthy();
    }
  });

  it('speelt een voorbeeld af zonder de instelling op te slaan', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onPreviewVoice = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsForm
        user={user({ speechEnabled: true })}
        onSave={onSave}
        onPreviewVoice={onPreviewVoice}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Nathalie beluisteren' }));

    await waitFor(() => expect(onPreviewVoice).toHaveBeenCalledWith('nl_BE-nathalie-medium'));
    // Beluisteren is geen kiezen: er is niets opgeslagen en de keuze staat nog op de oude stem.
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Nathalie/ }).checked).toBe(false);
  });

  it('slaat de gekozen stem en de spraakinstellingen op', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SettingsForm user={user()} onSave={onSave} onPreviewVoice={vi.fn()} />);

    fireEvent.click(
      screen.getByRole('checkbox', { name: /leest voor wat er op het scherm staat/ }),
    );
    fireEvent.click(screen.getByRole('radio', { name: /Nathalie/ }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: /hardop uitleggen hoe de knoppen werken/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Instellingen opslaan' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, settings] = onSave.mock.calls[0] as [string, UpdateSettingsRequest];
    expect(settings.speechEnabled).toBe(true);
    expect(settings.speechVoice).toBe('nl_BE-nathalie-medium');
    expect(settings.speechHints).toBe(false);
  });

  it('houdt de stemkeuze uitgeschakeld zolang spraak uitstaat', () => {
    render(<SettingsForm user={user()} onSave={vi.fn()} onPreviewVoice={vi.fn()} />);

    // Zonder spraak valt er niets te kiezen; het hele blok staat uit in plaats van te doen alsof.
    expect(screen.getByRole<HTMLFieldSetElement>('group', { name: 'Stem' }).disabled).toBe(true);
  });

  it('meldt het als beluisteren niet lukt', async () => {
    const onPreviewVoice = vi.fn().mockRejectedValue(new Error('geen dienst'));
    render(
      <SettingsForm
        user={user({ speechEnabled: true })}
        onSave={vi.fn()}
        onPreviewVoice={onPreviewVoice}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pim beluisteren' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Beluisteren lukte niet. Draait de spraakdienst?',
    );
  });

  it('laat de luisterknoppen weg als er geen manier is om te beluisteren', () => {
    render(<SettingsForm user={user({ speechEnabled: true })} onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Pim beluisteren' })).toBeNull();
  });
});
