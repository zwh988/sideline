// Real rows of the Lichess puzzle database (CC0, the 2026-11 file), columns
// PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags.
// Chosen to cover the pool's filters (puzzlepool.test.ts): low popularity, few
// plays, an unsettled rating, ratings outside the bands, puzzles with several themes.
export const FIXTURE_CSV = `U2YyE,5rk1/5p2/p5p1/r1qBPb1p/5P2/8/4Q1PP/3R1R1K b - - 3 29,f8d8 d5f7 g8f7 d1d8,807,88,91,2106,crushing discoveredAttack middlegame short,https://lichess.org/game/6UJp6qYr/black#58,
U2aN7,r3k1nr/ppp2ppp/3p1q2/2b1p2P/2P1P3/N2P1Q1P/PP3P2/R1B1KB1R w KQkq - 1 10,f3d1 f6f2,922,78,66,153,attackingF2F7 mate mateIn1 middlegame oneMove,https://lichess.org/game/krv2wfPi#19,Kings_Knight_Opening Kings_Knight_Opening_Normal_Variation
U2dEB,8/6k1/8/p4RPp/7P/8/r5K1/8 w - - 0 46,f5f2 a2f2 g2f2 a5a4 f2e2 a4a3 e2d1 a3a2,732,82,100,624,advancedPawn crushing endgame quietMove rookEndgame veryLong,https://lichess.org/game/8FTFWAu2#91,
U2ejK,2k2r2/pp1n4/1P2p3/P2pP3/B1pPr1pp/Q1P1q3/1R4PP/R5K1 w - - 1 33,g1h1 e3e1 a1e1 e4e1,924,106,96,721,backRankMate mate mateIn2 middlegame sacrifice short,https://lichess.org/game/I52hkXxc#65,
U2gbk,2k2bnr/1pprpNpp/8/1P6/4q3/Q3P3/1P1PKP1P/n1B2R2 b - - 1 17,e4c4 d2d3 c4d3 a3d3 d7d3 e2d3,1061,80,90,501,advantage defensiveMove long middlegame,https://lichess.org/game/D3lRYaYU/black#34,Reti_Opening Reti_Opening_Reti_Accepted
U2MZc,5r2/pp4k1/4N1p1/5p2/2Q1q2P/2P3PK/8/8 b - - 1 33,g7h6 c4e4 f5e4 e6f8 e4e3 h3g2,1392,75,97,5208,advantage defensiveMove endgame long,https://lichess.org/game/JJ0x7ASY/black#66,
U2PG5,1b2r1k1/pp3ppp/3p4/2pN4/2P5/1P1n4/PB3qPP/R2Q3K w - - 0 20,d1d3 e8e1 a1e1 f2e1 d3f1 e1f1,1058,81,88,304,kingsideAttack long mate mateIn3 middlegame,https://lichess.org/game/BgKSGRRv#39,
U2Qb0,3r2k1/p4q1p/1p4p1/2p5/3r4/7Q/PPB2PPP/5RK1 b - - 0 23,f7a2 c2b3 a2b3 h3b3,1301,77,88,395,advantage endgame fork short,https://lichess.org/game/KXBqCTHh/black#46,
U2TaL,2r5/bp1k1pp1/p3p3/3pPn2/PP3P1p/7P/1BN1K1P1/5N1R w - - 3 24,c2e3 a7e3 f1e3 f5g3 e2f2 g3h1,1887,80,92,887,crushing exposedKing fork long middlegame,https://lichess.org/game/gOe7sJzd#47,
U2tFf,8/6p1/8/7P/4k1K1/8/8/8 b - - 1 63,e4e5 g4g5 e5d6 g5g6,991,86,95,1096,crushing endgame master pawnEndgame short,https://lichess.org/game/Guuaq4zs/black#126,
U2upj,8/4k3/6PK/2p5/1p2p3/8/8/8 b - - 4 48,e7f8 h6h7 f8e7 g6g7 e4e3 g7g8q,1404,76,82,514,advancedPawn crushing endgame long pawnEndgame promotion,https://lichess.org/game/c6OjHmUT/black#96,
U2xn1,7r/6pp/2npk3/1R6/3P4/2P5/PP4PP/6K1 b - - 0 22,h8f8 d4d5 e6e5 d5c6,1020,77,89,65,crushing discoveredAttack discoveredCheck endgame fork short,https://lichess.org/game/nSLuxlQW/black#44,
U2zKt,2Q2qk1/3P3p/1p6/8/8/P5r1/7K/8 b - - 1 45,g3g6 c8f8 g8f8 d7d8q,1175,75,88,606,advancedPawn attraction crushing endgame promotion short,https://lichess.org/game/RGyeZ66q/black#90,
U2pdQ,8/8/3k2B1/2n1p2p/p7/4K1P1/5P2/8 w - - 0 42,g6h5 a4a3 h5f7 c5e6 e3d2 a3a2,1328,77,93,243,advancedPawn crushing endgame long quietMove,https://lichess.org/game/gXcwBENo#83,
U2oI6,2kr2r1/Rp3p1p/2p1pK2/5n2/8/6B1/P4PPP/5R2 b - - 2 24,f5h6 a7a8 c8d7 f1d1 d7e8 d1d8,1126,77,100,613,endgame long mate mateIn3,https://lichess.org/game/hshOjH6d/black#48,
U2ksJ,6k1/1bp5/4p3/4P3/3P2pq/4P2P/P2Q3K/R4R2 w - - 0 35,d2f2 h4h3 h2g1 h3h1,1466,77,92,3834,endgame mate mateIn2 short,https://lichess.org/game/5cCqAsqw#69,`;

export const FIXTURE_ROWS: string[][] = FIXTURE_CSV.split('\n').map((l) => l.split(','));
