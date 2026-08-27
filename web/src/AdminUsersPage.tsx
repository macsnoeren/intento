import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CONVERSATION_STRATEGY_CATALOG,
  type AccountPublic,
  type UpdateSettingsRequest,
  type UserPublic,
} from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import { SettingsForm } from './SettingsForm.tsx';
import { AccountsPanel } from './AccountsPanel.tsx';
import { CaregiverAccountsPanel } from './CaregiverAccountsPanel.tsx';
import { CaregiversPanel } from './CaregiversPanel.tsx';
import { DevicePanel } from './DevicePanel.tsx';
import { PersonalContextPanel } from './PersonalContextPanel.tsx';
import { PreferencesPanel } from './PreferencesPanel.tsx';
import { ProfileExportPanel, ProfileImportPanel } from './ProfileTransferPanel.tsx';
import { Modal } from './Modal.tsx';
import { SegmentedTabs, tabPanelProps, type SegmentedTab } from './SegmentedTabs.tsx';
import type { AdminView } from './AdminNav.tsx';
import { AppShell } from './AppShell.tsx';

/**
 * Beheeromgeving — gebruikersbeheer (T2.1, DESIGN §5.2), heringericht in T17.2.
 *
 * Tot T17.2 stond alles op één scherm in twee smalle kolommen: links de gebruikerslijst mét de
 * formulieren voor aanmaken, importeren en begeleider-accounts, rechts de zeven detailpanelen van de
 * geselecteerde gebruiker. Zolang er niemand geselecteerd was stond de rechterkolom leeg te wachten,
 * en zodra dat wél zo was moest je in een kolom van een halve pagina een wizard invullen.
 *
 * Nu is het **overzicht → detail**: een lijst over de volle breedte, en één gebruiker openen geeft
 * hem een eigen scherm met alle panelen naast elkaar. Handelingen die je vanaf het overzicht begint
 * (toevoegen, importeren, begeleider aanmaken) zitten achter een knop met een dialoog, zodat het
 * overzicht een overzicht blijft.
 *
 * Alle data loopt via de backend (`Api`), die per definitie tenant-gefilterd is.
 */

/** Twee soorten "wie" in een organisatie: de mensen die communiceren, en de logins die hen helpen. */
type UsersTab = 'users' | 'accounts';

const OVERVIEW_TABS: readonly SegmentedTab<UsersTab>[] = [
  { id: 'users', label: 'Gebruikers' },
  { id: 'accounts', label: 'Logins' },
];

/**
 * De onderdelen van één gebruiker (T17.4). Volgorde is de volgorde waarin je ze nodig hebt: eerst
 * instellen hoe hij communiceert, dan wie hem begeleidt, dan wat de AI over hem mag weten, en pas
 * daarna het apparaat en het beheer van zijn profiel.
 */
type UserTab = 'settings' | 'caregivers' | 'context' | 'preferences' | 'device' | 'profile';

const USER_TABS: readonly SegmentedTab<UserTab>[] = [
  { id: 'settings', label: 'Instellingen' },
  { id: 'caregivers', label: 'Begeleiders' },
  { id: 'context', label: 'Persoonlijke context' },
  { id: 'preferences', label: 'Voorkeuren' },
  { id: 'device', label: 'Tablet' },
  { id: 'profile', label: 'Profiel & verwijderen' },
];

/** Welke dialoog openstaat; `null` = geen. */
type UsersDialog = 'create-user' | 'create-caregiver' | 'import-profile' | null;

function strategyLabel(key: UserPublic['communicationProfile']['conversationStrategy']): string {
  return CONVERSATION_STRATEGY_CATALOG.find((entry) => entry.key === key)?.label ?? key;
}

/** Initialen voor het naamvakje in de lijst. Puur decoratief; de naam staat er voluit naast. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('nl-NL');
}

export function AdminUsersPage({
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
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<UsersTab>('users');
  const [dialog, setDialog] = useState<UsersDialog>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Telt op na elk nieuw begeleider-account (T2.4); zit in de `key` van de koppelweergave zodat die
  // opnieuw laadt en het verse account meteen aan te vinken is.
  const [caregiverVersion, setCaregiverVersion] = useState(0);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { users: list } = await api.listUsers();
      setUsers(list);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const created = await api.createUser({ name: newName.trim() });
      setNewName('');
      setDialog(null);
      await refresh();
      // Meteen door naar zijn scherm: een verse gebruiker heeft nog een profiel nodig.
      setSelectedId(created.id);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Aanmaken mislukt.');
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setError(null);
    try {
      await api.deleteUser(id);
      if (selectedId === id) setSelectedId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Verwijderen mislukt.');
    }
  }

  async function handleSaveSettings(id: string, settings: UpdateSettingsRequest): Promise<void> {
    const updated = await api.updateSettings(id, settings);
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  }

  const selected = users.find((u) => u.id === selectedId) ?? null;

  // Eén gebruiker geopend: zijn eigen scherm, met alle panelen over de volle breedte.
  if (selected) {
    return (
      <UserDetailPage
        api={api}
        account={account}
        user={selected}
        caregiverVersion={caregiverVersion}
        error={error}
        onBack={() => setSelectedId(null)}
        onDelete={() => void handleDelete(selected.id)}
        onSaveSettings={handleSaveSettings}
        onLogout={onLogout}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <AppShell
      account={account}
      title="Gebruikersbeheer"
      subtitle="De mensen die met Intento communiceren, en wie hen begeleidt."
      active="users"
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="toolbar">
        <SegmentedTabs
          label="Weergave"
          prefix="overview"
          tabs={OVERVIEW_TABS}
          active={tab}
          onSelect={setTab}
        />

        <div className="toolbar__actions">
          {tab === 'users' ? (
            <>
              <button className="button" type="button" onClick={() => setDialog('import-profile')}>
                Profiel importeren
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={() => setDialog('create-user')}
              >
                <span aria-hidden="true">+ </span>Gebruiker toevoegen
              </button>
            </>
          ) : (
            <button
              className="button button--primary"
              type="button"
              onClick={() => setDialog('create-caregiver')}
            >
              <span aria-hidden="true">+ </span>Begeleider aanmaken
            </button>
          )}
        </div>
      </div>

      {tab === 'users' ? (
        <div {...tabPanelProps('overview', 'users')}>
          <section className="panel" aria-label="Gebruikers">
            {loading ? (
              <p className="muted">Laden…</p>
            ) : users.length === 0 ? (
              <p className="muted">
                Nog geen gebruikers. Voeg er één toe met de knop rechtsboven, of importeer een
                bestaand profiel.
              </p>
            ) : (
              <ul className="record-list">
                {users.map((user) => (
                  <li key={user.id}>
                    <button type="button" className="record" onClick={() => setSelectedId(user.id)}>
                      <span className="record__avatar" aria-hidden="true">
                        {initials(user.name)}
                      </span>
                      <span className="record__body">
                        <span className="record__title">{user.name}</span>
                        <span className="record__meta">
                          {user.communicationProfile.iconsPerScreen} pictogrammen per scherm ·{' '}
                          {strategyLabel(user.communicationProfile.conversationStrategy)} · sinds{' '}
                          {formatDate(user.createdAt)}
                        </span>
                      </span>
                      {user.communicationProfile.supportMode ? (
                        <span className="badge">Ondersteuningsmodus</span>
                      ) : null}
                      <span className="badge badge--active">
                        {user.active ? 'Actief' : 'Inactief'}
                      </span>
                      <span className="record__chevron" aria-hidden="true">
                        →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <div {...tabPanelProps('overview', 'accounts')}>
          {/* Accountlijst (T2.6): ververst op de begeleiderteller, zodat een net aangemaakt account
              er meteen — mét zijn "tijdelijk wachtwoord"-markering — in staat. `currentAccountId`
              houdt de resetknop (T2.7) van het eigen account af: je eigen wachtwoord wijzig je onder
              "Mijn account", mét je huidige wachtwoord. */}
          <AccountsPanel api={api} refreshToken={caregiverVersion} currentAccountId={account.id} />
        </div>
      )}

      {dialog === 'create-user' ? (
        <Modal title="Gebruiker toevoegen" onClose={() => setDialog(null)}>
          <p className="muted">
            Een gebruiker is iemand die met Intento communiceert. Het communicatieprofiel stel je
            daarna op zijn eigen scherm in.
          </p>
          <form
            className="form"
            onSubmit={(e) => void handleCreate(e)}
            aria-label="Gebruiker toevoegen"
          >
            <label className="field">
              <span className="field__label">Naam van de gebruiker</span>
              <input
                className="field__input"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                autoFocus
              />
            </label>
            <div className="form__actions">
              <button className="button button--primary" type="submit" disabled={!newName.trim()}>
                Toevoegen
              </button>
              <button className="button" type="button" onClick={() => setDialog(null)}>
                Annuleren
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {dialog === 'create-caregiver' ? (
        <Modal title="Begeleider aanmaken" showTitle={false} onClose={() => setDialog(null)}>
          <CaregiverAccountsPanel
            api={api}
            onCreated={() => setCaregiverVersion((version) => version + 1)}
          />
        </Modal>
      ) : null}

      {dialog === 'import-profile' ? (
        <Modal title="Profiel importeren" showTitle={false} onClose={() => setDialog(null)}>
          <ProfileImportPanel
            api={api}
            onImported={(user) => {
              setDialog(null);
              void refresh();
              setSelectedId(user.id);
            }}
          />
        </Modal>
      ) : null}
    </AppShell>
  );
}

/**
 * Het scherm van één gebruiker (T17.2, in onderdelen sinds T17.4): communicatieprofiel,
 * begeleiders, persoonlijke context, geleerde voorkeuren, tabletkoppeling en profielbeheer.
 *
 * T17.2 zette die panelen naast elkaar in een raster van twee kolommen. Dat was al beter dan de
 * halve kolom ervoor, maar elk paneel bleef daarmee een halve pagina breed — en juist deze panelen
 * bevatten formulieren met uitleg, een wizard van vijf stappen en lijsten met knoppen erin. Nu staat
 * er een **keuzebalk** bovenaan en één onderdeel tegelijk over de volle breedte: je ziet minder in
 * één blik, maar wat je ziet is te lezen en in te vullen.
 *
 * Verwijderen zit onder "Profiel & verwijderen", apart van de instellingen: het is de enige
 * handeling hier die niet terug te draaien is.
 */
function UserDetailPage({
  api,
  account,
  user,
  caregiverVersion,
  error,
  onBack,
  onDelete,
  onSaveSettings,
  onLogout,
  onNavigate,
}: {
  api: Api;
  account: AccountPublic;
  user: UserPublic;
  caregiverVersion: number;
  error: string | null;
  onBack: () => void;
  onDelete: () => void;
  onSaveSettings: (id: string, settings: UpdateSettingsRequest) => Promise<void>;
  onLogout: () => void;
  onNavigate: (view: AdminView) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<UserTab>('settings');

  return (
    <AppShell
      account={account}
      title={user.name}
      subtitle="Communicatieprofiel, begeleiders, context en apparaten."
      active="users"
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      <div>
        <button className="detail-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Alle gebruikers
        </button>
      </div>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      <SegmentedTabs
        label={`Onderdelen van ${user.name}`}
        prefix="user"
        tabs={USER_TABS}
        active={tab}
        onSelect={setTab}
      />

      <div className="detail-section" {...tabPanelProps('user', tab)}>
        {tab === 'settings' ? (
          <section className="panel" aria-label="Instellingen">
            <h2 className="panel__subtitle">Communicatie-instellingen</h2>
            <p className="muted">
              Hoe {user.name} communiceert: hoeveel pictogrammen hij tegelijk ziet, of er tekst bij
              staat, en hoe de AI naar zijn bedoeling zoekt.
            </p>
            <SettingsForm key={user.id} user={user} onSave={onSaveSettings} />
          </section>
        ) : null}

        {tab === 'caregivers' ? (
          <CaregiversPanel
            key={`caregivers-${user.id}-${caregiverVersion}`}
            api={api}
            userId={user.id}
            userName={user.name}
          />
        ) : null}

        {tab === 'context' ? (
          <PersonalContextPanel
            key={`context-${user.id}`}
            api={api}
            userId={user.id}
            userName={user.name}
          />
        ) : null}

        {tab === 'preferences' ? (
          <PreferencesPanel
            key={`preferences-${user.id}`}
            api={api}
            userId={user.id}
            userName={user.name}
          />
        ) : null}

        {tab === 'device' ? (
          <DevicePanel key={`device-${user.id}`} api={api} userId={user.id} userName={user.name} />
        ) : null}

        {tab === 'profile' ? (
          <div className="stack">
            <ProfileExportPanel
              key={`export-${user.id}`}
              api={api}
              userId={user.id}
              userName={user.name}
            />

            <section
              className="panel panel--danger"
              aria-label={`Gebruiker ${user.name} verwijderen`}
            >
              <h2 className="panel__subtitle">Gebruiker verwijderen</h2>
              <p className="muted">
                Verwijdert {user.name} met zijn communicatieprofiel, persoonlijke context, geleerde
                voorkeuren en gekoppelde apparaten. Dit is niet terug te draaien. Wil je het profiel
                bewaren, exporteer het dan eerst hierboven.
              </p>
              <button
                type="button"
                className="button button--danger"
                onClick={onDelete}
                aria-label={`Gebruiker ${user.name} verwijderen`}
              >
                Verwijderen
              </button>
            </section>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
