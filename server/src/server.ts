import { buildApp } from './app.js';
import { loadEnv } from './env.js';

/**
 * Entrypoint: valideert de omgeving, bouwt de app en gaat luisteren.
 * Gescheiden van `buildApp()` zodat tests de app kunnen bouwen zonder poort.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp({ env, logger: true });

  // Zichtbaar maken welke AI-modus draait (T9.8). In de gebruikerstest leek de AI niets te doen; de
  // oorzaak was de standaard `AI_PROVIDER=mock` — de deterministische mock-provider, die simpelweg de
  // bibliotheekvolgorde teruggeeft. Dat is een prima dev-/testinstelling, maar niets liet het zien.
  // Daarom bij het opstarten één duidelijke regel, met een waarschuwing als er géén echte AI meedenkt.
  if (env.AI_PROVIDER === 'mock') {
    app.log.warn(
      'AI_PROVIDER=mock: er draait GEEN echte AI. De gespreksflow gebruikt de deterministische ' +
        'mock-provider (bibliotheekvolgorde). Zet AI_PROVIDER=queue en start een AI-worker (ai-worker/) ' +
        'voor echte AI-ondersteuning.',
    );
  } else {
    app.log.info(
      `AI_PROVIDER=${env.AI_PROVIDER}: AI-aanvragen lopen via de wachtrij; er is een draaiende ` +
        'AI-worker nodig (zie ai-worker/README.md). Status: GET /ai/status.',
    );
  }

  try {
    // Dual-stack ('::'): luister op zowel IPv6 (o.a. ::1) als IPv4 (via IPv4-mapped, o.a.
    // 127.0.0.1 en LAN-adressen). Nodig omdat de browser 'localhost' op Windows vaak eerst
    // naar ::1 resolvet; bij een IPv4-only bind ('0.0.0.0') mislukt de fetch dan met
    // "Kan de server niet bereiken.".
    await app.listen({ port: env.PORT, host: '::' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
