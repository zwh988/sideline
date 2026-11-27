// Theme packs: a folder under public/themes/<id>/ with a theme.json and piece
// images. Replacing those files changes the look with no code changes.

export interface Theme {
  name: string;
  board: { light: string; dark: string };
  pieces: { folder: string; format: 'svg' | 'png' };
  highlights: { lastMove: string; selected: string; moveDot: string; check: string };
  /** The coach's colour, used by the UI only (buttons, the speech box), never on the board. */
  coach: { accent: string; accentStrong?: string; accentSoft?: string };
  /** The coach's faces, one file per mood (`<folder>/neutral.svg`, …). Without it the drawn face is used. */
  portraits?: { folder: string; format: 'svg' | 'png' };
  credits?: string;
}

/** A loaded pack: the theme and the folder its paths are relative to. */
export interface LoadedTheme {
  id: string;
  theme: Theme;
  base: string;
}

const cache = new Map<string, Promise<LoadedTheme>>();

/** The URL of a portrait for a mood, or undefined when the pack has none. */
export function portraitUrl(t: LoadedTheme, mood: string): string | undefined {
  const p = t.theme.portraits;
  return p ? `${t.base}${p.folder}/${mood}.${p.format}` : undefined;
}

/** Fetches a pack once (later calls reuse it) without applying it. */
export function fetchTheme(id: string): Promise<LoadedTheme> {
  let p = cache.get(id);
  if (!p) {
    const base = `${import.meta.env.BASE_URL}themes/${id}/`;
    p = fetch(`${base}theme.json`).then(async (res) => {
      if (!res.ok) throw new Error(`Theme "${id}" not found`);
      return { id, theme: (await res.json()) as Theme, base };
    });
    p.catch(() => cache.delete(id)); // a failed fetch can be tried again
    cache.set(id, p);
  }
  return p;
}

/** Loads a pack and applies it to the page (board, pieces, accent). */
export async function useTheme(id: string): Promise<LoadedTheme> {
  const t = await fetchTheme(id);
  applyLoaded(t);
  return t;
}

/** Applies a pack already fetched. */
export function applyLoaded(t: LoadedTheme): void {
  applyTheme(t.theme, t.base);
}

const ROLES = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' } as const;


/** Writes the theme into a <style> element that the board CSS reads. */
function applyTheme(t: Theme, base: string): void {
  const pieces = Object.entries(ROLES)
    .flatMap(([letter, role]) =>
      (['w', 'b'] as const).map(
        (c) =>
          `.cg-wrap piece.${role}.${c === 'w' ? 'white' : 'black'} { background-image: url('${base}${t.pieces.folder}/${c}${letter}.${t.pieces.format}'); }`,
      ),
    )
    .join('\n');

  const h = t.highlights;
  const css = `
:root {
  --coach-accent: ${t.coach.accent};
  --coach-accent-strong: ${t.coach.accentStrong ?? t.coach.accent};
  --coach-accent-soft: ${t.coach.accentSoft ?? `color-mix(in srgb, ${t.coach.accent} 15%, #fff)`};
  --board-light: ${t.board.light};
  --board-dark: ${t.board.dark};
}
cg-board {
  /* Checkerboard: the top-left square is light from either side. */
  background: repeating-conic-gradient(${t.board.dark} 0% 25%, ${t.board.light} 0% 50%) 0 0 / 25% 25%;
}
cg-board square.last-move { background-color: ${h.lastMove}; }
cg-board square.selected { background-color: ${h.selected}; }
cg-board square.move-dest { background: radial-gradient(${h.moveDot} 19%, transparent 20%); }
cg-board square.oc.move-dest { background: radial-gradient(transparent 79%, ${h.moveDot} 80%); }
cg-board square.move-dest:hover { background: ${h.moveDot}; }
cg-board square.check { background: radial-gradient(ellipse at center, ${h.check} 0%, transparent 75%); }
${pieces}`;

  let style = document.getElementById('theme-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'theme-style';
    document.head.append(style);
  }
  style.textContent = css;
}
