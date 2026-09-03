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
 * **Bootstrap (optioneel).** Met `grantOperatorIfFirst` krijgt de allereerste aanmelding op een
 * lege database ook de platform-operatorrol, zodat een verse installatie zonder seed-script in
 * gebruik te nemen is. Uit tenzij expliciet aangezet; zie `BOOTSTRAP_FIRST_ADMIN_AS_OPERATOR` in
 * `env.ts` voor waarom dat de veilige stand is.
 *
 * De uniciteit van de e-mail leunt op de db-constraint (`Account.email @unique`), niet op een
 * losse "bestaat al?"-check: dat sluit een race tussen twee gelijktijdige registraties uit en
 * voorkomt dat de responstijd het bestaan van een account verraadt. Bij een botsing geeft de
 * service een **generieke** faalreden terug; de route vertaalt die naar een neutrale melding
 * (geen account-enumeratie, CLAUDE.md security-checklist).
 */

export type RegisterResult =
  | { ok: true; account: AccountModel; grantedOperator: boolean }
  | { ok: false; reason: 'email_taken' };

export interface RegisterOptions {
  /**
   * Mag deze aanmelding de platform-operatorrol krijgen als hij de allereerste is? Komt uit
   * `BOOTSTRAP_FIRST_ADMIN_AS_OPERATOR`; staat standaard uit. Zie de uitleg bij de vlag in `env.ts`.
   */
  grantOperatorIfFirst?: boolean;
}

export async function registerOrganization(
  prisma: PrismaClient,
  input: RegisterRequest,
  options: RegisterOptions = {},
): Promise<RegisterResult> {
  const passwordHash = await hashPassword(input.password);
  let grantedOperator = false;

  try {
    const account = await prisma.$transaction(async (tx) => {
      // De bootstrap-uitzondering (T8.3-variant): op een lege database is deze aanmelding degene
      // die de installatie in gebruik neemt, en dan krijgt hij de operatorconsole. "Leeg" is hier
      // *geen enkel account*, niet *geen enkele organisatie*: een organisatie zonder account kan
      // niet bestaan (deze transactie maakt ze samen), en op accounts tellen leest directer.
      //
      // Binnen DEZE transactie, zodat het tellen en het claimen niet uit elkaar kunnen lopen.
      // Op SQLite is dat sluitend: er is één schrijver tegelijk, dus een tweede registratie ziet
      // het account van de eerste al staan. Op PostgreSQL zouden twee gelijktijdige áállereerste
      // registraties allebei nul kunnen tellen; daar hoort dan SERIALIZABLE bij. Dat is geen
      // theoretische slordigheid maar wel een heel klein raam: het bestaat alleen op een database
      // waar nog nooit iemand op stond, en alleen zolang de vlag aan is.
      grantedOperator = (options.grantOperatorIfFirst ?? false) && (await tx.account.count()) === 0;

      const organization = await tx.organization.create({
        data: {
          name: input.organizationName,
          type: input.organizationType,
          // De dubbele voorwaarde uit `auth/operator.ts`: de vlag op het account alleen geeft geen
          // console-toegang, de organisatie moet de platformorganisatie zijn. Allebei of geen van
          // beide — een half gezette bootstrap levert een account op dat operator heet en het niet is.
          ...(grantedOperator ? { isPlatform: true } : {}),
        },
      });
      return tx.account.create({
        data: {
          email: input.email,
          name: input.adminName,
          passwordHash,
          role: 'ADMIN',
          organizationId: organization.id,
          ...(grantedOperator ? { isOperator: true } : {}),
        },
      });
    });
    return { ok: true, account, grantedOperator };
  } catch (error) {
    // Unieke-constraint-botsing op de e-mail: het account bestaat al. Bewust generiek terug —
    // de route lekt niet of het adres bestaat. Andere fouten laten we doorgooien (500).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, reason: 'email_taken' };
    }
    throw error;
  }
}
