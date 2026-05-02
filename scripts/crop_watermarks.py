"""Crop the bottom 12% off the three watermarked character photos.

The Crash, Squirtle, and Charizard source images carry copyright text on the
bottom ~10%. Run once; output overwrites the originals (git history keeps
the uncropped versions if needed).
"""

from pathlib import Path
from PIL import Image

TARGETS = [
    "assets/IMG_0372.png",   # Crash Bandicoot
    "assets/IMG_0374.webp",  # Squirtle
    "assets/IMG_0376.webp",  # Charizard
]
CROP_FRACTION = 0.12

repo_root = Path(__file__).resolve().parent.parent

for rel in TARGETS:
    path = repo_root / rel
    img = Image.open(path)
    w, h = img.size
    new_h = int(h * (1 - CROP_FRACTION))
    cropped = img.crop((0, 0, w, new_h))
    save_kwargs = {}
    if path.suffix.lower() == ".webp":
        save_kwargs = {"quality": 92, "method": 6}
    elif path.suffix.lower() == ".png":
        save_kwargs = {"optimize": True}
    cropped.save(path, **save_kwargs)
    print(f"{rel}: {w}x{h} -> {w}x{new_h}")
