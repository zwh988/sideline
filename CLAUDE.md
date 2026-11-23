# Sideline

A chess app where you play an AI coach who thinks aloud, hints at the right moments and gives feedback on your ideas. Target players: beginner to ~1600. Runs fully in the browser as a static site (no server).

- Product spec: [Sideline — Product Spec.md](./Sideline%20—%20Product%20Spec.md). This is the "what" and "why".
- The idea behind the product (read before designing any feature): the spec's "The idea behind the product". Every feature is a step in its improvement loop.
- Where things stand: [docs/STATE.md](docs/STATE.md). Read this first in every session.
- What to build next: [docs/PLAN.md](docs/PLAN.md). Work on one task from it per session.

## Commands

```
npm install
npm run dev          # app at http://localhost:5173, tests page at /tests.html
npm run dev:phone    # also serves on your Wi-Fi, for phone testing
npm test             # Vitest unit tests (src/**/*.test.ts)
npm run build        # tsc + vite build into dist/
npx tsc              # type-check only
```

`predev`/`prebuild` copy Stockfish and the Maia model from `node_modules` into `public/engine/` and `public/models/` (git-ignored). If the engine 404s, run `node scripts/copy-engine.mjs`.

## Code map

| Path | What |
|---|---|
| `src/main.ts`, `src/app/ui.ts` | Game screen: board (chessground), coach bubble, status line, hints, takebacks, promotion |
| `src/app/game.ts` | Game state over chess.js (moves, results, takeback, start from FEN) |
| `src/app/levels.ts` | The 6 levels: Maia rating, max taught line, min gain, mistake threshold, patterns flagged |
| `src/app/modes.ts` | Lesson / Sparring: switches the coach and game screen read (prompts, small talk, takebacks, reveals plans) |
| `src/app/opponent.ts` | Coach's move choice: Maia (human-like), weakened Stockfish fallback |
| `src/app/theme.ts`, `public/themes/<id>/` | Theme packs: `theme.json` + piece images, no code changes to reskin |
| `src/engine/stockfish.ts` | UCI wrapper for Stockfish WASM (single-threaded lite build) |
| `src/engine/maia.ts` | Maia3 via maia3-js + ONNX Runtime Web (wasm build) |
| `src/engine/llm.ts` | WebLLM wrapper (only used by the tests page so far) |
| `src/coach/facts.ts` | Board facts per move: material, captures, forks, discovered attacks, check/mate |
| `src/coach/concepts.ts` | Concepts (Lichess theme names) detected in a line; `npm run concepts` scores them against sampled Lichess puzzles |
| `src/coach/lines.ts` | Cuts engine lines to the taught part, names the motif |
| `src/coach/analyst.ts` | Second Stockfish: position evals, threats (pass the move), forced replies |
| `src/coach/narration.ts` | Facts for the coach's own move: threat answered, captures, idea, move quality vs Stockfish |
| `src/coach/coach.ts` | Trigger rules (when the coach speaks, by level and mode), hint ladder, comment budget |
| `src/coach/templates.ts` | Sentences built from facts. This is the coach's voice |
| `src/tests/`, `tests.html` | Feasibility test page (Stockfish, Maia, WebLLM benchmarks) |

## Rules that must not break

1. **The engine decides what's true.** Every chess claim comes from Stockfish or board code (`facts.ts`, `lines.ts`). Templates only word facts. An AI model may later rephrase, never add facts. Never let text claim something the facts don't contain.
2. **Honest narration.** The coach plays weaker moves on purpose (Maia). It must never call those moves good.
3. **The coach mostly stays quiet.** Rules in `coach.ts` decide when it speaks; only flag patterns in the player's level (`levels.ts` `motifs`).
4. **Static site only.** No server, no API keys, nothing fetched from a CDN at runtime except the WebLLM model download and, when the player asks, their own public games from the Chess.com/Lichess APIs (game import). Must work on GitHub Pages (no COOP/COEP headers, so single-threaded engines).
5. **Phone-first UI.** Tap to move (no drag needed), board full width under 760px, 16px gutters.

## How to work here

- **One task from `docs/PLAN.md` per session.** Start by reading `docs/STATE.md` and the task. If a task turns out bigger than one session, split it in the plan.
- **Test chess logic with real positions.** Add Vitest tests next to the code (`*.test.ts`), using FENs and hand-checked engine lines. Verify every FEN and line is legal; tests have caught wrong test positions before.
- **Check behaviour in the browser.** `?fen=<FEN>` starts a game from any position (the player plays the side to move), which makes triggers easy to reproduce. In the page console, modules can be imported directly (`await import('/src/coach/coach.ts')`) to script scenarios with the real engine.
- **Before finishing a task:** `npm test`, `npx tsc`, `npm run build` all pass; check it in the browser; update `docs/STATE.md` (what changed, how verified, new known issues) and tick the task in `docs/PLAN.md`; commit.
- Keep the user's spec in sync: when a decision changes the spec, note it in `docs/STATE.md` under "Decisions" (the spec update itself is a task in the plan).

## Gotchas

- `vite.config.ts` aliases `onnxruntime-web` to `onnxruntime-web/wasm`; the default build tries to load a WebGPU file and fails.
- chess.js `history()` and `moves` cover only moves since the start FEN; `Game.startFen` matters for games started from a position (Maia needs it as `baseFen`).
- The analyst's Stockfish handles one search at a time; `Analyst.run` queues jobs. Don't call `Stockfish.analyse` concurrently on one instance.
- Stockfish scores are from the side to move. Convert carefully (`scoreToCp`, negate across a move).
- Licenses: Stockfish and chessground are GPL-3.0, so the app is GPL-compatible open source. Pieces are CC0 (rhosgfx). Maia3 weights' license is unconfirmed (see STATE).
