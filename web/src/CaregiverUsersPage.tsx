import { useCallback, useEffect, useState } from 'react';
import {
  SPEECH_PREVIEW_SENTENCE,
  isDeviceVoice,
  type AccountPublic,
  type UpdateSettingsRequest,
  type UserPublic,
} from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';
import { SettingsForm } from './SettingsForm.tsx';
import { ContactsPanel } from './ContactsPanel.tsx';
import { playAudioBlob, speakWithDeviceVoice } from './speech.ts';

/**
 * Begeleider — "Mijn gebruikers" (INTENTO-NEW-DESIGN §49, V7). De gebruikers waaraan deze begeleider
 * gekoppeld is, met per gebruiker het instellingenformulier. De server laat alleen gekoppelde
 * gebruikers zien en wijzigen; dit scherm toont wat er terugkomt.
 */
export function CaregiverUsersPage({
  api,
  account,
  onLogout,
  onNavigate,
}: {
  api: Api;
  account: AccountPublic;
  onLogout: () => void;
  onNavigate: (view: AdminView) => void;
}): React.JSX.Element {
  const [users, setUsers] = useState<UserPublic[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUsers((await api.listCaregiverUsers()).users);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveSettings(id: string, settings: UpdateSettingsRequest): Promise<void> {
    const updated = await api.updateSettings(id, settings);
    setUsers((list) => (list ? list.map((u) => (u.id === id ? updated : u)) : list));
  }

  const selected = users?.find((u) => u.id === selectedId) ?? null;

  if (selected) {
    return (
      <AppShell
        account={account}
        title={selected.name}
        subtitle="Hoe deze persoon communiceert, en naar wie hij berichten kan sturen."
        active="my-users"
        onNavigate={onNavigate}
        onLogout={onLogout}
      >
        <div>
          <button className="detail-back" type="button" onClick={() => setSelectedId(null)}>
            <span aria-hidden="true">←</span> Mijn gebruikers
          </button>
        </div>
        <section className="panel" aria-label="Instellingen">
          <h2 className="panel__subtitle">Communicatie-instellingen</h2>
          <SettingsForm
            key={selected.id}
            user={selected}
            onSave={saveSettings}
            onPreviewVoice={async (voice) => {
              if (isDeviceVoice(voice)) {
                speakWithDeviceVoice(SPEECH_PREVIEW_SENTENCE);
                return;
              }
              await playAudioBlob(
                await api.speechPreview(selected.id, SPEECH_PREVIEW_SENTENCE, voice),
              );
            }}
          />
        </section>
        <ContactsPanel
          key={`contacts-${selected.id}`}
          api={api}
          userId={selected.id}
          userName={selected.name}
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      account={account}
      title="Mijn gebruikers"
      subtitle="De mensen die jij begeleidt."
      active="my-users"
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}
      {users === null ? (
        error ? null : (
          <p className="muted">Laden…</p>
        )
      ) : users.length === 0 ? (
        <p className="muted">
          Je bent nog aan niemand gekoppeld. Vraag de beheerder om je aan een gebruiker te koppelen.
        </p>
      ) : (
        <section className="panel" aria-label="Gebruikers">
          <ul className="record-list">
            {users.map((user) => (
              <li key={user.id}>
                <button className="record" type="button" onClick={() => setSelectedId(user.id)}>
                  <span className="record__title">{user.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
