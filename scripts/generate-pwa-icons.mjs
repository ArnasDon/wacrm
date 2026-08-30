// Generates the PWA icon set from the brand mark (violet rounded square +
// white chat-square glyph — matches src/app/icon.tsx / the sidebar logo).
// Run once and commit the PNGs: `node scripts/generate-pwa-icons.mjs`
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const VIOLET = '#7c3aed';
const GLYPH = 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z';

/** @param {number} size @param {boolean} maskable */
function svg(size, maskable) {
  // "any": rounded square that fills the canvas, glyph ~46% of size.
  // "maskable": full-bleed square (OS masks the shape), glyph pulled in
  // to ~40% so it survives an aggressive circular mask (safe zone ~80%).
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const glyph = maskable ? size * 0.4 : size * 0.46;
  const gx = (size - glyph) / 2;
  const gy = (size - glyph) / 2;
  const stroke = Math.max(1.5, (glyph / 24) * 2.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${VIOLET}"/>
  <g transform="translate(${gx} ${gy}) scale(${glyph / 24})">
    <path d="${GLYPH}" fill="none" stroke="#ffffff" stroke-width="${(stroke * 24) / glyph}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

async function png(size, maskable, out) {
  await sharp(Buffer.from(svg(size, maskable))).png().toFile(out);
  console.log('wrote', out);
}

await mkdir('public/icons', { recursive: true });
await png(192, false, 'public/icons/icon-192.png');
await png(512, false, 'public/icons/icon-512.png');
await png(192, true, 'public/icons/icon-maskable-192.png');
await png(512, true, 'public/icons/icon-maskable-512.png');
// Apple touch icon: iOS ignores maskable + transparency; use the "any" look.
await png(180, false, 'public/icons/apple-icon-180.png');
