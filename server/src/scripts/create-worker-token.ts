import { parseArgs } from 'node:util';
import { prisma } from '../db/prisma.js';
import { createWorkerToken, WORKER_SCOPE_AI_PROCESS } from '../ai/worker-token.js';

/**
 * CLI om een worker-token aan te maken (T5.5, ADR-0010). Een worker-token is een **infrastructuur**-
 * credential (los van gebruiker-/device-/sessietokens) en wordt daarom buiten de app-UI gemunt.
 *
 *   npm run worker-token:create --workspace=server -- --name gpu-node-1 [--ttl-days 90] [--scopes ai:process]
 *
 * Het rauwe token wordt **één keer** afgedrukt; daarna kent de db alleen de SHA-256-hash. Zet het in de
 * `.env` van de worker (T5.6) als `WORKER_TOKEN`.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      'ttl-days': { type: 'string' },
      scopes: { type: 'string' },
    },
  });

  const name = values.name?.trim();
  if (!name) {
    throw new Error('Geef een naam op: --name <label> (bv. --name gpu-node-1).');
  }

  const ttlDays = values['ttl-days'] !== undefined ? Number(values['ttl-days']) : undefined;
  if (ttlDays !== undefined && (!Number.isFinite(ttlDays) || ttlDays <= 0)) {
    throw new Error('--ttl-days moet een positief getal zijn.');
  }

  const scopes = values.scopes
    ? values.scopes
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean)
    : [WORKER_SCOPE_AI_PROCESS];

  const { record, token } = await createWorkerToken(prisma, { name, scopes, ttlDays });

  process.stdout.write(
    [
      'Worker-token aangemaakt. Bewaar het rauwe token nu — het wordt niet opnieuw getoond.',
      '',
      `  id:      ${record.id}`,
      `  naam:    ${record.name}`,
      `  scopes:  ${record.scopes}`,
      `  vervalt: ${record.expiresAt ? record.expiresAt.toISOString() : 'nooit'}`,
      '',
      `  WORKER_TOKEN=${token}`,
      '',
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Fout: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
