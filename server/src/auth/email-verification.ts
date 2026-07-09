import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import type { MailMessage, MailTransport } from '../mail/transport.js';

/**
 * E-mailverificatie (T1.4, DESIGN §2, §9.4, CLAUDE.md security-checklist).
 *
 * Net als bij sessie- en apparaat-tokens gaat het rauwe verificatietoken alléén naar de
 * accounthouder (per e-mail) en staat het in de db **uitsluitend gehasht** (SHA-256). Tokens
 * zijn eenmalig (`usedAt`) en verlopen (`expiresAt`). Bij het aanmaken van een nieuw token
 * verwijderen we openstaande, ongebruikte tokens van hetzelfde account, zodat er per account
 * hooguit één geldig token tegelijk bestaat (een resend maakt het vorige ongeldig).
 */

/** Genereert een cryptografisch sterk, URL-veilig verificatietoken (256 bit). */
export function generateVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256-hash (hex) van een token; dezelfde functie bij aanmaken en inwisselen. */
export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Maakt een nieuw verificatietoken voor een account en geeft het **rauwe** token terug (alleen
 * hier beschikbaar; daarna kennen we alleen de hash). Verwijdert eerst eventuele openstaande,
 * ongebruikte tokens van dit account zodat een resend het vorige token ongeldig maakt.
 */
export async function createEmailVerificationToken(
  prisma: PrismaClient,
  accountId: string,
  ttlHours: number,
): Promise<string> {
  const token = generateVerificationToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { accountId, usedAt: null } }),
    prisma.emailVerificationToken.create({
      data: { tokenHash: hashVerificationToken(token), accountId, expiresAt },
    }),
  ]);
  return token;
}

export type VerifyEmailOutcome =
  { ok: true; account: AccountModel } | { ok: false; reason: 'invalid_or_expired' };

/**
 * Wisselt een rauw verificatietoken in: markeert het account als geverifieerd en het token als
 * gebruikt, in één transactie. Weigert onbekende, verlopen of reeds gebruikte tokens met dezelfde
 * neutrale reden (geen onderscheid → geen enumeratie). Een al geverifieerd account dat opnieuw
 * verifieert met een geldig (nog ongebruikt) token is idempotent: `emailVerifiedAt` blijft staan.
 */
export async function verifyEmailToken(
  prisma: PrismaClient,
  token: string,
): Promise<VerifyEmailOutcome> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashVerificationToken(token) },
  });

  if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'invalid_or_expired' };
  }

  const now = new Date();
  const [, account] = await prisma.$transaction([
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: now },
    }),
    prisma.account.update({
      where: { id: record.accountId },
      // Behoud een bestaand verificatiemoment (idempotent); zet het anders op nu.
      data: { emailVerifiedAt: now },
    }),
  ]);

  return { ok: true, account };
}

/** Bouwt de verificatielink door het rauwe token als query-parameter aan de basis-URL te hangen. */
export function buildVerificationUrl(env: Env, token: string): string {
  const url = new URL(env.EMAIL_VERIFICATION_URL_BASE);
  url.searchParams.set('token', token);
  return url.toString();
}

/** Stelt de verificatiemail samen (tekst + eenvoudige HTML) voor een account en link. */
export function buildVerificationEmail(to: string, verificationUrl: string): MailMessage {
  const subject = 'Bevestig je e-mailadres voor Intento';
  const text = [
    'Welkom bij Intento!',
    '',
    'Bevestig je e-mailadres door op de volgende link te klikken:',
    verificationUrl,
    '',
    'Heb je je niet aangemeld? Dan kun je deze e-mail negeren.',
  ].join('\n');
  // De URL is server-gegenereerd (geen gebruikersinvoer), dus veilig in het href-attribuut.
  const html =
    `<p>Welkom bij Intento!</p>` +
    `<p>Bevestig je e-mailadres door op de volgende link te klikken:</p>` +
    `<p><a href="${verificationUrl}">E-mailadres bevestigen</a></p>` +
    `<p>Heb je je niet aangemeld? Dan kun je deze e-mail negeren.</p>`;
  return { to, subject, text, html };
}

/**
 * Maakt een verificatietoken aan en verstuurt de verificatiemail. Bewust **tolerant**: een
 * mislukte verzending (bv. SMTP down) mag de aanroepende flow (registratie) niet laten falen —
 * de mail is een aanvulling, geen harde blokkade (T1.3 blijft werken zonder mailserver). Fouten
 * worden gelogd door de aanroeper; hier gooien we niet.
 */
export async function sendVerificationEmail(
  prisma: PrismaClient,
  mail: MailTransport,
  env: Env,
  account: Pick<AccountModel, 'id' | 'email'>,
): Promise<void> {
  const token = await createEmailVerificationToken(
    prisma,
    account.id,
    env.EMAIL_VERIFICATION_TTL_HOURS,
  );
  const url = buildVerificationUrl(env, token);
  await mail.send(buildVerificationEmail(account.email, url));
}
