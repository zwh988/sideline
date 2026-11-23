# Project state

Last updated: 2026-11-23, after task 1.4 (Lesson and Sparring modes).

## Summary

Roadmap phase 1 (coached game MVP) is about half done. You can play a full game against a Maia opponent at your level. The coach speaks on rule-based triggers (tactic available, threat, mistake with takeback offer, praise, phase prompts) and gives 4-step hints, all from board-checked facts. The coach also thinks aloud on its own moves (how it answered your threat, its captures, the idea behind a quiet move), honestly and under the comment budget. Two modes: Lesson (all of the above, takebacks) and Sparring (serious moments only, hints on request, no takebacks, no thinking aloud). Not yet built: move navigation, "Explain your idea", branches.

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
| (task 1.4) | Lesson and Sparring modes: `modes.ts`, mode passed to `Coach`, Mode select remembered in `sideline.settings`, Take back hidden in Sparring (53 tests) |

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
- Task 1.4: 10 unit tests in `coach.test.ts` run the real trigger rules on hand-checked positions with a scripted fake analyst (knight fork, 5.Bc4?? in the Scotch losing the queen to Nxd4, a bishop threatening a loose knight, the opening): each trigger compared between Lesson and Sparring.
- Task 1.4 in the browser: Sparring with the fork FEN (`r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1`): no prompt, no Take back button, Hint gave step 1 ("There's a tactic in this position."). Sparring with `r1bqkbnr/ppp2ppp/2np4/8/3QP3/5N2/PPP2PPP/RNB1KB1R w KQkq - 1 5`, 5.Bc4: "Careful: Bc4 gives me a chance to win material.", no arrow, no takeback offer, the coach played Nxd4 without narrating. Switched to Lesson in the select (status "Lesson mode set. It applies from your next game.", saved in `localStorage`), new game, same move: full explanation with arrow, Take back / Play on, Take back button shown. No console errors.
- Task 1.3 in the game screen: after 1.e4 the coach said "I'm putting a pawn in the centre, on e5."; with `?fen=4k3/p7/5n2/8/8/8/2P1K3/2B5 w - - 0 1`, after Bb2 Ne4: "After your Bb2, you were threatening to win a knight with Bxf6. Ne4 moves my knight out of danger." No console errors.

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

## Known issues and gaps

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
- No way to view earlier positions (planned as task 1.4b).
- Phone layout: the coach bubble sits below the full-width board and is barely visible without scrolling (planned in task 1.8).
- Maia3 weights' license is unstated (code is AGPL-3.0; maia3-js is MIT by an individual). Ask CSSLab before a public release.
- The spec doesn't yet reflect the decisions above.
- `npm warn install-scripts` appears on install; harmless so far.

## Environment

- Windows, Node 24, npm 11. Git repo on `main`, no remote yet. `gh` CLI not installed.
- Dev server may land on port 5174 if 5173 is taken.
