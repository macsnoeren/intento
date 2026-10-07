import type { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../env.js';
import type { MailMessage, MailTransport } from '../mail/transport.js';

/**
 * E-mail bij een nieuw ontbrekend woord (N9.3, INTENTO-NEW-DESIGN §17).
 *
 * Alleen beheerders van de organisatie die `notifyGapsByEmail` aanzetten en hun e-mailadres bevestigden,
 * en alleen voor woorden die **nieuw** zijn (de eerste keer dat de organisatie ze mist): hetzelfde woord
 * een tweede keer geeft geen tweede e-mail. De mail noemt het woord en waar je het kunt toevoegen, nooit
 * de gebruiker of het gesprek.
 */

export function buildGapEmail(to: string, label: string, appUrl: string): MailMessage {
  const subject = `Ontbrekend woord in Intento: "${label}"`;
  const text = [
    `Een gebruiker wilde iets zeggen met het woord "${label}", maar daar is nog geen goed pictogram voor.`,
    'Intento toonde het woord met het pictogram dat er het dichtst bij kwam.',
    '',
    `Voeg het woord toe onder "Ontbrekende woorden": ${appUrl}`,
    '',
    'Je krijgt deze e-mail omdat je meldingen over ontbrekende woorden aanzette onder "Mijn account".',
  ].join('\n');
  return { to, subject, text };
}

export async function notifyNewGaps(
  prisma: PrismaClient,
  mail: MailTransport,
  env: Pick<Env, 'CORS_ORIGIN'>,
  organizationId: string,
  concepts: readonly string[],
): Promise<number> {
  if (concepts.length === 0) return 0;
  const [gaps, admins] = await Promise.all([
    prisma.vocabularyGap.findMany({
      where: { organizationId, conceptKey: { in: [...concepts] } },
      select: { label: true },
    }),
    prisma.account.findMany({
      where: {
        organizationId,
        role: 'ADMIN',
        notifyGapsByEmail: true,
        emailVerifiedAt: { not: null },
      },
      select: { email: true },
    }),
  ]);
  let sent = 0;
  for (const admin of admins) {
    for (const gap of gaps) {
      await mail.send(buildGapEmail(admin.email, gap.label, env.CORS_ORIGIN));
      sent += 1;
    }
  }
  return sent;
}
