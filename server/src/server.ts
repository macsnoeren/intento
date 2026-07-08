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
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
