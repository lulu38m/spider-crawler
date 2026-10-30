import { describe, expect, it } from 'vitest';
import { dist } from '../src/core/math';
import { solveTwoBone } from '../src/spider/ik';
import { SKINS, skinById } from '../src/spider/skins';
import { Spider } from '../src/spider/spider';

describe('solveTwoBone', () => {
  it('keeps both segment lengths', () => {
    const hip = { x: 0, y: 0 };
    const target = { x: 40, y: 10 };
    const { knee, end } = solveTwoBone(hip, target, 30, 30, { x: -10, y: 0 });
    expect(dist(hip, knee)).toBeCloseTo(30, 5);
    expect(dist(knee, end)).toBeCloseTo(30, 5);
    expect(dist(end, target)).toBeCloseTo(0, 5);
  });

  it('bends the knee away from the body', () => {
    const body = { x: 0, y: 0 };
    const { knee } = solveTwoBone({ x: 0, y: 5 }, { x: 0, y: 60 }, 35, 35, body);
    // Both solutions are mirror images; the chosen one is farther from the body center.
    const mirrored = { x: -knee.x, y: knee.y };
    expect(dist(knee, body)).toBeGreaterThanOrEqual(dist(mirrored, body) - 1e-9);
  });

  it('stretches toward unreachable targets without breaking', () => {
    const { end, extension } = solveTwoBone({ x: 0, y: 0 }, { x: 500, y: 0 }, 30, 30, { x: 0, y: -1 });
    expect(extension).toBeLessThanOrEqual(1);
    expect(end.x).toBeCloseTo(60, 1);
  });
});

describe('Spider gait', () => {
  it('walks with the alternating tetrapod gait at a steady pace', () => {
    const spider = new Spider({ x: 0, y: 0 }, skinById('blueprint'), 0);
    // The director moves a goal point ahead of the spider at reading speed.
    let bothGroupsAtOnce = 0;
    let frames = 0;
    for (let i = 0; i < 60 * 5; i++) {
      spider.goal = { x: (i / 60) * 220, y: 0 };
      spider.update(1 / 60);
      if (i < 60) continue; // ignore the start-up from standstill
      frames++;
      const lifting = new Set(spider.legs.filter((l) => l.stepping && l.stepT > 0).map((l) => l.group));
      if (lifting.size > 1) bothGroupsAtOnce++;
    }
    expect(spider.steps).toBeGreaterThan(20);
    // Groups take turns: four legs up, then the other four.
    expect(bothGroupsAtOnce / frames).toBeLessThan(0.05);
  });

  it('reaches its goal and settles', () => {
    const spider = new Spider({ x: 0, y: 0 }, skinById('boxy'), 0);
    spider.goal = { x: 400, y: 120 };
    for (let i = 0; i < 60 * 4; i++) spider.update(1 / 60);
    expect(dist(spider.pos, spider.goal)).toBeLessThan(2);
    expect(spider.legs.every((l) => !l.stepping)).toBe(true);
  });

  it('keeps every foot within reach of its hip', () => {
    const spider = new Spider({ x: 0, y: 0 }, skinById('stilts'), 0);
    for (let i = 0; i < 60 * 3; i++) {
      spider.goal = { x: Math.sin(i / 30) * 300, y: Math.cos(i / 45) * 200 };
      spider.update(1 / 60);
      for (const leg of spider.legs) expect(dist(leg.hipW, leg.endW)).toBeLessThanOrEqual(leg.a + leg.b + 1e-6);
    }
  });

  it('jumps and lands with every foot planted', () => {
    const spider = new Spider({ x: 0, y: 0 }, SKINS[0], 0);
    spider.jumpTo({ x: 300, y: 120 });
    for (let i = 0; i < 90; i++) spider.update(1 / 60);
    expect(spider.mode).toBe('walk');
    expect(dist(spider.pos, { x: 300, y: 120 })).toBeLessThan(1);
    expect(spider.legs.every((l) => !l.stepping)).toBe(true);
  });
});

describe('skins', () => {
  it('have unique ids and two leg colors', () => {
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length);
    for (const s of SKINS) expect(s.colors.legs).toHaveLength(2);
    expect(skinById('nope').id).toBe('blueprint');
  });
});
