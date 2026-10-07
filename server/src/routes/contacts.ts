import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  contactVerifyRequestSchema,
  contactVerifyStatusSchema,
  type ContactVerifyStatus,
  contactCreateRequestSchema,
  contactListResponseSchema,
  contactPublicSchema,
  contactUpdateRequestSchema,
  type ContactListResponse,
  type ContactPublic,
} from '@intento/shared';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AccountModel } from '../generated/prisma/models.js';
import type { Encryptor } from '../crypto/encryption.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { assertSameTenant } from '../auth/tenant.js';
import { assertCaregiverAccess } from '../auth/caregivers.js';
import { HttpError } from '../errors.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';
import { availableTo } from '../vocabulary/repository.js';
import { signedAssetUrl } from '../vocabulary/assets.js';
import type { MailTransport } from '../mail/transport.js';
import {
  confirmContactToken,
  findOpenContactToken,
  sendContactVerification,
} from '../contacts/verification.js';

/**
 * Contacten van een gebruiker (N10.1, INTENTO-NEW-DESIGN §28, §39).
 *
 * `GET    /users/:id/contacts`              — lijst, in de vaste volgorde.
 * `POST   /users/:id/contacts`              — toevoegen (naam, relatie, e-mail, pictogram, volgorde).
 * `PATCH  /users/:id/contacts/:contactId`   — wijzigen; een nieuw e-mailadres is weer onbevestigd.
 * `DELETE /users/:id/contacts/:contactId`   — verwijderen.
 * `POST   /users/:id/contacts/:contactId/verification` — de bevestigingsmail opnieuw versturen.
 * `GET    /contacts/verify?token=`          — openbaar: is de link nog bruikbaar (verandert niets).
 * `POST   /contacts/verify`                 — openbaar: het contact bevestigt zelf (opt-in, N10.2).
 *
 * Voor de beheerder en een **gekoppelde** begeleider, alleen binnen de eigen organisatie. Naam en
 * e-mailadres staan versleuteld in de database en worden alleen hier, voor de beheeromgeving, ontsleuteld;
 * ze gaan nooit naar de agentdienst (V6). Het pictogram moet in de Vocabulary van de organisatie staan.
 * Geaudit zonder naam of e-mailadres.
 */

const userParamsSchema = z.object({ id: z.string().min(1).max(200) });
const contactParamsSchema = z.object({
  id: z.string().min(1).max(200),
  contactId: z.string().min(1).max(200),
});
const labelsSchema = z.array(z.string());

const contactInclude = {
  vocabularyItem: { select: { id: true, labels: true, status: true, assetPath: true } },
} satisfies Prisma.ContactInclude;
type ContactRow = Prisma.ContactGetPayload<{ include: typeof contactInclude }>;

export function contactToPublic(
  contact: ContactRow,
  encryptor: Encryptor,
  env: Pick<Env, 'ASSET_URL_SECRET' | 'ASSET_URL_TTL_SECONDS'>,
  now: Date = new Date(),
): ContactPublic {
  const item = contact.vocabularyItem;
  return contactPublicSchema.parse({
    id: contact.id,
    userId: contact.userId,
    name: encryptor.decrypt(contact.nameEncrypted),
    relation: contact.relation,
    email: encryptor.decrypt(contact.emailEncrypted),
    emailVerified: contact.emailVerifiedAt !== null,
    active: contact.active,
    sortOrder: contact.sortOrder,
    symbol: item
      ? {
          id: item.id,
          label: labelsSchema.parse(item.labels)[0] ?? item.id,
          imageUrl:
            item.status === 'approved' && item.assetPath ? signedAssetUrl(env, item, now) : null,
        }
      : null,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  });
}

export function registerContactRoutes(
  app: FastifyInstance,
  {
    env,
    prisma,
    encryptor,
    mail,
  }: { env: Env; prisma: PrismaClient; encryptor: Encryptor; mail: MailTransport },
): void {
  const guard = { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) };
  // Opnieuw versturen: streng begrensd tegen mailbommen (zelfde grens als bij accounts).
  const strict = {
    rateLimit: {
      max: env.RESEND_RATE_LIMIT_MAX,
      timeWindow: env.RESEND_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    },
  };
  // De openbare bevestigingspagina: ruim genoeg voor openen en klikken, te krap om tokens te raden
  // (die zijn 256 bit, maar begrenzen kost niets).
  const publicLimit = { rateLimit: { max: 30, timeWindow: 60 * 1000 } };

  /**
   * De bevestigingsmail versturen. Een mislukte mail breekt het opslaan niet af: het contact staat er,
   * nog onbevestigd, en "opnieuw versturen" kan later. Wel gelogd (zonder adres).
   */
  async function sendVerification(request: FastifyRequest, contactId: string): Promise<boolean> {
    try {
      await sendContactVerification({ prisma, mail, encryptor, env }, contactId);
      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.CONTACT_VERIFICATION_SEND,
        targetType: 'contact',
        targetId: contactId,
      });
      return true;
    } catch (error) {
      request.log.error({ err: error, contactId }, 'bevestigingsmail voor een contact mislukt');
      return false;
    }
  }

  /** De gebruiker in de eigen organisatie, en voor een begeleider alleen als hij gekoppeld is. */
  async function loadUser(account: AccountModel, userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const safe = assertSameTenant(account, user);
    await assertCaregiverAccess(prisma, account, userId);
    return safe;
  }

  /** Het pictogram moet een bruikbaar item uit de Vocabulary van deze organisatie zijn. */
  async function assertSymbol(organizationId: string, itemId: string | null | undefined) {
    if (!itemId) return;
    const item = await prisma.vocabularyItem.findFirst({
      where: { id: itemId, status: 'approved', ...availableTo(organizationId) },
      select: { id: true },
    });
    if (!item) {
      throw new HttpError(
        422,
        'SYMBOL_NOT_AVAILABLE',
        'Kies een pictogram uit de Vocabulary van je organisatie.',
      );
    }
  }

  /** Een contact van déze gebruiker; anders 404 (ook als het id bij een ander hoort). */
  async function loadContact(userId: string, contactId: string) {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, userId } });
    if (!contact) throw new HttpError(404, 'NOT_FOUND', 'Dit contact bestaat niet.');
    return contact;
  }

  app.get('/users/:id/contacts', guard, async (request): Promise<ContactListResponse> => {
    const account = requireAccount(request);
    const { id } = userParamsSchema.parse(request.params);
    const user = await loadUser(account, id);
    const rows = await prisma.contact.findMany({
      where: { userId: user.id, organizationId: user.organizationId },
      include: contactInclude,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const now = new Date();
    return contactListResponseSchema.parse({
      contacts: rows.map((row) => contactToPublic(row, encryptor, env, now)),
    });
  });

  app.post('/users/:id/contacts', guard, async (request, reply): Promise<ContactPublic> => {
    const account = requireAccount(request);
    const { id } = userParamsSchema.parse(request.params);
    const user = await loadUser(account, id);
    const body = contactCreateRequestSchema.parse(request.body);
    await assertSymbol(user.organizationId, body.vocabularyItemId);
    const sortOrder =
      body.sortOrder ??
      ((await prisma.contact.aggregate({ where: { userId: user.id }, _max: { sortOrder: true } }))
        ._max.sortOrder ?? -1) + 1;
    const contact = await prisma.contact.create({
      data: {
        userId: user.id,
        organizationId: user.organizationId,
        nameEncrypted: encryptor.encrypt(body.name),
        relation: body.relation ?? null,
        emailEncrypted: encryptor.encrypt(body.email),
        vocabularyItemId: body.vocabularyItemId ?? null,
        sortOrder,
      },
      include: contactInclude,
    });
    await recordAudit(prisma, request, {
      action: AUDIT_ACTIONS.CONTACT_CREATE,
      targetType: 'contact',
      targetId: contact.id,
      metadata: { userId: user.id },
    });
    await sendVerification(request, contact.id);
    reply.status(201);
    return contactToPublic(contact, encryptor, env);
  });

  app.patch('/users/:id/contacts/:contactId', guard, async (request): Promise<ContactPublic> => {
    const account = requireAccount(request);
    const { id, contactId } = contactParamsSchema.parse(request.params);
    const user = await loadUser(account, id);
    const current = await loadContact(user.id, contactId);
    const body = contactUpdateRequestSchema.parse(request.body);
    await assertSymbol(user.organizationId, body.vocabularyItemId);
    // Een ander e-mailadres moet opnieuw bevestigd worden (V5): de ontvanger zelf geeft toestemming.
    const emailChanged =
      body.email !== undefined && body.email !== encryptor.decrypt(current.emailEncrypted);
    const updated = await prisma.contact.update({
      where: { id: current.id },
      data: {
        ...(body.name !== undefined ? { nameEncrypted: encryptor.encrypt(body.name) } : {}),
        ...(body.relation !== undefined ? { relation: body.relation } : {}),
        ...(emailChanged && body.email
          ? { emailEncrypted: encryptor.encrypt(body.email), emailVerifiedAt: null }
          : {}),
        ...(body.vocabularyItemId !== undefined ? { vocabularyItemId: body.vocabularyItemId } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      },
      include: contactInclude,
    });
    await recordAudit(prisma, request, {
      action: AUDIT_ACTIONS.CONTACT_UPDATE,
      targetType: 'contact',
      targetId: current.id,
      metadata: { userId: user.id, fields: Object.keys(body), emailChanged },
    });
    // Nieuw adres: de oude link vervalt (sendVerification maakt een nieuw token) en de nieuwe
    // ontvanger moet zelf bevestigen.
    if (emailChanged) await sendVerification(request, current.id);
    return contactToPublic(updated, encryptor, env);
  });

  app.post(
    '/users/:id/contacts/:contactId/verification',
    { ...guard, config: strict },
    async (request, reply): Promise<void> => {
      const account = requireAccount(request);
      const { id, contactId } = contactParamsSchema.parse(request.params);
      const user = await loadUser(account, id);
      const current = await loadContact(user.id, contactId);
      if (current.emailVerifiedAt) {
        throw new HttpError(409, 'ALREADY_VERIFIED', 'Dit contact heeft al bevestigd.');
      }
      if (!(await sendVerification(request, current.id))) {
        throw new HttpError(502, 'MAIL_FAILED', 'De e-mail kon niet verstuurd worden.');
      }
      reply.status(204).send();
    },
  );

  app.get(
    '/contacts/verify',
    { config: publicLimit },
    async (request): Promise<ContactVerifyStatus> => {
      const parsed = contactVerifyRequestSchema.safeParse(request.query);
      const valid =
        parsed.success && (await findOpenContactToken(prisma, parsed.data.token)) !== null;
      return contactVerifyStatusSchema.parse({ valid });
    },
  );

  app.post(
    '/contacts/verify',
    { config: publicLimit },
    async (request): Promise<{ verified: true }> => {
      const { token } = contactVerifyRequestSchema.parse(request.body);
      const confirmed = await confirmContactToken(prisma, token);
      if (!confirmed) {
        throw new HttpError(
          400,
          'INVALID_OR_EXPIRED',
          'Deze link werkt niet meer. Vraag om een nieuwe bevestigingsmail.',
        );
      }
      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.CONTACT_VERIFY,
        targetType: 'contact',
        targetId: confirmed.contactId,
        organizationId: confirmed.organizationId,
      });
      return { verified: true };
    },
  );

  app.delete('/users/:id/contacts/:contactId', guard, async (request, reply): Promise<void> => {
    const account = requireAccount(request);
    const { id, contactId } = contactParamsSchema.parse(request.params);
    const user = await loadUser(account, id);
    const current = await loadContact(user.id, contactId);
    await prisma.contact.delete({ where: { id: current.id } });
    await recordAudit(prisma, request, {
      action: AUDIT_ACTIONS.CONTACT_DELETE,
      targetType: 'contact',
      targetId: current.id,
      metadata: { userId: user.id },
    });
    reply.status(204).send();
  });
}
