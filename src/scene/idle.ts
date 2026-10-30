import { clamp, dist, type Rect, type Vec2 } from '../core/math';
import { mulberry32 } from '../core/rng';
import { FONT_SANS, FONT_SERIF } from '../doc/layout';
import type { Spider } from '../spider/spider';
import type { Camera } from './camera';
import { PALETTE } from './palette';

export interface IdleText {
  title: string;
  body: string;
}

/**
 * The landing screen is a blank sheet the spider lives on. It follows the pointer, wanders when
 * left alone, and jumps where you click. The bottom of the sheet is reserved for the buttons.
 */
export class Idle {
  card: Rect = { x: 0, y: 0, w: 1000, h: 600 };
  roam: Rect = { x: 0, y: 0, w: 100, h: 100 };
  portrait = false;
  /** World height reserved for the DOM controls at the bottom of the card. */
  controlsHeight = 230;
  mouse: Vec2 | null = null;
  mouseAt = -100;
  drag = false;
  /** Draw a drop zone on the sheet itself (when there are no DOM buttons over it). */
  decor = false;
  private wanderAt = 0;
  private rng = mulberry32(42);
  private wrapCache = new Map<string, string[]>();

  /**
   * Screen px the DOM controls need (measured by the page). On small screens they don't scale
   * down with the sheet, so the sheet grows taller to keep them on the paper.
   */
  controlsNeed = 0;

  layout(w: number, h: number, cam: Camera): void {
    this.portrait = h > w * 1.05;
    const cw = this.portrait ? 660 : 900;
    const base = this.portrait ? 330 : 200;
    const sheet = this.portrait ? 900 : 560;
    // The text and the spider's playground can give up some room before the sheet has to grow.
    const minTop = this.portrait ? 340 : 250;
    let controls = base;
    let ch = sheet;
    let zoom = 1;
    // The zoom depends on the sheet's height, which depends on the zoom: a few rounds settle it.
    for (let i = 0; i < 5; i++) {
      zoom = clamp(Math.min((w * 0.92) / cw, ((h - 96) * 0.94) / ch), 0.3, 1.9);
      if (!this.controlsNeed) break;
      controls = Math.max(base, this.controlsNeed / zoom);
      ch = Math.max(sheet, minTop + controls);
    }
    const top = ch - controls;
    this.controlsHeight = controls;
    this.card = { x: -cw / 2, y: -ch / 2, w: cw, h: ch };
    const pad = 44;
    this.roam = { x: this.card.x + pad, y: this.card.y + pad, w: cw - pad * 2, h: top - pad * 1.2 };
    cam.set(0, -24 / zoom, zoom);
  }

  /** Screen rect of the controls area (the DOM panel is positioned over it). */
  controlsRect(cam: Camera, w: number, h: number): Rect {
    const tl = cam.toScreen({ x: this.card.x, y: this.card.y + this.card.h - this.controlsHeight }, w, h);
    const br = cam.toScreen({ x: this.card.x + this.card.w, y: this.card.y + this.card.h }, w, h);
    return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
  }

  private clampToRoam(p: Vec2): Vec2 {
    return {
      x: clamp(p.x, this.roam.x, this.roam.x + this.roam.w),
      y: clamp(p.y, this.roam.y, this.roam.y + this.roam.h),
    };
  }

  update(now: number, spider: Spider): void {
    if (spider.mode !== 'walk') return;
    spider.speedLimit = 300;
    if (this.drag) {
      spider.goal = { x: this.roam.x + this.roam.w / 2, y: this.roam.y + this.roam.h * 0.6 };
      spider.tasting = Math.max(spider.tasting, 0.6);
      return;
    }
    const active = this.mouse && now - this.mouseAt < 5;
    if (active && this.mouse) {
      const target = this.clampToRoam(this.mouse);
      const d = dist(spider.pos, target);
      // Approach the pointer but keep a polite distance, then face it.
      if (d > 70) spider.goal = target;
      else spider.goal = { ...spider.pos };
      spider.face = Math.atan2(this.mouse.y - spider.pos.y, this.mouse.x - spider.pos.x);
      this.wanderAt = now + 2;
      return;
    }
    spider.face = null;
    if (now >= this.wanderAt) {
      this.wanderAt = now + 2.4 + this.rng() * 2.6;
      spider.goal = {
        x: this.roam.x + this.rng() * this.roam.w,
        y: this.roam.y + this.rng() * this.roam.h,
      };
    }
  }

  /** A click on the sheet: jump there. */
  click(world: Vec2, spider: Spider): void {
    if (spider.mode !== 'walk') return;
    const target = this.clampToRoam(world);
    if (dist(target, spider.pos) > 40) spider.jumpTo(target);
  }

  clearCache(): void {
    this.wrapCache.clear();
  }

  private wrap(ctx: CanvasRenderingContext2D, text: string, font: string, width: number): string[] {
    const key = `${font}|${width}|${text}`;
    const hit = this.wrapCache.get(key);
    if (hit) return hit;
    ctx.font = font;
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > width && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    if (line) lines.push(line);
    this.wrapCache.set(key, lines);
    return lines;
  }

  /** World-space card (inside the camera transform). */
  draw(ctx: CanvasRenderingContext2D, now: number, text: IdleText, zoom: number, dpr: number, alpha: number): void {
    if (alpha <= 0) return;
    const c = this.card;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(6, 8, 32, 0.55)';
    ctx.shadowBlur = 50 * zoom * dpr;
    ctx.shadowOffsetY = 18 * zoom * dpr;
    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.shadowColor = 'transparent';

    const pad = 64;
    const titleSize = this.portrait ? 46 : 44;
    ctx.font = `700 ${titleSize}px ${FONT_SERIF}`;
    ctx.fillStyle = PALETTE.ink;
    ctx.textBaseline = 'alphabetic';
    const titleLines = this.wrap(ctx, text.title, ctx.font, c.w - pad * 2);
    let y = c.y + pad + titleSize * 0.8;
    for (const l of titleLines) {
      ctx.fillText(l, c.x + pad, y);
      y += titleSize * 1.12;
    }
    const bodySize = this.portrait ? 22 : 20;
    const bodyFont = `400 ${bodySize}px ${FONT_SERIF}`;
    ctx.font = bodyFont;
    ctx.fillStyle = PALETTE.inkSoft;
    y += bodySize * 0.5;
    const width = this.portrait ? c.w - pad * 2 : Math.min(c.w - pad * 2, 640);
    for (const l of this.wrap(ctx, text.body, bodyFont, width)) {
      ctx.fillText(l, c.x + pad, y);
      y += bodySize * 1.5;
    }

    // Drafting marks at the corners.
    ctx.strokeStyle = 'rgba(63, 156, 240, 0.45)';
    ctx.lineWidth = 1.4;
    const m = 22;
    const k = 18;
    ctx.beginPath();
    for (const [x, yy, sx, sy] of [
      [c.x + m, c.y + m, 1, 1],
      [c.x + c.w - m, c.y + m, -1, 1],
      [c.x + m, c.y + c.h - m, 1, -1],
      [c.x + c.w - m, c.y + c.h - m, -1, -1],
    ]) {
      ctx.moveTo(x, yy + sy * k);
      ctx.lineTo(x, yy);
      ctx.lineTo(x + sx * k, yy);
    }
    ctx.stroke();

    if (this.decor) {
      const zone = { x: c.x + pad, y: c.y + c.h - this.controlsHeight + 18, w: c.w - pad * 2, h: this.controlsHeight - 64 };
      ctx.strokeStyle = 'rgba(29, 95, 158, 0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.roundRect(zone.x, zone.y, zone.w, zone.h, 18);
      ctx.stroke();
      ctx.setLineDash([]);
      const cx = zone.x + zone.w / 2;
      const cy = zone.y + zone.h / 2 - 12;
      ctx.strokeStyle = 'rgba(29, 95, 158, 0.8)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy + 14);
      ctx.lineTo(cx, cy - 14);
      ctx.moveTo(cx - 11, cy - 3);
      ctx.lineTo(cx, cy - 14);
      ctx.lineTo(cx + 11, cy - 3);
      ctx.stroke();
      ctx.font = `500 17px ${FONT_SANS}`;
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.textAlign = 'center';
      ctx.fillText('PDF, Word, Markdown, HTML, text or code', cx, cy + 46);
      ctx.textAlign = 'left';
    }
    if (this.decor) {
      const zone = { x: c.x + pad, y: c.y + c.h - this.controlsHeight + 18, w: c.w - pad * 2, h: this.controlsHeight - 64 };
      ctx.strokeStyle = 'rgba(29, 95, 158, 0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.roundRect(zone.x, zone.y, zone.w, zone.h, 18);
      ctx.stroke();
      ctx.setLineDash([]);
      const cx = zone.x + zone.w / 2;
      const cy = zone.y + zone.h / 2 - 12;
      ctx.strokeStyle = 'rgba(29, 95, 158, 0.8)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy + 14);
      ctx.lineTo(cx, cy - 14);
      ctx.moveTo(cx - 11, cy - 3);
      ctx.lineTo(cx, cy - 14);
      ctx.lineTo(cx + 11, cy - 3);
      ctx.stroke();
      ctx.font = `500 17px ${FONT_SANS}`;
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.textAlign = 'center';
      ctx.fillText('PDF, Word, Markdown, HTML, text or code', cx, cy + 46);
      ctx.textAlign = 'left';
    }
    if (this.drag) {
      ctx.strokeStyle = PALETTE.pollen;
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 10]);
      ctx.lineDashOffset = -now * 40;
      ctx.strokeRect(c.x + 14, c.y + 14, c.w - 28, c.h - 28);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
}
