import { useEffect, useState } from 'react';
import type { AiStatusResponse } from '@intento/shared';
import { ApiRequestError } from './api.ts';

/** Hoe vaak de indicator zichzelf ververst. Rustig: dit is een lampje, geen live-monitor. */
const DEFAULT_POLL_MS = 30_000;

/** De smalle client-eis van deze component: alleen de AI-status ophalen (beheer- én tablet-API voldoen). */
export interface AiStatusApi {
  getAiStatus(): Promise<AiStatusResponse>;
}

/** De tekst en toon bij een opgehaalde status. Eén plek, zodat tablet en beheer hetzelfde zeggen. */
function describe(status: AiStatusResponse): { tone: 'ok' | 'warn'; label: string; title: string } {
  if (status.active) {
    return {
      tone: 'ok',
      label: 'AI denkt mee',
      title:
        status.workersOnline > 1
          ? `${status.workersOnline} AI-workers actief.`
          : 'Er is een AI-worker actief.',
    };
  }
  if (status.workerRequired) {
    return {
      tone: 'warn',
      label: 'Geen AI-worker actief',
      title: status.lastSeenAt
        ? `Laatste worker-activiteit: ${new Date(status.lastSeenAt).toLocaleString('nl-NL')}. Start een AI-worker om verder te kunnen.`
        : 'Er heeft zich nog geen AI-worker gemeld. Start een AI-worker (ai-worker/).',
    };
  }
  return {
    tone: 'warn',
    label: 'Zonder AI',
    title:
      'De server draait op AI_PROVIDER=mock: de keuzes komen uit de vaste bibliotheekvolgorde, er denkt geen AI mee.',
  };
}

/**
 * Indicator "is er een AI actief?" (T9.4, DESIGN §7.2, §9.2).
 *
 * In de gebruikerstest was nergens te zien of er daadwerkelijk een AI meedacht: de backend draaide op
 * `AI_PROVIDER=mock` en dat is aan de flow niet te merken (de mock kiest de bibliotheekvolgorde). Deze
 * badge maakt het expliciet in **beide** interfaces — de tablet en de beheeromgeving — en ververst
 * zichzelf rustig, zodat een worker die wegvalt of terugkomt vanzelf zichtbaar wordt.
 *
 * Bewust klein en niet-blokkerend: mislukt het ophalen, dan verdwijnt de badge in plaats van een fout
 * te tonen — de gespreksflow zelf mag hier nooit door verstoord worden.
 */
export function AiStatusBadge({
  api,
  pollMs = DEFAULT_POLL_MS,
}: {
  api: AiStatusApi;
  /** Verversinterval in ms; `0` = eenmalig ophalen (handig in tests). */
  pollMs?: number;
}): React.JSX.Element | null {
  const [status, setStatus] = useState<AiStatusResponse | null>(null);

  useEffect(() => {
    let active = true;

    async function load(): Promise<void> {
      try {
        const next = await api.getAiStatus();
        if (active) setStatus(next);
      } catch (err) {
        // Een niet-bereikbare of nog niet geauthenticeerde status mag de app niet storen: badge weg.
        if (!(err instanceof ApiRequestError)) throw err;
        if (active) setStatus(null);
      }
    }

    void load();
    if (pollMs <= 0)
      return () => {
        active = false;
      };

    const timer = setInterval(() => void load(), pollMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, pollMs]);

  if (!status) return null;

  const { tone, label, title } = describe(status);
  // Bewust géén `role="status"`/live region: dit lampje mag de voorleesvolgorde van de gespreksflow niet
  // onderbreken en zou bij elke poll opnieuw worden voorgelezen. Het staat gewoon als tekst op de pagina.
  return (
    <p className={`ai-status ai-status--${tone}`} title={title}>
      <span className="ai-status__dot" aria-hidden="true" />
      {label}
    </p>
  );
}
