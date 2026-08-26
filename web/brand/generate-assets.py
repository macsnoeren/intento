#!/usr/bin/env python3
"""Genereert de web-bruikbare logobestanden uit het bronlogo.

Het bronbestand (`logo-intento-source.png`) is een vierkant plaatje van 1254x1254 met het volledige
logo op een **witte** achtergrond: beeldmerk (spraakbel), woordmerk "Intento" en de payoff. Zo is het
op een webpagina niet te gebruiken — een witte blokrand op elke gekleurde ondergrond, geen favicon,
geen los beeldmerk voor een kopbalk, en 925 kB voor een icoontje van 40 px.

Dit script leidt daar de bestanden uit af die de app wél kan gebruiken (naar `web/public/brand/` en
`web/public/`). Draaien vanuit deze map:

    python3 generate-assets.py

Twee stappen die het handwerk zijn:

1. **Wit wegsleutelen.** De alfa loopt van 0 (wit) naar 1 (inkt) over een smalle band, zodat de
   antialiasing-randen zacht blijven.
2. **Randkleur herstellen.** Halfdoorzichtige randpixels houden hun tegen-wit-gemengde kleur; op een
   donkere ondergrond geeft dat een lichte waas ("fringe"). Elke randpixel krijgt daarom de kleur van
   de dichtstbijzijnde volledig dekkende pixel, waardoor het logo op élke achtergrond schoon staat.

De bel is van binnen open (transparant): op een donkere ondergrond valt het donkerblauwe figuurtje
daarin weg. Gebruik daar de tegelvariant (`intento-tile.png`), die het beeldmerk op een wit,
afgerond vlak zet — dat is meteen de vorm die iOS/Android voor een app-icoon willen.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'logo-intento-source.png'
PUBLIC = HERE.parent / 'public'
BRAND = PUBLIC / 'brand'

# Alfadrempels in "afstand tot wit" (255 - min(r,g,b)). Onder LOW is het achtergrond, boven HIGH is
# het inkt; ertussen loopt de alfa lineair op. Ruim boven de ruis in de bronscan (~2) en ruim onder
# de lichtste echte logokleur.
ALPHA_LOW = 8
ALPHA_HIGH = 40


def key_out_white(image: Image.Image) -> Image.Image:
    """Maakt de witte achtergrond transparant en haalt de witte waas van de randpixels af."""
    rgb = image.convert('RGB')
    width, height = rgb.size
    pixels = rgb.load()
    out = Image.new('RGBA', (width, height))
    target = out.load()

    edges: list[tuple[int, int]] = []
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            distance = 255 - min(r, g, b)
            if distance <= ALPHA_LOW:
                target[x, y] = (r, g, b, 0)
            elif distance >= ALPHA_HIGH:
                target[x, y] = (r, g, b, 255)
            else:
                alpha = round(255 * (distance - ALPHA_LOW) / (ALPHA_HIGH - ALPHA_LOW))
                target[x, y] = (r, g, b, alpha)
                edges.append((x, y))

    # Randpixels de kleur van de dichtstbijzijnde dekkende buur geven (de "unfringe"-stap).
    for x, y in edges:
        best: tuple[int, int, int] | None = None
        for radius in (1, 2, 3):
            found: list[tuple[int, int, int]] = []
            for dy in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < width and 0 <= ny < height and target[nx, ny][3] == 255:
                        found.append(target[nx, ny][:3])
            if found:
                best = (
                    sum(c[0] for c in found) // len(found),
                    sum(c[1] for c in found) // len(found),
                    sum(c[2] for c in found) // len(found),
                )
                break
        if best is not None:
            target[x, y] = (*best, target[x, y][3])

    return out


def ink_rows(image: Image.Image) -> list[int]:
    """Aantal zichtbare pixels per beeldrij; gebruikt om de drie logo-onderdelen te vinden."""
    alpha = image.getchannel('A')
    width, height = image.size
    data = alpha.load()
    return [sum(1 for x in range(width) if data[x, y] > 24) for y in range(height)]


def bands(image: Image.Image, minimum_gap: int = 12) -> list[tuple[int, int]]:
    """Verticale banden met inkt (beeldmerk, woordmerk, payoff), van boven naar beneden."""
    rows = ink_rows(image)
    found: list[tuple[int, int]] = []
    start: int | None = None
    gap = 0
    for y, count in enumerate(rows):
        if count > 0:
            if start is None:
                start = y
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= minimum_gap:
                found.append((start, y - gap))
                start = None
    if start is not None:
        found.append((start, len(rows) - 1))
    return found


def crop_band(image: Image.Image, band: tuple[int, int]) -> Image.Image:
    """Snijdt één band strak uit, ook links en rechts."""
    top, bottom = band
    strip = image.crop((0, top, image.width, bottom + 1))
    box = strip.getbbox()
    return strip.crop(box) if box else strip


def square(image: Image.Image, size: int, padding: float = 0.06) -> Image.Image:
    """Zet een uitsnede gecentreerd op een vierkant canvas met wat lucht eromheen."""
    inner = round(size * (1 - 2 * padding))
    scaled = contain(image, inner, inner)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2), scaled)
    return canvas


def contain(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    """Schaalt binnen een kader met behoud van verhouding (LANCZOS: scherp bij verkleinen)."""
    ratio = min(max_width / image.width, max_height / image.height)
    return image.resize(
        (max(1, round(image.width * ratio)), max(1, round(image.height * ratio))),
        Image.LANCZOS,
    )


def tile(mark: Image.Image, size: int, padding: float) -> Image.Image:
    """Beeldmerk op een wit, afgerond vlak — voor donkere ondergronden en app-iconen."""
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=round(size * 0.22), fill=(255, 255, 255, 255)
    )
    inner = round(size * (1 - 2 * padding))
    scaled = contain(mark, inner, inner)
    canvas.paste(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2), scaled)
    return canvas


def lockup(mark: Image.Image, wordmark: Image.Image, height: int) -> Image.Image:
    """Horizontale variant: beeldmerk links, woordmerk rechts — de vorm die een kopbalk nodig heeft."""
    mark_scaled = contain(mark, height, height)
    word_height = round(height * 0.52)
    word_scaled = contain(wordmark, height * 4, word_height)
    gap = round(height * 0.18)
    canvas = Image.new('RGBA', (mark_scaled.width + gap + word_scaled.width, height), (0, 0, 0, 0))
    canvas.paste(mark_scaled, (0, (height - mark_scaled.height) // 2), mark_scaled)
    # Optisch centreren: het woordmerk heeft geen stok- of staartletters onder de basislijn.
    canvas.paste(
        word_scaled,
        (mark_scaled.width + gap, round((height - word_scaled.height) / 2)),
        word_scaled,
    )
    return canvas


def main() -> None:
    BRAND.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE)
    keyed = key_out_white(source)

    found = bands(keyed)
    if len(found) != 3:
        raise SystemExit(f'Verwachtte 3 logo-onderdelen (beeldmerk, woordmerk, payoff), kreeg {found}')
    mark = crop_band(keyed, found[0])
    wordmark = crop_band(keyed, found[1])
    full = keyed.crop(keyed.getbbox())

    written: list[Path] = []

    def save(image: Image.Image, path: Path, **kwargs: object) -> None:
        image.save(path, **kwargs)
        written.append(path)

    # Beeldmerk: los, vierkant, transparant. 512 als bron, 128 voor de kopbalk (scheelt bytes).
    save(square(mark, 512), BRAND / 'intento-mark.png')
    save(square(mark, 128), BRAND / 'intento-mark-128.png')

    # Horizontale variant voor kopbalken en het inlogscherm.
    save(lockup(mark, wordmark, 128), BRAND / 'intento-lockup.png')

    # Het volledige logo (beeldmerk + woordmerk + payoff), transparant en strak bijgesneden.
    save(contain(full, 768, 768), BRAND / 'intento-logo.png')

    # Tegel voor donkere ondergronden en als bron voor de app-iconen.
    save(tile(mark, 512, 0.12), BRAND / 'intento-tile.png')

    # Favicons en app-iconen. Het maskable-icoon houdt extra lucht aan de randen, omdat Android er
    # zijn eigen vorm uit knipt.
    # Favicons krijgen nauwelijks lucht: bij 16-32 px telt elke pixel van het beeldmerk.
    save(square(mark, 32, padding=0.01), PUBLIC / 'favicon-32.png')
    save(
        square(mark, 48, padding=0.01),
        PUBLIC / 'favicon.ico',
        format='ICO',
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    save(tile(mark, 180, 0.14), PUBLIC / 'apple-touch-icon.png')
    save(tile(mark, 192, 0.14), PUBLIC / 'icon-192.png')
    save(tile(mark, 512, 0.14), PUBLIC / 'icon-512.png')
    save(tile(mark, 512, 0.24), PUBLIC / 'icon-maskable-512.png')

    for path in written:
        print(f'{path.relative_to(HERE.parent)}  {path.stat().st_size / 1024:.1f} kB')


if __name__ == '__main__':
    main()
