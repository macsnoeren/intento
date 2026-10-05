import { useCallback, useEffect, useState } from 'react';
import type { DeviceSessionResponse } from '@intento/shared';
import { ApiRequestError, httpApi, type DeviceApi } from './api.ts';
import { AuthLayout } from './AuthLayout.tsx';
import { BrandMark, BRAND_NAME } from './Brand.tsx';

/**
 * Vaste kopbalk van de gebruikersapp: linksboven het beeldmerk met de naam, rechtsboven wie
 * er op deze tablet communiceert (en waar van toepassing de AI-indicator).
 *
 * Uit de gebruikerstest: op een gedeelde tablet was nergens te zien wélke app dit is en voor wie hij
 * openstaat. De balk is bewust klein en grijs — het keuzescherm eronder moet de aandacht houden — en
 * bevat geen kop-element, zodat de vraag op het scherm de enige `<h1>` blijft.
 */
function TabletHeader({
  userName,
  children,
}: {
  /** De gebruiker van deze tablet; ontbreekt op schermen van vóór het koppelen. */
  userName?: string;
  /** Extra's rechts in de balk, bv. de AI-indicator. */
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="tablet__header">
      <span className="tablet__brand">
        <BrandMark size={34} />
        <span className="tablet__brand-name">{BRAND_NAME}</span>
      </span>
      <span className="tablet__identity">
        {userName ? <span className="tablet__user">{userName}</span> : null}
        {children}
      </span>
    </header>
  );
}

/**
 * Gebruikersapp op de tablet (INTENTO-NEW-DESIGN §48).
 *
 * Draait op **device-auth**: het apparaat is aan één gebruiker gekoppeld en start daarna zonder
 * dagelijkse login. Bij het openen wordt eerst de apparaatsessie opgehaald (`GET /device/me`);
 * ontbreekt die, dan verschijnt het koppelscherm om een koppelcode in te wisselen.
 *
 * De gespreksflow wordt herbouwd (ADR-0017). Tot die er is, toont een gekoppelde tablet een rustig
 * scherm "Nog niet beschikbaar".
 *
 * `api` is injecteerbaar zodat tests een in-memory backend kunnen meegeven.
 */
export function TabletApp({ api = httpApi }: { api?: DeviceApi } = {}): React.JSX.Element {
  const [session, setSession] = useState<DeviceSessionResponse | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const found = await api.deviceMe();
        if (active) setSession(found);
      } catch (err) {
        // 401 = nog geen gekoppeld apparaat (verwacht) → koppelscherm. Andere fouten negeren we
        // hier en tonen eveneens het koppelscherm.
        if (!(err instanceof ApiRequestError)) throw err;
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  /**
   * De apparaatsessie (en dus het communicatieprofiel) opnieuw ophalen (T18.6).
   *
   * De sessie werd alleen bij het opstarten geladen, waarna de tablet tot een herlaad van de pagina op
   * dát profiel bleef staan. Uit de praktijk: een begeleider zette de stem op Nathalie terwijl de tablet
   * openstond; de tablet bleef de oude keuze gebruiken ("Stem van het apparaat") en het leek alsof de
   * stemkeuze niet werkte. Mislukt het ophalen (even geen netwerk), dan houden we het profiel dat we
   * hebben: doorgaan met oude instellingen is beter dan een gesprek afbreken.
   */
  const refreshSession = useCallback(async (): Promise<void> => {
    try {
      setSession(await api.deviceMe());
    } catch (err) {
      if (!(err instanceof ApiRequestError)) throw err;
    }
  }, [api]);

  // Een tablet wordt neergelegd en weer opgepakt; dat is een natuurlijk moment om te kijken of de
  // begeleider iets aan de instellingen veranderd heeft.
  useEffect(() => {
    if (!session || typeof document === 'undefined') return;
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void refreshSession();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [session, refreshSession]);

  if (checking) {
    return (
      <AuthLayout title="Even geduld">
        <p className="muted">Bezig met laden…</p>
      </AuthLayout>
    );
  }

  if (!session) {
    return <DeviceLinkScreen api={api} onLinked={setSession} />;
  }

  return <NotYetAvailableScreen userName={session.user.name} />;
}

/**
 * Rustig scherm voor een gekoppelde tablet zolang de nieuwe gespreksflow er nog niet is (ADR-0017).
 * Geen knoppen: er is niets te doen, en een knop die niets doet verwart meer dan geen knop.
 */
function NotYetAvailableScreen({ userName }: { userName: string }): React.JSX.Element {
  return (
    <main className="tablet">
      <TabletHeader userName={userName} />
      <section className="tablet__waiting" role="status">
        <h1 className="tablet__prompt">Nog niet beschikbaar</h1>
        <p className="muted">
          Deze tablet is gekoppeld. Het praten met pictogrammen komt binnenkort.
        </p>
      </section>
    </main>
  );
}

/**
 * Koppelscherm: de tablet is nog niet gekoppeld. De begeleider genereert een koppelcode in de
 * beheeromgeving (T2.3); die wordt hier ingewisseld voor een apparaat-token. Na succes start de
 * gebruikersapp direct.
 */
function DeviceLinkScreen({
  api,
  onLinked,
}: {
  api: DeviceApi;
  onLinked: (session: DeviceSessionResponse) => void;
}): React.JSX.Element {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onLinked(await api.linkDevice(code));
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Koppelen mislukt. Probeer het opnieuw.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Tablet koppelen"
      intro="Voer de koppelcode in die je in de beheeromgeving hebt aangemaakt."
    >
      <form className="form" aria-label="Tablet koppelen" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span className="field__label">Koppelcode</span>
          <input
            className="field__input"
            name="code"
            autoComplete="off"
            autoCapitalize="characters"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        {error ? (
          <p className="form__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form__actions">
          <button
            className="button button--primary"
            type="submit"
            disabled={busy || code.trim().length === 0}
          >
            Koppelen
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
