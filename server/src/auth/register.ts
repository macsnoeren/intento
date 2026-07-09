import type { RegisterRequest } from '@intento/shared';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import { hashPassword } from './password.js';

/**
 * Zelfaanmelding van een organisatie/familie (T1.3, DESIGN §2, §3.7 stap 1).
 *
 * Maakt in **één transactie** een nieuwe `Organization` plus het eerste `Account` met rol
 * ADMIN (argon2id-wachtwoordhash). Slaagt of faalt als geheel: bij een dubbele e-mail rolt de
 * transactie terug, zodat er nooit een lege organisatie zonder eigenaar achterblijft.
 *
 * De uniciteit van de e-mail leunt op de db-constraint (`Account.email @unique`), niet op een
 * losse "bestaat al?"-check: dat sluit een race tussen twee gelijktijdige registraties uit en
 * voorkomt dat de responstijd het bestaan van een account verraadt. Bij een botsing geeft de
 * service een **generieke** faalreden terug; de route vertaalt die naar een neutrale melding
 * (geen account-enumeratie, CLAUDE.md security-checklist).
 */

export type RegisterResult =
  { ok: true; account: AccountModel } | { ok: false; reason: 'email_taken' };

export async function registerOrganization(
  prisma: PrismaClient,
  input: RegisterRequest,
): Promise<RegisterResult> {
  const passwordHash = await hashPassword(input.password);

  try {
    const account = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: input.organizationName, type: input.organizationType },
      });
      return tx.account.create({
        data: {
          email: input.email,
          name: input.adminName,
          passwordHash,
          role: 'ADMIN',
          organizationId: organization.id,
        },
      });
    });
    return { ok: true, account };
  } catch (error) {
    // Unieke-constraint-botsing op de e-mail: het account bestaat al. Bewust generiek terug —
    // de route lekt niet of het adres bestaat. Andere fouten laten we doorgooien (500).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, reason: 'email_taken' };
    }
    throw error;
  }
}
