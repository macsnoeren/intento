import type { AgentEvent, Presentation } from '@intento/shared';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { CommunicationSessionModel } from '../generated/prisma/models.js';
import type { Encryptor } from '../crypto/encryption.js';
import type { MailMessage, MailTransport } from '../mail/transport.js';
import { HttpError } from '../errors.js';

/**
 * Versturen per e-mail (N11.3, INTENTO-NEW-DESIGN §32, invariant I3).
 *
 * De **backend** verstuurt, nooit de agentdienst, en alleen als de gebruiker zelf JA zei op een scherm
 * dat over **dát ene contact** ging ("Wil je dit naar Mama sturen?", of in multi-icon "Naar Mama
 * sturen?"). Wat de agent in zijn toestand zet, telt niet. Het contact moet van deze gebruiker zijn,
 * actief en bevestigd (opt-in); de boodschap moet bevestigd zijn (I2).
 *
 * De verzending wordt vóór het versturen vastgelegd (`sending`), uniek per gesprek en contact: een
 * dubbele tik of een herhaalde JA na een storing verstuurt nooit twee keer. Daarna `sent` of `failed`.
 * Na een geslaagde verzending krijgen beheerders die dat willen een kopie, met de ontvanger erbij (N11.7).
 */

export type DeliveryStatus = 'sent' | 'failed';

export interface DeliveryOutcome {
  deliveryId: string;
  contactId: string;
  /** Voor de tablet ("Verstuurd naar Mama"); nooit naar een LLM of in een log. */
  contactName: string;
  status: DeliveryStatus;
  /** Kopieën aan beheerders (N11.7): verstuurd en mislukt. Een mislukte kopie raakt de verzending niet. */
  copies?: { sent: number; failed: number };
}

export function buildCopyEmail(
  to: string,
  userName: string,
  contactName: string,
  message: string,
): MailMessage {
  return {
    to,
    subject: `Kopie: bericht van ${userName} aan ${contactName}`,
    text: [
      `${userName} stuurde via Intento dit bericht aan ${contactName}:`,
      '',
      `"${message}"`,
      '',
      'Je krijgt deze kopie omdat je "Kopie van verstuurde berichten" aanzette onder "Mijn account".',
    ].join('\n'),
  };
}

/** Een kopie aan elke beheerder van de organisatie die dat wil (en een bevestigd adres heeft). */
async function sendCopies(
  prisma: PrismaClient,
  mail: MailTransport,
  organizationId: string,
  userName: string,
  contactName: string,
  message: string,
): Promise<{ sent: number; failed: number }> {
  const admins = await prisma.account.findMany({
    where: {
      organizationId,
      role: 'ADMIN',
      copySentMessages: true,
      emailVerifiedAt: { not: null },
    },
    select: { email: true },
  });
  const copies = { sent: 0, failed: 0 };
  for (const admin of admins) {
    try {
      await mail.send(buildCopyEmail(admin.email, userName, contactName, message));
      copies.sent += 1;
    } catch {
      copies.failed += 1;
    }
  }
  return copies;
}

/**
 * Het contact waar deze JA over ging, of `null` als dit geen verzend-JA is. Alleen een JA (geen keuze
 * uit tegels: die vraagt eerst nog "Naar … sturen?") op een deelscherm met precies één contact.
 */
export function contactToSend(presentation: Presentation, event: AgentEvent): string | null {
  if (event.type !== 'answer_yes') return null;
  if (presentation.kind !== 'share_contact' && presentation.kind !== 'confirm_send') return null;
  const contacts = presentation.options.filter((option) => option.kind === 'contact');
  if (contacts.length !== 1) return null;
  return contacts[0]?.contact_id ?? null;
}

export function buildMessageEmail(to: string, userName: string, message: string): MailMessage {
  return {
    to,
    subject: `Bericht van ${userName}`,
    text: [
      `Bericht van ${userName} via Intento:`,
      '',
      `"${message}"`,
      '',
      `${userName} maakte dit bericht met pictogrammen in Intento en koos zelf om het naar jou te sturen.`,
      'Antwoorden op deze e-mail komt niet aan; neem op je eigen manier contact op.',
    ].join('\n'),
  };
}

/**
 * Verstuurt de bevestigde boodschap naar één contact. Gooit 409 als dat niet mag (contact niet van deze
 * gebruiker, uit of onbevestigd, of geen bevestigde boodschap); dan is er niets verstuurd of vastgelegd.
 */
export async function deliver(
  deps: { prisma: PrismaClient; encryptor: Encryptor; mail: MailTransport },
  session: CommunicationSessionModel,
  userName: string,
  contactId: string,
  now: () => Date = () => new Date(),
): Promise<DeliveryOutcome> {
  const { prisma, encryptor, mail } = deps;
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      userId: session.userId,
      organizationId: session.organizationId,
      active: true,
      emailVerifiedAt: { not: null },
    },
    select: { id: true, emailEncrypted: true, nameEncrypted: true },
  });
  if (!contact) {
    throw new HttpError(409, 'CANNOT_SEND', 'Naar dit contact kan nu niets verstuurd worden.');
  }
  const intent = await prisma.communicationIntent.findUnique({
    where: { sessionId: session.id },
    select: { id: true, messageEncrypted: true },
  });
  if (!intent) {
    throw new HttpError(409, 'NOT_CONFIRMED', 'Er is nog geen bevestigde boodschap.');
  }

  const contactName = encryptor.decrypt(contact.nameEncrypted);
  let deliveryId: string;
  try {
    const row = await prisma.delivery.create({
      data: {
        sessionId: session.id,
        intentId: intent.id,
        contactId: contact.id,
        userId: session.userId,
        organizationId: session.organizationId,
        channel: 'email',
        status: 'sending',
      },
      select: { id: true },
    });
    deliveryId = row.id;
  } catch (error) {
    // Al eerder (of tegelijk) vastgelegd: dat is dezelfde verzending, niet nog een keer versturen.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.delivery.findUniqueOrThrow({
        where: { sessionId_contactId: { sessionId: session.id, contactId: contact.id } },
        select: { id: true, status: true },
      });
      return {
        deliveryId: existing.id,
        contactId: contact.id,
        contactName,
        status: existing.status === 'failed' ? 'failed' : 'sent',
      };
    }
    throw error;
  }

  const message = encryptor.decrypt(intent.messageEncrypted);
  try {
    await mail.send(
      buildMessageEmail(encryptor.decrypt(contact.emailEncrypted), userName, message),
    );
  } catch {
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: 'failed', error: 'mail_failed' },
    });
    return { deliveryId, contactId: contact.id, contactName, status: 'failed' };
  }
  await prisma.delivery.update({
    where: { id: deliveryId },
    data: { status: 'sent', sentAt: now() },
  });
  const copies = await sendCopies(
    prisma,
    mail,
    session.organizationId,
    userName,
    contactName,
    message,
  );
  return { deliveryId, contactId: contact.id, contactName, status: 'sent', copies };
}
