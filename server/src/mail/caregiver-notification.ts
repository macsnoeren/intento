import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../env.js';
import type { MailMessage, MailTransport } from './transport.js';

/**
 * Seintje aan de begeleider dat er een nieuwe boodschap is (T13.2, DESIGN §3.6, §9.4, §10.1).
 *
 * De berichtenlijst (T13.1) laat zien wát er gezegd is, maar alleen als de begeleider toevallig kijkt.
 * Deze mail is het duwtje: er is iets nieuws, kom kijken.
 *
 * **De boodschap staat bewust niet in de mail.** E-mail is een extern kanaal: het gaat over servers die
 * niet van ons zijn, blijft in postvakken staan en wordt geïndexeerd. De zin van de gebruiker is
 * communicatie-inhoud en hoort in de app, achter authenticatie (§9.4). Wat er wél in staat: wie er iets
 * zei en wanneer — genoeg om te weten dat je moet gaan kijken, niet genoeg om iemands communicatie uit
 * een postvak te lezen. Dat is ook precies wat gevraagd is: gemaild wórden *dat* er iets nieuws is.
 *
 * **Nooit blokkerend.** Een mislukte mail (geen SMTP, time-out, onbereikbare server) mag het bevestigen
 * van een boodschap niet stukmaken — de gebruiker heeft dan al gezegd wat hij wilde zeggen. Elke fout
 * wordt gelogd en verder genegeerd, net als bij de verificatiemail bij registratie.
 *
 * **Wie krijgt hem:** uitsluitend accounts met een expliciete `CaregiverAssignment` op deze gebruiker.
 * Een beheerder die niet gekoppeld is, krijgt niets — die zou anders mail krijgen over elke zin van
 * elke gebruiker in de organisatie.
 */

/** Stelt de meldingsmail samen. Bevat de naam en het tijdstip — nooit de boodschap zelf. */
export function buildCaregiverNotification(
  to: string,
  userName: string,
  at: Date,
  appUrl: string,
): MailMessage {
  const time = at.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' });
  const subject = `Nieuw bericht van ${userName}`;
  const text = [
    `${userName} heeft om ${time} een bericht bevestigd in Intento.`,
    '',
    'Log in om te zien wat er gezegd is:',
    appUrl,
    '',
    'Het bericht zelf staat bewust niet in deze e-mail.',
  ].join('\n');
  const html =
    `<p><strong>${escapeHtml(userName)}</strong> heeft om ${escapeHtml(time)} een bericht ` +
    `bevestigd in Intento.</p>` +
    `<p><a href="${escapeHtml(appUrl)}">Log in om te zien wat er gezegd is</a></p>` +
    `<p>Het bericht zelf staat bewust niet in deze e-mail.</p>`;
  return { to, subject, text, html };
}

/** Minimale HTML-escape voor de namen/tijden die we in de HTML-variant zetten. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Stuurt de gekoppelde begeleiders van deze gebruiker een seintje. Geeft het aantal verstuurde mails
 * terug (handig voor tests en logging); faalt nooit.
 */
export async function notifyCaregiversOfMessage(
  prisma: PrismaClient,
  mail: MailTransport,
  env: Env,
  input: { userId: string; at: Date },
  log?: FastifyBaseLogger,
): Promise<number> {
  if (!env.NOTIFY_CAREGIVERS_BY_EMAIL) return 0;

  try {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { name: true },
    });
    if (!user) return 0;

    const links = await prisma.caregiverAssignment.findMany({
      where: { userId: input.userId },
      select: { account: { select: { email: true } } },
    });
    if (links.length === 0) return 0;

    let sent = 0;
    for (const link of links) {
      try {
        await mail.send(
          buildCaregiverNotification(link.account.email, user.name, input.at, env.APP_BASE_URL),
        );
        sent += 1;
      } catch (error) {
        // Eén onbereikbaar adres mag de rest niet tegenhouden.
        log?.warn({ err: error }, 'Melding aan begeleider kon niet worden verstuurd');
      }
    }
    return sent;
  } catch (error) {
    // Ook een db-fout hier mag het bevestigen niet raken: de boodschap staat al vast.
    log?.warn({ err: error }, 'Melding aan begeleiders overgeslagen');
    return 0;
  }
}
