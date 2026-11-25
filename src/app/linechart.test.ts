import { describe, expect, it } from 'vitest';
import { LANE_ARROW, LANE_BARS, LANE_COLOUR, meterSvg } from './linechart';
import { LANES } from './linetree';

describe('quality without words', () => {
  it('each lane has its own colour, bar count and arrow width, stronger = more', () => {
    expect(new Set(LANES.map((l) => LANE_COLOUR[l])).size).toBe(4);
    expect(LANES.map((l) => LANE_BARS[l])).toEqual([4, 3, 2, 1]);
    const widths = LANES.map((l) => LANE_ARROW[l]);
    expect(widths).toEqual([...widths].sort((a, b) => b - a)); // thickest first
    expect(new Set(widths).size).toBe(4);
  });

  it('the meter fills as many bars as the lane has', () => {
    for (const lane of LANES) {
      const svg = meterSvg(lane);
      expect(svg.split(`fill="${LANE_COLOUR[lane]}"`).length - 1).toBe(LANE_BARS[lane]);
      expect(svg.match(/<rect/g)?.length).toBe(4);
    }
  });
});
