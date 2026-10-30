import { mulberry32, range } from '../core/rng';
import type { Vec2 } from '../core/math';

/**
 * Orb web geometry, built in the same order a real orb weaver builds it: frame, radii, then the
 * capture spiral from the outside in. Drawing takes a progress value per stage, so the finale can
 * show the web being spun.
 */
export interface OrbWeb {
  center: Vec2;
  radius: number;
  /** Frame polygon vertices. */
  frame: Vec2[];
  /** Mooring lines from frame vertices outward. */
  moorings: Array<[Vec2, Vec2]>;
  /** Radial thread end points (on the frame). */
  radials: Vec2[];
  /** Capture spiral polyline, outside → inside. */
  spiral: Vec2[];
  /** Cumulative spiral length per point, for progressive drawing. */
  spiralLen: number[];
  /** Hub mesh lines. */
  hub: Array<[Vec2, Vec2]>;
  dew: Array<{ p: Vec2; r: number; phase: number; at: number }>;
  /** Good spots for cocoons (on the spiral, spread out). */
  slots: Vec2[];
}

export interface WebOptions {
  radials?: number;
  frameSides?: number;
  spacing?: number;
  mooringLength?: number;
  seed?: number;
  slots?: number;
}

function rayPolygon(c: Vec2, dir: Vec2, poly: Vec2[]): Vec2 {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - c.x) * ey - (a.y - c.y) * ex) / den;
    const u = ((a.x - c.x) * dir.y - (a.y - c.y) * dir.x) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  if (!isFinite(best)) best = 1;
  return { x: c.x + dir.x * best, y: c.y + dir.y * best };
}

export function makeOrbWeb(center: Vec2, radius: number, opts: WebOptions = {}): OrbWeb {
  const rng = mulberry32(opts.seed ?? 7);
  const sides = opts.frameSides ?? 6;
  const frame: Vec2[] = [];
  const rot = range(rng, 0, Math.PI * 2);
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2 + range(rng, -0.18, 0.18);
    const r = radius * range(rng, 1.05, 1.22);
    frame.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
  }
  const mooringLength = opts.mooringLength ?? radius * 2.5;
  const moorings: Array<[Vec2, Vec2]> = frame.map((p) => {
    const a = Math.atan2(p.y - center.y, p.x - center.x) + range(rng, -0.25, 0.25);
    return [p, { x: p.x + Math.cos(a) * mooringLength, y: p.y + Math.sin(a) * mooringLength }];
  });

  const n = opts.radials ?? 26;
  const radials: Vec2[] = [];
  const angles: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + range(rng, -0.05, 0.05);
    angles.push(a);
    radials.push(rayPolygon(center, { x: Math.cos(a), y: Math.sin(a) }, frame));
  }

  // Capture spiral: one point per radial crossing, radius shrinking each step.
  const spacing = opts.spacing ?? radius / 15;
  const inner = radius * 0.2;
  const spiral: Vec2[] = [];
  const radialLen = radials.map((p) => Math.hypot(p.x - center.x, p.y - center.y));
  let r = Math.min(...radialLen) * 0.9;
  for (let k = 0; r > inner; k++) {
    const i = k % n;
    const limit = radialLen[i] * 0.92;
    const rr = Math.min(r, limit);
    spiral.push({ x: center.x + Math.cos(angles[i]) * rr, y: center.y + Math.sin(angles[i]) * rr });
    r -= spacing / n;
  }
  const spiralLen: number[] = [0];
  for (let i = 1; i < spiral.length; i++) {
    spiralLen.push(spiralLen[i - 1] + Math.hypot(spiral[i].x - spiral[i - 1].x, spiral[i].y - spiral[i - 1].y));
  }

  const hub: Array<[Vec2, Vec2]> = [];
  for (let i = 0; i < 9; i++) {
    const a1 = range(rng, 0, Math.PI * 2);
    const a2 = a1 + range(rng, 0.6, 2.2);
    const r1 = radius * range(rng, 0.03, 0.12);
    const r2 = radius * range(rng, 0.03, 0.12);
    hub.push([
      { x: center.x + Math.cos(a1) * r1, y: center.y + Math.sin(a1) * r1 },
      { x: center.x + Math.cos(a2) * r2, y: center.y + Math.sin(a2) * r2 },
    ]);
  }

  const total = spiralLen[spiralLen.length - 1] || 1;
  const dew = spiral
    .map((p, i) => ({ p, r: range(rng, 0.55, 1.5), phase: range(rng, 0, Math.PI * 2), at: spiralLen[i] / total, keep: rng() < 0.16 }))
    .filter((d) => d.keep)
    .map(({ p, r, phase, at }) => ({ p, r, phase, at }));

  // Cocoon slots: spread on two rings, avoiding the very top where the spider hangs.
  const slotCount = opts.slots ?? 12;
  const slots: Vec2[] = [];
  for (let i = 0; i < slotCount; i++) {
    const ring = i % 2 === 0 ? 0.78 : 0.52;
    const a = -Math.PI / 2 + ((i + 0.5) / slotCount) * Math.PI * 2;
    slots.push({ x: center.x + Math.cos(a) * radius * ring, y: center.y + Math.sin(a) * radius * ring });
  }

  return { center, radius, frame, moorings, radials, spiral, spiralLen, hub, dew, slots };
}

export interface WebProgress {
  frame: number;
  radials: number;
  spiral: number;
}

export const WEB_DONE: WebProgress = { frame: 1, radials: 1, spiral: 1 };

export interface WebStyle {
  rgb: string;
  alpha: number;
  /** Line width in the current transform's units. */
  width: number;
  time: number;
  glint?: boolean;
}

/** Draw the web with per-stage progress (0..1 each). */
export function drawOrbWeb(ctx: CanvasRenderingContext2D, web: OrbWeb, progress: WebProgress, style: WebStyle): void {
  const { rgb, alpha, width } = style;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.55})`;
  ctx.lineWidth = width;

  // Moorings + frame.
  const f = Math.min(1, progress.frame);
  if (f > 0) {
    ctx.beginPath();
    for (const [a, b] of web.moorings) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
    }
    const edges = web.frame.length;
    const shown = f * edges;
    for (let i = 0; i < edges; i++) {
      const t = Math.min(1, shown - i);
      if (t <= 0) break;
      const a = web.frame[i];
      const b = web.frame[(i + 1) % edges];
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }
    ctx.stroke();
  }

  // Radials, drawn one after another around the hub.
  const rp = Math.min(1, progress.radials);
  if (rp > 0) {
    ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.7})`;
    ctx.beginPath();
    const shown = rp * web.radials.length;
    for (let i = 0; i < web.radials.length; i++) {
      const t = Math.min(1, shown - i);
      if (t <= 0) break;
      const end = web.radials[i];
      ctx.moveTo(web.center.x, web.center.y);
      ctx.lineTo(web.center.x + (end.x - web.center.x) * t, web.center.y + (end.y - web.center.y) * t);
    }
    for (const [a, b] of web.hub) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  // Capture spiral.
  const sp = Math.min(1, progress.spiral);
  if (sp > 0 && web.spiral.length > 1) {
    const total = web.spiralLen[web.spiralLen.length - 1];
    const limit = sp * total;
    ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.85})`;
    ctx.lineWidth = width * 0.85;
    ctx.beginPath();
    ctx.moveTo(web.spiral[0].x, web.spiral[0].y);
    for (let i = 1; i < web.spiral.length; i++) {
      if (web.spiralLen[i] > limit) {
        const prev = web.spiral[i - 1];
        const cur = web.spiral[i];
        const seg = web.spiralLen[i] - web.spiralLen[i - 1] || 1;
        const t = (limit - web.spiralLen[i - 1]) / seg;
        ctx.lineTo(prev.x + (cur.x - prev.x) * t, prev.y + (cur.y - prev.y) * t);
        break;
      }
      ctx.lineTo(web.spiral[i].x, web.spiral[i].y);
    }
    ctx.stroke();
    if (style.glint) {
      // Light running along the threads.
      ctx.setLineDash([width * 2, width * 34]);
      ctx.lineDashOffset = -style.time * width * 30;
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
      ctx.lineWidth = width * 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Dew drops catch the light once the spiral reaches them.
    for (const d of web.dew) {
      if (d.at > sp) continue;
      const tw = 0.55 + 0.45 * Math.sin(style.time * 2.2 + d.phase);
      const r = d.r * width * 1.6;
      ctx.fillStyle = `rgba(${rgb}, ${alpha * 0.35 * tw})`;
      ctx.beginPath();
      ctx.arc(d.p.x, d.p.y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * (0.6 + 0.4 * tw)})`;
      ctx.beginPath();
      ctx.arc(d.p.x, d.p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
