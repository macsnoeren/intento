import { useCallback, useEffect, useState } from 'react';
import type { CaregiverLink } from '@intento/shared';
import { ApiRequestError, type Api } from './api.ts';

/**
 * Begeleiders koppelen aan een gebruiker (T2.2, DESIGN §5.2, FR-017). Toont alle
 * CAREGIVER-accounts van de organisatie met per account een aan/uit-schakelaar; omzetten
 * roept `POST /admin/users/{id}/caregivers` aan. De backend bepaalt daarmee welke gebruikers
 * een begeleider mag zien — een niet-gekoppelde begeleider krijgt overal 403.
 */
export function CaregiversPanel({
  api,
  userId,
  userName,
}: {
  api: Api;
  userId: string;
  userName: string;
}): React.JSX.Element {
  const [caregivers, setCaregivers] = useState<CaregiverLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { caregivers: list } = await api.listCaregivers(userId);
      setCaregivers(list);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Laden mislukt.');
    } finally {
      setLoading(false);
    }
  }, [api, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleToggle(accountId: string, linked: boolean): Promise<void> {
    setError(null);
    setBusyId(accountId);
    try {
      const { caregivers: list } = await api.linkCaregiver(userId, accountId, linked);
      setCaregivers(list);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Opslaan mislukt.');
    } finally {
      setBusyId(null);
    }
  }

  const linkedCount = caregivers.filter((caregiver) => caregiver.linked).length;

  return (
    <section className="panel" aria-label={`Begeleiders voor ${userName}`}>
      <h2 className="panel__subtitle">
        Gekoppelde begeleiders{' '}
        {loading ? null : (
          <span className="panel__count">
            {linkedCount} van {caregivers.length} gekoppeld
          </span>
        )}
      </h2>
      <p className="muted">
        Een gekoppelde begeleider ziet de bevestigde boodschappen van {userName} en kan hem vragen
        stellen. Wie hier niet aanstaat, krijgt geen toegang tot deze gebruiker.
      </p>
      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="muted">Laden…</p>
      ) : caregivers.length === 0 ? (
        <p className="muted">
          Nog geen begeleider-accounts in deze organisatie. Maak er één aan via Gebruikers → Logins
          → “Begeleider aanmaken”; daarna verschijnt hij hier om te koppelen.
        </p>
      ) : (
        // Elke begeleider een eigen regel over de volle breedte (T17.4): een aanvinkvakje van een
        // paar pixels is op een tablet lastig te raken, de hele regel niet.
        <ul className="choice-list">
          {caregivers.map((caregiver) => (
            <li key={caregiver.accountId}>
              <label className="choice-block">
                <input
                  type="checkbox"
                  checked={caregiver.linked}
                  disabled={busyId === caregiver.accountId}
                  onChange={(e) => void handleToggle(caregiver.accountId, e.target.checked)}
                />
                <span>{caregiver.email}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
