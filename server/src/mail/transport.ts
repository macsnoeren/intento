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
 * SMTP-transport (productie) op basis van nodemailer. De verbinding komt uit `SMTP_URL` of uit de
 * losse `SMTP_*`-variabelen (zie `smtpSettingsFromEnv`); het afzenderadres uit `MAIL_FROM`. Faalt de verzending, dan gooit `send()` — de aanroeper beslist
 * of dat de flow moet blokkeren (bij registratie niet: de mail is een aanvulling, geen harde eis).
 *
 * `requireTLS` staat hier hard aan (security by default): bij een `smtp://`-URL (STARTTLS-poort,
 * meestal 587) dwingt nodemailer dan een STARTTLS-upgrade af en breekt de verbinding af als die
 * mislukt, in plaats van de inloggegevens alsnog in platte tekst te versturen. Bij een
 * `smtps://`-URL (implicit TLS, poort 465) is de verbinding al versleuteld en is de vlag een no-op.
 * De env bepaalt dus wélke TLS-variant je gebruikt, nooit óf er TLS is.
 */
export class SmtpMailTransport implements MailTransport {
  private readonly transporter: nodemailer.Transporter;

  /**
   * `connection` is óf een SMTP-URL (`SMTP_URL`) óf de losse instellingen (`SMTP_HOST` en de rest,
   * via `smtpSettingsFromEnv`). Beide komen op dezelfde nodemailer-transporter uit; het verschil
   * zit alleen in hoe je ze opschrijft.
   */
  constructor(
    connection: string | SmtpSettings,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport(
      typeof connection === 'string' ? withRequiredTls(connection) : connection,
    );
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
 * Zet `requireTLS=true` in de SMTP-URL, tenzij de env die zelf al expliciet meegeeft.
 *
 * Bewust via een query-parameter en niet via een optie-object: geeft je `createTransport()` een
 * object met een `url`-property, dan gebruikt nodemailer *alleen* de URL en gooit het de rest van
 * het object weg (`lib/nodemailer.js`) — `{ url, requireTLS: true }` ziet er dus goed uit maar doet
 * niets. Query-parameters lopen wél door de URL-parser heen. Een round-trip door `URL` laat
 * gebruikersnaam en wachtwoord ongemoeid, ook als daar een `@` in zit.
 */
export function withRequiredTls(smtpUrl: string): string {
  const url = new URL(smtpUrl);
  if (!url.searchParams.has('requireTLS')) {
    url.searchParams.set('requireTLS', 'true');
  }
  return url.toString();
}

/** De verbindingsinstellingen die uit de losse `SMTP_*`-variabelen komen. */
export interface SmtpSettings {
  host: string;
  port: number;
  /** true = implicit TLS (poort 465): versleuteld vanaf de eerste byte. */
  secure: boolean;
  /** true = STARTTLS is verplicht; mislukt de upgrade, dan faalt de verbinding. */
  requireTLS: boolean;
  /** true = niet eens proberen te upgraden. Alleen bij `SMTP_SECURE=none`, zonder inloggegevens. */
  ignoreTLS: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}

/** De standaardpoort die bij een TLS-variant hoort, als `SMTP_PORT` leeg blijft. */
const DEFAULT_PORTS = { ssl: 465, tls: 587, none: 25 } as const;

/**
 * Zet de losse `SMTP_*`-variabelen om in nodemailer-opties.
 *
 * De vertaling die er echt toe doet is die van `SMTP_SECURE`, want nodemailer heeft er twee
 * vlaggen voor waar een hostingpakket één keuze noemt:
 *
 *   ssl   `secure: true`  — implicit TLS, poort 465. Versleuteld vanaf de eerste byte.
 *   tls   `secure: false` + `requireTLS: true` — STARTTLS, poort 587. De verbinding begint in
 *         platte tekst en wordt ge-upgrade; `requireTLS` maakt die upgrade verplicht, zodat een
 *         server die hem weigert een fout oplevert in plaats van een wachtwoord op de lijn.
 *   none  `secure: false` + `ignoreTLS: true` — geen TLS. `env.ts` staat dit alleen toe zónder
 *         inloggegevens, dus er valt hier niets te lekken.
 *
 * Let op wat `secure: false` NIET betekent: het is geen "onversleuteld", het is "niet vanaf de
 * eerste byte". Dat is de verwarring waar deze functie voor bestaat.
 */
export function smtpSettingsFromEnv(
  env: Pick<
    Env,
    | 'SMTP_HOST'
    | 'SMTP_PORT'
    | 'SMTP_SECURE'
    | 'SMTP_USER'
    | 'SMTP_PASSWORD'
    | 'SMTP_TIMEOUT_SECONDS'
  >,
): SmtpSettings {
  const timeout = env.SMTP_TIMEOUT_SECONDS * 1000;
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? DEFAULT_PORTS[env.SMTP_SECURE],
    secure: env.SMTP_SECURE === 'ssl',
    requireTLS: env.SMTP_SECURE === 'tls',
    ignoreTLS: env.SMTP_SECURE === 'none',
    // Zonder gebruiker géén auth-object: nodemailer probeert dan niet in te loggen, wat de
    // bedoeling is bij een relay die op IP-adres vertrouwt.
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
    // Eén getal uit de env, drie time-outs hier: verbinden, wachten op de begroeting en de stilte
    // daarna. Laat je ze weg, dan hangt nodemailer op de socket-time-out van het OS — minuten,
    // waar de aanroeper seconden verwacht.
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  };
}

/**
 * Kiest het mail-transport op basis van de env: een echte SMTP-verbinding als `SMTP_URL` óf
 * `SMTP_HOST` is gezet, anders het log-transport (dev). De prod-guard in `env.ts` dwingt af dat er
 * in productie één van beide staat, zodat je daar nooit per ongeluk op het log-transport draait —
 * en dat ze niet allebei staan, zodat de volgorde hieronder nooit een keuze hoeft te maken.
 */
export function createMailTransport(env: Env): MailTransport {
  if (env.SMTP_URL) {
    return new SmtpMailTransport(env.SMTP_URL, env.MAIL_FROM);
  }
  if (env.SMTP_HOST) {
    return new SmtpMailTransport(smtpSettingsFromEnv(env), env.MAIL_FROM);
  }
  return new LogMailTransport();
}
