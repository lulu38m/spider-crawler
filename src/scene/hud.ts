import { clamp, type Vec2 } from '../core/math';
import { PALETTE, UI_FONT } from './palette';
import { drawOrbWeb, makeOrbWeb, WEB_DONE, type OrbWeb } from './web';

export interface HudStats {
  fileName: string;
  page: number;
  pages: number;
  wordsRead: number;
  wordsTotal: number;
  caught: number;
  keywords: number;
  progress: number;
}

const fmt = new Intl.NumberFormat('en');

/** Screen-space overlay that is part of the picture (and of recordings): wordmark, web, stats. */
export class Hud {
  web!: OrbWeb;
  unit = 1;
  /** Where the logo was last drawn (screen px), so the page can put a "home" button on it. */
  logoRect: { x: number; y: number; w: number; h: number } | null = null;
  private w = 0;
  private h = 0;

  layout(w: number, h: number): void {
    if (w === this.w && h === this.h && this.web) return;
    this.w = w;
    this.h = h;
    this.unit = clamp(Math.min(w, h) / 820, 0.7, 1.9);
    const r = clamp(Math.min(w, h) * (h > w * 1.1 ? 0.12 : 0.15), 70, 230);
    const m = 26 * this.unit;
    const center = { x: w - m - r, y: m + r * 0.92 };
    this.web = makeOrbWeb(center, r, { radials: 22, frameSides: 5, spacing: r / 9, mooringLength: Math.max(w, h), seed: 11, slots: 12 });
  }

  slot = (i: number): Vec2 => {
    const s = this.web.slots[i % this.web.slots.length];
    // Extra cocoons hang a little lower on the same slots.
    const lap = Math.floor(i / this.web.slots.length);
    return { x: s.x, y: s.y + lap * 26 * this.unit };
  };

  /** Dark bands at the top and bottom keep the HUD legible when a page scrolls under it. */
  drawBands(ctx: CanvasRenderingContext2D, alpha: number): void {
    if (alpha <= 0) return;
    const u = this.unit;
    ctx.save();
    ctx.globalAlpha = alpha;
    const topH = 112 * u;
    const top = ctx.createLinearGradient(0, 0, 0, topH);
    top.addColorStop(0, 'rgba(15, 31, 66, 0.94)');
    top.addColorStop(0.55, 'rgba(15, 31, 66, 0.6)');
    top.addColorStop(1, 'rgba(15, 31, 66, 0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, this.w, topH);
    const botH = 120 * u;
    const bottom = ctx.createLinearGradient(0, this.h - botH, 0, this.h);
    bottom.addColorStop(0, 'rgba(15, 31, 66, 0)');
    bottom.addColorStop(0.5, 'rgba(15, 31, 66, 0.62)');
    bottom.addColorStop(1, 'rgba(15, 31, 66, 0.95)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, this.h - botH, this.w, botH);
    // A soft porthole behind the corner web.
    const c = this.web.center;
    const r = this.web.radius;
    const g = ctx.createRadialGradient(c.x, c.y, r * 0.6, c.x, c.y, r * 1.38);
    g.addColorStop(0, 'rgba(15, 31, 66, 0.86)');
    g.addColorStop(1, 'rgba(15, 31, 66, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 1.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawWeb(ctx: CanvasRenderingContext2D, time: number, alpha: number): void {
    if (alpha <= 0) return;
    drawOrbWeb(ctx, this.web, WEB_DONE, { rgb: PALETTE.silkRgb, alpha: 0.7 * alpha, width: Math.max(0.8, this.unit * 0.9), time, glint: true });
  }

  drawWordmark(ctx: CanvasRenderingContext2D, time: number, subtitle: string, alpha = 1): void {
    const u = this.unit;
    const m = 26 * u;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textBaseline = 'alphabetic';
    const x = m;
    const y = m + 26 * u;
    const width = drawLogo(ctx, x, y, 28 * u, time, true);
    this.logoRect = { x, y: y - 28 * u, w: width, h: 34 * u };
    if (subtitle) {
      ctx.font = `400 ${13.5 * u}px ${UI_FONT}`;
      ctx.fillStyle = PALETTE.hudMuted;
      ctx.fillText(subtitle, x, y + 22 * u);
    }
    ctx.restore();
  }

  drawStats(ctx: CanvasRenderingContext2D, s: HudStats, time: number, alpha: number): void {
    if (alpha <= 0) return;
    const u = this.unit;
    const m = 26 * u;
    const lines = [
      s.pages > 1 ? `Page ${s.page + 1} of ${s.pages}` : 'One page',
      `${fmt.format(s.wordsRead)} of ${fmt.format(s.wordsTotal)} words`,
      `${s.caught} of ${s.keywords} keywords caught`,
    ];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `500 ${14.5 * u}px ${UI_FONT}`;
    ctx.fillStyle = PALETTE.hudText;
    ctx.textBaseline = 'alphabetic';
    const lh = 21 * u;
    const base = this.h - m - 18 * u;
    lines.forEach((l, i) => ctx.fillText(l, m, base - (lines.length - 1 - i) * lh));

    // Progress: a silk thread along the bottom with a dew drop riding on it.
    const y = this.h - 16 * u;
    const x0 = m;
    const x1 = this.w - m;
    const px = x0 + (x1 - x0) * clamp(s.progress, 0, 1);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(232, 236, 247, 0.22)';
    ctx.lineWidth = Math.max(1, u * 1.1);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(244, 180, 0, 0.9)';
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(px, y);
    ctx.stroke();
    const glow = 0.6 + 0.4 * Math.sin(time * 3);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.25 * glow})`;
    ctx.beginPath();
    ctx.arc(px, y, 7 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, y, 3.2 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * The wordmark: "spider crawler" with a dotless i whose dot is a tiny spider. With `thread`,
 * the spider hangs from the top edge of the frame.
 */
export function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, time: number, thread: boolean): number {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `700 ${size}px ${UI_FONT}`;
  ctx.fillStyle = PALETTE.silk;
  ctx.fillText('sp\u0131der crawler', x, y);
  const width = ctx.measureText('sp\u0131der crawler').width;
  const before = ctx.measureText('sp').width;
  const iw = ctx.measureText('\u0131').width;
  const bob = Math.sin(time * 1.8) * size * 0.05;
  const dot = { x: x + before + iw / 2, y: y - size * 0.86 + bob };
  if (thread) {
    ctx.strokeStyle = 'rgba(232, 236, 247, 0.55)';
    ctx.lineWidth = Math.max(0.8, size / 30);
    ctx.beginPath();
    ctx.moveTo(dot.x, 0);
    ctx.lineTo(dot.x, dot.y);
    ctx.stroke();
  }
  drawMiniSpider(ctx, dot, size * 0.12, time);
  ctx.restore();
  return width;
}

/** The little spider that dots the "i". */
export function drawMiniSpider(ctx: CanvasRenderingContext2D, p: Vec2, r: number, time: number): void {
  ctx.save();
  ctx.strokeStyle = PALETTE.pollen;
  ctx.lineWidth = Math.max(0.8, r * 0.28);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const a = (-0.75 + i * 0.5) + Math.sin(time * 6 + i) * 0.06;
      const kx = p.x + side * Math.cos(a) * r * 1.7;
      const ky = p.y + Math.sin(a) * r * 1.7 - r * 0.5;
      ctx.moveTo(p.x + side * r * 0.4, p.y);
      ctx.lineTo(kx, ky);
      ctx.lineTo(kx + side * r * 0.8, ky + r * 1.3);
    }
  }
  ctx.stroke();
  ctx.fillStyle = PALETTE.pink;
  ctx.beginPath();
  ctx.arc(p.x, p.y + r * 0.35, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(p.x - r * 0.35, p.y, r * 0.3, 0, Math.PI * 2);
  ctx.arc(p.x + r * 0.35, p.y, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
