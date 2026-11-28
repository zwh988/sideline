// The coaches' phrase banks (task 1.14b, voice): a short phrase in the coach's
// own voice in front of the shared fact sentence. Agreed with the user line by
// line (docs/COACHES.md). Rules 1–2: a phrase never states or changes a chess
// fact and never calls the coach's own move good; the fact text stays as it is
// (`Remark.text`), the phrase is kept apart (`Remark.phrase`) and only joined
// for display. Phrases go through a budget (`Voice`): no joke on every move.

/** The moments a coach has lines for. */
export type Cue =
  | 'start' // game start
  | 'good' // your good move, or the tactic you found
  | 'mistake' // your mistake (or a missed tactic)
  | 'blunder' // your blunder
  | 'tactic' // a tactic is there for you
  | 'sawThreat' // you dealt with the coach's threat
  | 'thinking' // thinking aloud on its own move
  | 'ownSlip' // its own weaker move, said only once you punished it
  | 'solved' // puzzle solved
  | 'solvedFirstTry' // puzzle solved with no miss and no hint
  | 'missed' // puzzle: a wrong move
  | 'lessonRight' // opening lesson or drill: the right move
  | 'openingDone' // small talk: the opening is over
  | 'endgame' // small talk: the endgame
  | 'win' // the player won
  | 'loss' // the player lost
  | 'draw'
  | 'puzzlesTab' // greeting on the Puzzles tab
  | 'openingsTab' // greeting on the Openings tab
  | 'puzzleStart' // a new puzzle
  | 'lessonStart' // an opening lesson starts
  | 'lessonDone'; // an opening line or drill run is finished

export type VoiceBank = Record<Cue, readonly string[]>;

export const VOICES: Record<string, VoiceBank> = {
  // Beans, penguin: hip-hop kid, new to chess himself.
  coach1: {
    start: ['Yo, let’s get it!', 'Ayy, new game!', 'Headphones on. Let’s go!'],
    good: ['Yo, let’s GO!', 'Clean!', 'Ooh, that’s slick.', 'Sheesh!'],
    mistake: ['Uh oh, hold up…', 'Wait wait wait.', 'Hmm, wanna rewind that?'],
    blunder: ['Yo… WAIT.', 'Oh no no no.', 'Hold up, hold up!'],
    tactic: ['Psst… something’s cooking.', 'Ooh, I smell something.'],
    sawThreat: ['Ha, you caught that!', 'Aw, you peeped it.'],
    thinking: ['Lemme vibe on this…', 'Okay okay, my turn.'],
    ownSlip: ['Okay, that one was not my best.', 'My bad, my bad.', 'Lowkey messed that up.'],
    solved: ['Let’s GO!', 'You crushed it!', 'Easy!'],
    solvedFirstTry: [],
    missed: ['Nah, run it back!', 'So close! Again?'],
    lessonRight: ['Yesss!', 'You got it!'],
    openingDone: ['Okay, halftime!'],
    endgame: ['Endgame vibes.'],
    win: ['GG! You got me!'],
    loss: ['GG! Run it back?'],
    draw: ['Tie game. Respect.'],
    puzzlesTab: ['Yo, puzzle time!'],
    openingsTab: ['Openings, let’s GO.'],
    puzzleStart: ['Ooh, okay, check this one.'],
    lessonStart: ['Alright, let’s learn this one together.'],
    lessonDone: ['Ayy, we did it!'],
  },
  // Cheese, duck: unbothered, few words; an exclamation mark means a lot.
  coach2: {
    start: ['Hey. No rush.', 'Alright. Let’s play.', 'Take your time.'],
    good: ['Nice.', 'Smooth.', 'Mm. Clean.', 'Easy.'],
    mistake: ['Hm. Take a breath.', 'Easy now.', 'Slow down a sec.'],
    blunder: ['…Oh!', 'Whoa. Okay.', 'Hm. Look again.'],
    tactic: ['Look closer.', 'Something’s here. No rush.'],
    sawThreat: ['Ah. You saw it.', 'Mm. Good eyes.'],
    thinking: ['Let me sit with this.', 'Hm.', 'Okay.'],
    ownSlip: ['Eh. Not my finest.', 'Hm. Sloppy of me.', 'Oops. Mine.'],
    solved: ['Nice.', 'Smooth.'],
    solvedFirstTry: ['Oh, nice!'],
    missed: ['Eh, happens. Again.', 'Breathe. Try again.'],
    lessonRight: ['Yep.', 'That’s it.'],
    openingDone: ['Opening’s done. Breathe.'],
    endgame: ['Endgame. Slow is good.'],
    win: ['Well played. Really.'],
    loss: ['Good game. Again?'],
    draw: ['Even. Fair.'],
    puzzlesTab: ['Puzzles. No rush.'],
    openingsTab: ['Openings. Easy does it.'],
    puzzleStart: ['Mm. Take a look.'],
    lessonStart: ['Okay. Slow and steady.'],
    lessonDone: ['Nice. That’s a wrap.'],
  },
  // Jimmeny, cowboy jellyfish: loud, heavy Southern drawl, calls you "partner".
  coach3: {
    start: ['Howdy, partner! Y’all ready to DRAW?', 'This here town ain’t big enough for the both of us, partner.', 'Saddle up, partner. It’s high NOON.'],
    good: ['Well, I’ll be. Mighty fine shootin’, partner.', 'YEEHAW! Now that’s how ya do it, partner.', 'Dang, you’re quicker on the draw than I reckoned.'],
    mistake: ['WHOA there, partner!', 'Easy on that trigger, partner.', 'Now hold on just a minute, partner…'],
    blunder: ['Well, DANG, partner.', 'WHOA, WHOA, WHOA!', 'Lordy, partner… I reckon ya might wanna look again.'],
    tactic: ['I’m smellin’ gunpowder, partner.', 'Somethin’s fixin’ to happen here, partner.'],
    sawThreat: ['Hmph. Sniffed out my ambush, didja, partner?', 'Ya got sharp eyes, partner.'],
    thinking: ['Hold yer horses, partner, I’m aimin’…', 'Lemme chew on this a spell.', 'Steady now… steady…'],
    ownSlip: ['That there was… a warnin’ shot.', 'Aw, dang. Plumb misfired.', 'Sun was in my eyes, partner.'],
    solved: ['YEEHAW!', 'Fastest gun this side of the Mississippi!'],
    solvedFirstTry: ['Bullseye, partner!'],
    missed: ['Reload, partner. Ya got this.', 'Missed ’er! Saddle on back up, partner.'],
    lessonRight: ['Darn tootin’, partner!', 'Now yer ridin’!'],
    openingDone: ['Openin’s done, partner. Time to RIDE.'],
    endgame: ['Endgame, partner. Last ones standin’.'],
    win: ['Well, I’ll be. Ya outdrew me fair ’n’ square, partner.'],
    loss: ['Mosey on back anytime, partner.'],
    draw: ['A standoff, partner. Reckon that’s fair.'],
    puzzlesTab: ['Step right up, partner, puzzles for the brave!'],
    openingsTab: ['Every gunslinger needs an openin’, partner.'],
    puzzleStart: ['Here’s a varmint for ya, partner.'],
    lessonStart: ['Saddle up, partner, here’s how ya start.'],
    lessonDone: ['YEEHAW, that’s the trail done, partner!'],
  },
  // Kelpie, otter: warm and motherly, kindness before correction.
  coach4: {
    start: ['Hello, dear! Ready when you are.', 'Snack packed? Lovely. Let’s play.', 'Let’s have a nice game, sweetie.'],
    good: ['Oh, well done, dear!', 'That’s my clever one.', 'Ooh, look at you!', 'I knew you’d see it.'],
    mistake: ['Careful now, sweetie.', 'Oh, let’s slow down a moment, dear.', 'Hmm, let’s look at that together.'],
    blunder: ['Oh my!', 'Oh, sweetie, no…', 'Deep breath, dear. Let’s look.'],
    tactic: ['Have a good look, dear. There’s something here.', 'Take your time, sweetie.'],
    sawThreat: ['Oh, you saw that! Good.', 'Well spotted, dear.'],
    thinking: ['Let me have a little think.', 'Now then…', 'Mm, let’s see.'],
    ownSlip: ['Oh dear, I’ve muddled that one.', 'Silly me.', 'Well, nobody’s perfect, dear.'],
    solved: ['Oh, well done!', 'Lovely, dear!'],
    solvedFirstTry: ['First go, too! Clever thing.'],
    missed: ['That’s alright, dear. Have another go.', 'Nearly! Try again, sweetie.'],
    lessonRight: ['That’s it, dear!', 'Lovely, you remembered.'],
    openingDone: ['Opening’s done. Lovely.'],
    endgame: ['Endgame now, dear.'],
    win: ['Oh, you got me! I’m so proud of you.'],
    loss: ['Good game, sweetie. You’ll get me next time.'],
    draw: ['A draw! Well played, dear.'],
    puzzlesTab: ['Puzzles, dear! Take your time.'],
    openingsTab: ['Let’s learn some openings, sweetie.'],
    puzzleStart: ['Here’s a nice one, dear.'],
    lessonStart: ['Let’s go through this gently, dear.'],
    lessonDone: ['Well done, sweetie, all finished!'],
  },
  // Oscar, ostrich: a posh English gentleman; a strong British accent in every line.
  coach5: {
    start: ['Good afternoon, old sport. Shall we?', 'Right then. Jolly good, let’s begin.', 'Splendid day for a game, what?'],
    good: ['Splendid!', 'Jolly good show, old sport.', 'I say, rather well played.', 'Bravo! Top marks.'],
    mistake: ['I say, steady on.', 'Hmm. Rather loose, that.', 'Ah. Bit of a sticky wicket, old sport.'],
    blunder: ['Good heavens!', 'Well. That’s a spot of bother.', 'Oh, I say. Oh dear, oh dear.'],
    tactic: ['I do believe there’s something rather lovely here.', 'Have a proper look, old sport.'],
    sawThreat: ['Ah, you rumbled me. Well spotted.', 'Sharp as a tack, old sport.'],
    thinking: ['One moment, old sport.', 'Hmm, let me mull this over.', 'Right, then…'],
    ownSlip: ['Ah. Not quite cricket, that one.', 'Bit of a pig’s ear, I’m afraid.', 'Oh, bother. Frightfully sloppy of me.'],
    solved: ['Splendid!', 'Marvellous, old sport!'],
    solvedFirstTry: ['First time, no less! Bravo.'],
    missed: ['Not to worry. Chin up, have another crack.', 'Close, old sport. Once more.'],
    lessonRight: ['Quite right!', 'Spot on, old sport.'],
    openingDone: ['Opening’s concluded. Rather civilised.'],
    endgame: ['Ah, the endgame. My favourite bit.'],
    win: ['Well played, old sport. Thoroughly deserved.'],
    loss: ['Good game. Fancy another round?'],
    draw: ['Honours even. Most civilised.'],
    puzzlesTab: ['Ah, puzzles. Splendid exercise, old sport.'],
    openingsTab: ['Openings, old sport. Proper preparation.'],
    puzzleStart: ['Right then, a little conundrum.'],
    lessonStart: ['Let us begin properly, old sport.'],
    lessonDone: ['Jolly good. That’s the lot.'],
  },
  // Mortimer, frog: a retired schoolteacher in his sixties at his park table.
  coach6: {
    start: ['Pull up a chair, kid.', 'Ah, company. Sit, sit.', 'Let’s see what you’ve got.'],
    good: ['Hah. Not bad, kid.', 'Well, look at that.', 'Now that’s chess.', 'Gold star.'],
    mistake: ['Hmm. Think that one over.', 'Easy, kid. Look again.', 'Hmm. You sure about that?'],
    blunder: ['Oh, kid…', 'Well. Hm.', 'Oof. My knees felt that one.'],
    tactic: ['Take your time. It’s there.', 'Look closer, kid.'],
    sawThreat: ['Hah. Sharp one, aren’t you.', 'Caught that, eh? Good.'],
    thinking: ['Hold on, let an old man think.', 'Where are my glasses…', 'Mm. Let’s see.'],
    ownSlip: ['Bah. Getting old.', 'Eh. Even I nod off sometimes.', 'Well, that was a senior moment.'],
    solved: ['There it is.', 'Top of the class.'],
    solvedFirstTry: ['First go! Hah.'],
    missed: ['Again. We’ve got all afternoon.', 'Not quite. Once more, kid.'],
    lessonRight: ['That’s the one.', 'Mm-hm. Just like that.'],
    openingDone: ['Now the real game starts.'],
    endgame: ['Endgame. My favourite part of the day.'],
    win: ['Hah! Well played, kid. Class dismissed.'],
    loss: ['Good game. Same bench tomorrow?'],
    draw: ['Fair’s fair. A draw.'],
    puzzlesTab: ['Puzzles. Sharpen the old pencil, kid.'],
    openingsTab: ['Openings. Every game starts somewhere.'],
    puzzleStart: ['Here’s one for you, kid.'],
    lessonStart: ['Right. Today’s lesson, kid.'],
    lessonDone: ['Class dismissed. Good work.'],
  },
};

/** Rare moments: a phrase every time. The rest are rationed. */
const ALWAYS: ReadonlySet<Cue> = new Set<Cue>(['start', 'blunder', 'ownSlip', 'solved', 'solvedFirstTry', 'missed', 'win', 'loss', 'draw', 'puzzlesTab', 'openingsTab', 'lessonStart', 'lessonDone']);
/** Sparring keeps quiet: only the start, the end and a blunder. */
const SPARRING: ReadonlySet<Cue> = new Set<Cue>(['start', 'blunder', 'win', 'loss', 'draw']);
/** A rationed phrase needs at least this many bubbles without one before it (at most one in three). */
const RATION_GAP = 2;

/**
 * Generic openers of the plain sentences, which a phrase stands in for
 * ("Clean! That fork wins a rook.", not "Clean! Nice, that fork…"). Only these
 * exact prefixes are dropped; the rest of the text is untouched but for its
 * first letter's case. An opener that is the whole sentence (no fact in it)
 * leaves only the phrase.
 */
export const OPENERS: readonly string[] = [
  "Let's play! ",
  'Well played! ',
  'Nice, ',
  'Good eye: ',
  'Careful: ',
  'Bold! ',
  'Solved! ',
  'Not this one. ',
  'Good, you saw my threat.',
];

/** The plain text with a generic opener dropped, for showing after a phrase. */
export function afterPhrase(text: string): string {
  const opener = OPENERS.find((o) => text.startsWith(o));
  if (!opener) return text;
  const rest = text.slice(opener.length);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** What the bubble shows: the phrase, then the fact text (opener dropped). Without a phrase, the text as it is. */
export function voiced(text: string, phrase?: string): string {
  if (!phrase) return text;
  const rest = afterPhrase(text);
  return rest ? `${phrase} ${rest}` : phrase;
}

/**
 * Picks the coach's phrases: rare moments always get one, the rest at most one
 * bubble in three and never two in a row; lines rotate so none repeats until
 * the others of its kind were said. `plain` (the "plain coach" setting) drops
 * them all. Call `next` for every bubble, with or without a cue, so the ration counts them.
 */
export class Voice {
  private sinceLast = RATION_GAP;
  private used = new Map<string, Set<number>>();
  private last = new Map<string, number>();

  constructor(private random: () => number = Math.random) {}

  next(coachId: string, cue: Cue | undefined, opts: { plain?: boolean; sparring?: boolean } = {}): string | undefined {
    const phrase = cue && !opts.plain && (!opts.sparring || SPARRING.has(cue)) ? this.allowed(coachId, cue) : undefined;
    this.sinceLast = phrase ? 0 : this.sinceLast + 1;
    return phrase;
  }

  private allowed(coachId: string, cue: Cue): string | undefined {
    if (!ALWAYS.has(cue) && this.sinceLast < RATION_GAP) return undefined;
    const bank = VOICES[coachId];
    if (!bank) return undefined;
    // A coach with no first-try line uses its solved lines.
    const lines = cue === 'solvedFirstTry' && !bank.solvedFirstTry.length ? bank.solved : bank[cue];
    return lines.length ? this.pick(`${coachId}.${cue}`, lines) : undefined;
  }

  private pick(key: string, lines: readonly string[]): string {
    let used = this.used.get(key);
    if (!used || used.size >= lines.length) {
      used = new Set();
      this.used.set(key, used);
    }
    const free = lines.map((_, i) => i).filter((i) => !used.has(i) && (lines.length === 1 || i !== this.last.get(key)));
    const i = free[Math.floor(this.random() * free.length)] ?? 0;
    used.add(i);
    this.last.set(key, i);
    return lines[i];
  }
}

/** A blunder in the phrase bank's sense: this much lost (centipawns), as `coach.ts` counts one. */
const BLUNDER_LOSS = 500;
/** A sideline move this much worse than the best is a mistake for the phrase bank. */
const SIDELINE_MISTAKE_LOSS = 150;

/**
 * The moment for a move the player tried in a sideline, from the engine's rating of it: the best or an
 * excellent move is a good one, a move far below the best a mistake or a blunder, and the rest gets no phrase.
 */
export function cueForSidelineMove(r: { lane: 'best' | 'great' | 'good' | 'other'; lossCp: number }): Cue | undefined {
  if (r.lane === 'best' || r.lane === 'great') return 'good';
  if (r.lossCp >= BLUNDER_LOSS) return 'blunder';
  if (r.lane === 'other' && r.lossCp >= SIDELINE_MISTAKE_LOSS) return 'mistake';
  return undefined;
}

/** The moment for a Review moment, from its kind (the opponent's moments get no phrase: they are not the player's). */
export function cueForMoment(kind: string, lossCp?: number): Cue | undefined {
  if (kind === 'found-tactic') return 'good';
  if (kind === 'mistake') return (lossCp ?? 0) >= BLUNDER_LOSS ? 'blunder' : 'mistake';
  if (kind === 'missed-tactic') return 'mistake';
  return undefined;
}

/** A coach's line for a fixed spot (a tab's greeting): the first of its kind, the same each time, outside the budget. */
export function fixedLine(coachId: string, cue: Cue): string | undefined {
  return VOICES[coachId]?.[cue][0];
}
