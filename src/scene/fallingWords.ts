import { clamp, type Rect, type Vec2 } from '../core/math';
import { mulberry32, type Rng } from '../core/rng';
import type { WordPass } from './director';

/**
 * Every now and then a word the spider walks over comes unstuck: it pops off the page like a
 * paper scrap, spins and falls away, and the gap it leaves closes a few seconds later.
 * Rare on purpose: a gag works when it's a surprise.
 */

export interface Hole {
  page: number;
  /** Page-local rectangle of the missing word. */
  rect: Rect;
  /** 1 = word fully gone, 0 = back in place. */
  alpha: number;
}

/** What the scene needs to cut a word out of its page. */
export interface WordCut {
  sprite: CanvasImageSource;
  /** Page-local rectangle that was cut (word box plus a little margin). */
  rect: Rect;
  /** World position of the page's top-left corner. */
  origin: Vec2;
}

interface Falling {
  page: number;
  cut: WordCut;
  born: number;
  pos: Vec2;
  vel: Vec2;
  angle: number;
  spin: number;
}

/** Seconds the scrap stays visible while it falls. */
const FALL_TIME = 2;
/** The gap closes between these two times. */
const HEAL_START = 3.2;
const HEAL_END = 3.8;
const GRAVITY = 1800;

export interface FallingOptions {
  /** Chance that a word inside a highlighted sentence drops (when allowed). */
  readingChance?: number;
  /** Chance for any other word. */
  otherChance?: number;
  /** Seconds between two drops: min, plus up to `jitter`. */
  cooldown?: number;
  jitter?: number;
  /** No drop before this many seconds into the crawl. */
  warmup?: number;
}

export class FallingWords {
  items: Falling[] = [];
  private rng: Rng;
  private nextAllowed: number;
  private opts: Required<FallingOptions>;

  constructor(seed: number, start: number, options: FallingOptions = {}) {
    this.rng = mulberry32(seed);
    this.opts = { readingChance: 0.45, otherChance: 0.18, cooldown: 4, jitter: 4, warmup: 3, ...options };
    this.nextAllowed = start + this.opts.warmup;
  }

  /** Decide whether this word falls. `cut` is only called when it does. */
  consider(pass: WordPass, now: number, direction: number, cut: () => WordCut | null): boolean {
    if (now < this.nextAllowed || pass.caught) return false;
    const letters = pass.word.text.match(/\p{L}/gu)?.length ?? 0;
    if (letters < 3) return false;
    const chance = pass.reading ? this.opts.readingChance : this.opts.otherChance;
    if (this.rng() >= chance) return false;
    const c = cut();
    if (!c) return false;
    this.nextAllowed = now + this.opts.cooldown + this.rng() * this.opts.jitter;
    const side = this.rng() < 0.5 ? -1 : 1;
    this.items.push({
      page: pass.page,
      cut: c,
      born: now,
      pos: { x: c.origin.x + c.rect.x + c.rect.w / 2, y: c.origin.y + c.rect.y + c.rect.h / 2 },
      // Kicked up and sideways, a little in the direction the spider walks.
      vel: { x: (60 + this.rng() * 80) * side + direction * 40, y: -(160 + this.rng() * 100) },
      angle: 0,
      spin: (2 + this.rng() * 3) * side,
    });
    return true;
  }

  update(dt: number, now: number): void {
    for (const f of this.items) {
      if (now - f.born > FALL_TIME) continue;
      f.vel.y += GRAVITY * dt;
      f.pos.x += f.vel.x * dt;
      f.pos.y += f.vel.y * dt;
      f.angle += f.spin * dt;
    }
    this.items = this.items.filter((f) => now - f.born < HEAL_END);
  }

  holes(now: number): Hole[] {
    return this.items.map((f) => ({
      page: f.page,
      rect: f.cut.rect,
      alpha: 1 - clamp((now - f.born - HEAL_START) / (HEAL_END - HEAL_START), 0, 1),
    }));
  }

  /** Draw the falling scraps in world space. */
  draw(ctx: CanvasRenderingContext2D, now: number, px: number): void {
    for (const f of this.items) {
      const t = now - f.born;
      if (t > FALL_TIME) continue;
      const alpha = t < FALL_TIME - 0.5 ? 1 : 1 - (t - (FALL_TIME - 0.5)) / 0.5;
      // A quick pop toward the camera, then it shrinks as it falls away from the page.
      const s = t < 0.2 ? 1 + t * 1.75 : Math.max(0.7, 1.35 - (t - 0.2) * 0.4);
      const { w, h } = f.cut.rect;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(f.pos.x, f.pos.y);
      ctx.rotate(f.angle);
      ctx.scale(s, s);
      ctx.shadowColor = 'rgba(10, 14, 40, 0.35)';
      ctx.shadowBlur = 10 * px;
      ctx.shadowOffsetY = 6 * px;
      ctx.drawImage(f.cut.sprite, -w / 2, -h / 2, w, h);
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(63, 156, 240, 0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
}
