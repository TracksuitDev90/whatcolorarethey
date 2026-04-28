// Loads characters.json and resolves each character's image source.
// If a local image is provided in `image`, use it. Otherwise fall back to a
// stylized SVG silhouette card so the game ships playable without bundling
// copyrighted images. Users can drop real images into assets/characters/<id>.webp
// and add an `image` field per entry to upgrade.

export async function loadCharacters() {
  const res = await fetch('data/characters.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`characters.json: ${res.status}`);
  const list = await res.json();
  validate(list);
  return list.map(c => ({ ...c, imageSrc: resolveImage(c) }));
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
