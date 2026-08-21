import { randomBytes } from 'node:crypto';
import type { CreateCaregiverRequest } from '@intento/shared';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import { hashPassword } from './password.js';

/**
 * Begeleider-accounts aanmaken (T2.4, DESIGN §2, §5.2, §6.2, FR-017).
 *
 * Tot nu toe ontstonden er alleen ADMIN-accounts (seed + zelfaanmelding T1.3), waardoor de
 * koppelweergave van T2.2 nooit iets te kiezen had. Een beheerder maakt hier een `Account` met rol
 * **CAREGIVER** binnen de **eigen** organisatie aan.
 *
 * Gekozen flow: **direct aanmaken met een server-gegenereerd tijdelijk wachtwoord** (i.p.v. een
 * uitnodigingsmail met wachtwoord-instellink). Redenen:
 *   - Intento moet **zonder mailserver** bruikbaar blijven (zelfde uitgangspunt als T1.3/T1.4:
 *     e-mail is een aanvulling, geen harde afhankelijkheid). Een uitnodigingsflow zou een werkende
 *     SMTP-server tot randvoorwaarde maken voor het inrichten van een organisatie.
 *   - Het wachtwoord komt **niet** van de beheerder: die zou een zwak of hergebruikt wachtwoord
 *     kunnen kiezen voor iemand anders. De server genereert 256 bit entropie.
 *   - Het rauwe wachtwoord bestaat alleen in het antwoord op deze ene call — in de db staat
 *     uitsluitend de argon2id-hash, precies zoals bij koppelcodes (T2.3) en worker-tokens (T5.8).
 * Het account start **ongeverifieerd**; de route stuurt best-effort een verificatiemail zodat de
 * begeleider zijn adres alsnog bevestigt (zie `docs/security.md` voor de verificatie-gate). Het start
 * óók met `mustChangePassword` (T2.6): zolang het tijdelijke wachtwoord geldt, kent de beheerder het
 * wachtwoord van de begeleider — het account mag dan niets anders dan zijn eigen wachtwoord wisselen.
 */

/**
 * Genereert een sterk tijdelijk wachtwoord (256 bit, URL-veilig base64). Voldoet ruim aan
 * `strongPasswordSchema` (≥ 12 tekens, niet één herhaald teken) en is niet te raden of af te
 * leiden uit het e-mailadres.
 */
export function generateTemporaryPassword(): string {
  return randomBytes(24).toString('base64url');
}

export type CreateCaregiverResult =
  | { ok: true; account: AccountModel; temporaryPassword: string }
  | { ok: false; reason: 'email_taken' };

/**
 * Maakt een CAREGIVER-account binnen `organizationId`. De rol en de organisatie komen bewust
 * **niet** uit de invoer (geen privilege-escalatie, geen account in een andere tenant).
 *
 * Net als bij registratie (T1.3) leunt de uniciteit van de e-mail op de db-constraint
 * (`Account.email @unique`) in plaats van een losse "bestaat al?"-check: dat sluit een race tussen
 * twee gelijktijdige aanmaakverzoeken uit en laat de responstijd niet verraden of het adres al
 * bestaat. Bij een botsing komt er een **generieke** faalreden terug die de route naar een
 * neutrale melding vertaalt (geen account-enumeratie, CLAUDE.md security-checklist).
 */
export async function createCaregiverAccount(
  prisma: PrismaClient,
  organizationId: string,
  input: CreateCaregiverRequest,
): Promise<CreateCaregiverResult> {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  try {
    const account = await prisma.account.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        role: 'CAREGIVER',
        organizationId,
        // Tijdelijk-wachtwoord-markering (T2.6): dit wachtwoord is bij de beheerder bekend, dus het
        // account is pas echt van de begeleider alleen zodra hij het zelf vervangt. Tot dan laat
        // `authorize()` alleen het eigen account bekijken en het wachtwoord wijzigen toe.
        mustChangePassword: true,
      },
    });
    return { ok: true, account, temporaryPassword };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, reason: 'email_taken' };
    }
    throw error;
  }
}
