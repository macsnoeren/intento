import type { FastifyInstance } from 'fastify';
import {
  messageListQuerySchema,
  messageListResponseSchema,
  type MessageListResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Encryptor } from '../crypto/encryption.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';

/**
 * Berichtenoverzicht voor de beheerder (N11.6, INTENTO-NEW-DESIGN §32, §49).
 *
 * `GET /messages?page=&pageSize=` — de bevestigde berichten van de eigen organisatie, nieuwste eerst:
 * wanneer, van wie, de boodschap, en aan wie verstuurd (met status), of niets ("niet verstuurd"). Alleen
 * de beheerder; een begeleider niet. Boodschap en contactnamen worden hier ontsleuteld. Omdat dat
 * persoonlijke inhoud is, wordt elke opvraging geaudit (zonder inhoud).
 */
export function registerMessageRoutes(
  app: FastifyInstance,
  { prisma, encryptor }: { prisma: PrismaClient; encryptor: Encryptor },
): void {
  app.get(
    '/messages',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<MessageListResponse> => {
      const { organizationId } = requireAccount(request);
      const query = messageListQuerySchema.parse(request.query);
      const where = { organizationId };
      const [total, intents] = await Promise.all([
        prisma.communicationIntent.count({ where }),
        prisma.communicationIntent.findMany({
          where,
          orderBy: [{ confirmedAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            userId: true,
            messageEncrypted: true,
            confirmedAt: true,
            deliveries: {
              where: { organizationId },
              orderBy: { createdAt: 'asc' },
              select: {
                status: true,
                createdAt: true,
                sentAt: true,
                contact: { select: { nameEncrypted: true } },
              },
            },
          },
        }),
      ]);
      const users = await prisma.user.findMany({
        where: { organizationId, id: { in: [...new Set(intents.map((i) => i.userId))] } },
        select: { id: true, name: true },
      });
      const names = new Map(users.map((user) => [user.id, user.name]));

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.MESSAGE_LIST,
        targetType: 'organization',
        targetId: organizationId,
        metadata: { page: query.page, count: intents.length },
      });

      return messageListResponseSchema.parse({
        items: intents.map((intent) => ({
          id: intent.id,
          confirmedAt: intent.confirmedAt.toISOString(),
          user: { id: intent.userId, name: names.get(intent.userId) ?? 'Onbekend' },
          message: encryptor.decrypt(intent.messageEncrypted),
          deliveries: intent.deliveries.map((delivery) => ({
            contactName: delivery.contact
              ? encryptor.decrypt(delivery.contact.nameEncrypted)
              : null,
            status: delivery.status,
            at: (delivery.sentAt ?? delivery.createdAt).toISOString(),
          })),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      });
    },
  );
}
