# Vocabulary-bronnen

De startset van de Vocabulary (INTENTO-NEW-DESIGN §15.1): **Mulberry Symbols** (`mulberry`) en de
**Mulberry Plus Collection** (`corona-symbols`) van [Global Symbols](https://globalsymbols.com), CC BY-SA 4.0.

| Map | Inhoud | Hoe |
|---|---|---|
| `sources/<slug>.manifest.json` | Per picto: Global Symbols-id, woordsoort, afbeeldings-URL, formaat en de Engelse, Duitse en Franse labels; plus naam, uitgever en licentie van de set. | `npm run vocabulary:manifest -- <slug>` (gegenereerd, niet met de hand bewerken) |
| `translations/<slug>.nl.json` | Nederlandse labels, synoniemen, concept, context, startconcept en status (`reviewed`/`machine`). | Met de hand (kernset) en via de machinevertaling (N8.7). |

Het manifest maakt de import herhaalbaar, ook als de bron verandert. De afbeeldingen zelf staan niet in
de repo; die haalt `npm run vocabulary:images -- <slug>` naar de bestandsopslag.
