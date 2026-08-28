/**
 * Handmatige rookproef voor spraakuitvoer (T18.1/T18.3).
 *
 * Draait de échte backend tegen de échte spraakdienst — geen mocks — en controleert dat een gekoppelde
 * tablet een WAV terugkrijgt voor de zin op zijn scherm. Bedoeld om met de hand te draaien:
 *
 *   SPEECH_PROVIDER=http SPEECH_SERVICE_URL=http://127.0.0.1:5002 SPEECH_SERVICE_TOKEN=… \
 *     npx tsx src/scripts/smoke-speech.ts
 */
import { buildApp } from '../app.js';
import { loadEnv } from '../env.js';
import { prisma } from '../db/prisma.js';
import { createLinkCode } from '../auth/device.js';

async function main(): Promise<void> {
  const env = loadEnv({
    NODE_ENV: 'test',
    SIGNING_SECRET: 'smoke-signing-secret',
    ENCRYPTION_KEY: 'smoke-encryption-key',
    SPEECH_PROVIDER: process.env.SPEECH_PROVIDER ?? 'http',
    SPEECH_SERVICE_URL: process.env.SPEECH_SERVICE_URL ?? 'http://127.0.0.1:5002',
    SPEECH_SERVICE_TOKEN: process.env.SPEECH_SERVICE_TOKEN ?? '',
  });
  const app = await buildApp({ env });

  const org = await prisma.organization.create({
    data: { name: 'Rookproef spraak', type: 'family' },
  });
  const user = await prisma.user.create({
    data: {
      name: 'Sanne',
      organizationId: org.id,
      communicationProfile: {
        create: { speechEnabled: true, speechVoice: process.env.VOICE ?? 'nl_NL-pim-medium' },
      },
    },
  });

  const { code } = await createLinkCode(prisma, user.id, 60);
  const link = await app.inject({ method: 'POST', url: '/devices/link', payload: { code } });
  const cookie = String(link.headers['set-cookie']).split(';', 1)[0];

  const started = Date.now();
  const res = await app.inject({
    method: 'POST',
    url: '/device/speech',
    headers: { cookie },
    payload: { text: 'Ik wil graag water drinken.' },
  });
  const isWav = res.rawPayload.subarray(0, 4).toString('ascii') === 'RIFF';
  console.log(
    `status=${res.statusCode} type=${res.headers['content-type']} bytes=${res.rawPayload.length} ` +
      `wav=${isWav} in ${Date.now() - started} ms`,
  );

  // Tweede keer: uit de cache, dus merkbaar sneller en zonder de dienst te raken.
  const cached = Date.now();
  const again = await app.inject({
    method: 'POST',
    url: '/device/speech',
    headers: { cookie },
    payload: { text: 'Ik wil graag water drinken.' },
  });
  console.log(`herhaling: status=${again.statusCode} in ${Date.now() - cached} ms (cache)`);

  await prisma.device.deleteMany({ where: { userId: user.id } });
  await prisma.deviceLinkCode.deleteMany({ where: { userId: user.id } });
  await prisma.userCommunicationProfile.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await app.close();
  await prisma.$disconnect();

  if (res.statusCode !== 200 || !isWav) process.exitCode = 1;
}

void main();
