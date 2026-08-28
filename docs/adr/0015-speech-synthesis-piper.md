# 0015. Spraakuitvoer: een lokale Piper-dienst, met de apparaatstem als vangnet

- **Status:** geaccepteerd
- **Datum:** 2026-08-28

## Context

De tablet toonde tot nu toe alleen tekst. Voor een groot deel van de doelgroep is lezen juist het
probleem: wie de vraag of de voorgestelde zin niet kan lezen, kan hem ook niet beoordelen. Een gebruiker
die zijn boodschap hardop kan laten zeggen, communiceert bovendien mét de mensen om hem heen in plaats
van via een scherm — dat is de kern van AAC.

Randvoorwaarden uit het ontwerp:

1. **De zin van de gebruiker is het meest persoonlijke wat de app kent** (DESIGN §9.4). "Ik heb pijn in
   mijn buik" mag niet bij een derde partij belanden om er geluid van te maken.
2. **De client praat nooit rechtstreeks met een externe dienst** (DESIGN §8.1) — bij spraak net zo goed
   als bij de AI, want wie iets mag laten uitspreken is een autorisatievraag.
3. **Voorspelbaar op elke tablet** (DESIGN §5.1). Een gedeeld apparaat mag niet per toestel anders klinken.
4. **Geen kosten per zin.** Intento draait in de zorg, niet op een marketingbudget.
5. **Verstaanbaar.** Een onverstaanbare stem is voor deze doelgroep erger dan geen stem.

Gemeten op 2026-08-28 (Intel i7-6700, 8 threads, geen GPU, `piper-tts` 1.7.0): Piper synthetiseert een
korte Nederlandse zin in 64–153 ms, real-time factor 0,05, model laden ± 1 s eenmalig.

## Beslissing

**We synthetiseren lokaal met Piper, in een losstaande dienst (`speech-service/`) achter een
HTTP-grens, met een cache in de backend en de stem van het apparaat als vangnet en als expliciete
keuze.** Concreet:

- **`speech-service/`** — een dienst van ± 300 regels op de stdlib, met `piper-tts` als enige
  dependency. Twee endpoints: `GET /health` en `POST /synthesize` (Bearer-token). Hij kent geen
  gebruikers, sessies of database: hij krijgt tekst en geeft geluid.
- **`server/src/speech/`** — een provider-agnostische `SpeechSynthesizer` (zoals de AI-orchestrator,
  ADR-0008) met een HTTP-implementatie en een "niet geconfigureerd"-variant die 503 geeft. Ervoor een
  **geheugencache** op `hash(tekst + stem)`.
- **Twee routes** — `POST /device/speech` (apparaatsessie; de stem komt uit het profiel van díé
  gebruiker, niet uit het verzoek) en `POST /admin/users/:id/speech-preview` (begeleider beluistert een
  stem vóór hij hem kiest, tenant-gefilterd).
- **De stem staat in het communicatieprofiel** (`speechEnabled`, `speechVoice`, `speechHints`), naast
  `showText` en `iconsPerScreen`, en verhuist mee bij profielexport (T8.1).
- **De apparaatstem (`device`)** is een volwaardige keuze: dan spreekt de tablet zelf via
  `speechSynthesis`. Diezelfde weg is het vangnet als de spraakdienst onbereikbaar is — beter een
  minder mooie stem dan stilte.

## Gevolgen

- **Makkelijker:** geen kosten per zin, geen API-sleutel, geen gegevens naar derden; overal dezelfde
  stem; herhaalde zinnen (schermteksten, AAC-labels) zijn na één keer gratis; de dienst is klein genoeg
  om te vertrouwen en apart te deployen, net als `ai-worker/`.
- **Moeilijker/afweging:** één infrastructuurcomponent extra (± 63 MB per stem op schijf), en Piper
  staat onder **GPL-3.0** (het bevat espeak-ng). Daarom draait het als **los proces achter HTTP** en
  niet als bibliotheek in de backend: aanroepen is geen afgeleid werk, ook niet commercieel. Wie
  Intento ooit als kant-en-klaar apparaat uitlevert, moet Pipers broncode meeleveren. De gebruikte
  stemmen zijn CC0; `nl_NL-mls` (CC-BY 4.0) staat niet in de catalogus.
- **Openstaand:** er is **geen goede Nederlandse vrouwenstem**. Piper heeft er formeel tien voor het
  Nederlands, maar `nl_NL-mls-medium` (52 sprekers, waaronder alle Nederlandse vrouwenstemmen) en de
  twee `mls_*-low`-modellen komen uit ruwe luisterboekdata; bij het beluisteren sprak geen van die
  stemmen een zin verstaanbaar uit. Ze zijn daarom uit de catalogus gelaten. Nathalie (Vlaams) is de
  enige vrouwenstem die de server kan leveren; voor een Nederlandse vrouwenstem is de apparaatstem
  voorlopig de weg. Zie T18.5 in `TASKS.md`.
- **Later heroverwegen:** een zwaarder model met Nederlandse vrouwenstemmen (bv. Chatterbox
  Multilingual, MIT, maar 6 GB+ VRAM) of een eigen fijn-afgestemde Piper-stem, zodra er hardware of een
  dataset voor is.

## Alternatieven overwogen

- **Cloud-TTS (Google, Azure, ElevenLabs)** — de mooiste stemmen, maar elke zin van de gebruiker gaat
  dan naar een derde partij, met een gratis laag die eindigt bij een creditcard. Strijdig met DESIGN
  §9.4. Afgewezen.
- **Alleen `speechSynthesis` in de browser** — nul infrastructuur en gratis, maar de stem hangt volledig
  van het apparaat af: goed op iPad en Android, blikkerig op Windows, robotachtig op Linux. Als énige
  weg te wisselvallig voor een gedeelde tablet; behouden als keuze én als vangnet.
- **Kokoro (Apache-2.0, zeer natuurlijk)** — ondersteunt geen Nederlands. Afgewezen.
- **Coqui XTTS-v2** — kan Nederlands en klonen, maar de licentie staat commercieel gebruik niet toe.
  Afgewezen.
- **Piper als bibliotheek in de backend (Node-binding of subprocess)** — trekt de GPL-3.0 tegen de
  eigen code aan en zet zware inferentie op de webserver. Afgewezen ten gunste van de HTTP-grens.
- **Audio opslaan op schijf als cache** — sneller na herstart, maar dan staat de uitgesproken zin van
  een gebruiker als bestand op de server. De geheugencache verdwijnt bij herstart; dat is precies de
  bedoeling (DESIGN §6.4).
