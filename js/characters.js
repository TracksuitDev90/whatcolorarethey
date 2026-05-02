// Loads characters.json, resolves each character's image source, and — for
// characters with a real photo — preloads the image and samples its dominant
// color. If the sample is close to the curated official-guide color we keep
// the official one; otherwise we fall back to what the photo actually shows,
// since the photo is what the player sees.

// RGB distance under which the sampled photo color is considered to "match"
// the official guide color. Tuned by eye against the existing roster.
const COLOR_MATCH_THRESHOLD = 70;

export async function loadCharacters() {
  const res = await fetch('data/characters.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`characters.json: ${res.status}`);
  const list = await res.json();
  validate(list);
  const resolved = list.map(c => ({ ...c, imageSrc: resolveImage(c) }));
  // Preload every photo in parallel and reconcile colors. Done at startup so
  // round transitions show the new image (and the grayscale filter) instantly.
  await Promise.all(resolved.map(prepareCharacter));
  return resolved;
}

async function prepareCharacter(c) {
  if (!c.image) return;
  let img;
  try {
    img = await loadImage(c.imageSrc);
  } catch {
    return;
  }
  c.preloadedImage = img;
  const sampled = sampleDominantHex(img);
  if (!sampled) return;
  c.sampledHex = sampled;
  const official = normalizeHex(c.color.hex);
  const matched = colorsMatch(official, sampled, COLOR_MATCH_THRESHOLD);
  c.color = { ...c.color, hex: matched ? official : sampled };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${src}`));
    img.src = src;
  });
}

// Quantize pixels into 4-bit-per-channel buckets and pick the largest one.
// Skip near-white background and near-black outline pixels so character body
// color wins over the studio backdrop / linework.
function sampleDominantHex(img) {
  try {
    const w = 96;
    const h = Math.max(1, Math.round(96 * img.naturalHeight / img.naturalWidth));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue;
      if (r > 240 && g > 240 && b > 240) continue;
      if (r < 25 && g < 25 && b < 25) continue;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const e = buckets.get(key);
      if (e) {
        e.r += r; e.g += g; e.b += b; e.count++;
      } else {
        buckets.set(key, { r, g, b, count: 1 });
      }
    }
    let best = null;
    for (const e of buckets.values()) {
      if (!best || e.count > best.count) best = e;
    }
    if (!best) return null;
    const r = Math.round(best.r / best.count);
    const g = Math.round(best.g / best.count);
    const b = Math.round(best.b / best.count);
    return rgbToHex(r, g, b);
  } catch {
    return null;
  }
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function normalizeHex(hex) {
  const s = hex.startsWith('#') ? hex.slice(1) : hex;
  const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  return `#${full}`.toUpperCase();
}

function colorsMatch(a, b, threshold) {
  return rgbDistance(a, b) <= threshold;
}

function rgbDistance(a, b) {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

function validate(list) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('characters.json must be a non-empty array');
  }
  for (const c of list) {
    if (!c.id || !c.name || !c.color?.hex) {
      throw new Error(`Invalid character entry: ${JSON.stringify(c)}`);
    }
    if (!/^#?[0-9a-fA-F]{6}$/.test(c.color.hex)) {
      throw new Error(`Bad hex for ${c.id}: ${c.color.hex}`);
    }
  }
}

function resolveImage(c) {
  if (c.image) return c.image;
  return placeholderDataUri(c);
}

// SVG card: dark neutral background, character initials inside a soft circle,
// character name beneath. The grayscale CSS filter is a no-op on this neutral
// art, but the reveal animation still pulses on success.
function placeholderDataUri(c) {
  const initials = c.name
    .split(/\s+/)
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const safeName = escapeXml(c.name);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1f2530"/>
      <stop offset="1" stop-color="#11151c"/>
    </linearGradient>
    <radialGradient id="ring" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0.6" stop-color="#2a3340"/>
      <stop offset="1" stop-color="#1a2030"/>
    </radialGradient>
  </defs>
  <rect width="800" height="600" fill="url(#bg)"/>
  <circle cx="400" cy="260" r="170" fill="url(#ring)" stroke="#3a4456" stroke-width="3"/>
  <text x="400" y="295" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif"
        font-size="140" font-weight="700" fill="#cfd6e2" letter-spacing="-3">${initials}</text>
  <text x="400" y="500" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif"
        font-size="44" font-weight="600" fill="#e6ebf2" letter-spacing="0.5">${safeName}</text>
  <text x="400" y="548" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif"
        font-size="18" fill="#7c8699" letter-spacing="2">PLACEHOLDER</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
