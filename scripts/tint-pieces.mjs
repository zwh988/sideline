// Tinted piece sets per coach (task 1.14b): each theme pack whose theme.json has
// "pieces": { "source": "../pieces/<set>", "tint": { "white": { "fill", "line" }, "black": { "fill", "line" } } }
// gets a copy of the source set in its own "folder", with the set's white fill and outline and its black fill
// replaced by the coach's colours. The source sets are one-colour line art (mpchess: white #fff with a #000
// outline, black solid #000). Run after changing a tint or the source: node scripts/tint-pieces.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const THEMES = 'public/themes';
const ROLES = ['K', 'Q', 'R', 'B', 'N', 'P'];

for (const id of readdirSync(THEMES)) {
  let theme;
  try {
    theme = JSON.parse(readFileSync(join(THEMES, id, 'theme.json'), 'utf8'));
  } catch {
    continue; // not a pack (the shared piece sets live here too)
  }
  const { source, tint, folder } = theme.pieces ?? {};
  if (!source || !tint) continue;
  const from = resolve(THEMES, id, source);
  const to = resolve(THEMES, id, folder);
  mkdirSync(to, { recursive: true });
  for (const side of ['w', 'b']) {
    const c = side === 'w' ? tint.white : tint.black;
    for (const r of ROLES) {
      let svg = readFileSync(join(from, `${side}${r}.svg`), 'utf8');
      if (side === 'w') {
        svg = svg.replace(/fill:#fff(?:fff)?\b/gi, `fill:${c.fill}`).replace(/stroke:#000(?:000)?\b/gi, `stroke:${c.line}`);
      } else {
        // Black: solid shapes (#000000…#000004 in mpchess), outlined in the line colour if one is given.
        svg = svg.replace(/fill:#0000[0-9a-f]{2}\b|fill:#000\b/gi, `fill:${c.fill}`).replace(/stroke:(?:none|#000(?:000)?)\b/gi, `stroke:${c.line ?? 'none'}`);
      }
      writeFileSync(join(to, `${side}${r}.svg`), svg);
    }
  }
  console.log(`${id}: ${folder} from ${source}`);
}
