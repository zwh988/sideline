// Reads the Lichess puzzle database (lichess_db_puzzle.csv.zst, CC0) row by row.
//
// The file is many zstd frames with skippable frames between them (and one at
// the start). Node's zstd decoder stops at the first skippable frame it meets
// mid-stream, so read straight through it gives only the first frame (about
// 176,000 of ~5 million rows). This walks the frame structure, drops the
// skippable frames and feeds the standard ones to the decoder.
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createZstdDecompress } from 'node:zlib';

const ZSTD_MAGIC = 0xfd2fb528;

/** Byte ranges [start, end) of the standard zstd frames in `buf`, skipping skippable frames. */
export function zstdFrames(buf) {
  const frames = [];
  let pos = 0;
  while (pos + 8 <= buf.length) {
    const magic = buf.readUInt32LE(pos);
    if ((magic & 0xfffffff0) === 0x184d2a50) {
      pos += 8 + buf.readUInt32LE(pos + 4);
      continue;
    }
    if (magic !== ZSTD_MAGIC) throw new Error(`Not a zstd frame at byte ${pos}`);
    const start = pos;
    const fhd = buf[pos + 4];
    const fcsFlag = fhd >> 6;
    const single = (fhd >> 5) & 1;
    const checksum = (fhd >> 2) & 1;
    const dictFlag = fhd & 3;
    pos += 5 + (single ? 0 : 1) + [0, 1, 2, 4][dictFlag] + [single ? 1 : 0, 2, 4, 8][fcsFlag];
    for (;;) {
      const h = buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16);
      const last = h & 1;
      const type = (h >> 1) & 3;
      const size = h >>> 3;
      pos += 3 + (type === 1 ? 1 : size);
      if (last) break;
    }
    if (checksum) pos += 4;
    frames.push([start, pos]);
  }
  return frames;
}

/** Yields each CSV row of the database as an array of fields (the header is skipped). */
export async function* puzzleRows(path) {
  const buf = readFileSync(path);
  const frames = zstdFrames(buf);
  const input = Readable.from((function* () {
    for (const [a, b] of frames) yield buf.subarray(a, b);
  })());
  const rl = createInterface({ input: input.pipe(createZstdDecompress()), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (line) yield line.split(',');
  }
}
