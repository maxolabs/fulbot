# Builds the self-hosted woff2 files in src/assets/fonts (loaded by
# src/app/fonts.ts through next/font/local). Run it only to change the fonts;
# the output is committed, so builds never fetch anything.
#
# Sources: https://github.com/google/fonts (the files Google Fonts serves),
# with their OFL.txt copied next to the output as OFL-<family>.txt:
#   ofl/syne/Syne[wght].ttf
#   ofl/ibmplexsans/IBMPlexSans[wdth,wght].ttf
#   ofl/ibmplexmono/IBMPlexMono-Regular.ttf, IBMPlexMono-Medium.ttf
#
# The output matches what next/font/google used to serve: Syne as the
# variable font (wght 400-800), IBM Plex Sans as the variable font pinned to
# normal width (wght 100-700), IBM Plex Mono as static files, each cut to the
# Google Fonts latin + latin-ext (+ vietnamese, + Mono's box-drawing block)
# ranges with Google's layout features, unhinted. Greek and Cyrillic are left out; they
# fall back to the system font. Characters outside these ranges (→, ★, emoji)
# fall back exactly as before.
#
#   python3 -m venv /tmp/fontvenv && /tmp/fontvenv/bin/pip install fonttools brotli
#   /tmp/fontvenv/bin/python -I scripts/build-fonts.py <dir with the sources> src/assets/fonts
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF"
VIETNAMESE = "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB"
MONO_SYMBOLS = "U+2000-2001,U+2004-2008,U+200A,U+23B8-23BD,U+2500-259F"


def unicodes(*ranges):
    out = set()
    for item in ",".join(ranges).split(","):
        start, _, end = item.strip()[2:].partition("-")
        out.update(range(int(start, 16), int(end or start, 16) + 1))
    return sorted(out)


def build(src_dir, out_dir, src, dst, ranges, pin=None, extra_features=()):
    # recalcTimestamp=False keeps the output byte-identical across runs.
    font = TTFont(f"{src_dir}/{src}", recalcTimestamp=False)
    if pin:
        # Instance, then reload: subsetting a freshly instanced font in memory
        # trips over its lazily loaded tables.
        pinned = f"{out_dir}/.pinned.ttf"
        instancer.instantiateVariableFont(font, pin).save(pinned)
        font = TTFont(pinned, recalcTimestamp=False)
    options = subset.Options()
    options.flavor = "woff2"
    # Unhinted, like the files Google Fonts served to next/font/google.
    options.hinting = False
    options.layout_features = list(options.layout_features) + list(extra_features)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=unicodes(*ranges))
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(f"{out_dir}/{dst}")
    if pin:
        os.remove(f"{out_dir}/.pinned.ttf")


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: build-fonts.py <source dir> <output dir>")
    src_dir, out_dir = sys.argv[1], sys.argv[2]
    # Google kept the numeral features in Syne (tabular-nums is used with font-display).
    build(src_dir, out_dir, "Syne[wght].ttf", "Syne-Variable.woff2", [LATIN, LATIN_EXT],
          extra_features=("lnum", "pnum", "tnum"))
    build(src_dir, out_dir, "IBMPlexSans[wdth,wght].ttf", "IBMPlexSans-Variable.woff2",
          [LATIN, LATIN_EXT, VIETNAMESE], pin={"wdth": 100})
    for weight in ("Regular", "Medium"):
        build(src_dir, out_dir, f"IBMPlexMono-{weight}.ttf", f"IBMPlexMono-{weight}.woff2",
              [LATIN, LATIN_EXT, VIETNAMESE, MONO_SYMBOLS])


if __name__ == "__main__":
    main()
