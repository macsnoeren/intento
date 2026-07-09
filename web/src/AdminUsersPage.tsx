import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AccountPublic, UpdateSettingsRequest, UserPublic } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';
import { SettingsForm } from './SettingsForm.tsx';
import { CaregiversPanel } from './CaregiversPanel.tsx';
import { DevicePanel } from './DevicePanel.tsx';
import { AdminNav, type AdminView } from './AdminNav.tsx';

/**
 * Beheeromgeving — gebruikersbeheer (T2.1, DESIGN §5.2). Toont de gebruikerslijst van de
 * eigen organisatie, laat een beheerder gebruikers aanmaken/verwijderen en het
 * communicatieprofiel van een geselecteerde gebruiker aanpassen. Alle data loopt via de
 * backend (`Api`), die per definitie tenant-gefilterd is.
 */
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
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      await refresh();
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

  return (
    <main className="admin">
      <header className="admin__header">
        <div>
          <h1 className="panel__title">Gebruikersbeheer</h1>
          <AdminNav active="users" onNavigate={onNavigate} />
        </div>
        <div className="admin__account">
          <span>{account.email}</span>
          <button className="button" type="button" onClick={onLogout}>
            Uitloggen
          </button>
        </div>
      </header>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="admin__grid">
        <section className="panel" aria-label="Gebruikers">
          <form
            className="form form--inline"
            onSubmit={(e) => void handleCreate(e)}
            aria-label="Gebruiker toevoegen"
          >
            <input
              className="field__input"
              type="text"
              placeholder="Naam van de gebruiker"
              aria-label="Naam van de gebruiker"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
            <button className="button button--primary" type="submit" disabled={!newName.trim()}>
              Toevoegen
            </button>
          </form>

          {loading ? (
            <p className="muted">Laden…</p>
          ) : users.length === 0 ? (
            <p className="muted">Nog geen gebruikers. Voeg er hierboven één toe.</p>
          ) : (
            <ul className="user-list">
              {users.map((user) => (
                <li
                  key={user.id}
                  className={`user-list__item${user.id === selectedId ? ' user-list__item--active' : ''}`}
                >
                  <button
                    type="button"
                    className="user-list__select"
                    onClick={() => setSelectedId(user.id)}
                  >
                    {user.name}
                  </button>
                  <button
                    type="button"
                    className="button button--danger"
                    onClick={() => void handleDelete(user.id)}
                    aria-label={`Gebruiker ${user.name} verwijderen`}
                  >
                    Verwijderen
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="admin__detail">
          <section className="panel" aria-label="Instellingen">
            <h2 className="panel__subtitle">Communicatie-instellingen</h2>
            {selected ? (
              <SettingsForm key={selected.id} user={selected} onSave={handleSaveSettings} />
            ) : (
              <p className="muted">Kies een gebruiker om de instellingen aan te passen.</p>
            )}
          </section>

          {selected ? (
            <CaregiversPanel
              key={`caregivers-${selected.id}`}
              api={api}
              userId={selected.id}
              userName={selected.name}
            />
          ) : null}

          {selected ? (
            <DevicePanel
              key={`device-${selected.id}`}
              api={api}
              userId={selected.id}
              userName={selected.name}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
