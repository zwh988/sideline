// Test tasks for the in-browser coach voice. Each task gives the model only
// facts (as the future fact extractor would produce them) and asks for words.
// The lines are verified with chess.js before use, so the facts are true.
import { Chess } from 'chess.js';

export const SYSTEM_PROMPT = `You are a warm, patient chess coach talking to a beginner (rated about 500).
Rules:
- Use ONLY the facts you are given. Never add moves, squares, pieces or evaluations that are not in the facts.
- Plain words, short sentences. No engine numbers.
- At most 3 sentences unless told otherwise.`;

export interface Task {
  name: string;
  /** What a good answer must do, shown next to the output for judging. */
  goal: string;
  /** Moves (SAN) from `fen` checked with chess.js; the last one's flags too. */
  verify: { fen: string; line: string[]; lastIs?: 'checkmate' | 'check' };
  prompt: string;
  /** Words or moves the answer must not contain (e.g. a hint giving away the answer). */
  forbidden?: string[];
  /** If set, the answer is constrained to JSON matching this schema. */
  jsonSchema?: object;
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    move: { type: 'string' },
    piece: { type: 'string' },
    target: { type: 'string' },
    reason: { type: 'string' },
    condition: { type: ['string', 'null'] },
  },
  required: ['move', 'piece', 'target', 'reason', 'condition'],
};

const SCHOLAR_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
const FORK_FEN = 'r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1';
const ITALIAN_FEN = 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 0 7';

export const TASKS: Task[] = [
  {
    name: 'Explain a mistake (Scholar’s mate)',
    goal: 'Says why 3…Nf6 lost: it did not stop Qxf7#. Mentions the queen and bishop aiming at f7. Ends with one question.',
    verify: { fen: SCHOLAR_FEN, line: ['Qxf7#'], lastIs: 'checkmate' },
    prompt: `The player is Black. Moves so far: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6.
Facts:
- 3...Nf6 was a mistake. White now plays 4.Qxf7#, checkmate.
- Before Black's move, White threatened Qxf7#: the queen on h5 and the bishop on c4 both attack the pawn on f7.
- The pawn on f7 was defended only by the king on e8. The king cannot take the queen on f7, because the bishop on c4 protects it.
- Better was 3...g6, which attacks the queen and blocks its path to f7, or 3...Qe7, which defends f7.
- Pattern: mate threat on f7.
Task: In 2-3 short sentences, explain why 3...Nf6 lost. Then ask one question that helps the player spot this threat next time.`,
  },
  {
    name: 'Praise a tactic (knight fork)',
    goal: 'Short praise that names the fork: the knight checks the king and attacks the rook at the same time.',
    verify: { fen: FORK_FEN, line: ['Nxc7+', 'Kd7', 'Nxa8'] },
    prompt: `The player is White and just played 1.Nxc7+.
Facts:
- 1.Nxc7+ captures a pawn on c7 and gives check.
- From c7 the knight attacks the king on e8 and the rook on a8 at the same time. This is a fork.
- Black must move the king; no black piece can capture the knight on c7.
- After 1...Kd7 2.Nxa8, White has won a rook and a pawn.
- Pattern: knight fork (double attack).
Task: Praise the move in 1-2 short sentences and name the pattern.`,
  },
  {
    name: 'Hint without revealing (step 2 of 4)',
    goal: 'Points at the black king and rook only. Must NOT mention the knight, c7 or the move.',
    verify: { fen: FORK_FEN, line: ['Nxc7+'], lastIs: 'check' },
    prompt: `The player is White, to move, and asked for a hint.
Facts:
- There is a tactic in this position that wins material.
- Where to look: Black's king on e8 and Black's rook on a8.
Task: Give a hint in 1-2 short sentences. Tell the player only WHERE to look (the king and the rook).
Do NOT name any White piece, any move, or any square other than e8 and a8. Do not give the answer.`,
    forbidden: ['knight', 'Nxc7', 'c7', 'Nc7', 'fork'],
  },
  {
    name: 'Turn a plan into a structured claim (JSON)',
    goal: 'Valid JSON: move Re1, piece rook, target e-file, reason the file opens, condition the central pawns are traded.',
    verify: { fen: ITALIAN_FEN, line: ['Re1'] },
    prompt: `The player is White. They typed this idea for their next move:
"I want to play Re1 because if the middle pawns get traded the e file opens up and my rook will be ready"
Task: Convert the player's idea into JSON with exactly these keys:
{"move": SAN move, "piece": piece that moves, "target": file, square or piece the plan aims at,
 "reason": what the player expects to happen, "condition": what must happen first, or null}
Only restate what the player said. Do not judge whether it is a good idea. Output only the JSON.`,
    jsonSchema: PLAN_SCHEMA,
  },
];

/** Plays each task's line with chess.js; throws if a "fact" is not true on the board. */
export function verifyTasks(): void {
  for (const t of TASKS) {
    const board = new Chess(t.verify.fen);
    for (const san of t.verify.line) board.move(san); // throws on an illegal move
    if (t.verify.lastIs === 'checkmate' && !board.isCheckmate()) throw new Error(`${t.name}: not checkmate`);
    if (t.verify.lastIs === 'check' && !board.inCheck()) throw new Error(`${t.name}: not check`);
  }
}

const SQUARE = /\b[a-h][1-8]\b/g;
const MOVE = /\b(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8])[+#]?|O-O(?:-O)?/g;
const EVAL = /[+-]\d+\.\d+/g;

/**
 * Cheap claim check: every square and move the answer mentions must appear in
 * the facts, and forbidden words must not appear. Returns problems found.
 */
export function checkAnswer(task: Task, answer: string): string[] {
  const problems: string[] = [];
  const allowed = new Set([...(task.prompt.match(SQUARE) ?? []), ...(task.prompt.match(MOVE) ?? [])]);
  const unknown = new Set(
    [...(answer.match(MOVE) ?? []), ...(answer.match(SQUARE) ?? [])].filter((x) => !allowed.has(x)),
  );
  if (unknown.size) problems.push(`mentions not in the facts: ${[...unknown].join(', ')}`);
  const evals = answer.match(EVAL);
  if (evals) problems.push(`engine numbers: ${evals.join(', ')}`);
  for (const word of task.forbidden ?? []) {
    if (answer.toLowerCase().includes(word.toLowerCase())) problems.push(`gives away "${word}"`);
  }
  if (task.jsonSchema) {
    try {
      const obj = JSON.parse(answer);
      if (obj.move !== 'Re1') problems.push(`move is ${JSON.stringify(obj.move)}, expected "Re1"`);
    } catch {
      problems.push('not valid JSON');
    }
  }
  return problems;
}
