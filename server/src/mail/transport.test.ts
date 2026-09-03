import net from 'node:net';
import type { AddressInfo } from 'node:net';
import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SmtpMailTransport,
  createMailTransport,
  smtpSettingsFromEnv,
  withRequiredTls,
} from './transport.js';
import { loadEnv } from '../env.js';

/**
 * Tests voor het SMTP-transport (T1.4). De kern is één security-eigenschap: het transport mag
 * inloggegevens nooit over een onversleutelde verbinding versturen. Bij een STARTTLS-poort
 * (`smtp://`, meestal 587) moet de upgrade naar TLS dus verplicht zijn — mislukt die, dan hoort de
 * verzending te falen in plaats van door te gaan in platte tekst.
 */

/** Regels die de neptestserver van de client ontving (om te controleren wat er is gelekt). */
interface FakeSmtp {
  port: number;
  received: string[];
  close(): Promise<void>;
}

/**
 * Minimale SMTP-server die géén STARTTLS aanbiedt en de upgrade weigert — het scenario van een
 * verkeerd geconfigureerde of gekaapte mailserver. Legt elke ontvangen commandoregel vast.
 */
async function startFakeSmtpWithoutStartTls(): Promise<FakeSmtp> {
  const received: string[] = [];

  const server = net.createServer((socket) => {
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk) => {
      for (const line of chunk.toString('utf8').split('\r\n').filter(Boolean)) {
        received.push(line);
        const command = line.toUpperCase();
        if (command.startsWith('EHLO') || command.startsWith('HELO')) {
          // Capabilities zonder STARTTLS, mét AUTH: een client die TLS niet afdwingt zou hier
          // vrolijk in platte tekst inloggen.
          socket.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 10240000\r\n');
        } else if (command.startsWith('STARTTLS')) {
          socket.write('454 TLS not available\r\n');
        } else if (command.startsWith('AUTH')) {
          socket.write('235 2.7.0 Authentication successful\r\n');
        } else if (command.startsWith('QUIT')) {
          socket.write('221 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
    socket.on('error', () => {
      // Client kapt de verbinding af bij een mislukte TLS-upgrade; dat is hier het verwachte pad.
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    port: (server.address() as AddressInfo).port,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe('withRequiredTls', () => {
  it('zet requireTLS in de URL zodat nodemailer de STARTTLS-upgrade afdwingt', () => {
    const options = nodemailer.createTransport(
      withRequiredTls('smtp://user:pw@smtp.intento.test:587'),
    ).options as { host?: string; port?: number; secure?: boolean; requireTLS?: boolean };

    expect(options.host).toBe('smtp.intento.test');
    expect(options.port).toBe(587);
    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBe(true);
  });

  it('laat implicit TLS (smtps, 465) intact — daar is de vlag een no-op', () => {
    const options = nodemailer.createTransport(
      withRequiredTls('smtps://user:pw@smtp.intento.test:465'),
    ).options as { port?: number; secure?: boolean; requireTLS?: boolean };

    expect(options.port).toBe(465);
    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBe(true);
  });

  it('houdt gebruikersnaam en wachtwoord ongemoeid, ook met een @ en dubbele punt erin', () => {
    const options = nodemailer.createTransport(
      withRequiredTls('smtp://no-reply@intento.test:pw:met:dubbelepunt@smtp.intento.test:587'),
    ).options as { auth?: { user?: string; pass?: string } };

    expect(options.auth?.user).toBe('no-reply@intento.test');
    expect(options.auth?.pass).toBe('pw:met:dubbelepunt');
  });

  it('respecteert een expliciete keuze uit de env', () => {
    const options = nodemailer.createTransport(
      withRequiredTls('smtp://user:pw@smtp.intento.test:587?requireTLS=false'),
    ).options as { requireTLS?: boolean };

    expect(options.requireTLS).toBe(false);
  });
});

/**
 * De losse `SMTP_*`-variabelen (SMTP_HOST en de rest), voor wie zijn hostinggegevens één op één wil
 * overtypen in plaats van ze tot een URL te breien. Wat hier vastligt is de vertaling van één
 * keuze (`tls` | `ssl` | `none`) naar de twee nodemailer-vlaggen die er samen over gaan — de plek
 * waar een vergissing stilletjes TLS uitzet.
 */
describe('smtpSettingsFromEnv', () => {
  const base = {
    SMTP_HOST: 'mail.mijndomein.nl',
    SMTP_USER: 'noreply@jmnl.nl',
    SMTP_PASSWORD: 'wachtwoord',
    SMTP_TIMEOUT_SECONDS: '15',
  };
  const settings = (overrides: Record<string, string> = {}) =>
    smtpSettingsFromEnv(
      loadEnv({
        NODE_ENV: 'test',
        SIGNING_SECRET: 'test-signing-secret',
        ENCRYPTION_KEY: 'test-encryption-key',
        ...base,
        ...overrides,
      }),
    );

  it("'tls' wordt STARTTLS op 587, met een verplichte upgrade", () => {
    const s = settings({ SMTP_SECURE: 'tls' });
    expect(s).toMatchObject({ host: 'mail.mijndomein.nl', port: 587 });
    // secure:false is hier "niet vanaf de eerste byte", niet "onversleuteld" — requireTLS is wat
    // de upgrade afdwingt, en zonder die vlag zou dit een wachtwoord in platte tekst zijn.
    expect(s.secure).toBe(false);
    expect(s.requireTLS).toBe(true);
    expect(s.ignoreTLS).toBe(false);
  });

  it("'ssl' wordt implicit TLS op 465", () => {
    const s = settings({ SMTP_SECURE: 'ssl' });
    expect(s.port).toBe(465);
    expect(s.secure).toBe(true);
    expect(s.ignoreTLS).toBe(false);
  });

  it("'none' mag alleen zonder inloggegevens, en levert dan een verbinding zonder auth", () => {
    const s = settings({ SMTP_SECURE: 'none', SMTP_USER: '', SMTP_PASSWORD: '' });
    expect(s.port).toBe(25);
    expect(s.ignoreTLS).toBe(true);
    expect(s.auth).toBeUndefined();
  });

  it('STARTTLS is de standaard als SMTP_SECURE niet is gezet', () => {
    expect(settings()).toMatchObject({ port: 587, requireTLS: true });
  });

  it('een expliciete SMTP_PORT wint van de standaard bij de TLS-variant', () => {
    expect(settings({ SMTP_SECURE: 'ssl', SMTP_PORT: '2465' }).port).toBe(2465);
  });

  it('neemt het wachtwoord letterlijk over, ook met tekens die een URL zouden breken', () => {
    const s = settings({ SMTP_PASSWORD: 'p@ss:w/ord?#' });
    expect(s.auth).toEqual({ user: 'noreply@jmnl.nl', pass: 'p@ss:w/ord?#' });
  });

  it('zet de time-out om naar milliseconden, op alle drie de fases', () => {
    expect(settings({ SMTP_TIMEOUT_SECONDS: '20' })).toMatchObject({
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 20_000,
    });
  });
});

describe('createMailTransport', () => {
  const env = (overrides: Record<string, string>) =>
    loadEnv({
      NODE_ENV: 'test',
      SIGNING_SECRET: 'test-signing-secret',
      ENCRYPTION_KEY: 'test-encryption-key',
      ...overrides,
    });

  it('kiest het SMTP-transport op de losse velden, niet alleen op een URL', () => {
    expect(createMailTransport(env({ SMTP_HOST: 'mail.mijndomein.nl' }))).toBeInstanceOf(
      SmtpMailTransport,
    );
  });

  it('valt zonder mailserver terug op het log-transport', () => {
    expect(createMailTransport(env({}))).not.toBeInstanceOf(SmtpMailTransport);
  });
});

describe('SmtpMailTransport', () => {
  const servers: FakeSmtp[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('weigert te versturen als de server geen STARTTLS doet, zonder inloggegevens te lekken', async () => {
    const server = await startFakeSmtpWithoutStartTls();
    servers.push(server);

    const transport = new SmtpMailTransport(
      `smtp://user:geheim@127.0.0.1:${server.port}`,
      'Intento <no-reply@intento.test>',
    );

    await expect(
      transport.send({ to: 'iemand@intento.test', subject: 'Verifieer', text: 'link' }),
    ).rejects.toThrow();

    expect(server.received).toContainEqual(expect.stringMatching(/^STARTTLS/i));
    expect(server.received).not.toContainEqual(expect.stringMatching(/^AUTH/i));
    expect(server.received.join('\n')).not.toContain('geheim');
  });

  it('weigert net zo goed via de losse velden: SMTP_SECURE=tls lekt niets zonder STARTTLS', async () => {
    const server = await startFakeSmtpWithoutStartTls();
    servers.push(server);

    // Dezelfde eigenschap als hierboven, maar langs de andere schrijfwijze. Zonder deze test kan
    // de losse route stilletijk zonder requireTLS eindigen en is de garantie de helft waard.
    const transport = new SmtpMailTransport(
      smtpSettingsFromEnv(
        loadEnv({
          NODE_ENV: 'test',
          SIGNING_SECRET: 'test-signing-secret',
          ENCRYPTION_KEY: 'test-encryption-key',
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: String(server.port),
          SMTP_SECURE: 'tls',
          SMTP_USER: 'user',
          SMTP_PASSWORD: 'geheim',
        }),
      ),
      'Intento <no-reply@intento.test>',
    );

    await expect(
      transport.send({ to: 'iemand@intento.test', subject: 'Verifieer', text: 'link' }),
    ).rejects.toThrow();

    expect(server.received).toContainEqual(expect.stringMatching(/^STARTTLS/i));
    expect(server.received).not.toContainEqual(expect.stringMatching(/^AUTH/i));
    expect(server.received.join('\n')).not.toContain('geheim');
  });

  it('controle: zonder requireTLS zou dezelfde server de inloggegevens in platte tekst krijgen', async () => {
    const server = await startFakeSmtpWithoutStartTls();
    servers.push(server);

    // Bewust rechtstreeks nodemailer (niet SmtpMailTransport): dit is het gedrag dat we níét
    // willen. Het bewijst tegelijk dat de assertie hierboven niet loos is — deze server ontvangt
    // AUTH wel degelijk als de client TLS niet afdwingt.
    const unsafe = nodemailer.createTransport(`smtp://user:geheim@127.0.0.1:${server.port}`);
    await unsafe.sendMail({
      from: 'Intento <no-reply@intento.test>',
      to: 'iemand@intento.test',
      subject: 'Verifieer',
      text: 'link',
    });
    unsafe.close();

    expect(server.received).toContainEqual(expect.stringMatching(/^AUTH/i));
  });
});
