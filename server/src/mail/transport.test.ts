import net from 'node:net';
import type { AddressInfo } from 'node:net';
import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it } from 'vitest';
import { SmtpMailTransport, withRequiredTls } from './transport.js';

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
