import { clamp, type Rect } from '../core/math';
import { FONT_SERIF } from '../doc/layout';
import type { Doc, Page } from '../doc/types';
import { PALETTE } from './palette';
import type { Hole } from './fallingWords';
import type { CatchMark, HighlightSeg } from './state';

const TIERS = [0.35, 1, 1.5, 2, 2.5, 3];
const MAX_BIG_BITMAPS = 6;

interface Raster {
  canvas?: HTMLCanvasElement;
  pending?: Promise<void>;
  used: number;
}

/** Lazily rasterizes PDF pages at a few resolutions and evicts the least recently used. */
class RasterCache {
  private entries = new Map<string, Raster>();
  private queue: Promise<void> = Promise.resolve();
  private clock = 0;

  private key(page: Page, tier: number) {
    return `${page.index}@${tier}`;
  }

  private request(page: Page, tier: number): Raster {
    const key = this.key(page, tier);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { used: this.clock };
      this.entries.set(key, entry);
      const e = entry;
      // One rasterization at a time keeps the pdf.js worker responsive.
      e.pending = this.queue = this.queue
        .then(() => page.rasterize!(tier))
        .then((canvas) => {
          e.canvas = canvas;
        })
        .catch(() => undefined)
        .finally(() => {
          e.pending = undefined;
        });
      this.evict();
    }
    entry.used = ++this.clock;
    return entry;
  }

  private evict() {
    const big = [...this.entries.entries()].filter(([k, e]) => !k.endsWith('@0.35') && e.canvas);
    if (big.length <= MAX_BIG_BITMAPS) return;
    big.sort((a, b) => a[1].used - b[1].used);
    for (const [k] of big.slice(0, big.length - MAX_BIG_BITMAPS)) this.entries.delete(k);
  }

  /** Best bitmap available now for the wanted resolution; schedules a better one if needed. */
  get(page: Page, ppu: number): HTMLCanvasElement | undefined {
    const want = TIERS.find((t) => t >= ppu * 0.92) ?? TIERS[TIERS.length - 1];
    const exact = this.request(page, want);
    if (exact.canvas) return exact.canvas;
    let best: HTMLCanvasElement | undefined;
    let bestTier = 0;
    for (const t of TIERS) {
      const e = this.entries.get(this.key(page, t));
      if (e?.canvas && (!best || Math.abs(t - want) < Math.abs(bestTier - want))) {
        best = e.canvas;
        bestTier = t;
      }
    }
    if (!best && want !== TIERS[0]) this.request(page, TIERS[0]);
    return best;
  }

  /** Sharpest bitmap already rendered, without scheduling anything. */
  sharpest(page: Page): HTMLCanvasElement | undefined {
    for (let i = TIERS.length - 1; i >= 0; i--) {
      const c = this.entries.get(this.key(page, TIERS[i]))?.canvas;
      if (c) return c;
    }
    return undefined;
  }

  /** Rasterize ahead of time (used by the deterministic demo renderer). */
  async preload(pages: Page[], ppu: number): Promise<void> {
    const want = TIERS.find((t) => t >= ppu * 0.92) ?? TIERS[TIERS.length - 1];
    await Promise.all(pages.map((p) => this.request(p, want).pending));
  }

  clear() {
    this.entries.clear();
  }
}

export class PageRenderer {
  private raster = new RasterCache();
  private currentFont = '';

  constructor(public doc: Doc) {
    // Typeset pages are rasterized too: drawing a bitmap per frame is far cheaper than
    // re-drawing thousands of glyphs, which matters while recording at 60 fps.
    for (const page of doc.pages) {
      if (!page.rasterize) page.rasterize = async (ppu: number) => this.rasterizeTypeset(page, ppu);
    }
  }

  preload(ppu: number): Promise<void> {
    return this.raster.preload(this.doc.pages, ppu);
  }

  private rasterizeTypeset(page: Page, ppu: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(page.width * ppu);
    canvas.height = Math.ceil(page.height * ppu);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ppu, ppu);
    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(0, 0, page.width, page.height);
    this.currentFont = '';
    this.drawTypeset(ctx, page, { x: 0, y: 0, w: page.width, h: page.height }, 0, 0);
    this.currentFont = '';
    return canvas;
  }

  dispose(): void {
    this.raster.clear();
  }

  /** Cut a word (plus a small margin) out of its page bitmap, for the falling-word effect. */
  cutWord(page: Page, box: Rect): { sprite: HTMLCanvasElement; rect: Rect } | null {
    const bitmap = this.raster.sharpest(page);
    if (!bitmap) return null;
    const rect = { x: box.x - 4, y: box.y - 3, w: box.w + 8, h: box.h + 6 };
    const k = bitmap.width / page.width;
    const sprite = document.createElement('canvas');
    sprite.width = Math.max(1, Math.round(rect.w * k));
    sprite.height = Math.max(1, Math.round(rect.h * k));
    const ctx = sprite.getContext('2d')!;
    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(0, 0, sprite.width, sprite.height);
    ctx.drawImage(bitmap, rect.x * k, rect.y * k, rect.w * k, rect.h * k, 0, 0, sprite.width, sprite.height);
    return { sprite, rect };
  }

  draw(
    ctx: CanvasRenderingContext2D,
    view: Rect,
    zoom: number,
    dpr: number,
    time: number,
    highlights: HighlightSeg[],
    catches: CatchMark[],
    holes: Hole[] = [],
  ): void {
    this.currentFont = '';
    for (const page of this.doc.pages) {
      if (page.y > view.y + view.h || page.y + page.height < view.y) continue;
      if (page.x > view.x + view.w || page.x + page.width < view.x) continue;
      this.drawPaper(ctx, page);
      this.drawBitmap(ctx, page, view, zoom * dpr);
      this.drawHoles(ctx, page, holes);
      this.drawHighlights(ctx, page, highlights);
      this.drawCatches(ctx, page, catches, time);
    }
  }

  /** Gaps left by fallen words: blank paper with a faint dashed outline, fading back in. */
  private drawHoles(ctx: CanvasRenderingContext2D, page: Page, holes: Hole[]) {
    for (const h of holes) {
      if (h.page !== page.index || h.alpha <= 0) continue;
      const x = page.x + h.rect.x;
      const y = page.y + h.rect.y;
      ctx.save();
      ctx.globalAlpha = h.alpha;
      ctx.fillStyle = PALETTE.paper;
      ctx.fillRect(x, y, h.rect.w, h.rect.h);
      ctx.strokeStyle = 'rgba(63, 156, 240, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, h.rect.w - 1, h.rect.h - 1);
      ctx.restore();
    }
  }

  private drawPaper(ctx: CanvasRenderingContext2D, page: Page) {
    // Stacked translucent rects fake a soft drop shadow at a fraction of shadowBlur's cost.
    ctx.fillStyle = 'rgba(6, 8, 32, 0.07)';
    for (let i = 1; i <= 6; i++) {
      const g = i * 5;
      ctx.fillRect(page.x - g, page.y - g + 14, page.width + g * 2, page.height + g * 2);
    }
    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(page.x, page.y, page.width, page.height);
  }

  private setFont(ctx: CanvasRenderingContext2D, css: string) {
    if (css !== this.currentFont) {
      ctx.font = css;
      this.currentFont = css;
    }
  }

  /** Draw typeset content with the page's top-left at (ox, oy). */
  private drawTypeset(ctx: CanvasRenderingContext2D, page: Page, view: Rect, ox = page.x, oy = page.y) {
    const { fonts } = this.doc;
    for (const d of page.decorations) {
      switch (d.kind) {
        case 'codeBox':
          ctx.fillStyle = '#f0f1f6';
          roundRect(ctx, ox + d.x, oy + d.y, d.w, d.h, 8);
          ctx.fill();
          break;
        case 'rule':
          ctx.fillStyle = '#c9cbdb';
          ctx.fillRect(ox + d.x, oy + d.y, d.w, 1.2);
          break;
        case 'quoteBar':
          ctx.fillStyle = '#d3d5e6';
          ctx.fillRect(ox + d.x, oy + d.y, d.w, d.h);
          break;
        case 'bullet':
          this.setFont(ctx, `500 17.5px ${FONT_SERIF}`);
          ctx.fillStyle = PALETTE.inkSoft;
          ctx.fillText(d.text ?? '•', ox + d.x, oy + d.y);
          break;
        case 'lineNumber':
          this.setFont(ctx, fonts[6].css);
          ctx.fillStyle = fonts[6].color;
          ctx.textAlign = 'right';
          ctx.fillText(d.text ?? '', ox + d.x, oy + d.y);
          ctx.textAlign = 'left';
          break;
      }
    }
    for (const line of page.lines) {
      if (!line.draw) continue;
      if (oy + line.bottom < view.y || oy + line.top > view.y + view.h) continue;
      const font = fonts[line.draw.font];
      this.setFont(ctx, font.css);
      ctx.fillStyle = font.color;
      ctx.fillText(line.draw.text, ox + line.draw.x, oy + line.baseline);
    }
  }

  private drawBitmap(ctx: CanvasRenderingContext2D, page: Page, view: Rect, ppu: number) {
    const bitmap = this.raster.get(page, ppu);
    if (bitmap) {
      // Bitmaps are rendered close to screen resolution, so cheap bilinear filtering is enough;
      // fall back to better filtering only when a coarser tier is standing in.
      const k = ppu / (bitmap.width / page.width);
      ctx.imageSmoothingQuality = k > 0.7 && k < 1.35 ? 'low' : 'medium';
      ctx.drawImage(bitmap, page.x, page.y, page.width, page.height);
      return;
    }
    if (this.doc.kind !== 'pdf') {
      this.drawTypeset(ctx, page, view);
      return;
    }
    // Placeholder while pdf.js renders: grey bars where the words are.
    ctx.fillStyle = 'rgba(35, 37, 58, 0.12)';
    for (const line of page.lines) {
      if (page.y + line.bottom < view.y || page.y + line.top > view.y + view.h) continue;
      for (const w of line.words) ctx.fillRect(page.x + w.x, page.y + w.y + w.h * 0.25, w.w, w.h * 0.5);
    }
  }

  private drawHighlights(ctx: CanvasRenderingContext2D, page: Page, highlights: HighlightSeg[]) {
    let any = false;
    for (const h of highlights) {
      if (h.page !== page.index || h.to <= h.from) continue;
      if (!any) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = PALETTE.highlighter;
        any = true;
      }
      // Marker strokes are a little uneven: slight tilt, rounded ends.
      const x0 = page.x + h.from - 2.5;
      const x1 = page.x + h.to + 2.5;
      const top = page.y + h.top - 1.5;
      const bottom = page.y + h.bottom + 1;
      const wob = ((h.seed % 7) - 3) * 0.35;
      ctx.beginPath();
      ctx.moveTo(x0 + 3, top + wob);
      ctx.lineTo(x1 - 2, top - wob);
      ctx.quadraticCurveTo(x1 + 2, (top + bottom) / 2, x1 - 1, bottom - wob);
      ctx.lineTo(x0 + 2, bottom + wob);
      ctx.quadraticCurveTo(x0 - 2, (top + bottom) / 2, x0 + 3, top + wob);
      ctx.fill();
    }
    if (any) ctx.restore();
  }

  private drawCatches(ctx: CanvasRenderingContext2D, page: Page, catches: CatchMark[], time: number) {
    for (const c of catches) {
      if (c.page !== page.index || c.caughtAt === null) continue;
      const t = clamp((time - c.caughtAt) / 0.6, 0, 1);
      const r = c.rect;
      const x = page.x + r.x - 5;
      const y = page.y + r.y - 3;
      const w = r.w + 10;
      const h = r.h + 6;
      ctx.save();
      // A pale silk film and a looped outline: the word stays readable but is clearly "caught".
      ctx.fillStyle = `rgba(63, 156, 240, ${0.1 * t})`;
      roundRect(ctx, x, y, w, h, h / 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(63, 120, 200, ${0.75 * t})`;
      ctx.lineWidth = 1;
      const perimeter = 2 * (w + h);
      ctx.setLineDash([perimeter * t, perimeter]);
      roundRect(ctx, x, y, w, h, h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Two loose turns of silk around the ends.
      ctx.globalAlpha = t * 0.6;
      ctx.beginPath();
      ctx.ellipse(x + 3, y + h / 2, 3.5, h * 0.62, 0.35, 0, Math.PI * 2);
      ctx.ellipse(x + w - 3, y + h / 2, 3.5, h * 0.62, -0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
