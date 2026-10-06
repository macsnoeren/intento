import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AttributionSource, DeviceSessionResponse } from '@intento/shared';
import { ApiRequestError, httpApi, type DeviceApi } from './api.ts';
import { AuthLayout } from './AuthLayout.tsx';
import { BrandMark, BRAND_NAME } from './Brand.tsx';
import { AttributionList } from './AttributionList.tsx';
import { TabletConversation } from './TabletConversation.tsx';
import { createBrowserSpeech, silentSpeech, type SpeechPort } from './speech.ts';

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
 * Daarna het gesprek (`TabletConversation`): startscherm, de schermen die de backend teruggeeft, en
 * ↩ Terug / ⏹ Stoppen.
 *
 * `api` en `speech` zijn injecteerbaar zodat tests een in-memory backend en een nep-spraaklaag kunnen
 * meegeven.
 */
export function TabletApp({
  api = httpApi,
  speech: injectedSpeech,
}: {
  api?: DeviceApi;
  /** Spraakpoort; standaard uit het profiel (spraakdienst of apparaatstem), in tests een nep. */
  speech?: SpeechPort;
} = {}): React.JSX.Element {
  const [session, setSession] = useState<DeviceSessionResponse | null>(null);
  const [checking, setChecking] = useState(true);
  const [showSources, setShowSources] = useState(false);

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
   * De apparaatsessie (en dus het communicatieprofiel) opnieuw ophalen.
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

  // Voorlezen (§48): de stem komt uit het profiel; zonder voorlezen een poort die niets doet.
  const speechEnabled = session?.user.communicationProfile.speechEnabled ?? false;
  const speechVoice = session?.user.communicationProfile.speechVoice ?? 'device';
  const speech = useMemo<SpeechPort>(() => {
    if (injectedSpeech) return injectedSpeech;
    if (!speechEnabled) return silentSpeech;
    return createBrowserSpeech({ voice: speechVoice, fetchAudio: (text) => api.speakText(text) });
  }, [injectedSpeech, api, speechEnabled, speechVoice]);

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

  if (showSources) {
    return (
      <SourcesScreen api={api} userName={session.user.name} onBack={() => setShowSources(false)} />
    );
  }

  return (
    <main className="tablet">
      <TabletHeader userName={session.user.name} />
      <TabletConversation
        api={api}
        showText={session.user.communicationProfile.showText}
        speech={speech}
        speaks={speechEnabled}
        footer={<SourcesLink onClick={() => setShowSources(true)} />}
      />
    </main>
  );
}

/** De link "Bronnen" onderaan het startscherm: klein en apart, want het is geen bediening. */
function SourcesLink({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <p className="tablet__footer">
      <button className="link-button" type="button" onClick={onClick}>
        Bronnen
      </button>
    </p>
  );
}

/**
 * Bronvermelding op de tablet (INTENTO-NEW-DESIGN §15): van wie de pictogrammen komen. Een licentie
 * als CC BY vraagt om naamsvermelding, ook waar de gebruiker de symbolen ziet.
 */
function SourcesScreen({
  api,
  userName,
  onBack,
}: {
  api: DeviceApi;
  userName: string;
  onBack: () => void;
}): React.JSX.Element {
  const [sources, setSources] = useState<AttributionSource[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .listAttributions()
      .then((response) => {
        if (active) setSources(response.sources);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [api]);

  return (
    <main className="tablet">
      <TabletHeader userName={userName} />
      <section className="tablet__sources">
        <h1 className="tablet__prompt">Bronnen</h1>
        {error ? (
          <p className="muted">De bronnen konden niet worden geladen.</p>
        ) : sources ? (
          <AttributionList sources={sources} />
        ) : (
          <p className="muted">Laden…</p>
        )}
        <button className="button" type="button" onClick={onBack}>
          ↩ Terug
        </button>
      </section>
    </main>
  );
}

/**
 * Koppelscherm: de tablet is nog niet gekoppeld. De begeleider genereert een koppelcode in de
 * beheeromgeving; die wordt hier ingewisseld voor een apparaat-token. Na succes start de
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
