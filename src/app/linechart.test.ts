import { describe, expect, it } from 'vitest';
import { LANE_ARROW, LANE_BADGE, LANE_COLOUR, laneBadgeSvg, pillWidth } from './linechart';
import { LANES } from './linetree';

describe('quality without words', () => {
  it('each lane has its own colour, badge and arrow width, stronger = thicker', () => {
    expect(new Set(LANES.map((l) => LANE_COLOUR[l])).size).toBe(4);
    expect(new Set(LANES.map((l) => LANE_BADGE[l])).size).toBe(4);
    const widths = LANES.map((l) => LANE_ARROW[l]);
    expect(widths).toEqual([...widths].sort((a, b) => b - a)); // thickest first
    expect(new Set(widths).size).toBe(4);
  });

  it("the lane's badge is a disc in the lane's colour with its symbol", () => {
    for (const lane of LANES) {
      const svg = laneBadgeSvg(lane);
      expect(svg).toContain(`fill="${LANE_COLOUR[lane]}"`);
      expect(svg).toContain(`>${LANE_BADGE[lane]}</text>`);
    }
  });
});

describe('the width of a move', () => {
  it('keeps the usual size for short labels and grows for long ones', () => {
    expect(pillWidth(['5.Bb5', '5…a6'])).toBe(46);
    expect(pillWidth([])).toBe(46);
    const long = pillWidth(['12…Nxd4+']);
    expect(long).toBeGreaterThan(46);
    expect(pillWidth(['112…Qxe8#'])).toBeGreaterThan(long);
  });
});
