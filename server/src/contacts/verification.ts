import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Encryptor } from '../crypto/encryption.js';
import type { MailMessage, MailTransport } from '../mail/transport.js';
import { generateVerificationToken, hashVerificationToken } from '../auth/email-verification.js';

/**
 * Opt-in van een contact (N10.2, INTENTO-NEW-DESIGN §28, V5).
 *
 * Een contact krijgt pas berichten nadat hij zelf heeft bevestigd dat hij dat wil. Bij het aanmaken
 * of bij een nieuw e-mailadres gaat er een mail met een bevestigingslink naar het contact; de link
 * opent een openbare pagina in de web-app, waar het contact **zelf op "Ja" klikt** (een POST). Een
 * kale GET van de link verandert niets, zodat een mailscanner die links vooraf opent geen toestemming
 * kan geven.
 *
 * Tokens zoals bij de e-mailverificatie: alleen de hash in de db, eenmalig, verlopen, hooguit één open
 * token per contact. De mail noemt het contact zoals de beheerder hem invoerde ("Mama") en de
 * organisatie, maar **niet de gebruiker**: klopt het adres niet, dan leert een vreemde niets over de
 * persoon die Intento gebruikt.
 */

export const CONTACT_VERIFY_PATH = '/contact-bevestigen';

export function buildContactVerificationUrl(env: Pick<Env, 'APP_BASE_URL'>, token: string): string {
  const url = new URL(CONTACT_VERIFY_PATH, env.APP_BASE_URL);
  url.searchParams.set('token', token);
  return url.toString();
}

export function buildContactVerificationEmail(
  to: string,
  contactName: string,
  organizationName: string,
  url: string,
  ttlHours: number,
): MailMessage {
  const days = Math.round(ttlHours / 24);
  const text = [
    `Hallo ${contactName},`,
    '',
    `${organizationName} gebruikt Intento: een app waarmee iemand die moeilijk kan praten met pictogrammen`,
    'een bericht maakt. Je bent toegevoegd als contact, zodat zo iemand jou een bericht kan sturen.',
    '',
    'Wil je die berichten per e-mail ontvangen? Bevestig dat dan via deze link:',
    url,
    '',
    `De link werkt ${days > 1 ? `${days} dagen` : 'één dag'}. Wil je dit niet, dan hoef je niets te doen:`,
    'zonder bevestiging krijg je geen berichten.',
  ].join('\n');
  return { to, subject: 'Wil je berichten ontvangen via Intento?', text };
}

/** Maakt een nieuw token (het vorige vervalt) en geeft het rauwe token terug. */
export async function createContactVerificationToken(
  prisma: PrismaClient,
  contactId: string,
  ttlHours: number,
): Promise<string> {
  const token = generateVerificationToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.contactVerificationToken.deleteMany({ where: { contactId, usedAt: null } }),
    prisma.contactVerificationToken.create({
      data: { tokenHash: hashVerificationToken(token), contactId, expiresAt },
    }),
  ]);
  return token;
}

/** Stuurt de bevestigingsmail naar het (ontsleutelde) adres van het contact. */
export async function sendContactVerification(
  deps: {
    prisma: PrismaClient;
    mail: MailTransport;
    encryptor: Encryptor;
    env: Pick<Env, 'APP_BASE_URL' | 'CONTACT_VERIFICATION_TTL_HOURS'>;
  },
  contactId: string,
): Promise<void> {
  const { prisma, mail, encryptor, env } = deps;
  const contact = await prisma.contact.findUniqueOrThrow({
    where: { id: contactId },
    select: {
      nameEncrypted: true,
      emailEncrypted: true,
      organization: { select: { name: true } },
    },
  });
  const token = await createContactVerificationToken(
    prisma,
    contactId,
    env.CONTACT_VERIFICATION_TTL_HOURS,
  );
  await mail.send(
    buildContactVerificationEmail(
      encryptor.decrypt(contact.emailEncrypted),
      encryptor.decrypt(contact.nameEncrypted),
      contact.organization.name,
      buildContactVerificationUrl(env, token),
      env.CONTACT_VERIFICATION_TTL_HOURS,
    ),
  );
}

/** Een token dat nog bruikbaar is (bestaat, ongebruikt, niet verlopen), of `null`. */
export async function findOpenContactToken(prisma: PrismaClient, token: string) {
  const record = await prisma.contactVerificationToken.findUnique({
    where: { tokenHash: hashVerificationToken(token) },
    select: { id: true, contactId: true, usedAt: true, expiresAt: true },
  });
  if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) return null;
  return record;
}

/**
 * Bevestigt een contact met een rauw token: token gebruikt en contact bevestigd, in één transactie.
 * Onbekend, verlopen of al gebruikt geven allemaal `null` (geen onderscheid → geen enumeratie).
 */
export async function confirmContactToken(
  prisma: PrismaClient,
  token: string,
): Promise<{ contactId: string; organizationId: string } | null> {
  const record = await findOpenContactToken(prisma, token);
  if (!record) return null;
  const now = new Date();
  const [, contact] = await prisma.$transaction([
    prisma.contactVerificationToken.update({ where: { id: record.id }, data: { usedAt: now } }),
    prisma.contact.update({
      where: { id: record.contactId },
      data: { emailVerifiedAt: now },
      select: { id: true, organizationId: true },
    }),
  ]);
  return { contactId: contact.id, organizationId: contact.organizationId };
}
