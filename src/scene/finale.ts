import { clamp, easeOutCubic, type Vec2 } from '../core/math';
import { PALETTE, UI_FONT } from './palette';
import { drawOrbWeb, makeOrbWeb, type OrbWeb, type WebProgress } from './web';

export const FINALE_WEB_RADIUS = 230;
const TEXT_DELAY = 2.6;

export interface FinaleContent {
  title: string;
  tldr: string;
  stats: string;
  footer: string;
}

interface FinaleLayout {
  portrait: boolean;
  hub: Vec2;
  radius: number;
  text: { x: number; y: number; w: number };
  unit: number;
}

/**
 * The ending: the spider drops into empty space, spins a full orb web, moves the caught keywords
 * onto it, then writes the gist in silk. Everything here is drawn on the canvas so recordings
 * capture it.
 */
export class Finale {
  web: OrbWeb;
  startedAt: number | null = null;
  private wrapCache = new Map<string, string[]>();

  constructor(public hub: Vec2) {
    this.web = makeOrbWeb(hub, FINALE_WEB_RADIUS, { radials: 30, frameSides: 7, spacing: FINALE_WEB_RADIUS / 17, mooringLength: 2600, seed: 3, slots: 12 });
  }

  begin(now: number): void {
    this.startedAt = now;
  }

  elapsed(now: number): number {
    return this.startedAt === null ? 0 : now - this.startedAt;
  }

  progress(now: number): WebProgress {
    const t = this.elapsed(now);
    return {
      frame: clamp(t / 0.55, 0, 1),
      radials: clamp((t - 0.35) / 1.0, 0, 1),
      spiral: easeOutCubic(clamp((t - 1.15) / 1.9, 0, 1)),
    };
  }

  /** Characters of the TL;DR revealed so far. */
  revealed(now: number, text: string): number {
    const t = this.elapsed(now) - TEXT_DELAY;
    if (t <= 0) return 0;
    const cps = Math.max(42, text.length / 3.6);
    return Math.min(text.length, Math.floor(t * cps));
  }

  textDone(now: number, text: string): boolean {
    const t = this.elapsed(now) - TEXT_DELAY;
    return t > 0 && this.revealed(now, text) >= text.length;
  }

  layout(w: number, h: number): FinaleLayout {
    const unit = clamp(Math.min(w, h) / 820, 0.7, 1.9);
    const portrait = h > w * 1.1;
    if (portrait) {
      const radius = Math.min(w * 0.36, h * 0.19);
      const hub = { x: w / 2, y: h * 0.1 + radius * 1.2 };
      return { portrait, hub, radius, unit, text: { x: w * 0.08, y: hub.y + radius * 1.4, w: w * 0.84 } };
    }
    const radius = Math.min(h * 0.33, w * 0.2);
    const hub = { x: w * 0.28, y: h * 0.5 };
    return { portrait, hub, radius, unit, text: { x: w * 0.52, y: h * 0.5, w: Math.min(w * 0.41, 46 * 16 * unit) } };
  }

  /** Camera that frames the web where the layout wants it. */
  camera(w: number, h: number): { x: number; y: number; zoom: number } {
    const l = this.layout(w, h);
    const zoom = l.radius / FINALE_WEB_RADIUS;
    return { x: this.hub.x - (l.hub.x - w / 2) / zoom, y: this.hub.y - (l.hub.y - h / 2) / zoom, zoom };
  }

  drawWorld(ctx: CanvasRenderingContext2D, now: number, zoom: number): void {
    if (this.startedAt === null) return;
    drawOrbWeb(ctx, this.web, this.progress(now), { rgb: PALETTE.silkRgb, alpha: 0.95, width: 1.4 / zoom, time: now, glint: true });
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

  /** Screen-space text. `spinnerets` is the spider's silk origin on screen (the thread follows the pen). */
  drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, content: FinaleContent, spinnerets: Vec2): void {
    if (this.startedAt === null) return;
    const l = this.layout(w, h);
    const u = l.unit;
    const t = this.elapsed(now);
    const size = l.portrait ? clamp(w * 0.05, 18, 46) : clamp(l.text.w / 17, 18, 40);
    const tldrFont = `600 ${size}px ${UI_FONT}`;
    const lines = this.wrap(ctx, content.tldr, tldrFont, l.text.w);
    const lh = size * 1.32;
    const titleSize = clamp(size * 0.5, 12, 20);
    const statsSize = clamp(size * 0.5, 12, 19);
    const blockH = titleSize * 2.2 + lines.length * lh + statsSize * 3;
    const top = l.portrait ? l.text.y : l.text.y - blockH / 2;

    ctx.save();
    ctx.textBaseline = 'alphabetic';
    const titleAlpha = clamp((t - TEXT_DELAY + 0.6) / 0.5, 0, 1);
    ctx.globalAlpha = titleAlpha;
    ctx.font = `500 ${titleSize}px ${UI_FONT}`;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.fillText(content.title, l.text.x, top + titleSize);

    // TL;DR, written character by character.
    const shown = this.revealed(now, content.tldr);
    ctx.globalAlpha = 1;
    ctx.font = tldrFont;
    ctx.fillStyle = PALETTE.silk;
    let count = 0;
    let pen: Vec2 | null = null;
    const y0 = top + titleSize * 2.2 + size;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const y = y0 + i * lh;
      if (count >= shown) break;
      const visible = line.slice(0, Math.max(0, shown - count));
      ctx.fillText(visible, l.text.x, y);
      pen = { x: l.text.x + ctx.measureText(visible).width, y: y - size * 0.3 };
      count += line.length + 1;
    }
    const writing = shown > 0 && shown < content.tldr.length;
    if (pen && writing) {
      ctx.strokeStyle = 'rgba(232, 236, 247, 0.45)';
      ctx.lineWidth = Math.max(0.8, u);
      ctx.beginPath();
      ctx.moveTo(spinnerets.x, spinnerets.y);
      ctx.quadraticCurveTo((spinnerets.x + pen.x) / 2, Math.max(spinnerets.y, pen.y) + 40 * u, pen.x, pen.y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.beginPath();
      ctx.arc(pen.x, pen.y, 7 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(pen.x, pen.y, 2.6 * u, 0, Math.PI * 2);
      ctx.fill();
    }

    if (shown >= content.tldr.length) {
      const doneAt = TEXT_DELAY + content.tldr.length / Math.max(42, content.tldr.length / 3.6);
      const a = clamp((t - doneAt) / 0.8, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `400 ${statsSize}px ${UI_FONT}`;
      ctx.fillStyle = PALETTE.hudText;
      const statLines = this.wrap(ctx, content.stats, ctx.font, l.text.w);
      statLines.forEach((s, i) => ctx.fillText(s, l.text.x, y0 + lines.length * lh + statsSize * 0.6 + i * statsSize * 1.4));
      ctx.globalAlpha = clamp((t - doneAt - 0.6) / 0.8, 0, 1) * 0.75;
      ctx.font = `500 ${clamp(12 * u, 11, 18)}px ${UI_FONT}`;
      ctx.fillStyle = PALETTE.hudMuted;
      ctx.textAlign = 'right';
      ctx.fillText(content.footer, w - 26 * u, h - 20 * u);
    }
    ctx.restore();
  }
}
