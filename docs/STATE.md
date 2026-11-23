# Project state

Last updated: 2026-11-23, after commit `0d01f06`.

## Summary

Roadmap phase 1 (coached game MVP) is about half done. You can play a full game against a Maia opponent at your level. The coach speaks on rule-based triggers (tactic available, threat, mistake with takeback offer, praise, phase prompts) and gives 4-step hints, all from board-checked facts. Not yet built: the coach thinking aloud on its own moves, modes, "Explain your idea", branches.

## Done

| Commit | What |
|---|---|
| `1edfd35` | Scaffold: Vite + TypeScript + chess.js |
| `1bf22ac` | Feasibility test 1: Stockfish WASM |
| `1c8af6b` | Feasibility test 2: Maia3 in the browser |
| `1ac2764` | Feasibility test 3: WebLLM coach voice |
| `c725e00` | MVP slice 1: playable game vs Maia, theme pack, tap-to-move, takeback, promotion, phone layout |
| `0d01f06` | MVP slice 2: fact extractor, line cutting, analyst, coach triggers, hint ladder, `?fen=` start, Vitest (24 tests) |

## Feasibility results (desktop only so far)

Measured on the developer's PC (16 cores, Intel Iris Xe-class integrated GPU).

- **Stockfish 19 Lite, single-threaded WASM:** ~1.9 MB, loads in ~0.1 s, depth 18 in under 0.7 s. MultiPV works (used for "forced" checks). Strength options exist for the fallback opponent.
- **Maia3 5M (maia3-js, ONNX wasm):** 22.6 MB model, ~23 ms per move. Plays clearly weaker as rating drops down to ~600 Lichess; at 400 it becomes erratic (out of training range). Levels use 600 as the floor.
- **WebLLM coach voice:** Llama 3.2 1B made up facts; Qwen3.5 2B was close (5–10 s per comment, good at JSON plan extraction, but mixed up whose piece is whose); Qwen3 4B was better but too slow (~2 tokens/s). Conclusion: templates are the main voice; a model may rephrase or extract structure only.

## How things were verified

- 24 unit tests (`npm test`) on real positions: facts, line cutting, templates.
- Browser checks with `?fen=`: knight fork (trigger, 4 hints, praise held through the combination); Scholar's mate defense (threat warning, mistake + takeback); defended queen attacked by a knight (Levels 1 and 2).
- A scripted full game (Maia vs Maia at 800, coach watching one side): 6 remarks in 20 moves, all accurate; ~0.35 s analysis per move.

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

## Known issues and gaps

- **Phone not tested yet** for any engine or the UI on a real device (only the emulated phone viewport).
- Promotion picker and the end-of-game screen are untested by clicking.
- File letters (a–h) sit under the pieces on the first rank and are hard to read.
- Pins and skewers aren't detected (no `pin`/`skewer` motif), so those tactics are silent even at Level 3+.
- The coach only names its own move in the status line; no thinking aloud yet.
- Hints used are counted (`Coach.hintsUsed`) but not stored anywhere.
- No game persistence: a reload loses the game.
- Maia3 weights' license is unstated (code is AGPL-3.0; maia3-js is MIT by an individual). Ask CSSLab before a public release.
- The spec doesn't yet reflect the decisions above.
- `npm warn install-scripts` appears on install; harmless so far.

## Environment

- Windows, Node 24, npm 11. Git repo on `main`, no remote yet. `gh` CLI not installed.
- Dev server may land on port 5174 if 5173 is taken.
