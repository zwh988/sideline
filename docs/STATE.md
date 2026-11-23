# Project state

Last updated: 2026-11-23, after task 1.5 (Explain your idea: lines).

## Summary

Roadmap phase 1 (coached game MVP) is about half done. You can play a full game against a Maia opponent at your level. The coach speaks on rule-based triggers (tactic available, threat, mistake with takeback offer, praise, phase prompts) and gives 4-step hints, all from board-checked facts. The coach also thinks aloud on its own moves (how it answered your threat, its captures, the idea behind a quiet move), honestly and under the comment budget. Two modes: Lesson (all of the above, takebacks) and Sparring (serious moments only, hints on request, no takebacks, no thinking aloud). You can view earlier positions. You can show a line with tap-arrows ("Explain") and the coach checks it against Stockfish. Not yet built: plans (free text), branches.

## Done

| Commit | What |
|---|---|
| `1edfd35` | Scaffold: Vite + TypeScript + chess.js |
| `1bf22ac` | Feasibility test 1: Stockfish WASM |
| `1c8af6b` | Feasibility test 2: Maia3 in the browser |
| `1ac2764` | Feasibility test 3: WebLLM coach voice |
| `c725e00` | MVP slice 1: playable game vs Maia, theme pack, tap-to-move, takeback, promotion, phone layout |
| `0d01f06` | MVP slice 2: fact extractor, line cutting, analyst, coach triggers, hint ladder, `?fen=` start, Vitest (24 tests) |
| `481c003` | Coach thinks aloud on its own moves: `narration.ts` facts, `narrateCoachMove` templates, `Coach.onCoachMove`, wired into the game screen (43 tests) |
| `3ea2002` | Lesson and Sparring modes: `modes.ts`, mode passed to `Coach`, Mode select remembered in `sideline.settings`, Take back hidden in Sparring (53 tests) |
| `a424f47` | Hung pawns and pieces below the level's mistake size are flagged in Lesson, when the evaluation confirms the loss (58 tests) |
| `08f8738` | Mistake remarks say why taking back fails (`failedRecapture`) (64 tests) |
| (after 1.4b) | Move navigation: `navigation.ts`, remark log in the bubble, tap buttons, move-list taps, keys (87 tests) |
| (after 1.5) | Explain your idea (lines): `lines-input.ts` (tap-arrow state), `linecheck.ts` (move-by-move check), verdict wording in `templates.ts`, Explain button + arrow bar in the game screen (106 tests) |
| (after 1.4) | Praise for a sound sacrifice; hung threshold 0.9 per pawn; the engine's top move is never a mistake (72 tests) |

## Feasibility results (desktop only so far)

Measured on the developer's PC (16 cores, Intel Iris Xe-class integrated GPU).

- **Stockfish 19 Lite, single-threaded WASM:** ~1.9 MB, loads in ~0.1 s, depth 18 in under 0.7 s. MultiPV works (used for "forced" checks). Strength options exist for the fallback opponent.
- **Maia3 5M (maia3-js, ONNX wasm):** 22.6 MB model, ~23 ms per move. Plays clearly weaker as rating drops down to ~600 Lichess; at 400 it becomes erratic (out of training range). Levels use 600 as the floor.
- **WebLLM coach voice:** Llama 3.2 1B made up facts; Qwen3.5 2B was close (5–10 s per comment, good at JSON plan extraction, but mixed up whose piece is whose); Qwen3 4B was better but too slow (~2 tokens/s). Conclusion: templates are the main voice; a model may rephrase or extract structure only.

## How things were verified

- 43 unit tests (`npm test`) on real positions: facts, line cutting, templates, coach-move narration (threat moved away / defended / attacker taken / blocked / mate stopped, recapture, free piece, en passant, check, develop, centre pawn, castling, silence on a mistake).
- Browser checks with `?fen=`: knight fork (trigger, 4 hints, praise held through the combination); Scholar's mate defense (threat warning, mistake + takeback); defended queen attacked by a knight (Levels 1 and 2).
- A scripted full game (Maia vs Maia at 800, coach watching one side): 6 remarks in 20 moves, all accurate; ~0.35 s analysis per move.
- Task 1.3, scripted Maia vs Maia (Level 2, 60 plies, coach = Black, a second Stockfish judging each coach move): the coach narrated 11 of its 30 moves; each claim checked by hand against the position. Examples: "After your g3, you were threatening to win a queen with gxh4. Qxe4+ moves my queen out of danger."; "…So I took your knight on b6 first."; "Your pawn on b2 wasn't defended, so I took it, with check." Moves that lost 150–580 cp got no narration, or plain facts only (e.g. O-O losing 3.5 pawns: no "reason" given).
- Hung material (decision 12): 5 unit tests (the real-game position at Levels 1 and 2, compensation below the eval threshold, an even trade 2.exd5 Qxd5, Sparring). In the browser with the real engine, 6.d4 now gives "Careful: after d4, I can play exd4, which takes the pawn. That would win a pawn. Want to take it back?" with Take back / Play on. False-positive check with the real coach at Level 2: Scandinavian, Italian (with cxd4, Nxc3 bxc3 trades) and QGD (cxd5 exd5) lines, 22 player moves, no remark.
- Sacrifice praise (decision 14): 8 unit tests (Greek gift accepted, declined, and with a jumping evaluation; Queen's Gambit 2.c4; Sparring; Evans Gambit; Italian 5.d4; an even trade). Real engine, two fresh runs each, Level 2: Greek gift praised; QG 2.c4 praised; Evans, King's Gambit, Italian 5.d4, Morra 3.c3 quiet; 6.d4 hung pawn and 5.Bc4?? still flagged; Scandinavian, Italian and QGD lines otherwise quiet.
- "Why taking back fails" (decision 13): 6 unit tests for `failedRecapture` (the real-game d4 case; recapture works; no recapture; a rook behind the queen retakes; a rook taking a queen still pays; two recaptures) and the full remark text. Real engine in the page console: 6.d4 → "…That would win a pawn: if you recapture with Qxd4, I take your queen with Qxd4. Want to take it back?"; 5.Bc4?? unchanged.
- Task 1.4: 10 unit tests in `coach.test.ts` run the real trigger rules on hand-checked positions with a scripted fake analyst (knight fork, 5.Bc4?? in the Scotch losing the queen to Nxd4, a bishop threatening a loose knight, the opening): each trigger compared between Lesson and Sparring.
- Task 1.4 in the browser: Sparring with the fork FEN (`r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1`): no prompt, no Take back button, Hint gave step 1 ("There's a tactic in this position."). Sparring with `r1bqkbnr/ppp2ppp/2np4/8/3QP3/5N2/PPP2PPP/RNB1KB1R w KQkq - 1 5`, 5.Bc4: "Careful: Bc4 gives me a chance to win material.", no arrow, no takeback offer, the coach played Nxd4 without narrating. Switched to Lesson in the select (status "Lesson mode set. It applies from your next game.", saved in `localStorage`), new game, same move: full explanation with arrow, Take back / Play on, Take back button shown. No console errors.
- Task 1.3 in the game screen: after 1.e4 the coach said "I'm putting a pawn in the centre, on e5."; with `?fen=4k3/p7/5n2/8/8/8/2P1K3/2B5 w - - 0 1`, after Bb2 Ne4: "After your Bb2, you were threatening to win a knight with Bxf6. Ne4 moves my knight out of danger." No console errors.

- Task 1.4b: 15 unit tests in `navigation.test.ts` (clamping, snap to live, new move while viewing, takeback while viewing, ply labels incl. the Greek-gift FEN, remark log). Browser, Greek gift in Lesson (`?fen=rnbq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 7`, Bxh7+): "Bold!…" stays in the bubble after Kxh7; « ‹ buttons, Home key and a tap on a move-list cell show the position with "Viewing 7.Bxh7+" bar, check highlight, Hint/Take back disabled; tapping the last move returns to live. A case where the coach narrates after a remark (two entries in the log) is only covered by unit tests, and a coach move arriving while viewing was not tried live. Not tried on a real Galaxy Z Fold 7: all controls are buttons (48px tall), the emulated 390px phone viewport looked right.

- Task 1.5: 10 tests in `lines-input.test.ts` (select/move/invalid/reselect/undo/promotion/full/game over/load+truncate) and 9 in `linecheck.test.ts` (scripted engine over real positions: knight fork good line, 5.Bc4?? refuted with Nxd4, refuted at a later move, a better opponent reply, "both already lost" and slower-mate cases, a weaker move that keeps the edge, labels). Browser (real engine), emulated 390px phone and 600px: the knight fork entered by real taps (illegal d6 shows a red arrow + "That's not a legal move for the knight."; numbered green/blue arrows; Done → "Good line!… +6.9"); Greek gift (`?fen=rnbq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 7`): good line 1.Bxh7+ Kxh7 2.Ng5+ Kg6 3.h4 (all engine top moves, +6.2); refuted 3.Qg4 ("I'd answer with f5, … -3.8 for me"); better reply (expecting Kg8: "Kg6 is a better reply… +7.8 … but only +3.9"); 7.Ba6 refuted ("Nxa6, winning a bishop"); 7.O-O + Bxc3 flagged as a better reply (f6). Black orientation taps checked on a flipped board. Navigation: Explain is disabled while viewing an earlier position, the « ‹ › » buttons are hidden and arrow keys ignored in arrow mode, Esc cancels. Checking a 5-move line takes about 3 s on desktop. Not tried on a real Galaxy Z Fold 7; no console errors seen.

## Decisions (differ from or add to the spec)

These should be folded into the spec (see PLAN, task "Spec sync").

1. **Templates are the coach's main voice**, not the in-browser model (feasibility test 3). The model's role: rephrase templates, extract structured claims from typed plans, persona flavour.
2. **Opponent rating floor is 600 Lichess** (Maia erratic below ~500). Level 1 is made easier by the coach, not a weaker Maia.
3. **Line cutting rule 1 ("stays changed")** = material holds for 4 plies after the cut. Losses later in the engine line are reported honestly ("you may give some of it back").
4. **Line cutting rule 2 ("nothing left to settle")** = no capture pending. Checks or threats after the cut only block it if they win material back (spite checks are ignored).
5. **"Loose piece" (Level 1 piece safety)** = a capture, optionally followed by a recapture: covers undefended pieces and pieces attacked by a cheaper one.
6. **Patterns per level** (`levels.ts`): L1 loose piece, mate in 1; L2 + fork, mate in 2; L3 + discovered attack, general material wins; L4+ + longer mates. Pins and skewers aren't detected yet.
7. **Licensing:** Stockfish and chessground are GPL-3.0, so the app will be GPL open source in a public repo (also fits free GitHub Pages).
8. **Games can start from any position** (`?fen=` for now), the base for "start from repertoire positions".
9. **Thinking aloud (task 1.3):** the coach narrates (a) the player's threat (a teachable line from the analyst's "pass" check) and how its move answered it, only when the engine confirms the threat is gone; (b) its captures (recapture, free piece, en passant, with check) and promotions; (c) quiet-move ideas (castling, developing, a centre pawn) in the first 24 plies, each at most once or twice a game. It **never rates its own move**: no "good/best/strong" wording at all, and no purposeful-sounding reason for a move that lost the level's mistake threshold (move quality vs Stockfish is computed in `narration.ts`). Its own new threats aren't narrated: within the player's level the existing "what does my last move want?" question covers them, beyond it they stay silent (rule 3). Candidate moves ("I considered…") aren't narrated yet.
10. **Narration budget:** a threat it answered may be said 2 plies after the last remark, a capture 4, a quiet idea 6 (the general budget). Narration and the player-turn remark share one bubble (`joinRemarks`).
11. **Modes (task 1.4).** The mode is a set of switches in `modes.ts`; changing it applies from the next game (like the level). Sparring:
    - **Silent:** the unasked prompts ("There's something strong here", "what does my last move want?"), phase prompts, "Good, you saw my threat", and all thinking aloud on its own moves (its captures and ideas count as revealing its plans; the moves speak for themselves).
    - **Kept as serious moments:** a mistake within the player's level is flagged without naming the refutation or drawing an arrow ("Careful: Bc4 gives me a chance to win material." / "…to checkmate you."); a missed tactic ("You had something stronger than a3 here."); short praise for finding a tactic.
    - **Hints** only from the Hint button, starting at step 1 (in Lesson the tactic prompt counts as step 1).
    - **No takebacks:** the button is hidden, no offer, and the loss message doesn't suggest taking back.

12. **Hung material is flagged below the mistake size (Lesson).** Found in play: at Level 2, 6.d4? in `rnb1kb1r/ppp2ppp/8/3qp3/8/3P4/PPP2PPP/R1BQKBNR w KQkq - 0 6` just drops a pawn (−0.42 → −1.73), but the coach was silent because the level's mistake size is 2.5 pawns and its smallest taught gain 3. Now a move is also flagged when (a) the engine's best reply wins material as a loose piece or pawn (`hanging-piece` pattern: a capture, maybe a recapture, at least 1 pawn), **and** (b) the evaluation drops by at least 0.9 pawns per pawn won (`HUNG_CP_PER_PAWN`; first 0.7, raised because Stockfish rates the Evans Gambit 4.b4 0.74 and the King's Gambit 2.f4 0.67 worse than the best move). (b) keeps even trades, gambits and sacrifices quiet. Same "Careful: after d4, I can play exd4…" remark and takeback offer as a mistake. Sparring skips it (`Mode.minorMistakes`): it flags only the level's real mistakes. A sound sacrifice or gambit (the evaluation holds) is deliberately not called a mistake; an unsound one is flagged like any hung material. The engine's own top move is never flagged (evaluations of sharp positions jump between searches).
13. **Why taking back fails.** When the refutation is a single capture of a defended piece, the mistake remark says why the player can't just take back, if board code shows it (`failedRecapture` in `facts.ts`): exactly one legal recapture, the coach takes the recapturing piece on the same square, the player can't take again, and the recapturing piece is worth more than what it won. "That would win a pawn: if you recapture with Qxd4, I take your queen with Qxd4." Longer exchanges, two ways to take back, or reasons elsewhere on the board get no "why" (attacker/defender counting is a possible next step).
14. **Praise for a sound sacrifice (Lesson).** So the player learns when a move that gives material is good. Two checks: (a) board facts: the move *offers* material, i.e. the coach can legally take the moved piece and the player can't win back as much on that square (their own capture plus at most one recapture of the taker), at least a pawn net; (b) the engine: the move is its top move or within 0.6 pawns of it (`FOUND_CP`). "Bold! Bxh7+ offers your bishop for a pawn, but the engine rates it among the best moves here. Can you see what you get for it?" Whether the engine would accept the offer doesn't matter (for the Greek gift it sometimes declines with Kh8). Found tactics within the level keep their own praise. Pawn breaks retaken at once (Italian 5.d4 exd4 cxd4, Morra 3.c3 dxc3 Nxc3) and gambits worth less than the best move (Evans, King's Gambit) get nothing.

15. **Explain your idea (task 1.5).**
    - **Live position only.** Explain is disabled while viewing an earlier position, and arrow mode blocks move navigation. `LineInput` takes any `rootFen`, so 1.6 can lift this and start a line (or branch) from a viewed position.
    - **Line state = `Line { rootFen, moves: LineMove[] }`** (`lines-input.ts`); each `LineMove` has from/to/promotion/uci/san and `mine`. The player's moves are the ones at even index (the player moves first); the opponent's replies are entered by tapping their pieces too. `LineInput` has `undo`, `truncate(n)` and `load(moves)`, which is what branches need (keep a prefix, fork). The game screen keeps the last checked line (`lastLine`) for "Change my line". For 1.6: a branch can start from `input.line`; the verdict is a pure function of the line (`checkLine`), so a branch can reuse it per move.
    - **Max 8 moves** per line (checking costs one search per position; the longer "play it out" case is the branch of 1.6).
    - **Verdict rules** (`linecheck.ts`, one Stockfish search per position, the value of a move = the negated score after it, compared with the best move's score): first problem along the line decides. (a) *Refuted at move N*: the player's move is worth ≥1.5 pawns less than the best move **and** leaves them under +1.0 (a weaker move that keeps an edge isn't "refuted"; the good-line text mentions the stronger move instead). The "why" is the opponent's best reply, with what it wins (taught line, `winsPhrase`) or else the engine score. (b) *The opponent has a better reply*: their move in the line is worth ≥1.5 pawns less than their best, so the line doesn't force it; the better reply and both scores are given. (c) *Good line*: nothing above; says what it wins/mates and the engine score. Ignored on purpose: a mate that is only slower, and differences when both moves leave a side at +5.0 or worse.
    - **Honesty:** wording says "the engine agrees / rates", never "correct". Scores are always labelled for whom (`+1.4 for you`).
    - **Lesson:** a tactic prompt also shows a "Show me your idea" button (`Remark.offerExplain`); the Explain button is always there (also in Sparring: the player asks for it, so it isn't unasked talk). Not done: asking for an explanation at other key moments.
    - Arrows: green = your move, blue = their reply, numbered; after a verdict the board keeps the arrows up to the failing move, with the better reply in red.

## Known issues and gaps

- Explain: the verdict arrows are drawn on the position before the line, so a piece that moves twice (e.g. a queen) has its second arrow start from an empty square. Plans (free text, AI model structure) are not built, and a line can't yet be played out as a branch (1.6). Promotion inside a line is untested by clicking. An opponent's move that is "worse than best" is reported even when both choices are bad for them but one is much less bad (e.g. +7.8 vs +3.9 for the player): that is true by the engine, but may feel picky at low levels.
- Foldable / small-tablet widths (760–~900 px) break the two-column layout (board cut off at 790 px wide). Planned in task 1.8.
- The Queen's Gambit (2.c4) gets "Bold!" praise every game: true by the facts, but it's standard theory, not daring. Planned: task 1.7b names known openings and gambits (for either side) instead.
- Sacrifice praise only looks at the moved piece; a move that leaves a *different* piece to be taken on purpose isn't praised.
- Hung material uses only the engine's best line: if the best reply is something else stronger, a hung pawn isn't named (the bigger problem may be, if it's within the level).
- **Phone not tested yet** for any engine or the UI on a real device (only the emulated phone viewport).
- Promotion picker and the end-of-game screen are untested by clicking.
- File letters (a–h) sit under the pieces on the first rank and are hard to read.
- Pins and skewers aren't detected (no `pin`/`skewer` motif), so those tactics are silent even at Level 3+.
- Line cutting stops at a drawn position (e.g. after a capture leaves K+B vs K, chess.js says insufficient material), so a capture that is immediately recaptured can look like a win there. Seen with a test FEN; rare in real games.
- A plain recapture after an even trade can be flagged as a "tactic" (seen in the scripted game: after 24…Rxd1 the coach said "There's something strong here" for Kxd1, praised as "that rook was free"). Comes from `coach.ts`/`lines.ts` (task 1.2), not the narration.
- Narration waits for the player-turn analysis plus a threat check (about 3 Stockfish searches); fine on desktop, not measured on a phone.
- The coach doesn't narrate candidate moves or longer plans yet (spec: "its candidates"). When it does, Lesson only (`Mode.revealsPlans`).
- Sparring is quiet by design; whether it feels too quiet (no word on the coach's captures) needs real play-testing. Review mode (later) is where Sparring games get explained.
- Changing the mode mid-game has no effect until "New game"; a player may expect it to apply at once.
- Hints used are counted (`Coach.hintsUsed`) but not stored anywhere.
- No game persistence: a reload loses the game.
- Phone layout: the coach bubble sits below the full-width board and is barely visible without scrolling (planned in task 1.8).
- Maia3 weights' license is unstated (code is AGPL-3.0; maia3-js is MIT by an individual). Ask CSSLab before a public release.
- The spec doesn't yet reflect the decisions above.
- `npm warn install-scripts` appears on install; harmless so far.

## Environment

- Windows, Node 24, npm 11. Git repo on `main`, no remote yet. `gh` CLI not installed.
- Dev server may land on port 5174 if 5173 is taken.
