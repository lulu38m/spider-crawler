import { clamp, easeInOutCubic, type Vec2 } from '../core/math';
import { roundRect } from './pages';
import { UI_FONT } from './palette';

/**
 * Caught keywords: the word gets wrapped on the page, then a silk cocoon carrying the word flies
 * to the web in the corner and hangs there. In the finale they move onto the big web.
 */

export type CocoonState = 'wrapping' | 'flying' | 'hanging';

export interface Cocoon {
  label: string;
  keyword: number;
  state: CocoonState;
  /** Scene time the state started. */
  since: number;
  /** World point the cocoon lifts off from. */
  origin: Vec2;
  /** Screen positions. */
  from: Vec2;
  pos: Vec2;
  /** Hanging anchor (screen) and where it should be (slot). */
  slot: number;
  angle: number;
  angVel: number;
  /** Scale in the finale. */
  big: number;
}

const WRAP_TIME = 0.6;
const FLIGHT_TIME = 0.95;

export interface SlotProvider {
  /** Screen position of a slot (where the cocoon's thread is tied). */
  slot(i: number): Vec2;
  /** Size multiplier for cocoons at the moment. */
  unit: number;
}

export class Cocoons {
  items: Cocoon[] = [];

  reset(): void {
    this.items = [];
  }

  spawn(label: string, keyword: number, origin: Vec2, now: number): void {
    this.items.push({
      label,
      keyword,
      state: 'wrapping',
      since: now,
      origin,
      from: { x: 0, y: 0 },
      pos: { x: 0, y: 0 },
      slot: this.items.length,
      angle: 0,
      angVel: 0,
      big: 0,
    });
  }

  /** Put cocoons straight into the web (skip button). */
  spawnHanging(label: string, keyword: number, now: number, slots: SlotProvider): void {
    const slot = this.items.length;
    const p = slots.slot(slot);
    this.items.push({ label, keyword, state: 'hanging', since: now, origin: p, from: p, pos: { ...p }, slot, angle: 0.3, angVel: 0, big: 0 });
  }

  update(dt: number, now: number, toScreen: (p: Vec2) => Vec2, slots: SlotProvider): void {
    for (const c of this.items) {
      if (c.state === 'wrapping' && now - c.since >= WRAP_TIME) {
        c.state = 'flying';
        c.since = now;
        c.from = toScreen(c.origin);
        c.pos = { ...c.from };
      }
      if (c.state === 'flying') {
        const t = clamp((now - c.since) / FLIGHT_TIME, 0, 1);
        const to = slots.slot(c.slot);
        const e = easeInOutCubic(t);
        const ctrl = { x: (c.from.x + to.x) / 2, y: Math.min(c.from.y, to.y) - 160 * slots.unit };
        const u = 1 - e;
        c.pos = {
          x: u * u * c.from.x + 2 * u * e * ctrl.x + e * e * to.x,
          y: u * u * c.from.y + 2 * u * e * ctrl.y + e * e * to.y,
        };
        c.angle = Math.sin(t * Math.PI * 3) * 0.5 * (1 - t);
        if (t >= 1) {
          c.state = 'hanging';
          c.since = now;
          c.angVel = 2.5;
        }
      } else if (c.state === 'hanging') {
        const to = slots.slot(c.slot);
        // Ease toward the slot (it moves during the finale) and swing like a pendulum.
        const k = 1 - Math.pow(0.0005, dt);
        c.pos = { x: c.pos.x + (to.x - c.pos.x) * k, y: c.pos.y + (to.y - c.pos.y) * k };
        const stiffness = 18;
        c.angVel += (-stiffness * c.angle - 1.6 * c.angVel) * dt;
        c.angle += c.angVel * dt;
      }
    }
  }

  /** Wrapping happens on the page (world space); called inside the camera transform. */
  drawWrapping(ctx: CanvasRenderingContext2D, now: number): void {
    for (const c of this.items) {
      if (c.state !== 'wrapping') continue;
      const t = clamp((now - c.since) / WRAP_TIME, 0, 1);
      // Spinning glints around the word while it is wrapped.
      ctx.save();
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * (1 - t * 0.5)})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      const r = 16 + 10 * (1 - t);
      for (let i = 0; i < 3; i++) {
        const a = now * 9 + (i * Math.PI * 2) / 3;
        ctx.moveTo(c.origin.x + Math.cos(a) * r, c.origin.y + Math.sin(a) * r * 0.5);
        ctx.arc(c.origin.x, c.origin.y, r, a, a + 0.9);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Flying and hanging cocoons (screen space). */
  draw(ctx: CanvasRenderingContext2D, slots: SlotProvider, alpha = 1): void {
    for (const c of this.items) {
      if (c.state === 'wrapping') continue;
      const u = slots.unit * (1 + c.big * 0.45);
      if (c.state === 'hanging') {
        const anchor = slots.slot(c.slot);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = 'rgba(232, 236, 247, 0.7)';
        ctx.lineWidth = Math.max(0.8, u * 0.9);
        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y - 12 * u);
        const tip = { x: c.pos.x + Math.sin(c.angle) * 12 * u, y: c.pos.y + Math.cos(c.angle) * 4 * u };
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
        ctx.restore();
        drawCocoon(ctx, c.label, tip, c.angle * 0.6, u, alpha, true);
      } else {
        drawCocoon(ctx, c.label, c.pos, c.angle, u, alpha, false);
      }
    }
  }
}

const widthCache = new Map<string, number>();

export function drawCocoon(ctx: CanvasRenderingContext2D, label: string, top: Vec2, angle: number, u: number, alpha: number, hanging: boolean): void {
  const font = `600 ${12 * u}px ${UI_FONT}`;
  ctx.save();
  ctx.font = font;
  const key = `${label}@${u.toFixed(2)}`;
  let tw = widthCache.get(key);
  if (tw === undefined) widthCache.set(key, (tw = ctx.measureText(label).width));
  const w = tw + 20 * u;
  const h = 22 * u;
  ctx.translate(top.x, top.y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  // Hanging cocoons hang below their thread; flying ones are centered.
  const y0 = hanging ? 0 : -h / 2;
  ctx.shadowColor = 'rgba(5, 6, 25, 0.45)';
  ctx.shadowBlur = 10 * u;
  ctx.shadowOffsetY = 4 * u;
  const grad = ctx.createLinearGradient(0, y0, 0, y0 + h);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#d6dbea');
  ctx.fillStyle = grad;
  roundRect(ctx, -w / 2, y0, w, h, h / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  // Silk strands wound around it.
  ctx.save();
  roundRect(ctx, -w / 2, y0, w, h, h / 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(140, 150, 190, 0.35)';
  ctx.lineWidth = 0.7 * u;
  ctx.beginPath();
  for (let x = -w / 2 - h; x < w / 2 + h; x += 5 * u) {
    ctx.moveTo(x, y0);
    ctx.lineTo(x + h * 0.7, y0 + h);
  }
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#23253a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, y0 + h / 2 + 0.5 * u);
  ctx.restore();
}
