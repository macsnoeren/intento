# 0006. Externe diensten via een server-side proxy (OpenSymbols)

- **Status:** geaccepteerd
- **Datum:** 2026-07-09

## Context

T3.3 voegt de eerste integratie met een **externe dienst** toe: bij het beheren van een AAC-symbool
kan een beheerder een bestaand, vrij te gebruiken pictogram bij [OpenSymbols](https://www.opensymbols.org/)
opzoeken en koppelen. Dit stelt drie vragen die verder reiken dan deze ene dienst:

1. **Waar loopt het verkeer?** Een kernregel van Intento is dat de client nooit rechtstreeks met
   externe diensten (AI, storage, …) praat; alles loopt via de backend die toegang, toestemming en
   context controleert (DESIGN §8.1, §9.1).
2. **Hoe blijft dit testbaar** zonder in elke testrun het echte netwerk op te gaan?
3. **Hoe voorkomen we misbruik** (XSS via onveilige URL's, SSRF naar interne services, oversized
   downloads) als we op basis van externe input een bestand ophalen?

## Beslissing

**We benaderen externe diensten uitsluitend via een server-side proxy achter een provider-agnostische,
injecteerbare client-interface.** Concreet voor OpenSymbols (`server/src/aac/opensymbols.ts`):

- Een `OpenSymbolsClient`-interface (`isConfigured`, `search`, `fetchImage`) met een echte,
  op `fetch` gebaseerde implementatie (token-uitwisseling met `OPENSYMBOLS_SECRET`, time-out,
  token-refresh bij `401`). De client wordt via `buildApp({ openSymbols })` geïnjecteerd, zodat
  tests een deterministische mock meegeven — net als de Prisma-client. Dit is dezelfde vorm die de
  latere AI-orchestrator (T5.1) krijgt.
- Twee ADMIN-endpoints: `GET /admin/aac/opensymbols/search` (proxy) en
  `POST /admin/aac/symbols/:id/opensymbols` (koppelen). De client krijgt nooit de externe URL's van
  credentials te zien; de bytes worden **server-side** opgehaald en lokaal opgeslagen (dezelfde
  `AacSymbol.imageData`-opslag als een upload, T3.2).
- **Veiligheid op de grens:** downloadbare bron-URL's moeten `https` zijn (zod `httpsUrlSchema`) én
  passeren `assertSafeImageUrl` (weigert `localhost`, `*.local`/`*.internal` en private/loopback/
  link-local IP-bereiken — SSRF). Het opgehaalde content-type valt onder de bestaande mime-allowlist
  (PNG/JPEG/WebP, geen SVG) en de grootte onder `AAC_IMAGE_MAX_BYTES`; redirects worden geweigerd.
- **Bron/licentie reist mee:** de gekozen afbeelding krijgt `imageLicense`/`imageAuthor`/… op het
  `AacSymbol`, en een `attribution`-object in de publieke API, zodat CC-attributie behouden blijft.
- Ontbrekende configuratie → `503`; externe fouten worden niet gelekt → nette `502`.

## Gevolgen

- **Makkelijker:** één patroon voor alle externe diensten (nu OpenSymbols, later de LLM-provider en
  AI-workers); volledig testbaar zonder netwerk; de veiligheidscontroles (https/SSRF/allowlist/limiet)
  zitten op één plek en zijn herbruikbaar.
- **Moeilijker/afweging:** we downloaden en **kopiëren** afbeeldingen lokaal (opslag + attributieplicht)
  i.p.v. hotlinken — bewust, want hotlinken naar een derde CDN lekt client-IP's en breekt bij
  offline gebruik. Alleen **raster** (geen SVG) wordt geaccepteerd, consistent met de uploadregel;
  dat sluit een deel van de OpenSymbols-catalogus (SVG) uit als koppelbare afbeelding.
- **Later heroverwegen:** veilige SVG-ondersteuning (sanitizen) als de raster-beperking te knellend
  blijkt; een gedeelde asset-store i.p.v. bytes-in-de-db bij grote volumes.

## Alternatieven overwogen

- **Client praat rechtstreeks met OpenSymbols** — schendt DESIGN §8.1 (geen externe toegang vanaf de
  client), lekt credentials/IP's en maakt server-side validatie onmogelijk. Afgewezen.
- **Afbeelding hotlinken (alleen URL opslaan, niet downloaden)** — geen controle over content-type/
  grootte, breekt bij bronwijziging/offline, en de client zou alsnog een derde host aanspreken.
  Afgewezen.
- **SVG toestaan** — grotere catalogusdekking, maar heropent het XSS-risico dat T3.2 juist dichtte;
  vergt een sanitizer. Buiten scope gehouden.
