import { readFileSync } from 'node:fs';
import { buildGrid } from '../js/grid.js';

const chars = JSON.parse(readFileSync(new URL('../data/characters.json', import.meta.url), 'utf8'));
console.log('characters:', chars.length);

let errors = 0;
for (let i = 0; i < chars.length; i++) {
  const c = chars[i];
  if (!/^#[0-9A-Fa-f]{6}$/.test(c.color.hex)) {
    console.error('BAD HEX', c.id, c.color.hex);
    errors++; continue;
  }
  const g = buildGrid(c.color.hex, { rows: 5, cols: 5, seed: i + 1 });
  const cc = g.cells[g.correctRow][g.correctCol];
  const want = c.color.hex.toUpperCase();
  if (cc.hex !== want) {
    console.error(`MISMATCH ${c.id}: want ${want}, got ${cc.hex}`);
    errors++;
  }
  // Sanity: at least one neighbor should be different
  const dr = g.correctRow > 0 ? -1 : 1;
  const neighbor = g.cells[g.correctRow + dr][g.correctCol];
  if (neighbor.hex === cc.hex) {
    console.error(`NEIGHBOR EQUAL ${c.id}`);
    errors++;
  }
  console.log(`#${String(i + 1).padStart(2, '0')} ${c.name.padEnd(24)} ${want}  correct@(r${g.correctRow},c${g.correctCol})  topleft=${g.cells[0][0].hex}  bottomright=${g.cells[4][4].hex}`);
}
console.log(errors ? `\nFAIL ${errors}` : '\nALL OK');
process.exit(errors ? 1 : 0);
