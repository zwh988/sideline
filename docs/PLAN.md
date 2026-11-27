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

### ✅ 1.6a Branches: state and UI ("What if?") — superseded
Built `src/app/branches.ts` (two-deep `BranchStack`), a "What if?" button, breadcrumb, tinted border, Stockfish replies. Play-testing showed it is a sandbox with no teaching value, and it overlaps "Ask about a line" (1.5). **Design reset, Nov 23:** see the spec's "The idea behind the product". The reusable parts (board play in a position, Stockfish replies, undo, tinted border) carry into 1.6d; nested depth, the breadcrumb and merging are dropped.

### ✅ 1.6b Lichess puzzle sample and concept test harness
The concept layer needs ground truth. Lichess puzzles (CC0) carry theme labels.
- `scripts/build-puzzles.mjs`: streams `lichess_db_puzzle.csv.zst` (~310 MB, downloaded by hand, not committed), keeps the themes that matter below ~1600, samples N puzzles per theme per rating band, writes small JSON files to `public/puzzles/` (git-ignored if large; check size; rule 4: our own static files only).
- `src/coach/concepts.ts`: the concept list (Lichess theme names), which are detectable today, and a `detect(fen, solution)` that maps our existing facts and motifs to themes.
- A test harness (`npm run concepts`) scoring each detector against labelled puzzles: precision, recall, and the share of puzzles with no named concept. Vitest tests use a small committed fixture of real puzzles.
- **Done when:** the sample builds, the harness prints per-theme agreement for the detectors we have (fork, hanging piece, discovered attack, mate in 1/2), and the numbers are recorded in STATE.

### ✅ 1.6c Concept detectors: close the gaps (first round)
Add and score detectors, one theme at a time (pin, skewer, back-rank mate, trapped piece, capturing/removing the defender, deflection, attraction, double check, sacrifice, quiet move...), cheapest and most common below 1600 first. Each needs: a detector in board code, an engine check, a test on real puzzles, and wording in `templates.ts` (hand-written; rule 1). Unfound concepts stay honest: "I can't name a reason I can check."

- Done (third round): attraction; line-level concepts recorded in moments. Dropped after measuring: x-ray, interference, exposed king. Wording the line-level concepts (deflection, intermezzo, attraction) in speech needs the line shown after the first move: with Review (1.7d).
- Done (second round): intermezzo, deflection; wording for trapped piece, capturing the defender, sacrifice. Dropped for now after measuring: clearance, attraction, quiet move, defensive move. See STATE.
- Done (first round): pin (absolute), skewer, capturing the defender, trapped piece, sacrifice, better discovered attack; numbers in STATE. Still open: deflection, attraction, quiet move and the rest of `NOT_YET`, relative pins, x-ray batteries; raising fork, hanging-piece and sacrifice precision. Do these as needed once 1.6d shows which concepts the coach actually says.

### ✅ 1.6d Try a sideline (replaces 1.6a's branches and 1.5's arrow flow)
Spec: "Try a sideline".
- One level, always visible (tinted border + banner + Back). The player plays a move or short line on the board; the coach answers with Stockfish and judges each move live using the 1.5 line checks, then explains with the concept (1.6b/c). Play it, or go back.
- Lesson only; open (no limits). Sparring has none.
- Entry points: a button on the player's turn, "Show me" after a mistake remark (plays the refutation), the tactic prompt.
- Retire "Ask about a line" arrows and "What if?", dropping the two-level stack and breadcrumb.
- **UX pass folded in** (from play-testing 1.5 and 1.6a): fewer taps, wording, the bubble visible on a phone, captured material on each side, decide on the eval bar. See the notes in STATE.
- **Done when:** played end to end on the phone viewport, with tests for the judging and the concept wording.
- Done: one-level `Branch`, "Try a sideline" button (Lesson only), per-move judging with concept sentences (`explain.ts`, `sideline.ts`), "Show me" after a mistake, "Try it out" at a tactic prompt; the arrow flow, two-deep stack, breadcrumb and "What if?" are gone. UX: one button instead of two, a banner with the line and Undo / Back to game.
- **Not done from the UX list, moved on:** captured material on each side of the board, the eval bar decision (still undecided; the sideline shows no numbers except in the "can't name a reason" fallback), the bubble above the board on phones (task 1.8). Also open: wording for trapped piece, sacrifice, capturing the defender and the rest once their detectors are good enough (1.6c round 2).

### ✅ 1.7 Game persistence and PGN
- Save the game in progress, plus finished games with their sidelines, on the device. Resume after a reload.
- Export the PGN (copy or download).
- Store hints used per game (for mastery later).
- **Moments record:** every flagged moment (mistake, missed tactic, good find) saved with its position, the concept named (or none) and the outcome. This is the input for Review and Practice.
- Done: `store.ts`, `pgn.ts`, `Moment` in `coach.ts`, resume after reload, History dialog (Copy / Download PGN, Delete), backup file (Back up / Restore). See STATE decisions 22 and 23. Not done: a list of the *moments* themselves and the concept record per player (that is Review, 1.7d); opening a past game on the board (also Review).

### ✅ 1.7c Game import
For Review. Paste or upload a PGN; fetch a player's public games from the Chess.com and Lichess APIs (player-initiated; rule 4 is relaxed for this one request, see STATE decision 17; check cross-origin support first). Imported games go through the same moment-finding as live games.
- Done: `pgnimport.ts`, `sources.ts`, `review.ts`, `import-dialog.ts` (History → Import games). Cross-origin checked: both APIs allow any origin. How the analysis runs (second engine, per-move cancel, `ucinewgame`): STATE decision 25. Not done: opening an imported game on the board (Review, 1.7d).

### ✅ 1.7d Review
Spec: Modes, Review. Walk through a game's critical moments, ask what the player was thinking, let them try sidelines, name the concept. Saved moments feed Practice (Phase 3).
- Done: Review button in History opens any saved game on the board; moment walk with the question first and "What happened?"; sidelines kept with the game; STATE decision 26. Not done: collecting the player's answer (plans task), moments' concept record per player, rewording the live phrasing for past games.

### ✅ 1.7e Polish Review and the coach in sidelines
Found in play after 1.7d: "Review is quite bad right now." Planned with the user (decisions: all patterns at any level, both sides, a story of the game plus a drill per moment, the "what were you thinking" question dropped, everything in one task).
- Done: **Review looks at every pattern at any level, for both sides** (`coach/review.ts`: one engine search per position, the evaluation curve, the player's level only sets the smallest swing listed and the "beyond your level" tag; at most 8 moments, costliest first); new kinds `their-tactic` and `their-blunder`; **past-tense wording** built from saved facts (`coach/reviewwords.ts`), the engine's better line stored with the moment and played out by "Show the line"; plain recaptures are no longer tactics (`isMereRecapture`); **story strip** (evaluation curve, moments marked, tap to jump) and turning points in the intro; games without an analysis are analysed when opened; the drill after "What happened?" (Show the line / Try it yourself). **Sideline:** `coach/lineexplain.ts` words every move of a line with pay-offs (skewer, pin, trap, deflection, attraction, intermezzo); every move in a sideline gets a note, the coach's reply too; "Show what's good" plays the engine's line with notes. STATE decisions 28–30.
- Not done: a list of all moments to jump to (the strip and Moment ‹ › do it), collecting the player's own answer (dropped on purpose), "Look again at level N", wording for interference / x-ray / clearance (no detectors).

### ✅ 1.7f Universes in sidelines (Review first)
User's direction: a sideline should show the different universes play out (what could have been; if the opponent doesn't play the strongest, how to punish; what tactic was missed in that universe). Done: STATE decision 31 (tree, 3-fork cap, universe chips, "If they play X" with punishment) inside Review's sidelines.

### ✅ 1.7g Universes in live games
Done: live mistakes, missed tactics and found tactics save `line` (what the engine wanted) and, for a mistake, `answer` (the coach's winning line); "Show me" now opens the sideline from the position before the mistake with "What happened" played out and the chips "What happened" / "What the engine wanted" / "If they play X"; a tactic prompt's "Try it out" offers "The tactic" as a chip (`Remark.line`). STATE decision 31. Not done: deviation chips at every opponent node of the path (only the latest), the player's tempting alternatives, universes saved with the game, renaming the UI around universes.

### ✅ 1.9 Lines chart: the sideline as a flowchart (UI/UX pass, live and Review)
Found in play (user): navigating inside one sideline is really hard, and it is hard to follow the coach when he talks while the pieces move. Designed with the user (mock-ups and a clickable prototype, Nov 25); STATE decision 32 has the vocabulary and rules. **The chart is as important as the board** and is the same in live games and Review.

**Vocabulary (use it in the UI and the code):** a **Line** is a path of moves from a **fork** (the last shared move; "universe" is retired). The chart is one grid: columns are moves, rows are **lanes**, the same fixed lanes everywhere: **Best / Great / Good / Other** (quality of a move compared with the engine's best move *in its own position*). A Line is a path that crosses lanes, so a bend means a change in quality. Authors, by colour: **Game** (gray, the trunk, always shown), **Engine** (amber), **You** (purple). Move fill = who moved; a small dot = who is better after it (you / them / level).

**Behaviour (agreed):**
- One cursor. The board and the coach's note always follow the selected move; the bubble shows only that move's note.
- At the cursor the **options** for the next move are drawn as dashed ghost moves in the next column: the engine's top moves (Best, Great, Good) and, in Other, moves that matter (the move played in the game, moves Maia says players at the level often choose). Tap one to open it (extends or forks a Line); or play any move on the board. The player chooses both sides' moves unless they tap an engine option ("I choose unless I choose the engine move").
- **Lanes are recalculated for every new position**: opening a move searches its position (MultiPV) and ranks the next column; the rating of a custom move that is not among the candidate lines costs one more search. Cached by position; the likely next step is searched ahead.
- Stepper « ‹ › »: ‹ to the parent, › to the Line's next move (at the end it opens the engine's best option), « to the fork, » to the end of the path; arrow keys. Tap any move in the chart to jump.
- Max 3 forks per sideline (as before) and a column limit; a longer line scrolls sideways.
- **Evaluation without a bar:** each move has a verdict ("clearly better for you", "about level", …) and the *reason* shown on the board: a Line (its arrows), or, for position-level reasons, squares (the pinned piece, the king's open squares). If no detector fires, the coach says so (rule 1). Badges only on notable moves (best, mistake), not on every move.
- Side lines are tinted on the board (orange border); the game has none.
- Same screen in live play and Review: in live play the lines from the current position are possible futures, one "Back to game" closes them all; looking at an earlier move is Review behaviour.
- Layouts: folded phone (375×650: coach strip, board, stepper, chart fill one screen), unfolded (~850×850: board and coach above, chart across the full width below), desktop (board left, chart right, note card pinned to the selected move). Text and nodes small but not below 11px.

**Split:**
- ✅ **1.9a** Line tree model: `src/app/linetree.ts` (nodes, authors, lanes, forks, cursor, path, `rateOptions`, `verdictOf`), pure, 13 tests.
- ✅ **1.9b** Engine options per position: `Coach.options` (MultiPV into lanes), `Coach.rateMove`, `Coach.lineNote`; tests in `sidelinecoach.test.ts`.
- ✅ **1.9c** The chart in the sideline screen: `linechart.ts`, ghost options, the stepper, board play at any node, options arrows, moment Lines as gray and amber; replaces `branches.ts`, the sideline bar, universe chips and played-out lines. Checked in the browser at 375×650 and desktop 800×600 with the real engine (live "Show me" after 5.Bc4??, a custom 5.Be2, options, forward and back).
- ✅ **1.9d** Reasons and badges: `coach/position.ts` (passed pawn, isolated and doubled pawns, open king, bishop pair: geometry only, 7 tests) and `Coach.reason` (what stands out when the engine says one side is clearly better and no concept was named; "I can't name a reason I can check" when none), lit up on the board; badges on notable moves only (`!` only move, `?` mistake, `??` blunder); Maia's "common at your level" options (`Opponent.likelyMoves`, `Coach.withCommon`: a common move the engine rates low is rated and added); the unused coach methods removed (`sidelineReply`, `bestLine`, `deviations`, `punishment`, `lineNotes`, `describeSidelineMove`, `describeSidelineReply`) with their tests; the unfolded size (850×850) and an 8-move Line checked in the browser. Dropped: "stale lanes" (each move's lane is relative to its own parent position, so nothing goes stale when an earlier move changes: the tree keeps the Lines that are still true).
- Moved to 1.12 (visual polish): the desktop note card pinned to the selected move, the shorter Review moment text with details on tap, the bubble's room on a phone (verdict, note and reason compete for 80 px).
- Still to do by the developer: time the option search on a real phone (about 0.3 s on the desktop, same CPU with the emulated phone).

### ⬜ 1.10 Ask the coach (an LLM layer over the engine's lines)
**Next up (the user's plan, Nov 27: the LLM pass, in its own session).** It overlaps Phase 2: the model download and warm-up (2.1) is needed first. Read STATE's feasibility results (templates stay the voice; small models invented facts) and rule 1. Align on the design with the user before building.
Found in play (user): wanting to ask more questions about a line ("why not Bxc6?", "what if they take?"). The model never judges: it reads the structured facts the app already has (the engine's lines for the shown position, `explainLine` steps, concept notes, evaluations) and answers questions about them, or turns a question into an engine query (a candidate move to check) whose result the templates word. Rule 1 holds: anything it says must be traceable to those facts; when it can't, it says so. Needs: a fact bundle per position, a question-to-query step (JSON, the feasibility test showed small models are good at that), an answer-from-facts step, and a refusal path. Depends on the WebLLM model download (rule 4) and on 1.9's single place for the bubble.

### ✅ 1.7b Known openings and gambits
Found in play (task 1.4 follow-ups): the Queen's Gambit 2.c4 gets "Bold! c4 offers a pawn…" praise every game, and a known gambit can look like a hung pawn. Standard theory should be named, not praised or warned about.
- Data: the Lichess opening names (`lichess-org/chess-openings`, CC0; ~3,000+ named lines with ECO codes and positions). A small script builds a lookup by position (EPD, so transpositions match) into a file committed to the repo; nothing fetched at runtime (rule 4). Check its size; at most a few hundred KB.
- Recognition after every move, **by either side**: the named opening of the current position, and whether this move entered a *gambit* (its name contains "Gambit" and the previous position's opening isn't already that gambit).
- Coach, Lesson:
  - the player plays a gambit: name it instead of the sacrifice praise, e.g. "That's the Queen's Gambit, a known opening: you offer the c-pawn." The name and the offered material are facts; add the engine's view only from the evaluation (e.g. a gambit the engine dislikes, like the Englund). No "why it works" text: that is hand-written content for Phase 6.
  - the coach plays a gambit: say so when thinking aloud ("I'm playing the Evans Gambit: I offer a pawn on b4."). Fine in Lesson; Sparring stays silent (decision 11).
  - while the position is in the book, no sacrifice praise and no hung-material warning (below the level's mistake size). Real mistakes within the level are still flagged.
  - point ahead: "We'll look at this one in openings training." until Phase 6 exists, then link to it.
- Store the openings met per game on the device (with task 1.7's persistence), as input for Phase 6 (start the repertoire from openings the player actually meets).
- Done: `build-openings.mjs`, `openings.ts`, coach wiring, `SavedGame.opening`; STATE decision 27. Not done: the opening named in the status line during play, a browser check of a full Queen's Gambit game from both sides, the training link.
- **Done when:** unit tests cover lookup by position (including a transposition), gambit entry by each side, and the suppressed praise/warning; a browser check plays the Queen's Gambit and the Evans Gambit from both sides.

### 🟨 1.8 MVP hardening and phone pass (layout done; real phone still to do)
- Done in the browser pane (STATE, task 1.8): phone layout, foldable sizes, file letters, promotion and end-of-game clicked through, pins and skewers (came with 1.6c). **Still to do by the developer:** run the feasibility tests and a full game on a real phone (`npm run dev:phone`) and record the numbers in STATE; check the analysis depth there (it is 10 on touch devices, 12 otherwise).
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

### 🟨 1.11 Deploy to GitHub Pages
- Done: `.github/workflows/pages.yml` (push to main: `npm ci`, `npm test`, `npm run build`, deploy `dist/` with the Pages actions); the production build checked from a `/sideline/` subpath on a local static server (Stockfish, the Maia model and ONNX runtime load; every request stays on the same host; the sideline options and Maia's common moves work). `dist/` is 45 MB (the Maia model is 22.6 MB).
- To decide with the user before anything goes public: (1) the repo (owner, name, public: STATE decision 7 says GPL-3.0 open source; a LICENSE file is not added yet); (2) **the Maia3 weights' licence is unconfirmed** and the site would serve them (ask CSSLab, or ship the weakened-Stockfish fallback until confirmed); (3) **all 40 commits carry the developer's personal email as author**: keep, or use GitHub's no-reply address from now on, or rewrite the history before the first push; (4) `gh` is not installed: install it, or create the repository on github.com and give the URL.
- Then: push, enable Settings > Pages > Source "GitHub Actions", check the live site on desktop and phone. **Installable and offline (built):** `public/manifest.webmanifest`, icons (`scripts/make-icons.mjs`, a placeholder fork mark to be redesigned in 1.12), theme tags, and a service worker generated at build time (`scripts/sw-template.js`, `src/pwa/build.ts`, the plugin in `vite.config.ts`). It could not be run in the built-in browser (service workers are unsupported there), so it is covered by 10 tests against a simulated worker environment and **still to try on the real phone** after the first deploy: install (Chrome menu > Install app / Add to Home screen; on iOS Share > Add to Home Screen), then airplane mode.

### 🟨 1.12 UX flow and visual polish (a–e done, f left) (flow agreed Nov 25, see STATE decision 34)
Found in play (user, Nov 25): the app looks barebones and, worse, the coach feels auxiliary (remarks are missed, a mistake costs one tap, the buttons are unrelated, the sideline chart is cluttered). Not a re-colour: a change of flow first, then one visual system. Build in this order, one commit per step, each checked in the browser at 375×650, ~850×850 and desktop:
- ✅ **1.12a Coach reacts on the board** (decision 34, 1–2): move goes through; on a flagged move the opponent waits; ring on the piece in danger, the refutation auto-plays as ghost pieces to the end of the taught line, `?`/`!` badge on the moved piece; three choices (Take back / Explore / Play on; a board tap = Play on, recorded); severity table; bigger coach face with mood states.
- ✅ **1.12b Takeback is recorded** (decision 34, 3): every takeback and "Play on" stored on the game, shown in the end-of-game summary ("3 moments, 2 takebacks, both on loose pieces").
- ✅ **1.12c Actions regrouped** (decision 34, 4): "Ask coach" menu (Hint, Explore), Undo by the last move, Flip and Settings in the header menu; captured pieces beside/above-below the board with +x.
- ✅ **1.12d Sideline on the board** (decision 34, 5): tinted squares and header, option arrows coloured and weighted by lane (no numbers, no legend), badges on pieces, the path we're on bold and the rest faded, the chart reduced to a wordless strip, aligned and non-overlapping.
- ✅ **1.12e One visual system** (tokens, Nunito, the coach portrait, buttons, History and Import, focus, reduced motion, contrast; the list below was the starting menu, see STATE for what was done and what was not checked): the list below (tokens, type, coach portrait, controls, dialogs, motion, accessibility), migrated screen by screen.
- ⬜ **1.12f Sound and haptics** (separate, later): light haptic on a mistake, short sound on a blunder, a Settings switch (haptics on, sound off by default).

Found in playtesting 1.12a–e (user, Nov 25). Do in this order, one session each:
- ✅ **1.12g Sideline pass** (done; see STATE. The phone board is smaller in both modes so the chart fits).
  - The board must not move or resize when a sideline opens: today `.layout:has(.sidelining) .side` widens the column from 300 to 420 px and shrinks the board. Keep one layout; the chart replaces the coach and hint area in the same column (sized for the chart from the start). On phones the chart takes the space under the board.
  - No move limit in a sideline: remove `MAX_DEPTH = 8` in `linetree.ts` (and its test); the chart scrolls sideways, following the current move. The game's own length is the only limit.
  - Lanes: replace the wifi-style bars (`LANE_BARS`, `meterSvg`, gutter meters) with the move-rating badge symbols on each lane row, the same badges as on the board.
  - Nodes: the move text must fit inside the node (make the node wider for long SAN such as `…Nxd4+`, or shrink the text; check the longest labels).
  - The line we're on (the main line) is a lot thicker than now; the others stay faded.
  - Captured pieces and +x in a sideline: they are hidden today (`.board-area.sidelining .captured`, an intended choice in 1.12c because the strips described the game). Change to show the material of the sideline's position, so the strip is never missing, in the off-game violet tint.
- ✅ **1.12h Material bigger.** Captured pieces beside the board larger (about 70% of a square), the advantage as a bold "+3" chip in the leader's colour.
- ✅ **1.12i Game review (replaces History).** One list called "Game review" holding every game the player can review: games played with the coach, imports from Chess.com (listed first) and Lichess. Picking a game makes the coach give a spoken summary like the end-of-game one (the moments, the takebacks, the habit), then the moment timeline (one dot per moment, coloured by the same badges as the board; a dot opens that moment with the question first). Game card tap opens the summary first. Import order in the dialog: Chess.com before Lichess.
- ✅ **1.12j Sidebar navigation** (rail on wide screens, header menu on phones, New game sheet; Library left out until it has content). A slim left rail (a bottom tab bar on phones) with Play, Game review, Library and Settings; room for Openings and Puzzles later. Hint, Take back, Flip and Try a sideline sit by the board and coach; the mode switch (Lesson / Sparring) goes at the top of Play and "More" into the rail. Do after 1.12i because both change navigation.
- The LLM connection is task 1.10 (Ask the coach, ⬜ not started) and Phase 2 (2.1 model loading, 2.2 rephrasing); neither is scheduled before 1.12g–j.

Ideas for 1.12e (nothing here is decided beyond the flow above):
- **Design tokens:** one palette (light and dark), type scale, spacing, radii and elevation in CSS variables. Today colours are ad hoc (`#c77d1a`, `#888780`, `#7F77DD`, `#1D9E75` in code and CSS; the app's own variables are `--bg`, `--panel`, `--muted`). Author and lane colours of the chart become tokens that also work for colour-blind players (a second cue besides hue: line style, shape).
- **Typography:** a typeface pair and a clear hierarchy (coach voice vs controls vs numbers like move labels); readable at the 11 px floor.
- **The coach:** a real portrait and bubble (tail, mood, the "thinking" state), tied to Phase 5 personas so the art is not thrown away; the verdict line ("Best · Slightly better for you") as a designed element, not plain text.
- **The Lines chart as the hero:** node shape and weight, curve style, lane band styling and names inside the band, a quieter key instead of the caption, the selected move's emphasis, motion when stepping (the cursor glides, options fade in, a re-rated lane shifts), touch targets of at least 44 px for moves on a phone.
- **The board:** square colours and coordinates from the theme pack, last-move, check and selected highlights, arrow style (numbered options), the tinted border for a sideline.
- **Controls:** one button hierarchy (primary / secondary / ghost), icons with labels, a bottom action bar on phones, a simpler header (settings as a sheet), consistent sizes and spacing.
- **Motion and feedback:** one duration and easing set, reduced-motion respected; loading and empty states ("Getting ready…", engine thinking) instead of bare text.
- **Dialogs and lists:** History, Import and the review strip styled with the same system.
- **Layouts by device:** phone 375×650, unfolded about 850×850, desktop; check each with the real engine at size. Includes the desktop note card pinned to the selected move from the mock-up.
- **Accessibility:** contrast in both themes, focus rings, keyboard flow through the chart, screen-reader names (the chart's moves already have labels).
- **Process:** a screenshot checklist per screen and size, taken before and after, kept out of the repo; one commit per screen migrated.

### ⬜ 1.13 Spec sync (can run in parallel with any task)
- Fold the "Decisions" from `docs/STATE.md` into the product spec: templates as the main voice, the Maia rating floor, the adapted line-cutting rules, loose piece, licensing.

### ⬜ 1.14 Six tiers, six animal coaches, a theme per tier
- ✅ **1.14a Infrastructure with placeholders** (Nov 27): `Level.coach`/`shownRating`/`theme`, six packs `public/themes/coach1…6` (board and accent from the table below, pieces reused), placeholder portraits per mood ("Coach N" + mood, `scripts/make-portraits.mjs`), switching at the next game (decided), Review uses the game's coach; bigger face; unfolded-foldable layout (coach column beside the board). STATE decision 35.
- ⬜ **1.14b Personas** (when the user has chosen them): names, animals, real portraits (drop into `portraits/`), per-coach piece colours, the shared highlight colours, contrast of highlights and arrows on all six boards, phrase banks (voice), a board/pieces override setting. (`specialty.puzzleThemes` and the puzzle themes were added in 3.1 with the placeholder coaches; check them when the personas are chosen.)
Agreed with the user (Nov 27): the 6 levels stay as in the spec and `levels.ts`, but each one is a **tier with its own animal coach** (no generic "Coach"), shown with **one exact rating** instead of a range, and **picking a tier switches the theme** (board colours, piece set, accent, portraits). Replaces the spec's four personas by band. Pulls part of Phase 5 (5.1 personas, 5.2 theme packs) forward; the art itself comes later from the developer, the placeholders stay until then. Align the two new animals with the user before building.

**The tiers** (shown number = the strength the coach plays at, as an approximate Chess.com rating; Maia's Lichess number stays in code; check the conversion against the bands in `levels.ts` and say "about" in the UI):

| Tier | Coach | Shown | Maia (Lichess) | Tone | Playing style | Teaches (spec concepts) |
|---|---|---|---|---|---|---|
| 1 | **Penguin** (Pip) | 300 | 600 | eager, clumsy, a fellow noob, humble | simple, natural moves, leaves things loose | piece safety, safe trades, basic mates |
| 2 | **Otter** (new) | 550 | 800 | playful, curious, easily distracted | grabby: takes whatever is offered, chases pieces | forks, mate in 1–2, opening principles (punish greed, keep your pieces defended) |
| 3 | **Fox** (Rusk) | 850 | 1100 | cheeky, confident, show-off | early attacks and gambits | pins, skewers, discovered attacks; staying safe vs aggression |
| 4 | **Badger** (new) | 1150 | 1350 | gruff, stubborn, blunt | tenacious defence, trades into endgames | removing the defender, deflection, combining motifs, K+P endgames; converting a win |
| 5 | **Tortoise** (Moss) | 1450 | 1600 | calm, patient, methodical | slow and solid | weak squares, open files, good vs bad pieces, pawn structure; plans in quiet positions |
| 6 | **Heron** (Ardea) | 1750 | 1850 | dry, Socratic, precise | precise, punishes loose play | calculation, anticipating plans, harder endgames |

Names are placeholders. Playing style is a later setting per coach (Maia temperature, opening choice); this task only adds the field.

**Themes** (first pass, test highlights and arrows on every board; the shared highlight colours do not change between themes; accent is for UI only, never on the board):

| Coach | Light sq | Dark sq | Accent / strong / soft | White pieces fill / outline | Black pieces fill / inner line |
|---|---|---|---|---|---|
| Penguin | `#EEF4F8` | `#9DB8CF` | `#2D5BD7` / `#2D5BD7` / `#E3EBFF` | `#FFFFFF` / `#1E2A38` | `#1E2A38` / `#4A5C70` |
| Otter | `#EAF1EE` | `#7FA9A0` | `#E0607E` / `#C2445F` / `#FCE4EA` | `#FFFFFF` / `#22312E` | `#22312E` / `#4E6662` |
| Fox | `#F6E7CF` | `#C7774A` | `#E8641E` / `#C2410C` / `#FDE8D9` | `#FFF6EA` / `#3A2418` | `#3A2418` / `#7A4A2E` |
| Badger | `#E8E2D8` | `#8F8273` | `#8A5A3B` / `#7A4C2F` / `#F2E6DA` | `#FBF8F3` / `#2B2622` | `#2B2622` / `#5C534A` |
| Tortoise | `#EDE6CF` | `#8C9A6A` | `#5F8A5B` / `#4E7A4A` / `#E4EEDF` | `#FBF7EC` / `#2F3524` | `#2F3524` / `#5A6444` |
| Heron | `#E3E7EA` | `#6F8597` | `#2F7F86` / `#2F7F86` / `#DDEFF0` | `#F7F9FA` / `#1A2128` | `#1A2128` / `#465664` |

**Specialties** (agreed Nov 27): each coach also specialises in a kind of puzzle (and later an opening; **openings to decide with the user next time**). Add a `specialty.puzzleThemes` field per coach with exact Lichess theme names. Phase 3 uses it for a named set per coach ("Fox's tricks"), on top of the drills for the player's own tier; any coach's set can be picked.

| Coach | Lichess puzzle themes |
|---|---|
| Penguin | `hangingPiece`, `mateIn1`, `oneMove` |
| Otter | `fork`, `mateIn2`, `backRankMate`, `trappedPiece` |
| Fox | `pin`, `skewer`, `discoveredAttack`, `sacrifice`, `opening`, `kingsideAttack` |
| Badger | `capturingDefender`, `deflection`, `defensiveMove`, `pawnEndgame`, `endgame` |
| Tortoise | `quietMove`, `rookEndgame`, `advancedPawn`, `promotion`, `intermezzo` |
| Heron | `long`, `veryLong`, `zugzwang`, `clearance`, `interference`, `xRayAttack` |

`scripts/build-puzzles.mjs` `THEMES` does not yet keep `oneMove`, `opening`, `kingsideAttack`, `pawnEndgame`, `endgame`, `rookEndgame`, `advancedPawn`, `long`, `veryLong`: add them (check each name against the CSV's theme column, and the bundle size), and keep `concepts.ts` in sync. Fox's set can later also filter by the puzzle's opening tags (gambits) once its openings are chosen. Positional coaches (tortoise, badger) have thinner puzzle sets; that's expected, their specialty will lean on openings and games. A test checks that every theme name in the mapping exists in the built puzzle sample.

Shared highlights: your moves `#6D4AFF`, opponent/coach replies `#F59E0B`, good `#22A559`, danger/check `#E5383B`, last move `#F7D046` at 40%, legal dot black at 22%; arrows get a thin `#1B1B1F` 50% stroke.

**Build:**
- `levels.ts`: each level gets `coach` (id, name, animal, tone), `shownRating`, and `theme` (a theme pack id). The UI says "Tier 3 · Fox · about 850" instead of the rating band. Keep `chessCom` only if something still needs the band.
- Theme packs: one folder per coach in `public/themes/<id>/`, each `theme.json` with board, accent (+ strong, soft) and pieces; until the developer's sets exist, all six point to the rhosgfx pieces (reuse, don't copy). Add a **portraits** slot (`portraits/neutral|thinking|pleased|concerned|surprised.(svg|png)`); when absent, `faceSvg` in `ui.ts` draws the placeholder in the accent.
- `theme.ts`: switching the tier loads that coach's pack (applies at once, unlike the level, which applies from the next game; or both from the next game: decide with the user). A setting can override board/pieces independently (spec: mix freely).
- **The theme follows the coach across formats:** Play, Game review, and later Puzzles and Openings use the current tier's coach and theme; formats have no colours of their own. **Game review:** a game played against a coach is reviewed by that coach in their theme (they were the opponent: "I left my bishop loose there"); imported games are reviewed by the current tier's coach.
- **Voice:** personality lives in the templates, not an LLM (STATE decision 1; the model was 5–10 s per comment and invented facts). Each coach gets a small phrase bank in `templates.ts` (or one file per coach): openers, praise, concern, thinking, small talk; the fact sentence stays shared and untouched (rules 1–2), the coach's phrase wraps it. Rotate to avoid repeats; personality phrases go through the comment budget (spec: no joke on every move). The "plain coach" setting drops the phrase bank. Phrase banks can be drafted with an LLM at writing time and edited by hand. Phase 2's rephrasing stays optional.
- **Done when (1.14):** each tier picks its coach, rating, theme and phrase bank; switching tiers in the browser changes board, accent and coach name at 375×650 and desktop; highlight and arrow contrast checked on all six boards; tests for the level→coach→theme mapping and that phrase banks never change the fact text; STATE decision added and the spec's "Coach personas" table marked for the spec sync (1.13).

### ⬜ 1.15 Coach playing styles
Agreed with the user (Nov 27). After 1.14 (needs the coach per tier). Each coach plays differently, not only at a different rating. The hook: `MaiaOpponent.chooseMove` in `opponent.ts` gets Maia's probability per legal move, drops those under `MIN_PROBABILITY` (2%) and samples. **A style reweights that policy before sampling**, so moves stay ones a human at that rating would consider.

1. **Opening book (most visible, cheapest).** For the first 4–8 moves the coach plays from its own small repertoire instead of Maia (the fox's gambits, the badger's London every game); once the game leaves the book, Maia takes over. Use the openings data from 1.7b to recognise positions (transpositions included). **The openings per coach are not chosen yet: decide with the user at the start of this task** (1.14 has the puzzle specialties; openings were left open). Play only book moves Stockfish doesn't call a blunder.
2. **Style weights.** Per candidate move, features from existing board code (`facts.ts`, `motifs.ts`, `narration.ts`): capture, check, attack near the enemy king, trade, leaves own piece loose, pawn push, defends a piece, quiet move. Weight: `p' = p · exp(style · features)`, renormalise, keep the 2% floor (computed on Maia's original p, so style tilts but never adds a move no human would play). Plus a **temperature** per coach (higher for Pip, lower for Heron). First pass:
   - Pip: none (plain Maia), slightly higher temperature.
   - Otter: + captures, even poisoned ones; − defending own pieces.
   - Rusk (fox): + checks, attacks near the king, pawn storms, sacrifices; − quiet moves and trades.
   - Badger: + trades (when level or ahead), defending, solid pawns; − opening its own king.
   - Moss (tortoise): + quiet moves, keeping the structure, defended pieces; − early attacks, loose pieces.
   - Heron: blend toward Stockfish's top moves (needs the analyst's search of the position), lower temperature.
   Styles are data on the coach (1.14's `playingStyle` field), not code per coach.
3. **Strength stays honest.** A style changes real strength (a greedy otter at 800 may play like 650). A script (`npm run styles`, like `npm run concepts`) plays N games of each styled coach against plain Maia at the same rating and records average centipawn loss per move (Stockfish) and the score; tune each coach's Maia rating until its real strength matches the shown rating. Record the numbers in STATE. Narration is already honest about weak moves (rule 2: compared with Stockfish's best); the phrase bank may own a greedy grab ("Free pawn! …wait"), never praise it.
- Sparring uses the same style (it is how the coach plays); the player can pick any coach to practise against a style (spec).
- **Done when:** unit tests for the reweighting (features from real FENs; the floor holds; a zero style equals plain Maia); the book is followed and left correctly (tests with a transposition); the strength script runs and its numbers are in STATE; a game per coach in the browser shows the style (e.g. the fox gambits and checks, the badger trades down).

---

## Phase 2: In-browser coach voice
Feasibility: Qwen3.5 2B is close but slow on integrated GPUs; templates stay the main voice.
- ⬜ 2.1 Model loading UX: optional download, progress, WebGPU check, warm-up before the game, template fallback.
- ⬜ 2.2 Rephrasing layer: the model rewrites template sentences in the persona's tone. A claim check rejects any output that adds squares, moves or pieces not in the facts; otherwise fall back to the template.
- ⬜ 2.3 Plans in text or voice: the model extracts `{move, piece, target, reason, condition}` (JSON schema); board code checks the premise; Stockfish gives the verdict; feedback categories from the spec.
- ⬜ 2.4 Ask the coach: fixed question types first ("Why did you play that?", "Is my knight safe?"), answered from facts.

## Phase 3: Puzzle drills
Designed with the user (Nov 27). Needs 1.14 (coaches, puzzle specialties); shares the practice scheduler with Openings (6.3), whichever is built first owns `src/app/practice.ts`. Note the decisions in STATE.

**Agreed design**
- **A Puzzles tab** (rail entry). The player picks a **coach** (default: your tier's coach); the coach sets the **difficulty band** and the theme. Any coach can be picked.
- **One pool, coaches are a filter.** A build script reads the full Lichess puzzle database (CC0, downloaded by hand, never fetched at runtime) once and keeps a broad sample: every theme we may use × every rating band. A coach's set = its `specialty.puzzleThemes` (1.14) at its band, chosen from the pool at runtime. Moving a theme between coaches is a data change, no rebuild.
- **A wrong move is not a fail:** a sideline shows why it doesn't work (the refutation, Lines chart), then the player retries. It still counts as a miss (the puzzle comes back sooner).
- **No timer.**
- **Rule 1:** Lichess theme tags only choose puzzles. The coach names a concept only when our detectors (`concepts.ts`) confirm it; otherwise it words the line's facts without a name.
- **First version sources:** the coach's set, your own missed tactics, Today. Woodpecker sets after (3.4).
- **Skipped (decided):** "defend" puzzles from tactics the player allowed (many moves are safe, hard to grade).

### ✅ 3.1 Puzzle pool (Nov 27; STATE decision 37)
- New output beside `public/puzzles/sample.json` (keep that file: `npm run concepts` and its tests use it): `public/puzzles/pool/<band>.json`, one file per rating band so the app loads only the band it needs.
- Themes: the existing `THEMES` in `scripts/build-puzzles.mjs` plus those 1.14 added to the coach mapping (`oneMove`, `opening`, `kingsideAttack`, `pawnEndgame`, `endgame`, `rookEndgame`, `advancedPawn`, `long`, `veryLong`) and any other Lichess theme that matters below ~2000; check every name against the CSV's theme column.
- Bands: Lichess puzzle ratings in steps of about 200 from the lowest up to ~2200. Lichess puzzle ratings run higher than Chess.com's at the low end: write down each coach's band (Pip's must still be easy) in the coach data, and check with a few hand-solved samples.
- Per theme × band: ~300 puzzles, **quality-filtered** (popularity and number of plays above a threshold), a puzzle stored once even when it has several themes (index by theme). Fields: id, FEN, moves, rating, themes, opening tags (for later: Rusk's gambits).
- Check the total size (target a few MB, compressed by the server); commit the files (the app serves only our own static files).
- **Done when:** the pool builds reproducibly (fixed seed); tests on a small committed fixture cover the filters (theme, band, quality, dedupe) and that every theme in every coach's mapping has puzzles in that coach's band.

### ⬜ 3.2 Puzzle screen and the coach's set
- **Puzzles tab:** pick the coach ("Rusk's tricks"), see progress per theme (solved, missed, hints used).
- **One puzzle:** the opponent's first move (Lichess puzzles start with it) is animated; the coach can ask "What does their last move want?" first (principle 3). The player moves; the opponent's replies come from the puzzle's solution. A different move that also wins (e.g. another mate in 1 as the final move) is accepted, judged by Stockfish (as Lichess does).
- **Hints:** the existing hint ladder (4 steps), each step recorded with the result (spec: solved after hint 3 is not mastered).
- **Wrong move:** the sideline opens from that position with the refutation played out and explained (`lineexplain.ts`, the Lines chart), then "Try again" returns to the puzzle position. Counted as a miss.
- **Solved:** the coach names the concept if a detector confirms it, otherwise words what the line achieved; "Another skewer?" offers the next puzzle on the same concept.
- **Choosing the next puzzle:** from the coach's themes at its band, unseen first, a little harder after a run of clean solves and easier after misses (within the band).
- Results per puzzle stored on the device (`store.ts`, in the backup file): first-try solve, misses, hints used.
- **Done when:** a puzzle of each kind (one move, a multi-move combination, a mate with an alternative mating move) is played in the browser at 375×650 and desktop, including a wrong move with its sideline and a retry; tests for solution checking (alternative mates, wrong-move detection) and puzzle choice.

### ⬜ 3.3 Your mistakes and Today
- **Your missed tactics become puzzles:** the saved moments (live games and imports; the missed-tactic kinds) already hold the position and the engine's line; cut by the line rules (`lines.ts`, the player's level at the time) and keep only forcing solutions (the opponent's replies forced or clearly best, checked with the analyst). Shown in the coach's voice of the game they came from ("From your game vs Rusk, move 14").
- **The practice scheduler** (`src/app/practice.ts`, shared with 6.3 Drill): cards, due dates and results; a miss brings a card back after 1 day, a clean solve pushes it out (1, 3, 7, 14, 30 days).
- **Today:** a short session of what is due (missed puzzles, your-mistake puzzles, then a few new puzzles from your coach's set; opening drill cards too once 6.3 exists), ending with "Done for today" (the spec's engagement metric).
- **Done when:** a missed tactic from a real saved game shows up as a puzzle and is solvable; tests for turning a moment into a puzzle (a non-forcing line rejected) and for the scheduler (intervals, due order, a miss resets); a Today session played in the browser.

### ⬜ 3.4 Woodpecker sets (later; discuss with the user first)
A fixed set (e.g. 50 puzzles from the pool, by coach and theme) solved repeatedly in cycles, tracking accuracy per cycle until the patterns are instant (spec principle 6). The user chose no timer: whether cycle time is recorded silently (for a progress view) or not at all is to decide.

## Phase 4: Levels and placement
- ⬜ 4.1 Concept mastery tracking (from puzzles, hints used, tactics found in games).
- ⬜ 4.2 Placement diagnostic (~12 adaptive puzzles) and the rating shortcut.
- ⬜ 4.3 Graduation checks (puzzles, Sparring wins, real use) and the level-up screen.
- ⬜ 4.4 Levels 1–3 curriculum: lesson text drafted from verifiable claims, positions verified by Stockfish.

## Phase 5: Personas and art
- ⬜ 5.1 Coach personas (six since task 1.14, which adds the coaches, themes and phrase banks; left here: playing style per coach and tuning the voice): tone in short phrases, a playing style for each (Maia settings or opening choice), a "plain coach" setting.
- ⬜ 5.2 Your own theme packs and portraits with expressions (the asset list is in the spec).

## Phase 6: Openings
Designed with the user (Nov 27). Can start once 1.14 (coaches per tier) is done; it doesn't need Phases 3–5. Replaces the spec's "Openings" section (note it in STATE "Decisions" and the spec sync, 1.13): no "play it from the position" part, and the player picks freely.

**Agreed design**
- **An Openings tab** (a rail entry, room was left in 1.12j). The player picks an **opening**, a **side** (play it, or meet it) and a **coach** to learn from. Nothing is assigned; the theme follows the chosen coach.
- **Every opening is learnable from both sides.** E.g. the Vienna as White (how to play it) and as Black (how to meet it); the Caro-Kann as Black and as White (how to meet 1…c6). Each opening × side is its own course with its own tree.
- **Every opening is available with every coach.** The coach sets (a) which opponent replies are covered: what players at that coach's rating actually play, and (b) the depth. Prepare for what your level meets, not master theory.
- **One tree per course that grows.** Each node is tagged with the lowest coach tier whose filter includes it; learning with coach N covers every node with tier ≤ N. Moving to a stronger coach *adds* replies; lines from lower tiers are kept (they still come up against weaker players), their cards just come back less often. To go deeper, pick a stronger coach.
- **A coach's opening specialty** only means it plays that opening against you in games (1.15's book) and labels it "Rusk's favourites"; it never limits what you can learn.
- **Two parts: Learn and Drill.**
- **Text in three layers**, so the content does not depend on the developer's chess knowledge: (1) what each move does: board-checked idea tags worded by templates in the coach's voice, automatic; (2) what happens after each reply: Stockfish lines and `lineexplain.ts`, traps found automatically, automatic; (3) plans and structure: LLM-drafted at writing time, claims checked by script, edited for clarity by the developer, reviewed by the community. **Ship with layers 1–2 only**; layer 3 is 6.4.

**First catalogue (7 openings × 2 sides = 14 courses).** Required by the user: Vienna Game / Vienna Gambit, Caro-Kann. Chosen for under-1600 players (common at these levels, ideas that carry over, both sides useful):

| Opening | Start | Play it as | Meet it as |
|---|---|---|---|
| **Vienna Game / Gambit** | 1.e4 e5 2.Nc3 | White: the gambit 3.f4 where it works (e.g. vs 2…Nf6, 2…Nc6), the quiet Vienna (3.Bc4 / 3.g3) where it doesn't (e.g. vs 2…Bc5) | Black: e.g. 2…Nf6 and the …d5 counter-strike vs 3.f4 |
| **Caro-Kann** | 1.e4 c6 | Black | White: one simple system vs 1…c6 (e.g. the Advance) |
| Italian Game | 1.e4 e5 2.Nf3 Nc6 3.Bc4 | White | Black |
| Scotch Game | 1.e4 e5 2.Nf3 Nc6 3.d4 | White | Black |
| London System | 1.d4 + Bf4 | White | Black: one setup vs the London |
| Queen's Gambit | 1.d4 d5 2.c4 | White | Black: the Declined (…e6) |
| Scandinavian | 1.e4 d5 | Black | White |

The player's own moves in each course are chosen when building (Stockfish's top moves; at low tiers the simplest move within ~0.3 pawns of the best, preferring one system the player can reuse), and listed in the course file so they can be reviewed. The move choices above are a starting point for that build, not fixed.

### 🔶 6.1 Opening data pipeline (code done Nov 27; the first full build, its review and the moves list in STATE are left)
- **Catalogue:** the course list above as data (id, name, side, the moves that define it), names from the existing Lichess `chess-openings` data (`openings-data.json`, 1.7b).
- **Replies by rating, at build time only** (rule 4: nothing fetched at runtime): `scripts/build-opening-trees.mjs` queries the **Lichess opening explorer** (Lichess games, CC0) for each position, per rating band, with a local cache and polite rate limiting. **Check first:** the API's terms, rate limit and whether it needs a token; the rating bands it offers and how the six coaches' ratings map onto them (the lowest band vs Pip). Where the explorer has too few games, fall back to **Maia** at the coach's rating (run in Node or via the tests page) and mark the node as Maia-sourced.
- **Tree rules per coach tier** (first pass, tune by size): include an opponent reply if it is common at that tier's band (e.g. ≥10% at Pip, ≥5% at Ardea) **or** it is a trap: played ≥3% and Stockfish says it loses ≥2 pawns (teach the punishment). The player's move at each node: see above. Depth: about 4 player moves at Pip up to about 10 at Ardea (align with `levels.ts` `maxPlies` spirit). Every player move is Stockfish-checked (never a mistake by the level's `mistakeCp`).
- **Idea tags (layer 1):** per player move and per common reply, from board code: develops a piece, fights for the centre (attacks/occupies d4 d5 e4 e5), castles or prepares castling, opens a line for a piece, attacks a piece or pawn, pins, threatens mate, gambits a pawn (material given), takes back. Add the missing detectors in `facts.ts` (or a new `coach/opening-ideas.ts`) with tests on real positions.
- **Consequences (layer 2):** for each reply, Stockfish's best answer and the cut, taught line (`lines.ts`), stored so the screen needs no deep search; traps flagged.
- **Output:** one committed JSON per course (`public/openings/<course>.json`): nodes (FEN, move, who, tier, frequency per band, source explorer/Maia, tags, consequence line, eval). Check the total size.
- **Done when:** all 14 courses build; tests cover the tree rules (a trap included, a rare non-trap dropped, tiers nest: Pip's tree ⊆ Ardea's), the new idea detectors on real FENs, and every player move in every course passes the Stockfish check (a test over the files); the per-course player moves are listed in STATE for review.

### ⬜ 6.2 Openings tab and Learn
- **Openings tab:** list of courses (opening, side, a small board of the start), pick a coach (default: your tier's coach; theme switches); progress per course and coach (nodes learned / total).
- **Learn:** the coach walks the tree, most common line first, then the branches:
  - **Your move:** the coach asks first (principle 3: "What would you play here?"). Right → it names the idea (layer 1). Wrong → a sideline shows what goes wrong (the Lines chart) and you retry; a reasonable alternative is accepted with "that works too, but this course plays …".
  - **Their move:** "At this level, most players reply …Nf6 (60%), some play …Bc5 (25%)", each with its idea; then the course continues with each reply in turn. Traps get their own beat: "Some players grab …exf4? Here's how to punish it" (layer 2).
  - Deeper coaches say more per move: more tags shown, longer consequence lines, more replies covered; the coach's phrase bank (1.14) gives the voice.
- Starts from the initial position, playing the defining moves quickly (shown, not quizzed), so the player sees how the opening arises.
- Rule 1: every sentence comes from tags, the stored lines and templates; nothing hand-written yet.
- **Done when:** the Vienna (White) and Caro-Kann (Black) courses can be learned end to end with Pip and with Ardea in the browser at 375×650 and desktop; tests for the walk order and answer checking.

### ⬜ 6.3 Drill (spaced repetition of the lines)
- **Cards are positions, not whole lines:** each player node learned in 6.2 becomes a card (per course and coach tier).
- A drill plays a course from the start: you play your side; the opponent picks replies weighted by frequency at the coach's band, steering toward **due** cards. A miss shows the right move with its idea, and the card comes back sooner; a hit pushes it out (1, 3, 7, then 14, 30 days).
- **The scheduler is shared with puzzles** (Phase 3, 3.3): build it here as `src/app/practice.ts` (cards, due dates, results, stored on the device with `store.ts`; included in the backup file) if Phase 3 hasn't yet.
- Lower-tier cards stay in the deck after moving to a stronger coach (agreed), on their normal intervals.
- Occasionally, "Why this move?" with choices from the node's idea tags (the wrong choices must be tags that are false for that move, checked by code).
- **Done when:** tests for the scheduler (intervals, due order, a miss resets) and for the reply weighting toward due cards; a drill session played in the browser on a phone viewport.

### ⬜ 6.4 Layer 3: plans and structure (later, per opening)
LLM-drafted at writing time per course and coach (deeper for Moss and Ardea), e.g. "Black aims for …c5 to hit the centre". A script checks each concrete claim against the course's stored lines and explorer games (does …c5 happen? does the bishop go to b2?); unverifiable sentences are flagged and not shipped as fact. The developer edits for clarity (being a beginner helps); outlines go to the community for review (spec). Added one course at a time.

### ⬜ 6.5 Openings in games (to discuss with the user first)
Proposed, not agreed: in a live game, when the opponent leaves a course you've learned, the coach asks "They've left the book: which principle applies?"; in Review a moment "left your repertoire" ("you played 4.Bc4, your course plays 4.Ng5"); suggestions from the openings met in your games (1.7b data: "you faced the Caro-Kann in 9 of your last 20 games").

## Phase 7: Higher levels
- ⬜ 7.1 Levels 4–6 content and patterns, with input from stronger players.
