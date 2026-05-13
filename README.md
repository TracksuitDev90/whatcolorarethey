# Coloration

A daily color guessing game. Each day, the puzzle presents an iconic character or item and asks you to pick the right shade — one round at a time, the same set for everyone, reset at UTC midnight.

## How to play

Two modes share the same daily run:

- **Items** — a 2×2 swatch picker. Four distinct colors, one guess.
- **Characters** — a 4×4 shade grid centered on the right hue. Three guesses; after the second miss, the row and column containing the answer light up.

Each mode allows up to **2 skips per day**. A skipped round is neutral against your streak but still uses the slot. Progress persists per UTC day in `localStorage`, so refreshing mid-puzzle picks up where you left off; the next UTC midnight starts a fresh set.

When the run ends, you can save a share image, copy a result-link (a read-only view of your day), or copy an emoji-style summary.

## Run locally

This is a static site that uses ES modules, so it must be served — opening `index.html` directly via `file://` won't work.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, `caddy file-server`, etc.).

## Project layout

```
index.html             - shell + meta
styles.css             - all styles
manifest.webmanifest   - PWA metadata
robots.txt             - crawler directives
js/
  main.js              - entry, init, UI wiring
  game.js              - daily-game state + persistence
  characters.js        - loads data/characters.json + data/items.json
  daily.js             - UTC date keying + daily character selection
  grid.js, quad.js     - board generators
  share.js             - share-card canvas + emoji/url encoding
data/
  characters.json      - character roster
  items.json           - item roster
assets/
  photos/              - per-character photos (referenced from JSON)
  favicon.svg          - source icon (PNG sizes derived from it)
  og-image.png         - social-share preview (1200×630)
scripts/               - one-off Python/Node tooling for asset prep
```

## Before deploying

A handful of release values are placeholders. Search for `TODO_PRODUCTION_URL` and swap in the canonical site URL (in `index.html` `<head>`, `robots.txt`).

## License

See [LICENSE](LICENSE).
