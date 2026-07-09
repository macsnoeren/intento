import { buildApp } from './app.js';
import { loadEnv } from './env.js';

/**
 * Entrypoint: valideert de omgeving, bouwt de app en gaat luisteren.
 * Gescheiden van `buildApp()` zodat tests de app kunnen bouwen zonder poort.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp({ env, logger: true });

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
