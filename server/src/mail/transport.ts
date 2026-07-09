import nodemailer from 'nodemailer';
import type { Env } from '../env.js';

/**
 * Provider-agnostische mail-service (T1.4, DESIGN §2, §9.4).
 *
 * De rest van de app kent alléén de `MailTransport`-interface; de concrete implementatie
 * (SMTP in productie, log in dev, geheugen in tests) wordt via `createMailTransport(env)`
 * gekozen en in `buildApp()` geïnjecteerd. Zo blijft de verificatieflow testbaar zonder een
 * echte mailserver en kan een andere provider later zonder wijzigingen elders worden ingehangen.
 */

export interface MailMessage {
  to: string;
  subject: string;
  /** Platte-tekstversie (verplicht — altijd een leesbare fallback). */
  text: string;
  /** Optionele HTML-versie. */
  html?: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

/**
 * Log-transport: verstuurt niets, maar logt dat er een mail "verstuurd" zou zijn (zonder de
 * token-URL volledig te lekken in productie — maar dit transport draait alleen in dev/test).
 * Standaard wanneer er geen `SMTP_URL` is geconfigureerd, zodat de app zonder mailserver draait.
 */
export class LogMailTransport implements MailTransport {
  constructor(private readonly log: (message: MailMessage) => void = defaultLog) {}

  send(message: MailMessage): Promise<void> {
    this.log(message);
    return Promise.resolve();
  }
}

function defaultLog(message: MailMessage): void {
  // Bewust via console: het log-transport is een dev/test-hulpmiddel. In dev wil je de
  // verificatielink kunnen zien; in productie draait dit transport niet (SMTP verplicht).
  console.info(`[mail] → ${message.to}: ${message.subject}\n${message.text}`);
}

/**
 * Geheugen-transport voor tests: bewaart verstuurde mails zodat een test de verificatielink kan
 * uitlezen zonder een echte mailserver. Niet voor productie.
 */
export class MemoryMailTransport implements MailTransport {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** De laatst verstuurde mail (of `undefined` als er nog niets is verstuurd). */
  last(): MailMessage | undefined {
    return this.sent.at(-1);
  }
}

/**
 * SMTP-transport (productie) op basis van nodemailer. De verbinding komt uit `SMTP_URL`; het
 * afzenderadres uit `MAIL_FROM`. Faalt de verzending, dan gooit `send()` — de aanroeper beslist
 * of dat de flow moet blokkeren (bij registratie niet: de mail is een aanvulling, geen harde eis).
 */
export class SmtpMailTransport implements MailTransport {
  private readonly transporter: nodemailer.Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

/**
 * Kiest het mail-transport op basis van de env: een echte SMTP-verbinding als `SMTP_URL` is
 * gezet, anders het log-transport (dev). De prod-guard in `env.ts` dwingt af dat `SMTP_URL` in
 * productie niet leeg is, zodat je daar nooit per ongeluk op het log-transport draait.
 */
export function createMailTransport(env: Env): MailTransport {
  if (env.SMTP_URL) {
    return new SmtpMailTransport(env.SMTP_URL, env.MAIL_FROM);
  }
  return new LogMailTransport();
}
