// The coach's words, formatted to be skimmed: moves and squares as chips, the key ideas in bold. Formatting
// only: the text is split, never changed, so the words stay exactly what the templates said (rule 1).

export type Segment = { kind: 'text' | 'move' | 'key'; text: string };

/** A move ("14.Bc4", "11…Nbd7", "Nxe5+", "O-O", "e8=Q#") or a square ("e4"). */
const MOVE = String.raw`(?:\d+(?:\.|…|\.\.\.)\s?)?(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8]|[a-h][1-8])(?:=[QRBN])?[+#]?`;

/** The ideas worth catching the eye: the chess concepts the coach names, and how much something is worth. */
const KEYS = [
  String.raw`mate in \d+`,
  'checkmate',
  'stalemate',
  'smothered mate',
  'back[- ]rank mate',
  'discovered (?:attack|check)',
  'double check',
  'forks?',
  'pins?',
  'pinned',
  'skewers?',
  'hanging',
  'trapped',
  'deflection',
  'attraction',
  'intermezzo',
  'sacrifices?',
  'free (?:pawn|knight|bishop|rook|queen|piece)',
  String.raw`(?:about )?\d+(?:\.\d+)? pawns?`,
];

// A percentage (accuracy) is a key too; it ends in a non-word character, so it sits outside the \b pair.
const PATTERN = new RegExp(String.raw`(?<![\w…])(${MOVE})(?![\w=])|\b(${KEYS.join('|')})\b|(?<![\w.])(\d+%)`, 'gi');

/** Splits the coach's text into plain runs, moves and key words. Joined back, the segments are the text. */
export function richSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(PATTERN)) {
    const start = m.index!;
    // A move is case-sensitive (a capital is a piece; "A1" is not a square); key words are not.
    if (m[1] !== undefined && !new RegExp(`^${MOVE}$`).test(m[1])) continue;
    if (start > at) out.push({ kind: 'text', text: text.slice(at, start) });
    out.push({ kind: m[1] !== undefined ? 'move' : 'key', text: m[0] });
    at = start + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}
