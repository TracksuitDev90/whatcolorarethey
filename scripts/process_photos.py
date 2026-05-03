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
}

# Mapping of every character ID to its source file.
ASSIGNMENTS = {
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
