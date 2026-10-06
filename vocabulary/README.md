# Vocabulary-bronnen

De startset van de Vocabulary (INTENTO-NEW-DESIGN §15.1): **Mulberry Symbols** (`mulberry`) en de
**Mulberry Plus Collection** (`corona-symbols`) van [Global Symbols](https://globalsymbols.com), CC BY-SA 4.0.

| Map | Inhoud | Hoe |
|---|---|---|
| `sources/<slug>.manifest.json` | Per picto: Global Symbols-id, woordsoort, afbeeldings-URL, formaat en de Engelse, Duitse en Franse labels; plus naam, uitgever en licentie van de set. | `npm run vocabulary:manifest -- <slug>` (gegenereerd, niet met de hand bewerken) |
| `translations/<slug>.nl.json` | Nederlandse labels, synoniemen, concept, context, startconcept en status (`reviewed`/`machine`). | Met de hand (kernset) en via de machinevertaling (N8.7). |

Het manifest maakt de import herhaalbaar, ook als de bron verandert. De afbeeldingen zelf staan niet in
de repo; die haalt `npm run vocabulary:images -- <slug>` naar de bestandsopslag.

## Vertaalbestand

```json
{ "slug": "mulberry", "language": "nl",
  "items": [{ "id": 4748, "label": "hoofdpijn", "synonyms": [], "concept": "headache",
              "context": "health", "is_start": false, "status": "reviewed" }] }
```

- **concept**: taalneutrale sleutel, normaal afgeleid uit het Engelse label (*chest pain* → `chest_pain`).
  Uniek over alle vertaalbestanden heen (getest). Bewuste afwijkingen in de kernset: `tired` (Mulberry heeft
  geen "tired"; het geeuw-pictogram "yawn" staat voor *moe*), `mouth_care` en `back_ache` (zorgsymbolen
  met een te specifiek Engels label), en `_2` voor de dubbele pictos van de Plus Collection.
- **context**: één van `health`, `food_drink`, `feelings`, `body`, `people`, `places`, `activities`,
  `things`, `time`, `other`.
- **is_start**: de startconcepten (§6): pijn, eten, drinken, toilet, moe, blij, verdrietig, hulp.
- **status**: `reviewed` (met de hand) of `machine` (machinevertaling, N8.7). Alleen symbolen met een
  Nederlandse vertaling komen in de Vocabulary.

De kernset (N2.5) telt 57 Mulberry-woorden en alle 42 zorgsymbolen van de Plus Collection.
