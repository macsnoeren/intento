# Huisstijlbestanden

Hier staat het **bronlogo** van Intento en het script dat er de bestanden uit maakt die de
web-applicatie gebruikt. De afgeleide bestanden staan in [`../public/`](../public/) en zijn
gegenereerd — bewerk ze niet met de hand.

## Waarom afgeleide bestanden

`logo-intento-source.png` is 1254×1254 px, 925 kB, en heeft een **witte achtergrond** met het
volledige logo erop (beeldmerk, woordmerk, payoff). Zo is het op een webpagina niet te gebruiken: op
elk gekleurd vlak zie je een wit blok, een kopbalk heeft een liggende variant nodig, een browsertab
een favicon van 32 px, en een tablet-startscherm een app-icoon. Het script lost dat in één keer op.

## Genereren

```bash
cd web/brand
python3 generate-assets.py      # vereist Pillow (python3-pil)
```

Het script sleutelt het wit weg tot transparantie, herstelt de kleur van de halfdoorzichtige
randpixels (anders krijgt het logo een lichte waas op een donkere ondergrond), knipt de drie
logo-onderdelen los en schrijft:

| Bestand                             | Waarvoor                                                        |
| ----------------------------------- | --------------------------------------------------------------- |
| `public/brand/intento-mark.png`     | Beeldmerk, 512 px, transparant — de bron voor grote weergaven    |
| `public/brand/intento-mark-128.png` | Hetzelfde beeldmerk klein, voor kopbalken (klein bestand)        |
| `public/brand/intento-lockup.png`   | Beeldmerk + woordmerk naast elkaar — de zijbalk van het beheer   |
| `public/brand/intento-logo.png`     | Het volledige logo mét payoff — inlog- en koppelschermen         |
| `public/brand/intento-tile.png`     | Beeldmerk op een wit, afgerond vlak — voor donkere ondergronden  |
| `public/favicon.ico`                | Browsertab (16/32/48 px)                                         |
| `public/favicon-32.png`             | Browsertab, scherpe variant voor moderne browsers                |
| `public/apple-touch-icon.png`       | iOS-startscherm (180 px)                                         |
| `public/icon-192.png`, `icon-512.png` | App-icoon uit `site.webmanifest`                                |
| `public/icon-maskable-512.png`      | Android-app-icoon dat zijn eigen vorm uitknipt (extra lucht)     |

De paden staan in de code op één plek: `BRAND_ASSETS` in [`../src/Brand.tsx`](../src/Brand.tsx).
`web/src/Brand.test.tsx` controleert dat elk pad — ook die in `index.html` — echt bestaat.

## Gebruik in de app

- **Op een lichte ondergrond**: het beeldmerk of de liggende variant, direct.
- **Op een donkere of gekleurde ondergrond**: de tegel (`intento-tile.png`). De spraakbel is van
  binnen open, dus het donkerblauwe figuurtje erin valt weg op een donkere ondergrond.
- **Naast de naam in tekst**: het beeldmerk staat dan `aria-hidden` (`<BrandMark />`), anders leest
  een schermlezer "Intento Intento".

## Kleuren

| Rol             | Waarde    | Herkomst                       |
| --------------- | --------- | ------------------------------ |
| Donkerblauw     | `#17255c` | het figuurtje en het woordmerk |
| Turkoois        | `#00c3b4` | begin van het belverloop       |
| Blauw           | `#3f7ad9` | midden van het belverloop      |
| Paars           | `#6f63d8` | eind van het belverloop        |
| Oranje          | `#f5951f` | het accentvierkantje           |

Deze staan als CSS-variabelen in [`../src/styles.css`](../src/styles.css) (`--intento-navy` enz.).
Het verloop komt in de interface alleen terug als dunne accentlijn — nooit onder tekst.
