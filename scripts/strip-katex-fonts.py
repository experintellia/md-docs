#!/usr/bin/env python3
"""Write KaTeX's fonts, minus what a browser never reads, to fonts/katex-<version>/.

Two things go, together a sixth of KaTeX's woff2 bytes, so the build
(vite.config.ts) bundles these copies instead of KaTeX's own:

- The TrueType hinting: bytecode that snaps outlines to the pixel grid at small
  sizes. Windows runs it; macOS, iOS and Android ignore it. That is the tables
  carrying it, each glyph's instructions, and the maxp fields that size them.
- The glyph names in the post table. Text is laid out by character map and
  glyph number; the names are for font editors.

Outlines, metrics, the character map and every other table are checked to come
out identical, glyph by glyph.

Re-run after upgrading KaTeX; the build refuses to start until you do:

    pip install fonttools brotli
    python3 scripts/strip-katex-fonts.py
"""
import json
import pathlib
import shutil

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
KATEX = ROOT / 'node_modules' / 'katex'
VERSION = json.loads((KATEX / 'package.json').read_text())['version']
OUT = ROOT / 'fonts' / f'katex-{VERSION}'
HINTING = ('fpgm', 'prep', 'cvt ')


def strip(font):
    for tag in HINTING:
        if tag in font:
            del font[tag]
    glyf = font['glyf']
    for name in font.getGlyphOrder():
        glyf[name].removeHinting()
    maxp = font['maxp']
    maxp.maxZones = 1
    for field in ('maxTwilightPoints', 'maxStorage', 'maxFunctionDefs',
                  'maxInstructionDefs', 'maxStackElements', 'maxSizeOfInstructions'):
        setattr(maxp, field, 0)
    font['post'].formatType = 3.0  # no glyph names


# Glyphs are compared by number: without stored names, fontTools makes up its
# own when it reads the font back.
def outline(font, name):
    g = font['glyf'][name]
    if g.isComposite():
        return [(font.getGlyphID(c.glyphName), c.x, c.y, getattr(c, 'transform', None))
                for c in g.components]
    if g.numberOfContours == 0:
        return []
    return (list(g.coordinates), list(g.endPtsOfContours), [f & 1 for f in g.flags])


def check(before, after):
    old, new = before.getGlyphOrder(), after.getGlyphOrder()
    assert len(new) == len(old)
    for a, b in zip(old, new):
        assert outline(after, b) == outline(before, a), a
    # The checksum is of the whole file, which is meant to change; the post
    # table is compared without its names, the rest of it must match.
    before['head'].checkSumAdjustment = after['head'].checkSumAdjustment = 0
    before['post'].formatType = 3.0
    for tag in before.keys():
        if tag in HINTING or tag in ('glyf', 'loca', 'maxp', 'GlyphOrder'):
            continue
        assert after[tag].compile(after) == before[tag].compile(before), tag


def main():
    for old in OUT.parent.glob('katex-*'):
        shutil.rmtree(old)
    OUT.mkdir(parents=True)
    # Not the faces the build drops (katexFonts() in vite.config.ts).
    dropped = ('SansSerif', 'Typewriter', 'Caligraphic-Bold', 'Fraktur-Bold')
    sources = [p for p in sorted((KATEX / 'dist' / 'fonts').glob('*.woff2'))
               if not any(d in p.name for d in dropped)]
    total_in = total_out = 0
    # Keep the bounding boxes and timestamp as KaTeX shipped them, rather than
    # letting fontTools recompute them, so nothing but the hinting differs.
    load = lambda path: TTFont(path, recalcBBoxes=False, recalcTimestamp=False)  # noqa: E731
    for src in sources:
        font = load(src)
        strip(font)
        dst = OUT / src.name
        font.flavor = 'woff2'
        font.save(dst)
        check(load(src), load(dst))
        total_in += src.stat().st_size
        total_out += dst.stat().st_size
    print(f'{len(sources)} fonts, {total_in} -> {total_out} bytes, in {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
