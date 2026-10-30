import type { Vec2 } from '../core/math';

export interface TwoBoneResult {
  knee: Vec2;
  /** Where the leg actually ends (equals the target when it is within reach). */
  end: Vec2;
  /** 0 = folded, 1 = fully stretched. */
  extension: number;
}

/**
 * Analytic two-bone IK in 2D (law of cosines). Of the two possible knee positions, we keep the
 * one farthest from `awayFrom` (the body center): spider knees arch outward, which is what makes
 * the silhouette read as "spider" from above.
 */
export function solveTwoBone(hip: Vec2, target: Vec2, a: number, b: number, awayFrom: Vec2): TwoBoneResult {
  const dx = target.x - hip.x;
  const dy = target.y - hip.y;
  const raw = Math.hypot(dx, dy);
  const dirX = raw > 1e-6 ? dx / raw : 1;
  const dirY = raw > 1e-6 ? dy / raw : 0;
  const d = Math.min(Math.max(raw, Math.abs(a - b) + 1e-3), a + b - 1e-3);
  const cosAngle = (a * a + d * d - b * b) / (2 * a * d);
  const angle = Math.acos(Math.min(1, Math.max(-1, cosAngle)));
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k1 = { x: hip.x + (dirX * c - dirY * s) * a, y: hip.y + (dirX * s + dirY * c) * a };
  const k2 = { x: hip.x + (dirX * c + dirY * s) * a, y: hip.y + (-dirX * s + dirY * c) * a };
  const d1 = (k1.x - awayFrom.x) ** 2 + (k1.y - awayFrom.y) ** 2;
  const d2 = (k2.x - awayFrom.x) ** 2 + (k2.y - awayFrom.y) ** 2;
  return {
    knee: d1 >= d2 ? k1 : k2,
    end: { x: hip.x + dirX * d, y: hip.y + dirY * d },
    extension: d / (a + b),
  };
}
