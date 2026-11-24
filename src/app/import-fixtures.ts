// Real games and positions for the import tests. Every move is legal (chess.js reads them).

/** Morphy's Opera Game, annotated: comments, clock tags, a NAG and a variation (which import drops). */
export const OPERA_ANNOTATED = `[Event "Paris"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 {[%clk 0:09:58]} e5 2. Nf3 d6 3. d4 Bg4 $1 {A pin on the knight.} (3... exd4 4. Nxd4 {Equal.})
4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7
12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0
`;

/** Starts from a position: 1.Nxc7+ forks king and rook. */
export const FORK_FEN = 'r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1';
export const FORK_PGN = `[Event "Training"]
[White "me"]
[Black "them"]
[Result "*"]
[SetUp "1"]
[FEN "${FORK_FEN}"]

1. Nxc7+ Kd7 2. Nxa8 *
`;

/** 5.Bc4?? loses the queen to Nxd4 (a mistake the level-2 coach flags). */
export const SCOTCH_FEN = 'r1bqkbnr/ppp2ppp/2np4/8/3QP3/5N2/PPP2PPP/RNB1KB1R w KQkq - 1 5';
export const BAD_MOVE_PGN = `[Event "Casual"]
[Site "https://lichess.org/AbCdEfGh"]
[Date "2026.11.20"]
[White "wei"]
[Black "rival"]
[Result "0-1"]
[WhiteElo "800"]
[BlackElo "850"]
[TimeControl "600+0"]
[Termination "Normal"]

1. e4 e5 2. Nf3 d6 3. d4 exd4 4. Qxd4 Nc6 5. Bc4 Nxd4 6. Nxd4 Nf6 0-1
`;

/** Chess.com's format: "1..." after every comment, clock comments, extra tags. */
export const CHESSCOM_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.11.01"]
[Round "-"]
[White "SomePlayer"]
[Black "Rival99"]
[Result "1-0"]
[CurrentPosition "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3"]
[Timezone "UTC"]
[ECO "C50"]
[UTCDate "2026.11.01"]
[UTCTime "10:00:00"]
[WhiteElo "1204"]
[BlackElo "1190"]
[TimeControl "600"]
[Termination "SomePlayer won by resignation"]
[Link "https://www.chess.com/game/live/123456"]

1. e4 {[%clk 0:10:00]} 1... e5 {[%clk 0:10:00]} 2. Nf3 {[%clk 0:09:58.1]} 2... Nc6 {[%clk 0:09:57.3]} 3. Bc4 {[%clk 0:09:50]} 3... Nf6 {[%clk 0:09:45]} 1-0
`;

/** A Lichess game as the API returns it. */
export const LICHESS_PGN = `[Event "Rated Blitz game"]
[Site "https://lichess.org/HqjDTU4A"]
[Date "2026.10.14"]
[White "wei"]
[Black "DrNykterstein"]
[Result "0-1"]
[UTCDate "2026.10.14"]
[UTCTime "17:24:06"]
[WhiteElo "1500"]
[BlackElo "2800"]
[Variant "Standard"]
[TimeControl "180+0"]
[Termination "Normal"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 0-1
`;
