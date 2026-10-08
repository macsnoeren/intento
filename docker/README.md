# Intento in Docker

Alles wat nodig is om Intento in containers te draaien staat in deze map. Op de doelmachine hoef je
geen Node, Python of Piper te installeren, alleen Docker.

## Snel starten

Vereist: **Docker Engine** met de **Compose-plugin** (`docker compose`, v2.20 of nieuwer).

```bash
docker/start.sh
```

Na een paar minuten (de eerste keer) staat er:

| Wat | Adres |
|---|---|
| Web-app (beheer, `/tablet`, `/operator`) | <http://localhost:8080> |
| API (gezondheidscheck) | <http://localhost:3000/health> |

Stoppen:

```bash
docker/stop.sh            # containers weg, gegevens blijven bewaard
```

Beide scripts werken vanuit elke map. `npm run docker:up` en `npm run docker:down` in de repo-root doen
hetzelfde.

## Wat `start.sh` doet

1. **Controleert Docker**: geïnstalleerd, de Compose-plugin aanwezig, de daemon bereikbaar. Ook kijkt
   het of de poorten vrij zijn (zie "Problemen oplossen").
2. **Maakt de configuratie aan** als die er nog niet is: `docker/.env.docker`, gekopieerd uit
   `.env.docker.example`. De vijf geheimen (`SIGNING_SECRET`, `ENCRYPTION_KEY`, `ASSET_URL_SECRET`,
   `SPEECH_SERVICE_TOKEN`, `AGENT_SERVICE_TOKEN`) vult het met verse willekeurige waarden. Het bestand
   krijgt rechten `600` en staat in `.gitignore`.
3. **Bouwt de images** (alleen wat gewijzigd is) en **start de stack**.
4. **Wacht tot alles gezond is** en toont de adressen. Lukt dat niet, dan zie je de status en de
   laatste logregels van elke dienst.

| Optie | Effect |
|---|---|
| `--no-build` | Niet bouwen, starten met de images die er al zijn (sneller na een herstart van de machine) |
| `--logs` | Na het starten de logs volgen; Ctrl+C stopt het meekijken, niet de stack |

**Vangnet voor je gegevens.** Mist `docker/.env.docker` terwijl er al een database-volume bestaat, dan
maakt `start.sh` géén nieuwe geheimen aan maar stopt hij. Met een nieuwe `ENCRYPTION_KEY` zouden alle
versleutelde gegevens in die database onleesbaar worden. Zet dan je oude `.env.docker` terug. Staat er
nog een `.env.docker` in de repo-root (de plek van vóór deze map), dan verplaatst `start.sh` die vanzelf
hierheen.

## De eerste keer

Bij de eerste start gebeurt er meer dan bij latere starts:

- **Stemmen downloaden.** De eenmalige dienst `speech-voices` haalt de stemmodellen van Piper op naar een
  volume (± 63 MB per stem). Bij latere starts ziet hij dat ze er al staan.
- **Vocabulary vullen.** De eenmalige dienst `vocabulary-import` migreert de database, downloadt de
  afbeeldingen van Mulberry en de zorgsymbolen en zet de Nederlandse startset neer. Bij latere starts
  maakt hij niets dubbel.

Daarna maak je een account aan: open <http://localhost:8080>, kies **Nieuwe omgeving aanmelden** en
maak een organisatie aan. Zonder mailserver (de standaard) gaat er geen e-mail de deur uit, maar staat de
verificatielink in de log van de server:

```bash
docker compose -f docker/compose.yaml --env-file docker/.env.docker logs server | grep -A3 '\[mail\]'
```

## Wat er draait

| Dienst | Image (Dockerfile) | Poort naar buiten | Rol |
|---|---|---|---|
| `server` | `server.Dockerfile` (Node 24, Debian) | `3000` | De backend. Migreert bij elke start (`prisma migrate deploy`) en draait als niet-root. |
| `web` | `web.Dockerfile` (nginx, Alpine) | `8080` | De web-app als statische bestanden, met SPA-fallback zodat een refresh op `/tablet` werkt. |
| `agents` | `agents.Dockerfile` (Python) | geen | De agentdienst (orchestrator + agents). Alleen de backend bereikt hem, met `AGENT_SERVICE_TOKEN`. |
| `speech` | `speech.Dockerfile` (Python + Piper) | geen | Spraakuitvoer. Alleen de backend bereikt hem, met `SPEECH_SERVICE_TOKEN`. |
| `speech-voices` | `speech.Dockerfile` | — | Eenmalig: stemmodellen naar het volume. |
| `vocabulary-import` | `server.Dockerfile` | — | Eenmalig: migreren, afbeeldingen ophalen, Vocabulary seeden. De server wacht hierop. |

De agentdienst en de spraakdienst publiceren bewust geen poort: de client praat nooit rechtstreeks met
de AI (tablet → backend → agentdienst → Ollama).

### Gegevens (volumes)

| Volume | Inhoud |
|---|---|
| `intento_intento-db` | De SQLite-database (`/data/intento.db`): accounts, gesprekken, contacten, versleuteld waar nodig. |
| `intento_intento-storage` | De afbeeldingen van de Vocabulary. |
| `intento_intento-voices` | De stemmodellen van Piper. |

`docker/stop.sh` laat de volumes staan. **Alles wissen** en echt opnieuw beginnen:

```bash
docker/stop.sh --wipe     # vraagt om bevestiging: typ 'wissen'
```

Dat is niet terug te draaien. Daarna kun je ook `docker/.env.docker` weggooien; de volgende
`start.sh` maakt dan nieuwe geheimen aan.

Een **back-up** van de database maak je met de server even stil, zodat er niet halverwege een
schrijfactie gekopieerd wordt:

```bash
dc stop server            # `dc`: zie "Handige commando's" hieronder
docker run --rm -v intento_intento-db:/data -v "$PWD":/backup alpine \
  cp /data/intento.db /backup/intento-$(date +%F).db
dc start server
```

Bewaar de back-up samen met `docker/.env.docker`. Zonder de `ENCRYPTION_KEY` daaruit is de versleutelde
inhoud niet te lezen.

## Configuratie

Alle instellingen staan in `docker/.env.docker`. Elke variabele is uitgelegd in
[`.env.docker.example`](.env.docker.example). Na een wijziging: `docker/start.sh` opnieuw. Compose
herstart alleen de diensten waarvan de configuratie veranderde.

De instellingen die je het vaakst aanpast:

| Variabele | Wanneer |
|---|---|
| `WEB_PORT`, `SERVER_PORT` | Een andere poort op de host. Pas dan ook `VITE_API_URL`, `CORS_ORIGIN` en `APP_BASE_URL` aan. |
| `VITE_API_URL` | De API-URL **zoals de browser hem ziet**. Vite bakt hem in de bundel, dus `start.sh` bouwt de web-app dan opnieuw. |
| `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_API_KEY` | Het taalmodel voor de agents. Leeg betekent dat alleen de regelgebaseerde agents draaien. Ollama Cloud: `https://ollama.com` met een API-key. |
| `SMTP_*`, `MAIL_FROM` | Echte e-mail (verificatie, berichten aan contacten). Leeg betekent dat mails alleen in de serverlog verschijnen. |
| `SPEECH_VOICES` | Welke stemmen `speech-voices` ophaalt. |
| `NODE_ENV` | `development` voor een lokale http-opstelling. Zie hieronder voor `production`. |

**Productie.** Met `NODE_ENV=production` eist de backend https voor de publieke URL's,
`COOKIE_SECURE=true` en een echte mailserver, en weigert hij anders te starten. Zet daarvoor een reverse
proxy met TLS vóór de poorten `8080` en `3000`. Die zit (nog) niet in deze opzet; zie
[ADR-0016](../docs/adr/0016-containers-en-compose.md).

## Handige commando's

`start.sh` en `stop.sh` dekken het dagelijkse gebruik. Voor de rest gebruik je `docker compose` met de
hand, altijd met beide bestanden erbij. Zonder `--env-file` mist Compose de verplichte tokens.

```bash
alias dc='docker compose -f docker/compose.yaml --env-file docker/.env.docker'   # vanuit de repo-root

dc ps                                  # status van elke dienst
dc logs -f server                      # logs van één dienst volgen
dc restart server                      # één dienst herstarten
dc run --rm --build vocabulary-import  # Vocabulary opnieuw importeren (na een nieuwe vertaling)
dc exec server sh                      # shell in de backendcontainer
```

## Bestanden in deze map

| Bestand | Doel |
|---|---|
| `start.sh`, `stop.sh` | Starten en stoppen (zie hierboven). |
| `compose.yaml` | De stack: diensten, volumes, poorten en wie op wie wacht. |
| `.env.docker.example` | Sjabloon voor `.env.docker`, met uitleg per variabele. In git. |
| `.env.docker` | Jouw configuratie met geheimen. **Niet** in git. |
| `server.Dockerfile` | Backend-image. Build-context is de repo-root (npm-workspaces met `shared/`). |
| `server-entrypoint.sh` | Entrypoint van de backend: eerst migreren, dan de server of het meegegeven commando. |
| `web.Dockerfile`, `nginx.conf` | Web-app-image en de nginx-configuratie (SPA-fallback, cachebeleid). |
| `agents.Dockerfile` | Agentdienst-image. Build-context is `agent-service/`. |
| `speech.Dockerfile` | Spraakdienst-image. Build-context is `speech-service/`. |
| `*.Dockerfile.dockerignore` | Per image wat níét mee de build-context in gaat (`node_modules`, `.venv`, stemmen, geheimen). BuildKit pakt het bestand naast het Dockerfile. |

De afwegingen achter deze opzet (vier images, SQLite op een volume, een eigen poort voor de API) staan in
[ADR-0016](../docs/adr/0016-containers-en-compose.md).

## Problemen oplossen

- **"Poort 3000 is al in gebruik".** `start.sh` controleert vooraf of `SERVER_PORT` en `WEB_PORT` vrij
  zijn. Meestal draait de lokale ontwikkelserver (`npm run dev`) nog; stop die met `npm run stop`, of
  kies andere poorten in `docker/.env.docker`.
- **`start.sh` meldt dat niet alles gezond opkwam.** Kijk in de getoonde logregels welke dienst faalde.
  De meest voorkomende oorzaken: een poort die al bezet is (`WEB_PORT`/`SERVER_PORT` aanpassen), of de
  eerste download van stemmen of afbeeldingen die afbrak. `start.sh` opnieuw draaien hervat die download.
- **Inloggen lukt, maar je bent meteen weer uitgelogd.** Op http moet `COOKIE_SECURE=false` staan.
- **De web-app praat met de verkeerde API.** `VITE_API_URL` zit in de bundel gebakken. Na een wijziging
  bouwt `start.sh` opnieuw. Draaide je met `--no-build`, start dan zonder die optie.
- **Ollama op je eigen machine gebruiken** vanuit de container: `OLLAMA_URL=http://host.docker.internal:11434`.
  Voeg op Linux in `compose.yaml` bij `agents` dan `extra_hosts: ["host.docker.internal:host-gateway"]`
  toe.
