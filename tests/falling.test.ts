import { describe, expect, it } from 'vitest';
import type { WordPass } from '../src/scene/director';
import { FallingWords } from '../src/scene/fallingWords';

const pass = (text: string, reading = true, caught = false): WordPass => ({
  page: 0,
  line: 0,
  word: { text, x: 100, y: 50, w: 60, h: 18, start: 0, end: text.length },
  reading,
  caught,
});
const cut = () => ({ sprite: {} as CanvasImageSource, rect: { x: 96, y: 47, w: 68, h: 24 }, origin: { x: 0, y: 0 } });

/** Walk past one word every 0.25 s for `seconds` and return the drop times. */
function run(seed: number, seconds: number, make = pass('spider')) {
  const fw = new FallingWords(seed, 0);
  const drops: number[] = [];
  for (let t = 0; t < seconds; t += 0.25) {
    if (fw.consider(make, t, 1, cut)) drops.push(t);
    fw.update(0.25, t);
  }
  return drops;
}

describe('FallingWords', () => {
  it('drops words only now and then', () => {
    const drops = run(42, 60);
    expect(drops.length).toBeGreaterThan(3);
    expect(drops.length).toBeLessThan(16);
    expect(drops[0]).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < drops.length; i++) expect(drops[i] - drops[i - 1]).toBeGreaterThanOrEqual(4);
  });

  it('is deterministic for a given seed', () => {
    expect(run(7, 40)).toEqual(run(7, 40));
  });

  it('never drops caught keywords or tiny words', () => {
    expect(run(1, 60, pass('silk', true, true))).toEqual([]);
    expect(run(1, 60, pass('of'))).toEqual([]);
  });

  it('leaves a hole that heals', () => {
    const fw = new FallingWords(3, 0, { warmup: 0, readingChance: 1 });
    expect(fw.consider(pass('spider'), 0, 1, cut)).toBe(true);
    expect(fw.holes(1)[0].alpha).toBe(1);
    fw.update(0.1, 5);
    expect(fw.holes(5)).toEqual([]);
  });
});
