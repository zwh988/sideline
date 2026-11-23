# Implementation plan

Each task is sized for **one session**. Work top to bottom unless a task says it can run in parallel. When you finish a task, tick it, add a line to `docs/STATE.md`, and commit.

**Starting a session:** open a new chat and say, for example:

> Do task 1.3 from docs/PLAN.md.

`CLAUDE.md` loads automatically. It points the session to `docs/STATE.md` and this plan.

Status: ✅ done · ⬜ to do · 🔶 partly done

---

## Phase 0: Feasibility ✅

Stockfish, Maia and WebLLM tested on desktop. Results are in `docs/STATE.md`. The phone runs are part of task 1.8.

## Phase 1: Coached game (MVP)

Done when the developer prefers it to playing bots on Chess.com.

### ✅ 1.1 Playable game vs Maia
Board, tap-to-move, Maia opponent per level, takeback, promotion, theme pack, phone layout.

### ✅ 1.2 Fact extractor and coach triggers
Facts, line cutting, analyst, trigger rules, hint ladder, `?fen=`, unit tests.

### ✅ 1.3 Coach thinks aloud on its own moves
Spec: "The coach's three jobs", job 2, and "Honest narration".
- After the coach moves (Lesson mode), give a short narration built from facts:
  - what the player's last move changed or threatened,
  - the coach's own checks, captures and threats,
  - why it chose its move.
- **Honest:** compare Maia's chosen move with Stockfish's best. If it's clearly worse, never call it good. Narrate it as human-like ("I'll develop my knight", not "the best move is…").
- Use the comment budget so it doesn't talk on every move. Prefer moves that teach something: a threat it creates, a capture, a defended threat.
- New templates in `templates.ts`. A new coach method, for example `onCoachMove(fenBefore, move)`.
- **Done when:** unit tests cover the narration facts, and a scripted Maia-vs-Maia game shows narration that is accurate, honest about weaker moves, and not on every move.
- Done: threats answered, captures, quiet-move ideas. Left for later: candidate moves ("I considered…"), and narration in Sparring mode (1.4).

### ✅ 1.4 Modes: Lesson and Sparring
Spec: "Modes" table.
- Add a mode setting, remembered on the device.
  - **Lesson:** frequent talk, hints offered, takebacks allowed, reveals its own plans.
  - **Sparring:** serious moments only, hints only on request, no takebacks, no plans revealed.
- Trigger rules read the mode. The takeback button and the mistake offer are hidden in Sparring.
- **Done when:** both modes are play-tested in the browser, and there are tests for the trigger differences.
- Done: `src/app/modes.ts` (switches: prompts, small talk, takebacks, reveals plans), `Coach` takes the mode, a Mode select in the header (applies from the next game). Sparring keeps: mistakes flagged without the refutation, missed tactics, praise. Thinking aloud is silent in Sparring.

### ✅ 1.4b Move navigation: view earlier positions
Comes before branches (1.6), which can start from a position the player is looking at.
- Buttons for start, back, forward and live (back and forward large enough to tap on a phone). Arrow keys on desktop. Tapping a move in the move list jumps to that position.
- While viewing an earlier position: the board is read-only, the last-move highlight shows the move that led there, and a clear "Viewing move 12 · Back to game" bar is shown. Hints and takeback are disabled.
- When the coach moves while the player is looking back, stay on the viewed position but show that a new move came in. Any move made in the live game returns to the live position.
- Keep the coach's remark with the ply it was said at, and show it again when viewing that position (a first step toward Review mode).
- **Don't lose remarks** (found in play): a remark on the player's move that doesn't wait for an answer (praise, "Bold!…", "Good, you saw my threat") is replaced about 0.6 s later by the coach's narration on its own move, before it can be read. Keep the turn's remarks together: the bubble shows the remark on the player's move and adds the coach's narration under it, as a short log (newest at the bottom, older ones dimmed, scrollable), not a replacement. The fixed-height bubble in task 1.8 must fit this (tap to expand).
- **Done when:** it works by tapping on the phone viewport and by keyboard on desktop, and there are unit tests for the navigation state (clamping at the ends, snapping back to live, the viewed position after a takeback), and a remark on the player's move is still readable after the coach replies.
- Done: `src/app/navigation.ts` (`Navigation`, `RemarkLog`, `plyLabel`), 4 tap buttons under the board (« ‹ › »), tappable move list, Home/End/arrow keys, a "Viewing … · Back to game" bar. The bubble is a log of the player-move remark and the coach reply.

### ✅ 1.5 Explain your idea: lines with tap-arrows
Spec: "Explain your idea", "Lines".
- An "Explain" button enters arrow mode:
  - tap a piece, then a square; arrows snap to legal moves, and an illegal arrow shows as invalid right away,
  - arrows are numbered automatically: one colour for your moves, another for the opponent's replies,
  - undo removes the last arrow; done/cancel buttons.
- The coach checks the line move by move against Stockfish and board code. Feedback uses the spec's categories for lines (good line, refuted at move N and why, the opponent has a better reply).
- The coach asks for an explanation at key moments, e.g. when a tactic is available in Lesson mode.
- **Done when:** this works on the phone viewport, and there are unit tests for line checking.
- Done: `src/app/lines-input.ts`, `src/coach/linecheck.ts`, `narrateVerdict` in `templates.ts`, `Coach.explainLine`. Explain button + "Show me your idea" at a Lesson tactic prompt; live position only (see STATE decision 15). Asking at other key moments, and plans (free text), are not done.

### ✅ 1.6a Branches: state and UI ("What if?")
Spec: "Branches: play it out" and its rules. This is large; split it if needed (a: branch state and UI, b: verdict and merge).
- A branch state stack, at most 2 deep. Always visible: a tinted board border and a breadcrumb (*Game → What if 14.Nxe5*).
- In a branch the coach plays Stockfish's best replies, not Maia's, and comments as the line goes. It ends the branch using the line rules, or steers the player back if they wander into random moves.
- **Verdict:** a bad line returns to the branch point; a good line can be merged. Merging plays only the player's first move in the real game. Merging from an earlier position needs a takeback, so it's Lesson mode only.
- Sources: a "What if?" button, a coach-suggested branch, or a line entered in task 1.5.
- Save branches as PGN variations.
- **Done when (1.6 overall):** the branch flow is play-tested end to end, including merge, on the phone viewport.
- **1.6a done:** `src/app/branches.ts` (`Branch`, `BranchStack`, max 2 deep), a "What if?" button (Lesson only) from the live or a viewed position, a nested "What if?" inside a branch, tinted board border (orange, purple at depth 2), breadcrumb, line text, Undo, Back. The coach answers with Stockfish's best move and says only board facts (start, mate or draw). The game is paused and untouched.

### ⬜ 1.6b Branches: verdict, merge, comments, PGN
What is left of the list above: comments as the line goes; ending a branch by the line rules or steering back from random moves; bad line (return to the branch point) and good line (merge, Lesson only, plays only the player's first move); a coach-suggested branch; a branch started from a line entered in 1.5; saving branches as PGN variations (with 1.7).

### ⬜ 1.6c UX pass (after branches)
Collected from play-testing 1.5; do it once branches (1.6a/b) exist, since they change the flow.
- **Ask about a line:** fewer taps (today: button, arrows, "Ask coach", then "Change my line"). Make clear it is a question to the coach: checking a line, confirming understanding, or exploring options. Revisit button and prompt wording.
- **Captured material:** put what *you* captured on your side of the board and what the coach captured on its side (not one text line under the board); the point balance next to them.
- **Eval bar:** decide whether to have one at all (it gives away answers; the coach plays weak moves on purpose). Candidate: Review mode only, or an off-by-default setting.
- **Ideas without replies / general ideas:** see the notes in STATE; belongs with the plans task.
- Phone: bubble below the board is barely visible (also in 1.8).

### ⬜ 1.7 Game persistence and PGN
- Save the game in progress, plus finished games with their branches, on the device. Resume after a reload.
- Export the PGN (copy or download).
- Store hints used per game (for mastery later).

### ⬜ 1.7b Known openings and gambits
Found in play (task 1.4 follow-ups): the Queen's Gambit 2.c4 gets "Bold! c4 offers a pawn…" praise every game, and a known gambit can look like a hung pawn. Standard theory should be named, not praised or warned about.
- Data: the Lichess opening names (`lichess-org/chess-openings`, CC0; ~3,000+ named lines with ECO codes and positions). A small script builds a lookup by position (EPD, so transpositions match) into a file committed to the repo; nothing fetched at runtime (rule 4). Check its size; at most a few hundred KB.
- Recognition after every move, **by either side**: the named opening of the current position, and whether this move entered a *gambit* (its name contains "Gambit" and the previous position's opening isn't already that gambit).
- Coach, Lesson:
  - the player plays a gambit: name it instead of the sacrifice praise, e.g. "That's the Queen's Gambit, a known opening: you offer the c-pawn." The name and the offered material are facts; add the engine's view only from the evaluation (e.g. a gambit the engine dislikes, like the Englund). No "why it works" text: that is hand-written content for Phase 6.
  - the coach plays a gambit: say so when thinking aloud ("I'm playing the Evans Gambit: I offer a pawn on b4."). Fine in Lesson; Sparring stays silent (decision 11).
  - while the position is in the book, no sacrifice praise and no hung-material warning (below the level's mistake size). Real mistakes within the level are still flagged.
  - point ahead: "We'll look at this one in openings training." until Phase 6 exists, then link to it.
- Store the openings met per game on the device (with task 1.7's persistence), as input for Phase 6 (start the repertoire from openings the player actually meets).
- **Done when:** unit tests cover lookup by position (including a transposition), gambit entry by each side, and the suppressed praise/warning; a browser check plays the Queen's Gambit and the Evans Gambit from both sides.

### ⬜ 1.8 MVP hardening and phone pass
- Run all feasibility tests and a full game on a real phone (`npm run dev:phone`). Record the numbers in STATE.
- Fix: file letters under the pieces; test the promotion picker and the end-of-game screen by clicking.
- Phone layout (spec: "Phone layout"). Today the page is one column: header controls, then the board, then the coach bubble, buttons and move list. On a ~375×650 screen the bubble is barely visible without scrolling. Change it to:
  - the coach bubble **above** the board, where an opponent's name usually sits, with a fixed height (about 3 lines, tap to expand) so the board doesn't jump when the text changes,
  - Hint, Take back, Flip (and the 1.4b navigation buttons) directly **below** the board, within thumb reach, with the status line in that row,
  - level, colour and new game moved out of the header into a menu, so the board moves up,
  - the move list as a horizontal scrolling strip, or behind a tap.
  - Done when the bubble, the board and the buttons all fit on one phone screen without scrolling.
- Foldables (the developer plays on a Galaxy Z Fold 7): the unfolded inner screen is nearly square, roughly 800–900 CSS px each way (measure it on the device). Today 760–~900 px wide gets the desktop two-column layout and breaks: at 790×880 the page is 41 px too wide, the board is cut off on the left and the side column is 216 px; at 880×790 it fits but the side column is cramped. Pick a layout for this size (likely the phone layout with a bigger board, or the side column under/over the board), check both orientations and the folded cover screen.
- Pins and skewers in `facts.ts` (needed for Level 3).
- Check the coach's analysis depth is fine on a phone.

### ⬜ 1.9 Deploy to GitHub Pages
- Decide on the public repo (GPL). Install `gh` or create the repo by hand; push.
- GitHub Actions workflow: `npm ci`, `npm test`, `npm run build`, deploy `dist/`.
- Check the live site on desktop and phone, including offline after the first load.

### ⬜ 1.10 Spec sync (can run in parallel with any task)
- Fold the "Decisions" from `docs/STATE.md` into the product spec: templates as the main voice, the Maia rating floor, the adapted line-cutting rules, loose piece, licensing.

---

## Phase 2: In-browser coach voice
Feasibility: Qwen3.5 2B is close but slow on integrated GPUs; templates stay the main voice.
- ⬜ 2.1 Model loading UX: optional download, progress, WebGPU check, warm-up before the game, template fallback.
- ⬜ 2.2 Rephrasing layer: the model rewrites template sentences in the persona's tone. A claim check rejects any output that adds squares, moves or pieces not in the facts; otherwise fall back to the template.
- ⬜ 2.3 Plans in text or voice: the model extracts `{move, piece, target, reason, condition}` (JSON schema); board code checks the premise; Stockfish gives the verdict; feedback categories from the spec.
- ⬜ 2.4 Ask the coach: fixed question types first ("Why did you play that?", "Is my knight safe?"), answered from facts.

## Phase 3: Puzzle drills
- ⬜ 3.1 Build script: filter the Lichess puzzle database (CC0) by rating and theme into small bundles per level.
- ⬜ 3.2 Puzzle screen reusing the board, hint ladder and coach. Woodpecker-style sets with speed and accuracy.
- ⬜ 3.3 Missed tactics from games become puzzles (using the line rules), with spaced repetition after 1, 3 and 7 days.

## Phase 4: Levels and placement
- ⬜ 4.1 Concept mastery tracking (from puzzles, hints used, tactics found in games).
- ⬜ 4.2 Placement diagnostic (~12 adaptive puzzles) and the rating shortcut.
- ⬜ 4.3 Graduation checks (puzzles, Sparring wins, real use) and the level-up screen.
- ⬜ 4.4 Levels 1–3 curriculum: lesson text drafted from verifiable claims, positions verified by Stockfish.

## Phase 5: Personas and art
- ⬜ 5.1 Four coach personas: tone in short phrases, a playing style for each (Maia settings or opening choice), a "plain coach" setting.
- ⬜ 5.2 Your own theme packs and portraits with expressions (the asset list is in the spec).

## Phase 6: Openings
- ⬜ 6.1 Small idea-based repertoire, drills with spaced repetition, starting games from repertoire positions (builds on `?fen=` / `Game.startFen`), and on the openings met in games (task 1.7b).

## Phase 7: Higher levels
- ⬜ 7.1 Levels 4–6 content and patterns, with input from stronger players.
