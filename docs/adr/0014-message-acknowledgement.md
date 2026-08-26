# 0014. Afhandelen van berichten: een gedeelde aftekening naast de boodschap

- **Status:** geaccepteerd
- **Datum:** 2026-08-26

## Context

Sinds T13.1 ziet een begeleider elke bevestigde boodschap van zijn gekoppelde gebruikers, nieuwste
eerst, en sinds T13.2 krijgt hij er een seintje van per e-mail. Daarmee is het gat gedicht waar de
communicatie stopte — maar er komt een nieuw gat voor terug: de lijst groeit alleen maar. Na een dag
weet niemand meer wat nieuw is en wat al is opgepakt. Een lijst die je niet kunt afwerken, lees je op
den duur niet meer; dan is een seintje krijgen net zo nutteloos als geen lijst hebben.

De krachten:

1. **De boodschap is van de gebruiker (DESIGN §2).** Wat hij bevestigde ligt vast. Alles wat een
   begeleider hier doet, is administratie *over* die boodschap — het mag hem niet wijzigen, niet
   verbergen en niet verwijderen. "Afgehandeld" is een uitspraak van de begeleider, niet van de
   gebruiker.
2. **De vraag is gemeenschappelijk.** Meerdere begeleiders kunnen aan dezelfde gebruiker gekoppeld
   zijn. Wat zij willen weten is niet "heb ík dit gezien" maar "is hier al iets mee gedaan". Twee
   begeleiders die allebei aannemen dat de ander het oppakt, is het echte risico — bij een gebruiker
   die om iets vraagt, is dat geen administratief ongemakje.
3. **Het moet terug te draaien zijn.** Een misklik op "opgepakt" mag geen boodschap in de vergetelheid
   duwen, en de collega die hem maakte hoeft er niet bij te zijn om hem te herstellen.
4. **`GeneratedMessage` is tot nu toe append-only.** Er is geen enkele plek die een bevestigde
   boodschap bijwerkt. Die eigenschap is een waarborg, geen toeval.

## Beslissing

We leggen de afhandeling vast in een **eigen tabel** `MessageAcknowledgement` (`messageId` uniek,
`accountId`, `createdAt`), naast `GeneratedMessage` en niet erin, met
`POST`/`DELETE /caregiver/messages/{id}/acknowledge` erbovenop. Daaruit volgt:

- **De boodschap wordt nooit beschreven.** `GeneratedMessage` blijft na `POST /conversation/{id}/confirm`
  onaangeroerd; kernprincipe 1 is per constructie waar in plaats van per afspraak.
- **Eén aftekening per boodschap, gedeeld door alle begeleiders.** Een tweede `POST` laat de eerste
  aftekenaar en het eerste tijdstip staan: de vraag is wie het opgepakt heeft, niet wie er als laatste
  op de knop drukte.
- **Terugdraaien is een `DELETE` van die ene rij**, toegestaan voor iedereen die de boodschap mag zien,
  en idempotent.
- **Aftekenen verbergt niets.** `GET /caregiver/messages` geeft afgetekende boodschappen gewoon terug.
  De begeleidersapp toont ze rustiger en heeft een filter "alleen nog niet opgepakt" — een hulpmiddel
  van de kijker, dat niets wist en met één klik terug is.
- **De grens is die van T13.1.** Aftekenen loopt langs exact hetzelfde `where`-fragment als de lijst
  (tenant + koppeling); daarbuiten `404` en niet `403`, zodat het antwoord niet verraadt dát er zo'n
  boodschap is.
- **Geen audit-log-actie.** Het audit-spoor is er voor *gevoelige* acties (§9.4) en bevat bewust nooit
  communicatie-inhoud; deze rij ís zijn eigen wie-wat-wanneer, en het aftekenen zegt niets over de
  boodschap zelf.

## Gevolgen

- Een begeleider kan zijn lijst afwerken en ziet aan de regel zelf wie iets oppakte en wanneer — ook
  bij ploegwissel, zonder mondelinge overdracht.
- Elke leesquery op berichten haalt er één relatie bij (`acknowledgement`); de kosten daarvan zijn
  verwaarloosbaar en de unieke index maakt de lookup exact.
- Verwijderen van een begeleideraccount laat afgetekende boodschappen weer als open zien (cascade). Dat
  is de gekozen kant van de afweging: onterecht opnieuw kijken is hinderlijk, iets onterecht als
  afgehandeld beschouwen terwijl niemand meer weet waarom, is schadelijk.
- We accepteren dat "opgepakt" niets zegt over **wat** er gedaan is. Een notitieveld zou verleiden tot
  het vastleggen van zorginhoud in een communicatiesysteem; wie dat nodig heeft, hoort het in zijn
  eigen dossier te zetten. Als de behoefte terugkomt, is dat een aparte beslissing.
- Later heroverwegen: als lijsten in de praktijk erg lang worden, is de logische volgende stap een
  server-side filter (`?status=open`) op dezelfde gegevens — geen ander model.

## Alternatieven overwogen

- **`acknowledgedAt` + `acknowledgedByAccountId` als kolommen op `GeneratedMessage`** — functioneel
  gelijkwaardig en één query minder, maar het maakt de rij van de gebruiker beschrijfbaar door een
  begeleider. Dan is "de administratie raakt de boodschap niet aan" nog maar een gewoonte, en één
  onzorgvuldige `update` verderop volstaat om hem te breken.
- **"Nieuw sinds je vorige bezoek" per account** — lichter (geen knop, geen actie), maar het beantwoordt
  de verkeerde vraag: het zegt wat *jij* nog niet zag, niet of er al iets mee gedaan is, en lost het
  dubbel-oppakken dus niet op. Erger nog: het wist stilzwijgend wat je nog moest doen op het moment dat
  je even keek — precies wanneer je er niets mee kón.
- **Boodschappen na afhandeling archiveren/verbergen** — geeft de rustigste lijst, maar laat een
  begeleider bepalen wat er van de communicatie van de gebruiker zichtbaar blijft. Dat is in strijd met
  §2; filteren doen we daarom uitsluitend in de weergave.
- **Aftekenen als audit-actie** (`AuditLog`) — het spoor is append-only en heeft geen "ongedaan maken";
  terugdraaien zou een tweede regel worden en de huidige stand een reconstructie. Bovendien is het
  audit-log er voor gevoelige beheeracties, niet voor dagelijks werk.
