# Sideline — Product Spec

Nov 23, 2026 · @zwhao

## Overview

A chess app where you play against an AI coach who thinks aloud, hints at the right moments and gives feedback on your ideas, so players learn to find tactics and plans, not just answers.

**The name.** Sideline has two meanings: in sports, the sideline is where the coach stands and guides you while you play; in chess, sidelines are the variations you explore, as in the play-it-out branches.

**Problem.** Beginner and improving players (roughly 400–1600) do puzzles and study openings, but in real games they still miss tactical ideas and don't know what to do in quiet positions. Engines tell them the best move but not how to think, and evaluations like "+2.3, Nf5" mean nothing to them.

**Target users.** Anyone from total beginner to about 1600 who wants to improve on their own. Not tailored to one person: the product adapts to the player's level. The first user is the developer (about 500 on Chess.com).

**Goals**

- Teach the way a real coach does: a thinking process, questions instead of answers, learning in real games.
- Improve players' tactic spotting and planning, shown in measurable game results.
- Short, enjoyable sessions on both phone and computer.
- Art and characters the player can customize (theme packs).

**Non-goals (for now)**

- Deep engine analysis tools, evaluation graphs, multi-line analysis boards.
- Large opening databases or memorizing long lines.
- Online play against other people.
- Players above about 1600–1800 (later, with expert help).

## Coaching principles

Every feature follows how real coaches teach, adapted for an app.

1. **Structured curriculum by level.** Small concepts in a deliberate order, many exercises per concept, testing before moving up. The structure is inspired by the Dutch Steps Method; the content is our own.
2. **A thinking process, not just answers.** Before each move: what did their move change or threaten? What are my checks, captures and threats? Compare candidate moves, then check for safety.
3. **Questions before answers.** The coach asks guiding questions, and its hints escalate only when the player is stuck.
4. **Think first, engine second.** The player states their idea before seeing the engine's verdict. The gap between the two is where learning happens.
5. **Playing out positions.** Convert a winning position or hold a draw against the coach.
6. **Repetition.** Repeat the same exercise sets until the patterns become instant (the Woodpecker approach).
7. **The engine decides what's true.** Stockfish and board checks supply every fact. The AI model only turns those facts into language and never judges positions itself.

## Core feature: the coached game

The player plays a full game against one coach character who plays at their level, thinks aloud on its own moves and comments on the player's moves only when it matters.

### The coach's three jobs

1. **Play at the player's level**, in a human-like way (see Platform and architecture: Maia).
2. **Think aloud on its own moves**, demonstrating the thinking process: what the player's last move changed, its own checks, captures and threats, its candidates, and why it chose its move.
3. **Respond to the player's moves**: praise, a warning, a hint, or silence.

One persona both plays and teaches, like a coach across the board. How much it reveals of its own plans is set by the mode.

### Modes

| Mode | Coach talk | Hints | Takebacks | Reveals its own plans |
| --- | --- | --- | --- | --- |
| Lesson | Frequent | Offered without asking | Allowed | Yes |
| Sparring | Serious moments only | Only on request | No | No |
| Review (after the game) | Walks through 3–5 key moments | Asks what you were thinking first | n/a | Yes |

### When the coach speaks

The coach mostly stays quiet. Rules, not the AI model, decide when it speaks. Default budget: at most one remark every few moves, except for the triggers below.

| Trigger | What the coach does |
| --- | --- |
| A tactic is available to the player | Hints without revealing: "There's something strong here, take your time." |
| The opponent has a threat the player may miss | Asks: "Before you move, what does my last move want?" |
| The player made a mistake (within their level's concepts) | Explains briefly and offers a takeback, in modes that allow it |
| The player found a good move or tactic | Short praise naming the pattern: "Nice, that pin wins material." |
| A new phase starts | Planning prompt: "The opening's done. Which of your pieces isn't doing anything?" |
| Nothing important | Silence |

### Step-by-step hints

Each hint reveals a little more, only when the player asks again:

1. Something is here ("There's a tactic in this position.")
2. Where to look ("Look at their king and rook.")
3. Which piece ("Your knight can do something.")
4. The answer, with an explanation.

Hints used are recorded, so a puzzle solved after hint 3 doesn't count as fully mastered.

### Explain your idea

The player can show what their move is meant to do, and the coach gives feedback on the reasoning, not just the move. It handles two kinds of ideas: lines and plans. It's optional: the coach asks at key moments, and an "Explain" button is always available.

**Lines** ("my knight goes here, their king must move, then I take the queen"):

- **Arrows by tapping:** tap a piece, then a square. No dragging, so it is precise on a phone.
- **Arrows snap to legal moves;** an illegal arrow shows as invalid immediately.
- **Automatic order and colors:** arrows are numbered 1, 2, 3, with one color for the player's moves and another for the opponent's replies. Undo removes the last arrow.
- **Play it out:** for lines longer than 2–3 moves, the player moves pieces in a branch (see Branches below). Every move is legal by construction.
- Lines are checked move by move against the engine and board code.

**Plans** ("Re1, because the central pawns may be traded and the e-file may open"):

1. Entered as free text or voice.
2. The AI model turns the words into a structured claim: piece, target, reason, condition.
3. Board code checks the premise: file status, pawn tension, locked structures.
4. Stockfish gives the verdict: is the move among its top moves, and do its lines carry out the plan?

Feedback falls into one of these:

- **Good idea, good move.**
- **Good idea, wrong timing:** a threat or a more urgent move comes first.
- **False premise:** e.g. locked pawns mean the file won't open.
- **Right move for the wrong reason,** or **wrong move but a good idea.**

Plans are judged with stated uncertainty ("the engine agrees this is one of the best moves", never "this is correct"). Good reasoning is praised at every level, even when another move was better. The AI model never decides by itself whether the player is right.

### Ask the coach

At any time the player can ask: "Why did you play that?", "What should I think about here?", "Is my knight safe?" Answers follow the same rule: facts from the engine and board code, wording from the AI model.

### Honest narration

The coach sometimes plays weaker moves to match the player's level. Its narration must never claim those moves are good. Two allowed patterns:

- Human-like moves, narrated honestly, mistakes included.
- Deliberate teaching traps in Lesson mode: "I'm leaving something loose here. Can you spot it?"

### Branches: play it out

The coach can step off the game into a side line, play it out with the player, explain the result, then return to the game or merge a good line into it.

1. **Start:** the coach suggests a branch ("Let's see what happens if you take that pawn"), or the player taps "What if?" or enters a line through "Explain your idea".
2. **Play:** the player makes their moves; the coach plays the opponent's best replies (Stockfish, not level-matched play) and comments as the line goes.
3. **End:** the coach ends the branch using the line rules below, or steers the player back if they wander into random moves.
4. **Verdict:**
   - **Bad line:** the coach explains why, returns to the branch point, and the player tries something else, possibly in a new branch.
   - **Good line:** the coach confirms it, and the player can merge it.

**Merging**

- Only the player's first move of the branch becomes the real game move. In the real game the coach plays at the player's level and may reply differently, and it says so.
- From the current position, merging plays that move. From an earlier position (after a mistake), merging means taking back moves, so it's only available in modes that allow takebacks.

**Rules**

- Always visible when in a branch: tinted board border and a breadcrumb trail (*Game → What if 14.Nxe5 → What if 15…Qd4*).
- At most two branches deep.
- The game clock pauses during branches.
- Offered freely in Lesson mode, not in Sparring games, and the main tool in Review.
- At low levels the coach shows the simplest refutation, not necessarily the engine's most precise one.
- The coach can also branch while thinking aloud: "I considered taking your knight, but look what happens…"
- All branches are saved with the game as standard side lines (PGN variations), for review and export.

### Which lines get taught

Stockfish's main line can run 20+ moves; only the forcing stretch up to the payoff is taught. Board code walks the line move by move and cuts it at the first point where all three hold:

1. **The payoff has happened:** material has changed and stays changed, or there's checkmate or an unavoidable forced mate.
2. **Nothing is left to settle:** no pending recaptures, checks or immediate threats. Never cut mid-exchange.
3. **Material matches the engine's evaluation.** If the engine still shows much more advantage than the material, extend the line or explain the rest as a positional point.

| Level | Max taught line length (moves by both sides) |
| --- | --- |
| 1–2 | 2–4 |
| 3–4 | about 6 |
| 5–6 | 8–10 |

A payoff beyond the maximum isn't flagged as a missed tactic; at most it's mentioned as a deeper idea for later.

**Forced or not:** at each opponent move in a taught line, Stockfish also checks the second-best reply. If it is much worse, the move is narrated as forced. If it is about as good, the line branches: mention the alternative, or let the player explore it.

These rules define "missed tactic" across the app: in game review, in coach triggers, and in turning missed tactics into puzzles.

### Facts for whole lines

Comments explain lines, not just single moves. Board code annotates each move of the cut line (capture, check, forced reply, double attack, material change) and tags the motif. The AI model receives these annotated facts and explains the idea behind the line ("the bishop sacrifice drags your king to f7 so the queen can fork"). It never reads raw moves and works out the chess itself.

## Level system

Six levels, each defined by the concepts mastered, not by rating. The player sees one level number. Underneath, the app tracks mastery of each concept, which drives drills, game prompts and review.

| Level | Rough Chess.com rating | Main concepts |
| --- | --- | --- |
| 1 | under 400 | Piece safety, safe trades, basic checkmates (queen or rook vs. king) |
| 2 | 400–700 | Double attacks and forks, mate-in-1 and mate-in-2 patterns, opening principles |
| 3 | 700–1000 | Pins, skewers, discovered attacks; a simple repertoire with its ideas |
| 4 | 1000–1300 | Removing the defender, deflection, combining motifs; basic king and pawn endgames |
| 5 | 1300–1600 | Weak squares, open files, good vs. bad pieces, pawn structure |
| 6 | 1600+ | Deeper calculation, anticipating opponent plans, harder endgames |

Rating bands are a placement guide only. Lichess ratings run a few hundred points higher at the low end. The final concept order is set from puzzle data (see Curriculum approach).

### Placement

- Adaptive diagnostic of about 12 puzzles, about 5 minutes: starts in the middle, gets harder or easier with each answer.
- Optional shortcut: enter a Chess.com or Lichess rating.
- The player can always pick a level by hand.

### Graduation (all three required)

1. **Puzzles:** at least 80% on the level's themes, within a time limit, with few hints.
2. **Games:** beat the level's coach in Sparring mode, for example 2 of the last 3 games.
3. **Real use:** the player finds the level's tactics when they come up in games, not only in puzzles.

No forced demotion. A struggling player is offered a review of weak concepts or games against the previous coach.

### What the level controls

- Opponent strength and the coach persona
- Which mistakes and missed tactics get flagged (only concepts the player has reached)
- How quickly and how directly hints come
- Default takeback rules and how talkative the coach is
- Puzzle difficulty and themes
- Depth of the opening repertoire

## Coach personas

Each level has its own coach character. Personality changes tone and playing style, never the teaching facts: every persona runs on the same engine-checked feedback.

| Level band | Tone | Playing style | What the style teaches |
| --- | --- | --- | --- |
| Beginner | Warm, patient, encouraging | Simple, natural moves | Building confidence and basic patterns |
| Improving | Playful, cheeky | Early attacks and gambits | Staying safe and punishing over-aggression |
| Intermediate | Calm, methodical | Slow and solid | Making plans when nothing is happening |
| Advanced | Dry, Socratic | Precise, punishes loose play | Calculating and justifying every move |

Names, looks and exact voice are open for the developer to design.

**Rules**

- Personality lives in short phrases, never paragraphs. No joke on every move.
- A "plain coach" setting keeps all the content and drops the character.
- The player's level sets a default coach, but any coach can be picked, for example to spar deliberately against a weaker or stronger style.
- Moving up a level introduces a new coach, with its own default board and pieces.

## Companion modes

Puzzle drills and openings reuse the same coach, engine, hints and level system. They feed into coached games, and coached games feed back into them.

### Puzzle drills

- **Source:** the free Lichess puzzle database, filtered by the player's level (puzzle rating) and by theme (fork, pin, skewer and so on).
- **Coaching:** the same step-by-step hints as in games. The coach can ask the player to explain their idea before moving.
- **Repetition:** Woodpecker-style sets solved repeatedly, tracking speed and accuracy.
- **From games:** tactics the player missed in coached games become puzzles in their own set, with spaced repetition (back after 1 day, then 3, then 7).

### Openings

- **A small repertoire taught through ideas,** not long memorized lines. The coach explains why each move is played ("this develops a piece and fights for e5").
- **Drills** with spaced repetition, covering the ideas as well as the moves.
- **Leaving the prepared lines:** when the opponent plays something new, the coach asks which principle applies.
- **Practice in games:** coached games can start from the player's repertoire positions.
- Repertoire depth grows with level; at Levels 1–2 it is mostly principles.

## Curriculum approach

The curriculum is assembled from public sources and data and checked automatically, so it doesn't depend on the developer's own chess strength or on expert reviewers.

- **Order:** follow the widely agreed teaching order for beginner and intermediate players. Copy no other curriculum's lessons or exercises.
- **Difficulty from data:** use the Lichess puzzle database's ratings and theme tags to measure how hard each concept is, and place concepts and exercises accordingly.
- **Drafting:** the AI model drafts lesson text and picks example positions; Stockfish verifies every position and line; the developer edits for clarity. Being a beginner helps judge what is confusing.
- **Only verifiable claims,** especially at Levels 1–4: "the knight attacks the king and rook at once" can be checked on the board; "this is strategically sound" can't.
- **Results as reviewer:** track whether puzzle accuracy on a theme improves after its lesson. If it doesn't, rewrite the lesson.
- **Free community feedback:** post curriculum outlines to r/chessbeginners, the Lichess forums and chess Discord servers.
- **Scope:** build Levels 1–3 first. Get stronger players' input before writing the higher levels.

## Art and theming

All visuals load from theme packs, so the app ships with free placeholder art first and the developer's own art replaces it file by file, with no code changes.

### Theme packs

A theme pack is a folder of images plus a small settings file the app reads. Each coach has a default pack; the player can mix pieces, board and coach freely and override any default.

### Placeholder strategy (no art yet)

- **Board:** two flat square colors defined in the settings file. No image or license needed.
- **Pieces:** a free open-source set from the ones Lichess uses ([license list](https://github.com/lichess-org/lila/blob/master/COPYING.md)). Pick by license:
  - **Easiest to ship:** rhosgfx (CC0, public domain); chessnut (Apache 2.0); fantasy, spatial or celtic (MIT).
  - **Fine with a credit line:** kiwen-suwi, Firi, totoy, papercut (CC BY 4.0).
  - **Avoid for a public release:** cburnett and merida are GPLv2+, which can impose license terms on the app; many others (staunty, california, horsey) are non-commercial only.
- **Coach portraits:** a colored circle with the coach's initial and a one-word expression label ("thinking"), drawn in code. Good enough to test when expressions change.
- **UI icons:** an open icon set such as Lucide (ISC license).
- **Sounds:** none at first; add a free sound pack later after checking its license.

### Asset list

What to draw, or source as a placeholder. MVP = needed for the first coached game.

| Asset | Count | Format and size | Placeholder | Phase |
| --- | --- | --- | --- | --- |
| Pieces (K, Q, R, B, N, P × white, black) | 12 | SVG, square canvas, centered, same base line | rhosgfx or chessnut set | MVP |
| Board squares (light, dark) | 2 colors, or 1 texture tile | Colors in settings, or tileable PNG 512 px | Two flat colors | MVP |
| Highlights: last move, selected piece, legal-move dot, capture ring, check, hint arrow | 6 | Colors or small SVGs | App defaults | MVP |
| Coach portrait expressions: neutral, thinking, pleased, concerned, surprised | 5 (first coach) | SVG or PNG 512 × 512, readable at 64 px | Initial in a circle + label | MVP |
| Coach accent color (speech bubble, UI) | 1 per coach | Color in settings | App default | MVP |
| App icon | 1 | PNG 1024 × 1024 (scaled down) | Plain glyph | MVP |
| UI icons: hint, takeback, explain, flip board, settings, voice, back, menu | \~8 | SVG 24 px grid | Lucide | MVP |
| Remaining coaches' portraits | 3 coaches × 5 expressions = 15 | As above | Initial in a circle | Later |
| Per-coach piece set and board | Up to 3 more sets of 12 pieces + board | As above | Reuse MVP set | Later |
| Level badges | 6 | SVG, readable at 32 px | Numbered circle | Later |
| Level-up / graduation illustration | 6 (one per level) | PNG or SVG, about 1080 px wide | Text-only screen | Later |
| Sounds: move, capture, check, castle, game end, hint | 6 | Short MP3 or OGG | Silent | Later |
| Animated expressions | Optional | Sprite sheets | Static images | Later |

### Checks for custom art

- **Readable at small sizes:** on a phone a square can be about 40 px wide. Knight and bishop must be easy to tell apart; the two sides must contrast clearly.
- **Highlights stay visible:** hint arrows and the last-move highlight must show on textured or busy squares.
- **Consistent framing:** all pieces centered in a square canvas on the same base line, so they don't jump between squares.

## Platform and architecture

Everything runs in the player's browser, so the app is a static site hosted free on GitHub Pages, with no server and no AI bill.

&#91;embedded content: one coached move · from analysis to comment\]

Stockfish and board code produce every fact, for the whole line; rules decide whether the coach speaks; the AI model only turns facts into words.

### Components

- **Board and UI:** board, move input, arrows, branches, coach bubble, theme packs.
- **Stockfish (WebAssembly):** analysis of every position, including second-best replies to check whether moves are forced. Lower search depth on phones saves battery and is still far stronger than needed at these levels.
- **Fact extractor:** board code that cuts the engine's line to its taught part, annotates each move, tags the motif, and checks the player's claims.
- **Trigger rules:** decide whether the coach speaks, based on level, mode and the comment budget.
- **Opponent move choice:** Maia, a research engine trained on Lichess games to play like humans at given ratings. Stockfish with weakness settings is the fallback.
- **Coach voice, in three tiers on the same facts:**
  1. **In-browser AI model (main voice):** a small open model (about 1–3B parameters) run with WebLLM over WebGPU. Downloaded once (roughly 0.75–2 GB) and cached. Explains the ideas behind lines and plans, voices the persona, answers questions.
  2. **Templates (fallback):** fixed sentences filled from the facts, for devices without WebGPU or before the model has downloaded. Can narrate short forcing lines, not ideas or plans.
  3. **Cloud model (optional, later):** only if small models turn out too weak at explaining ideas.
- **Puzzle data:** a filtered subset of the Lichess puzzle database, bundled by level and theme.
- **Progress:** stored on the device; no accounts at first.

### Hosting

- **GitHub Pages,** free for static sites up to 1 GB, with a soft limit of 100 GB of bandwidth a month. Not allowed for a commercial service, so a paid version would need to move.
- **Multi-threaded Stockfish** needs COOP/COEP headers, which GitHub Pages can't set. Use the coi-serviceworker workaround, or the single-threaded build (plenty at these levels).
- **If a server is ever needed** (cloud model, accounts): a Cloudflare Worker on the free plan (100,000 requests a day) can hold an API key.

### Speed and offline

- Coach comments on its own moves can take a few seconds, which reads as the coach thinking.
- Hints on the player's turn must feel instant: prepare them in the background while the player thinks.
- After the first download everything works offline, including the coach. Template-only devices also work offline.

### Phone layout

- The board takes most of the screen.
- The coach appears as a compact bubble or a pull-up drawer, not a side panel.
- Lines are entered by tapping arrows or playing them out; plans by voice or text.

## Metrics, roadmap and open questions

Success means players find more of the tactics available to them and make better quiet moves, measured in their own games.

### Metrics

- **Tactic conversion rate:** of the tactics available to the player in games, the share they found, by motif.
- **Quiet-position accuracy:** how often the player's move is among the engine's top 3 in non-tactical positions.
- **Lesson effect:** puzzle accuracy on a theme before vs. after its lesson.
- **Engagement:** days per week with a completed session; share of sessions reaching "done for today".

### Roadmap

1. **Coached game (MVP):** level-matched opponent, line facts and cutting rules, template comments, coach thinking aloud, hints, takebacks, branches, explaining ideas with arrows, one coach, placeholder art. Done when the developer prefers it to playing bots on Chess.com.
2. **In-browser coach voice:** WebLLM model as the main voice; explaining ideas behind lines; plans in text or voice; asking the coach questions.
3. **Puzzle drills:** Lichess puzzles by level and theme, step-by-step hints, missed tactics from games, spaced repetition.
4. **Levels and placement:** diagnostic, graduation checks, concept mastery tracking, Levels 1–3 curriculum.
5. **Personas and art:** four coaches, the developer's own theme packs, portraits with expressions.
6. **Openings:** idea-based repertoire, drills, starting games from repertoire positions.
7. **Higher levels:** Levels 4–6, with input from stronger players.

### Risks

| Risk | Mitigation |
| --- | --- |
| The AI model states false chess facts | Facts only from Stockfish and board code, annotated move by move; the model words them; claims checked before display |
| A small in-browser model explains ideas poorly | Test early on real lines; larger model on computers; templates as fallback; cloud model as a last resort |
| Model download too large or slow on phones | Smallest model that explains well; download once and cache; templates until it's ready |
| Older devices without WebGPU | Template comments; everything else works |
| The coach talks too much and players stop reading | Rule-based triggers, comment budget, Sparring mode, plain-coach setting |
| The opponent doesn't feel human at low levels | Maia for move choice; tune and test early |
| Branches confuse players | Visible branch state, breadcrumb trail, at most two levels deep |
| Curriculum quality without expert reviewers | Data-driven ordering, verifiable claims only, lesson-effect tracking, community feedback |
| Placeholder art licenses | Use CC0, MIT, Apache or CC BY sets; avoid GPL and non-commercial sets for a public release |

### Open questions

- Can Maia run well enough in a phone browser?
- Which in-browser model size explains the ideas behind lines well enough on phones?
- Does the explain-the-idea step need a larger model on computers than on phones?
- Free tool, or eventually paid? (Paid would mean moving off GitHub Pages.)
- Coach names, looks and voices for the four personas.

### Sources

- [Lichess COPYING.md: piece set licenses](https://github.com/lichess-org/lila/blob/master/COPYING.md)
- [GitHub Pages limits](https://docs.github.com/pages/getting-started-with-github-pages/github-pages-limits)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits)
- [WebGPU support in major browsers (web.dev)](https://web.dev/blog/webgpu-supported-major-browsers)
- [WebLLM](https://github.com/mlc-ai/web-llm)
- [coi-serviceworker approach for GitHub Pages](https://docs.wasmer.io/javascript-sdk/how-to/coop-coep-headers)
