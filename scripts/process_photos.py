"""Pre-process character source photos into a uniform, high-quality
4:3 frame.

For each source photo we:
  1. Detect the character's bounding box (transparency or color delta from
     a corner-sampled background).
  2. Clip out any printed watermark band on the bottom of the gallery prints.
  3. Add a small breathing-room margin so the figure isn't kissing the edge.
  4. Expand the crop box to a 4:3 aspect ratio centred on the character,
     extending the original image when there's room and only padding with
     the sampled background colour as a last resort.
  5. Save the result at the original (or higher) resolution as a PNG so we
     keep every pixel sharp on retina displays.

The output goes to assets/photos/ and is referenced from characters.json.
The originals stay in assets/ for the record.
"""

from pathlib import Path
from PIL import Image, ImageChops

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "assets"
OUT_DIR = REPO_ROOT / "assets" / "photos"
OUT_DIR.mkdir(parents=True, exist_ok=True)

TARGET_RATIO = 4 / 3
PADDING_FRAC = 0.06

# Per-image overrides: extra crop on a specific side (in fraction of source
# image dimension) to remove watermarks or empty borders before bbox detection.
PRECROP = {
    "IMG_0384.webp": {"bottom": 0.10},   # Scooby - GalleryPops watermark
    "IMG_0390.webp": {"bottom": 0.08},   # Winnie - GalleryPops watermark
    "IMG_0388.png":  {"left": 0.04, "right": 0.04},  # Sonic - jpeg edge artefacts
    "IMG_0399.jpeg": {"bottom": 0.07},   # Speed Racer - "SPEED RACER" watermark
    "IMG_0446.jpeg": {"bottom": 0.10},   # Stitch - GalleryPops watermark
}

# Mapping of every character/item ID to its source file. Character entries
# come from characters.json (full-body, played as 5x5 grid). Item entries
# come from items.json (scene + specific item, played as 4-swatch quad).
ASSIGNMENTS = {
    # ---- Characters (grid mode) ----
    "spongebob-squarepants": "IMG_0359.webp",
    "pikachu":               "IMG_0362.jpeg",
    "garfield":              "IMG_0363.jpeg",
    "grimace":               "IMG_0366.webp",
    "tweety":                "IMG_0368.png",
    "mr-krabs":              "IMG_0371.png",
    "crash-bandicoot":       "IMG_0372.png",
    "bugs-bunny":            "IMG_0373.png",
    "squirtle":              "IMG_0374.webp",
    "smurfs":                "IMG_0375.png",
    "charizard":             "IMG_0376.webp",
    "barney":                "IMG_0377.jpeg",
    "shrek":                 "IMG_0378.jpeg",
    "squidward":             "IMG_0379.png",
    "elmo":                  "IMG_0380.jpeg",
    "patrick-star":          "IMG_0381.jpeg",
    "yoshi":                 "IMG_0383.png",
    "scooby-doo":            "IMG_0384.webp",
    "kermit":                "IMG_0385.jpeg",
    "sonic":                 "IMG_0388.png",
    "sulley":                "IMG_0389.webp",
    "winnie-the-pooh":       "IMG_0390.webp",
    "tigger":                "IMG_0392.png",
    "kirby":                 "IMG_0393.png",
    # ---- Items (quad mode), 60s/90s cartoons ----
    "yogi-bears-tie":         "IMG_0394.png",
    "boo-boos-bowtie":        "IMG_0395.png",
    "snagglepuss-fur":        "IMG_0396.jpeg",
    "magilla-gorilla-bowtie": "IMG_0397.png",
    "speed-racer-emblem":     "IMG_0399.jpeg",
    "penelope-pitstop-suit":  "IMG_0400.png",
    "shaggy-shirt":           "IMG_0402.jpeg",
    "velma-sweater":          "IMG_0403.png",
    "daphne-dress":           "IMG_0404.png",
    "arnolds-hat":            "IMG_0405.webp",
    "helga-bow":              "IMG_0406.jpeg",
    "tommy-pickles-shirt":    "IMG_0407.jpeg",
    "chuckie-hair":           "IMG_0409.png",
    "doug-funnie-sweater":    "IMG_0410.webp",
    "daria-jacket":           "IMG_0411.webp",
    "dexter-gloves":          "IMG_0412.jpeg",
    "dee-dee-tutu":           "IMG_0413.webp",
    "eddy-shirt":             "IMG_0414.jpeg",
    "johnny-bravo-shirt":     "IMG_0415.jpeg",
    "blossom-bow":            "IMG_0416.jpeg",
    "buttercup-dress":        "IMG_0417.png",
    "stimpy-body":            "IMG_0418.webp",
    "heffer-hair":            "IMG_0419.jpeg",
    "reggie-shirt":           "IMG_0420.jpeg",
    # ---- Items (quad mode), 2000s cartoons ----
    "nigel-hair":             "IMG_0456.jpeg",
    "darkwing-mask":          "IMG_0458.png",
    "lois-shirt":             "IMG_0460.png",
    "fred-flintstone-shirt":  "IMG_0464.png",
    "johnny-quest-hair":      "IMG_0465.webp",
    "captain-planet-hair":    "IMG_0466.jpeg",
    "muriel-apron":           "IMG_0422.jpeg",
    "mac-shirt":              "IMG_0424.jpeg",
    "dora-shirt":             "IMG_0425.jpeg",
    "boots-stomach":          "IMG_0426.jpeg",
    "cosmo-mom-hair":         "IMG_0427.jpeg",
    "timmy-turner-hat":       "IMG_0428.webp",
    "aang-arrow":             "IMG_0429.webp",
    "inspector-gadget-coat":  "IMG_0430.jpeg",
    "arthur-sweater":         "IMG_0431.webp",
    "ferb-hair":              "IMG_0432.jpeg",
    "phineas-hair":           "IMG_0433.jpeg",
    "kim-possible-hair":      "IMG_0434.jpeg",
    "numbuh-1-shirt":         "IMG_0435.webp",
    "numbuh-4-hoodie":        "IMG_0436.webp",
    "krumm-lips":             "IMG_0437.webp",
    "danny-phantom-eyes":     "IMG_0438.jpeg",
    # Scooby collar reuses the same source as the full-body Scooby photo.
    "scooby-doo-collar":      "IMG_0384.webp",
    # ---- Items (quad mode), more cartoons ----
    "brock-vest":             "IMG_0441.jpeg",
    "catdog-nose":            "IMG_0443.webp",
    "finn-hair":              "IMG_0444.jpeg",
    "mabel-shirt":            "IMG_0455.webp",
    # ---- Characters (grid mode), additional ----
    "stitch":                 "IMG_0446.jpeg",
    "cookie-monster":         "IMG_0447.jpeg",
    "beast-boy":              "IMG_0448.jpeg",
    "homer-simpson":          "IMG_0449.webp",
    "jigglypuff":             "IMG_0450.webp",
    "jenny-xj9":              "IMG_0451.webp",
    "pink-panther":           "IMG_0452.png",
    "slimer":                 "IMG_0453.jpeg",
    "perry-the-platypus":     "IMG_0454.jpeg",
    "him":                    "IMG_0459.png",
    "ice-king":               "IMG_0461.jpeg",
    "blue-ranger":            "IMG_0463.jpeg",
    "genie":                  "IMG_0468.jpeg",
    "rocko":                  "IMG_0469.webp",
    "ursula":                 "IMG_0475.jpeg",
    "flounder":               "IMG_0476.webp",
    # ---- Items (quad mode), Disney additions ----
    "vanellope-hoodie":         "IMG_0471.jpeg",
    "snow-white-dress-lower":   "IMG_0472.webp",
    "jessica-rabbit-hair":      "IMG_0473.jpeg",
    "dr-facilier-vest":         "IMG_0474.webp",
}


def sample_bg(img):
    """Estimate background colour from the four corners. Treats fully or
    mostly transparent corners as white so we don't end up with black bands
    around isolated PNG characters."""
    w, h = img.size
    pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    samples = []
    for p in pts:
        px = img.getpixel(p)
        if isinstance(px, tuple):
            if len(px) == 4:
                r, g, b, a = px
                if a < 32:
                    samples.append((255, 255, 255))
                else:
                    samples.append((r, g, b))
            else:
                samples.append(px[:3])
        else:
            samples.append((px, px, px))
    avg = tuple(sum(c[i] for c in samples) // len(samples) for i in range(3))
    return avg


def find_content_bbox(img):
    """Return the bounding box of the foreground content."""
    if img.mode == "RGBA":
        alpha = img.split()[-1]
        # Ignore stray near-transparent pixels — they trip the bbox up
        # on PNG exports that have anti-aliased edges fading to alpha 1.
        mask = alpha.point(lambda v: 255 if v > 60 else 0)
        bbox = mask.getbbox()
        if bbox is not None:
            return bbox
        return alpha.getbbox() or (0, 0, *img.size)

    rgb = img.convert("RGB")
    bg = sample_bg(rgb)
    bg_img = Image.new("RGB", rgb.size, bg)
    diff = ImageChops.difference(rgb, bg_img).convert("L")
    # Some prints (Gallery Pops in particular) have a faint grey border at
    # ~211 on a 255 white field — diff ~44. Anything below 70 we treat as
    # noise/border and drop. If that erases everything fall back to a
    # gentler threshold so we still find soft-shaded subjects.
    for thresh in (70, 40, 16):
        mask = diff.point(lambda v: 255 if v > thresh else 0)
        bbox = mask.getbbox()
        if bbox is None:
            continue
        bw = bbox[2] - bbox[0]
        bh = bbox[3] - bbox[1]
        # Skip a bbox that's effectively the whole frame — that means we
        # caught a print border. Try a stricter threshold.
        if bw > rgb.size[0] * 0.97 and bh > rgb.size[1] * 0.97 and thresh > 16:
            continue
        return bbox
    return (0, 0, *rgb.size)


def precrop(img, name):
    if name not in PRECROP:
        return img
    w, h = img.size
    spec = PRECROP[name]
    left = int(w * spec.get("left", 0))
    top = int(h * spec.get("top", 0))
    right = w - int(w * spec.get("right", 0))
    bottom = h - int(h * spec.get("bottom", 0))
    return img.crop((left, top, right, bottom))


def expand_to_aspect(bbox, ratio):
    """Pad the bbox out to the target aspect ratio. We always grow rather
    than crop into the subject so the character keeps its head and feet.
    Returns the padded bbox in a virtual coordinate space; callers pad with
    the background colour for any part that falls outside the source."""
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0
    cur = bw / bh

    if cur < ratio:
        target_w = bh * ratio
        extra = target_w - bw
        x0 -= extra / 2
        x1 += extra / 2
    else:
        target_h = bw / ratio
        extra = target_h - bh
        y0 -= extra / 2
        y1 += extra / 2

    return (round(x0), round(y0), round(x1), round(y1))


def isolated_subject_to_4_3(img):
    """Tightly crop a flat-background subject to its bbox + a small
    breathing margin, then pad with the bg colour out to 4:3."""
    w, h = img.size
    bbox = find_content_bbox(img)
    bx0, by0, bx1, by1 = bbox
    bw, bh = bx1 - bx0, by1 - by0

    pad_x = bw * PADDING_FRAC
    pad_y = bh * PADDING_FRAC
    bbox = (bx0 - pad_x, by0 - pad_y, bx1 + pad_x, by1 + pad_y)

    target = expand_to_aspect(bbox, TARGET_RATIO)
    tx0, ty0, tx1, ty1 = target
    target_w = tx1 - tx0
    target_h = ty1 - ty0

    base = img if img.mode == "RGBA" else img.convert("RGB")
    bg = sample_bg(base)
    # JPEG export often dulls a "white" background to ~225,225,225. If the
    # bg is in that near-white range, snap to pure white so the padded
    # frame doesn't read as a faint grey border.
    if min(bg) > 210 and max(bg) - min(bg) < 8:
        bg = (255, 255, 255)

    canvas = Image.new("RGB", (target_w, target_h), bg)

    sx0 = max(0, tx0)
    sy0 = max(0, ty0)
    sx1 = min(w, tx1)
    sy1 = min(h, ty1)
    if sx1 > sx0 and sy1 > sy0:
        region = base.crop((sx0, sy0, sx1, sy1))
        if region.mode == "RGBA":
            bg_layer = Image.new("RGB", region.size, bg)
            bg_layer.paste(region, mask=region.split()[-1])
            region = bg_layer
        else:
            region = region.convert("RGB")
        canvas.paste(region, (sx0 - tx0, sy0 - ty0))
    return canvas


def is_solid_background(img):
    """Heuristic: a photo of an isolated character on a flat colour or
    transparent background has corners that all look similar (or are all
    transparent). Real photographs of costumes or scenes have wildly
    different corner colours — we cover-crop those instead."""
    w, h = img.size
    pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    rgba = img.convert("RGBA")
    samples = []
    for p in pts:
        r, g, b, a = rgba.getpixel(p)
        if a < 32:
            samples.append((255, 255, 255))
        else:
            samples.append((r, g, b))
    # Per-channel max-min spread. If every channel stays within 25 levels
    # across all four corners, treat it as a solid bg.
    spread = max(
        max(s[c] for s in samples) - min(s[c] for s in samples)
        for c in range(3)
    )
    return spread <= 25


def cover_crop(img, ratio):
    """Crop the source to the target aspect ratio, keeping the image
    centred. Used for full-bleed photographs."""
    w, h = img.size
    cur = w / h
    if abs(cur - ratio) < 1e-3:
        return img.convert("RGB")
    if cur > ratio:
        new_w = round(h * ratio)
        x0 = (w - new_w) // 2
        return img.crop((x0, 0, x0 + new_w, h)).convert("RGB")
    new_h = round(w / ratio)
    y0 = (h - new_h) // 2
    return img.crop((0, y0, w, y0 + new_h)).convert("RGB")


def process(src_path, dst_path):
    img = Image.open(src_path)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")

    img = precrop(img, src_path.name)

    if not is_solid_background(img):
        cropped = cover_crop(img, TARGET_RATIO)
    else:
        cropped = isolated_subject_to_4_3(img)

    # Cap at a sensible maximum so retina screens stay sharp without
    # shipping 5MB PNGs to phones.
    MAX_W = 1600
    if cropped.width > MAX_W:
        new_h = round(cropped.height * MAX_W / cropped.width)
        cropped = cropped.resize((MAX_W, new_h), Image.LANCZOS)

    cropped.save(dst_path, format="PNG", optimize=True)
    return cropped.size


def main():
    for cid, src_name in ASSIGNMENTS.items():
        src = SRC_DIR / src_name
        if not src.exists():
            print(f"MISSING source for {cid}: {src_name}")
            continue
        dst = OUT_DIR / f"{cid}.png"
        size = process(src, dst)
        print(f"{cid:24s} {src_name} -> photos/{dst.name} {size[0]}x{size[1]}")


if __name__ == "__main__":
    main()
