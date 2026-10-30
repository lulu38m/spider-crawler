import { clamp, type Vec2 } from '../core/math';
import { REPO_LABEL } from '../config';
import type { Doc } from '../doc/types';
import { DEFAULT_DRAW, drawSpider } from '../spider/draw';
import type { Skin } from '../spider/skins';
import { Spider } from '../spider/spider';
import type { Summary } from '../summarize/types';
import { clip } from '../summarize';
import { drawBackdrop } from './background';
import { Camera } from './camera';
import { Cocoons, type SlotProvider } from './cocoons';
import { Director } from './director';
import { Finale, type FinaleContent } from './finale';
import { Hud } from './hud';
import { Idle, type IdleText } from './idle';
import { PageRenderer } from './pages';
import { Dragline } from './trail';
import { FallingWords } from './fallingWords';
import { hashString } from '../core/rng';

export type Phase = 'idle' | 'loading' | 'leaving' | 'crawl' | 'finale';

export interface SceneCallbacks {
  onPhase?(phase: Phase): void;
  /** The finale finished writing: a good moment to show the full summary. */
  onFinaleSettled?(): void;
}

export interface CrawlStats {
  words: number;
  readingMinutes: number;
  seconds: number;
  steps: number;
  silkMeters: number;
  caught: number;
}

export const DEFAULT_IDLE: IdleText = {
  title: 'Drop a document here.',
  body: 'The spider will crawl it page by page, highlight the sentences that matter, catch the keywords in its web and spin you a summary.',
};

const PAGE_GAP = 150;
/** One world unit is about a quarter millimeter of paper (an A4 page is 820 units wide). */
const METERS_PER_UNIT = 0.21 / 820;

const fmt = new Intl.NumberFormat('en');

export class Scene {
  phase: Phase = 'idle';
  w = 800;
  h = 600;
  dpr = 1;
  /** Simulated time (affected by speed and pause). */
  time = 0;
  speed = 1;
  paused = false;
  camera = new Camera();
  spider: Spider;
  idle = new Idle();
  hud = new Hud();
  dragline = new Dragline();
  /** Words that occasionally pop off the page (null outside a crawl). */
  falling: FallingWords | null = null;
  cocoons = new Cocoons();
  doc: Doc | null = null;
  summary: Summary | null = null;
  pages: PageRenderer | null = null;
  director: Director | null = null;
  finale: Finale | null = null;
  idleText: IdleText = DEFAULT_IDLE;
  aiTldr: string | null = null;
  /** Wall-clock seconds spent crawling (for the stats line). */
  crawlSeconds = 0;

  private leavingAt = 0;
  private pending: { doc: Doc; summary: Summary } | null = null;
  private finaleContent: FinaleContent | null = null;
  private finaleSettled = false;
  private cardAlpha = 1;

  constructor(skin: Skin, private cb: SceneCallbacks = {}) {
    this.spider = new Spider({ x: 0, y: 0 }, skin, -Math.PI / 2);
  }

  // ── Setup ──────────────────────────────────────────────────────────────

  resize(w: number, h: number, dpr: number): void {
    const first = this.w === 800 && this.h === 600;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.hud.layout(w, h);
    if (this.isIdle) {
      this.idle.layout(w, h, this.camera);
      this.camera.snap();
      if (first) this.spider.place({ x: this.idle.roam.x + this.idle.roam.w * 0.72, y: this.idle.roam.y + this.idle.roam.h * 0.55 }, -2.4);
    } else if (this.phase === 'finale' && this.finale) {
      const c = this.finale.camera(w, h);
      this.camera.set(c.x, c.y, c.zoom);
      this.camera.snap();
    }
  }

  fontsChanged(): void {
    this.idle.clearCache();
    this.finale?.clearCache();
  }

  get isIdle(): boolean {
    return this.phase === 'idle' || this.phase === 'loading';
  }

  setSkin(skin: Skin): void {
    this.spider.setSkin(skin);
  }

  pointer(screen: Vec2 | null): void {
    if (!this.isIdle) return;
    this.idle.mouse = screen ? this.camera.toWorld(screen, this.w, this.h) : null;
    this.idle.mouseAt = this.time;
  }

  click(screen: Vec2): void {
    if (this.isIdle) this.idle.click(this.camera.toWorld(screen, this.w, this.h), this.spider);
  }

  setDrag(active: boolean): void {
    this.idle.drag = active;
    if (this.phase === 'idle') this.idleText = active ? { title: 'Let go to start crawling.', body: DEFAULT_IDLE.body } : DEFAULT_IDLE;
  }

  setLoading(title: string, body: string): void {
    this.setPhase('loading');
    this.idleText = { title, body };
  }

  /** Back to the landing sheet. */
  reset(): void {
    this.doc?.dispose?.();
    this.pages?.dispose();
    this.doc = null;
    this.summary = null;
    this.pages = null;
    this.director = null;
    this.finale = null;
    this.pending = null;
    this.aiTldr = null;
    this.falling = null;
    this.cocoons.reset();
    this.dragline.reset();
    this.idleText = DEFAULT_IDLE;
    this.cardAlpha = 1;
    // Lay out the landing sheet before announcing the phase: the page places its buttons on it.
    this.idle.layout(this.w, this.h, this.camera);
    this.camera.snap();
    this.spider.place({ x: this.idle.roam.x + this.idle.roam.w * 0.5, y: this.idle.roam.y + this.idle.roam.h * 0.5 }, -Math.PI / 2);
    this.setPhase('idle');
  }

  /** Start the show: the spider leaps off the sheet, then drops onto the first page. */
  start(doc: Doc, summary: Summary): void {
    this.pending = { doc, summary };
    this.setPhase('leaving');
    this.leavingAt = this.time;
    const view = this.camera.view(this.w, this.h);
    if (this.spider.mode === 'walk') this.spider.jumpTo({ x: this.spider.pos.x, y: view.y - 160 }, 90);
  }

  /** Start immediately, without the leap (used by the demo renderer and deep links). */
  startNow(doc: Doc, summary: Summary): void {
    this.pending = { doc, summary };
    this.beginCrawl();
  }

  private setPhase(p: Phase): void {
    if (this.phase === p) return;
    this.phase = p;
    this.cb.onPhase?.(p);
  }

  private crawlZoom(): number {
    const portrait = this.h > this.w * 1.05;
    return clamp(portrait ? Math.min(this.w / 700, this.h / 640) : Math.min(this.w / 880, this.h / 640), 0.3, 1.9);
  }

  private beginCrawl(): void {
    if (!this.pending) return;
    const { doc, summary } = this.pending;
    this.pending = null;
    this.doc = doc;
    this.summary = summary;
    let y = 0;
    for (const p of doc.pages) {
      p.x = -p.width / 2;
      p.y = y;
      y += p.height + PAGE_GAP;
    }
    const last = doc.pages[doc.pages.length - 1];
    const hub = { x: 0, y: last.y + last.height + 1150 };
    this.finale = new Finale(hub);
    this.finaleSettled = false;
    this.finaleContent = null;
    this.pages = new PageRenderer(doc);
    const pages = this.pages;
    // Seeded by the file name: the same document always drops the same words (handy for videos).
    const falling = (this.falling = new FallingWords(hashString(doc.name), this.time));
    this.dragline.reset();
    this.cocoons.reset();
    this.crawlSeconds = 0;
    this.spider.steps = 0;
    this.spider.traveled = 0;
    this.spider.face = null;
    this.spider.speedLimit = 1000;
    this.director = new Director(
      doc,
      summary,
      this.spider,
      {
        onCatch: (mark) => {
          const page = doc.pages[mark.page];
          const keyword = summary.keywords[mark.keyword];
          const origin = { x: page.x + mark.rect.x + mark.rect.w / 2, y: page.y + mark.rect.y + mark.rect.h / 2 };
          this.cocoons.spawn(keyword.phrase, mark.keyword, origin, this.time);
        },
        onWord: (pass) => {
          const page = doc.pages[pass.page];
          falling.consider(pass, this.time, Math.sign(Math.cos(this.spider.heading)), () => {
            const cut = pages.cutWord(page, pass.word);
            return cut && { ...cut, origin: { x: page.x, y: page.y } };
          });
        },
        onFinale: () => this.enterFinale(),
      },
      { hub },
    );
    const first = doc.pages[this.director.crawled[0]];
    const z = this.crawlZoom();
    this.camera.set(first.x + first.width / 2, first.y + this.h / 2 / z - 50, z);
    this.camera.snap();
    this.spider.place({ x: first.x + 100, y: first.y - 400 }, Math.PI / 2);
    this.director.begin();
    this.setPhase('crawl');
  }

  private enterFinale(): void {
    if (!this.finale || !this.summary || !this.doc) return;
    this.setPhase('finale');
    this.finale.begin(this.time);
    this.spider.face = Math.PI / 2;
    this.spider.goal = { ...this.finale.hub };
    const c = this.finale.camera(this.w, this.h);
    this.camera.smoothTime = 0.7;
    this.camera.zoomSmoothTime = 0.9;
    this.camera.set(c.x, c.y, c.zoom);
    this.finaleContent = this.buildFinaleContent();
  }

  setAiTldr(text: string): void {
    this.aiTldr = text;
    // Only swap in if the spider hasn't started writing yet.
    if (this.finale && this.finaleContent && this.finale.revealed(this.time, this.finaleContent.tldr) === 0) {
      this.finaleContent = this.buildFinaleContent();
    }
  }

  private buildFinaleContent(): FinaleContent {
    const s = this.stats();
    const minutes = s.readingMinutes < 1 ? 'under a minute' : `about ${Math.round(s.readingMinutes)} min`;
    const silk = s.silkMeters < 1 ? `${Math.round(s.silkMeters * 100)} cm` : `${s.silkMeters.toFixed(1)} m`;
    return {
      title: this.doc?.name ?? '',
      tldr: clip(this.aiTldr ?? this.summary?.tldr ?? '', 300),
      stats: `${fmt.format(s.words)} words (${minutes} of reading) crawled in ${Math.max(1, Math.round(s.seconds))} s. ${fmt.format(s.steps)} steps, ${silk} of silk.`,
      footer: `Spun by Spider Crawler. ${REPO_LABEL}`,
    };
  }

  stats(): CrawlStats {
    return {
      words: this.summary?.stats.words ?? 0,
      readingMinutes: this.summary?.stats.readingMinutes ?? 0,
      seconds: this.crawlSeconds,
      steps: this.spider.steps,
      silkMeters: this.spider.traveled * METERS_PER_UNIT,
      caught: this.cocoons.items.length,
    };
  }

  /** Jump to the summary. */
  skip(): void {
    if (this.phase === 'leaving') this.beginCrawl();
    if (this.phase !== 'crawl' || !this.director || !this.summary) return;
    const fresh = this.director.skip(this.time);
    const slots = this.slotProvider();
    for (const c of this.cocoons.items) {
      if (c.state !== 'hanging') {
        c.state = 'hanging';
        c.pos = slots.slot(c.slot);
      }
    }
    for (const mark of fresh) this.cocoons.spawnHanging(this.summary.keywords[mark.keyword].phrase, mark.keyword, this.time, slots);
    this.dragline.reset();
  }

  // ── Simulation ─────────────────────────────────────────────────────────

  private slotProvider(): SlotProvider {
    const finale = this.phase === 'finale' && this.finale;
    if (!finale) return { slot: this.hud.slot, unit: this.hud.unit };
    const f = this.finale!;
    const t = f.elapsed(this.time);
    return {
      unit: this.hud.unit,
      slot: (i: number) => {
        // Staggered hand-over from the corner web to the big web.
        if (t < 1.2 + i * 0.12) return this.hud.slot(i);
        const p = f.web.slots[i % f.web.slots.length];
        return this.camera.toScreen(p, this.w, this.h);
      },
    };
  }

  update(dtReal: number): void {
    const real = Math.min(dtReal, 0.1);
    const dt = this.paused ? 0 : real * this.speed;
    if (dt <= 0) return;
    this.time += dt;
    const now = this.time;

    switch (this.phase) {
      case 'idle':
      case 'loading':
        this.idle.update(now, this.spider);
        this.spider.update(dt);
        this.cardAlpha = Math.min(1, this.cardAlpha + dt * 3);
        break;
      case 'leaving':
        this.spider.update(dt);
        this.cardAlpha = Math.max(0, this.cardAlpha - dt * 2.2);
        if (now - this.leavingAt > 0.75) this.beginCrawl();
        break;
      case 'crawl':
        this.director!.update(dt, now);
        this.spider.update(dt);
        this.dragline.update(this.spider, now);
        this.falling?.update(dt, now);
        this.crawlSeconds += real;
        this.updateCrawlCamera();
        break;
      case 'finale': {
        this.spider.update(dt);
        this.falling?.update(dt, now);
        const f = this.finale!;
        const c = f.camera(this.w, this.h);
        this.camera.set(c.x, c.y, c.zoom);
        const t = f.elapsed(now);
        this.cocoons.items.forEach((cc, i) => {
          cc.big = clamp((t - 1.2 - i * 0.12) / 0.8, 0, 1);
        });
        if (!this.finaleSettled && this.finaleContent && f.textDone(now, this.finaleContent.tldr) && t > 3) {
          this.finaleSettled = true;
          this.cb.onFinaleSettled?.();
        }
        break;
      }
    }
    this.cocoons.update(dt, now, (p) => this.camera.toScreen(p, this.w, this.h), this.slotProvider());
    this.camera.update(dt);
  }

  private updateCrawlCamera(): void {
    const doc = this.doc!;
    const z = this.crawlZoom();
    const sp = this.spider;
    const page = doc.pages[this.director!.page] ?? doc.pages[0];
    let tx = page.x + page.width / 2;
    const visW = this.w / z;
    if (page.width + 60 > visW) {
      const slack = (page.width + 60 - visW) / 2;
      tx = clamp(sp.pos.x, tx - slack, tx + slack);
    }
    let ty = sp.pos.y + (this.h * 0.06) / z;
    let tz = z;
    let smooth = 0.5;
    if (sp.mode === 'rappel') {
      smooth = 0.28;
      tz = z * 0.82;
      ty = sp.pos.y;
    } else if (sp.mode === 'jump') {
      smooth = 0.32;
    }
    // Don't drift above the current page while reading it.
    const minY = page.y + this.h / 2 / tz - 60;
    if (sp.mode !== 'rappel' || this.director!.page === this.director!.crawled[0]) ty = Math.max(ty, minY);
    this.camera.smoothTime = smooth;
    this.camera.zoomSmoothTime = 0.9;
    this.camera.set(tx, ty, tz);
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  render(ctx: CanvasRenderingContext2D): void {
    const { w, h, dpr, camera } = this;
    const now = this.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackdrop(ctx, w, h, dpr, camera, 1);
    camera.apply(ctx, w, h, dpr);
    const zoom = camera.zoom;

    if (this.isIdle || this.phase === 'leaving') {
      this.idle.draw(ctx, now, this.idleText, zoom, dpr, this.cardAlpha);
    }
    if (this.pages && this.director && (this.phase === 'crawl' || this.phase === 'finale')) {
      const view = camera.view(w, h, 60);
      this.pages.draw(ctx, view, zoom, dpr, now, this.director.highlights, this.director.catches, this.falling?.holes(now) ?? []);
      if (this.phase === 'crawl') this.dragline.draw(ctx, this.spider, now, zoom);
      this.falling?.draw(ctx, now, zoom * dpr);
    }
    if (this.finale && this.phase === 'finale') this.finale.drawWorld(ctx, now, zoom);

    // Rappel thread from far above.
    const r = this.spider.rappel;
    if (r) {
      const tip = this.spider.spinnerets;
      ctx.strokeStyle = 'rgba(220, 228, 250, 0.9)';
      ctx.lineWidth = Math.max(1.2 / zoom, 0.9);
      ctx.beginPath();
      ctx.moveTo(tip.x, r.anchor.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
    this.cocoons.drawWrapping(ctx, now);
    drawSpider(ctx, this.spider, { ...DEFAULT_DRAW, shadow: this.phase === 'finale' ? 0 : 1, px: zoom * dpr });

    // Screen-space overlay.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const crawling = this.phase === 'crawl' || this.phase === 'finale';
    const subtitle = crawling && this.doc ? this.doc.name : 'A literal web crawler';
    const finaleT = this.finale && this.phase === 'finale' ? this.finale.elapsed(now) : 0;
    const hudAlpha = this.phase === 'finale' ? clamp(1 - (finaleT - 1.5) / 1.2, 0, 1) : 1;
    if (crawling) this.hud.drawBands(ctx, this.phase === 'finale' ? clamp(1 - finaleT / 1.5, 0, 1) : 1);
    this.hud.drawWordmark(ctx, now, subtitle);
    if (crawling && this.director) {
      this.hud.drawWeb(ctx, now, hudAlpha);
      this.hud.drawStats(
        ctx,
        {
          fileName: this.doc?.name ?? '',
          page: this.director.page,
          pages: this.doc?.pages.length ?? 1,
          wordsRead: this.director.wordsRead,
          wordsTotal: this.director.totalWords,
          caught: this.cocoons.items.length,
          keywords: this.director.catches.length,
          progress: this.director.progress,
        },
        now,
        this.phase === 'finale' ? clamp(1 - finaleT / 0.8, 0, 1) : 1,
      );
      this.cocoons.draw(ctx, this.slotProvider());
    }
    if (this.finale && this.phase === 'finale' && this.finaleContent) {
      this.finale.drawScreen(ctx, w, h, now, this.finaleContent, camera.toScreen(this.spider.spinnerets, w, h));
    }
  }

  /** Make sure PDF pages are rasterized (deterministic rendering for the demo script). */
  async preload(): Promise<void> {
    await this.pages?.preload(this.crawlZoom() * this.dpr);
  }
}
