// Placeholder portraits for the six coaches (task 1.14): a disc in the coach's accent with the coach's
// name and mood written on it, one file per mood. They stand in until the real art exists; to replace
// them, drop files with the same names (or PNGs and set "format": "png" in theme.json) into
// public/themes/<id>/portraits/. Run: node scripts/make-portraits.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const MOODS = ['neutral', 'thinking', 'pleased', 'concerned', 'surprised'];

for (let n = 1; n <= 6; n++) {
  const dir = `public/themes/coach${n}`;
  const theme = JSON.parse(readFileSync(`${dir}/theme.json`, 'utf8'));
  const { accent, accentSoft } = theme.coach;
  mkdirSync(`${dir}/portraits`, { recursive: true });
  for (const mood of MOODS) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="${theme.name} looks ${mood}">
  <rect width="200" height="200" fill="${accent}"/>
  <circle cx="100" cy="100" r="78" fill="${accentSoft}"/>
  <text x="100" y="94" text-anchor="middle" font-family="system-ui, sans-serif" font-size="30" font-weight="800" fill="${accent}">${theme.name}</text>
  <text x="100" y="128" text-anchor="middle" font-family="system-ui, sans-serif" font-size="24" font-weight="600" fill="#1f2421">${mood}</text>
</svg>
`;
    writeFileSync(`${dir}/portraits/${mood}.svg`, svg);
  }
}
console.log('Wrote placeholder portraits for 6 coaches.');
