"""Refresh character canonical colors via ColorThief.

The user-curated entries in `data/characters.json` carry an explicit
`colorSource` URL when the hex was pulled from a brand reference or a
trusted swatch site. The rest were eyeballed from screenshots and tend to
drift from the on-screen rendering. This script runs the photo through
ColorThief, drops palette entries that read as background / outline /
highlight noise, and picks the most plausible character body color from
what remains.

Behaviour by default:
  * Iterates entries WITHOUT `colorSource`.
  * Skips entries whose existing hex already lives close to a ColorThief
    palette entry (within COLORTHIEF_ACCEPT_DELTA in RGB Euclidean space)
    — that signals the canonical hex is already photo-faithful.
  * Updates the hex when a clearly-better candidate is available and
    records `colorSource: "colorthief"` so future runs don't fight a hand-
    tuned override.

Usage:
  python3 scripts/colorthief_update.py            # update all eligible
  python3 scripts/colorthief_update.py --dry-run  # print proposals only
  python3 scripts/colorthief_update.py id1 id2    # restrict to ids
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

from colorthief import ColorThief

REPO_ROOT = Path(__file__).resolve().parent.parent
CHARS_JSON = REPO_ROOT / "data" / "characters.json"

# ColorThief returns a palette ordered by quantization weight. Each entry is
# scored against these filters before we accept it as a character color.
PALETTE_SIZE = 8
QUALITY = 1  # Sample every pixel — slower but accurate on small photos.

# Drop pixels that read as paper-white background or pure black outline.
WHITE_MAX = 238
BLACK_MAX = 28

# Drop nearly-desaturated palette entries unless the character is itself a
# neutral (Bugs Bunny, Astro, etc.). Without this filter the dominant color
# on a chromatic character is often the gray scenery behind them.
NEUTRAL_CHROMA_MAX = 22

# When the existing canonical hex is already within this RGB-Euclidean
# distance of any palette entry, leave it alone — the manual value is good
# enough and the lookup just confirms it.
COLORTHIEF_ACCEPT_DELTA = 18

# When the closest palette entry sits between ACCEPT_DELTA and this maximum,
# we treat ColorThief as refining the canonical and adopt the palette pick.
# Past this distance the canonical and palette disagree so much that the
# palette winner is almost certainly background / accessory pixels, not the
# character — better to leave the human-set hex in place than churn it.
COLORTHIEF_MAX_DRIFT = 45

# Pre-existing colorSource values that should be treated as "given directly"
# even if other heuristics would override them.
PRESERVE_SOURCES = {"colorthief"}  # re-running is fine; we'll just recompute


def rgb_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    s = hex_str.lstrip("#")
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def chroma(rgb: tuple[int, int, int]) -> int:
    return max(rgb) - min(rgb)


def is_background_color(rgb: tuple[int, int, int]) -> bool:
    """True for palette entries that almost certainly belong to scenery."""
    r, g, b = rgb
    mx = max(rgb)
    mn = min(rgb)
    if mx > WHITE_MAX and mn > WHITE_MAX - 20:
        return True
    if mx < BLACK_MAX:
        return True
    if mx - mn < NEUTRAL_CHROMA_MAX and (mx > 200 or mx < 60):
        # Highly-desaturated AND extremal — page background or shadow.
        return True
    return False


def pick_character_color(
    image_path: Path,
    canonical_rgb: tuple[int, int, int],
    canonical_is_neutral: bool,
) -> tuple[str, list[tuple[str, float]], bool]:
    """Return (new_hex, palette_debug, accepted_existing).

    The palette debug list is the ColorThief output annotated with whether
    each entry was filtered out, useful in dry-run mode for sanity checks.
    `accepted_existing` is True when the canonical hex was already close
    enough to a palette entry that no update is warranted.
    """
    thief = ColorThief(str(image_path))
    palette = thief.get_palette(color_count=PALETTE_SIZE, quality=QUALITY)

    annotated: list[tuple[str, float]] = []
    candidates: list[tuple[int, int, int]] = []
    for rgb in palette:
        rgb = tuple(rgb)
        annotated.append((rgb_to_hex(rgb), 0.0))
        if canonical_is_neutral:
            # Neutral characters legitimately have low-chroma colors — skip
            # only the white-paper / pure-black palette entries.
            r, g, b = rgb
            if max(rgb) > WHITE_MAX and min(rgb) > WHITE_MAX - 20:
                continue
            if max(rgb) < BLACK_MAX:
                continue
            candidates.append(rgb)
        else:
            if is_background_color(rgb):
                continue
            candidates.append(rgb)

    if not candidates:
        return rgb_to_hex(canonical_rgb), annotated, True

    # Anchor on the existing canonical hex: pick the palette entry closest
    # to it. The canonical was set by a human who looked at the character —
    # it points to the right hue family even when the exact shade is off.
    # Drifting wildly toward an unrelated palette entry (the background,
    # an accessory) is almost always worse than keeping the human value.
    closest = min(candidates, key=lambda c: rgb_distance(c, canonical_rgb))
    delta = rgb_distance(closest, canonical_rgb)
    if delta <= COLORTHIEF_ACCEPT_DELTA:
        return rgb_to_hex(closest), annotated, True
    if delta <= COLORTHIEF_MAX_DRIFT:
        return rgb_to_hex(closest), annotated, False
    # Palette is too far from canonical to be talking about the same color —
    # the dominant on-photo region is background / accessory pixels and the
    # canonical hex is more trustworthy. Leave it alone.
    return rgb_to_hex(canonical_rgb), annotated, True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ids", nargs="*", help="Only process these character ids")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print proposed changes without writing")
    parser.add_argument("--force", action="store_true",
                        help="Re-evaluate even entries that have a colorSource")
    args = parser.parse_args()

    chars = json.loads(CHARS_JSON.read_text())
    changes: list[tuple[dict, str, str]] = []
    skipped_existing = 0
    skipped_other = 0

    for c in chars:
        if args.ids and c["id"] not in args.ids:
            continue
        existing_source = c.get("colorSource")
        if existing_source and existing_source not in PRESERVE_SOURCES and not args.force:
            # The user gave this color directly; leave it alone.
            skipped_other += 1
            continue
        img_field = c.get("image")
        if not img_field:
            continue
        path = REPO_ROOT / img_field
        if not path.exists():
            print(f"  MISSING photo for {c['id']}", file=sys.stderr)
            continue

        canonical_hex = c["color"]["hex"].upper()
        canonical_rgb = hex_to_rgb(canonical_hex)
        # A canonical "neutral" character (gray Bugs, white Brain) should
        # not have its desaturated palette entries filtered out as
        # background noise.
        canonical_is_neutral = chroma(canonical_rgb) < NEUTRAL_CHROMA_MAX

        new_hex, palette_debug, accepted_existing = pick_character_color(
            path, canonical_rgb, canonical_is_neutral
        )

        if accepted_existing or new_hex.upper() == canonical_hex:
            skipped_existing += 1
            print(f"  {c['id']:28s} canon={canonical_hex}  match")
            continue

        changes.append((c, canonical_hex, new_hex))
        print(f"  {c['id']:28s} canon={canonical_hex}  ->  {new_hex}")
        for hex_str, _ in palette_debug[:5]:
            marker = " <-" if hex_str.upper() == new_hex.upper() else ""
            print(f"      palette  {hex_str}{marker}")

    print()
    print(f"would update {len(changes)} entries")
    print(f"already accurate: {skipped_existing}")
    if skipped_other:
        print(f"skipped (manual colorSource): {skipped_other}")

    if args.dry_run or not changes:
        return 0

    apply_inline_edits(CHARS_JSON, changes)
    print(f"wrote {CHARS_JSON.relative_to(REPO_ROOT)}")
    return 0


def apply_inline_edits(path: Path, changes: list[tuple[dict, str, str]]) -> None:
    """Rewrite hex values without churning the file's existing formatting.

    `json.dumps` would expand the inline `"color": { "hex": ... }` form into
    multi-line objects and balloon the diff with cosmetic-only changes. This
    walks the source by line and updates only what's actually changing,
    preserving the rest of the formatting verbatim.
    """
    text = path.read_text()
    targets = {c["id"]: (old, new) for c, old, new in changes}
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    current_id: str | None = None
    seen_color_source = False
    pending_source_after_color = False

    id_re = re.compile(r'"id"\s*:\s*"([^"]+)"')
    hex_re = re.compile(r'("hex"\s*:\s*")(#[0-9A-Fa-f]{6})(")')

    for line in lines:
        m = id_re.search(line)
        if m:
            # Boundary between entries — capture the id and reset per-entry
            # state. JSON in the file lays one id per line so this is a stable
            # marker.
            current_id = m.group(1)
            seen_color_source = False
            pending_source_after_color = False

        if current_id in targets and not seen_color_source and '"colorSource"' in line:
            seen_color_source = True

        if current_id in targets and hex_re.search(line):
            old, new = targets[current_id]
            updated = hex_re.sub(
                lambda mm: mm.group(1) + new + mm.group(3),
                line,
                count=1,
            )
            out.append(updated)
            # Drop colorSource insertion onto the next line if the entry
            # didn't already have one. We only add for entries that lacked
            # the field — entries with --force keep their existing source.
            if not seen_color_source:
                pending_source_after_color = True
            continue

        if pending_source_after_color and current_id in targets:
            # Insert the new colorSource line right after the color line,
            # matching the indentation and quoting style of the file.
            indent = re.match(r"\s*", line).group(0)
            insertion = f'{indent}"colorSource": "colorthief",\n'
            out.append(insertion)
            pending_source_after_color = False

        out.append(line)

    path.write_text("".join(out))


if __name__ == "__main__":
    raise SystemExit(main())
