"""Sample dominant non-background colors from each character photo.

For each entry in characters.json that has an image, loads the processed
photo, drops near-white background pixels, very dark shadow lines, and
near-pure white highlights. Then quantizes the remaining pixels and
prints the top color buckets — useful for hand-tuning the canonical hex
when the brand reference doesn't quite match the rendered character.
"""

from collections import Counter
from pathlib import Path
import json
import sys

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
CHARS_JSON = REPO_ROOT / "data" / "characters.json"


def quantize(rgb, step=16):
    return tuple((c // step) * step + step // 2 for c in rgb)


def sample(path: Path, top_n=5):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    # Crop to inner 80% to reduce border/letterbox noise
    margin_x = int(w * 0.10)
    margin_y = int(h * 0.10)
    img = img.crop((margin_x, margin_y, w - margin_x, h - margin_y))

    counter = Counter()
    for px in img.getdata():
        r, g, b = px
        # Drop near-white background
        if r > 235 and g > 235 and b > 235:
            continue
        # Drop near-black outlines
        if r < 25 and g < 25 and b < 25:
            continue
        # Drop near-greys (low saturation) which are often shadows or
        # neutral backgrounds. A character's body color almost always
        # has at least some chromatic spread.
        mx = max(r, g, b)
        mn = min(r, g, b)
        # Allow gray characters (Bugs Bunny etc) — only drop very dark/very
        # light desaturated pixels; mid-gray bodies must survive.
        if mx - mn < 14 and (mx > 220 or mx < 50):
            continue
        counter[quantize((r, g, b))] += 1

    total = sum(counter.values())
    if total == 0:
        return []
    return [
        (rgb, n / total)
        for rgb, n in counter.most_common(top_n)
    ]


def hex_(rgb):
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def main():
    chars = json.loads(CHARS_JSON.read_text())
    target_ids = sys.argv[1:]
    for c in chars:
        if target_ids and c["id"] not in target_ids:
            continue
        img = c.get("image")
        if not img:
            continue
        path = REPO_ROOT / img
        if not path.exists():
            print(f"  MISSING photo for {c['id']}")
            continue
        results = sample(path)
        canonical = c["color"]["hex"]
        print(f"{c['id']:24s}  canon={canonical}")
        for rgb, frac in results:
            print(f"    {hex_(rgb)}  {frac*100:5.1f}%")


if __name__ == "__main__":
    main()
