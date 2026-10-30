import { add, clamp, dist, norm, scale, sub, type Rect, type Vec2 } from '../core/math';
import type { Doc, Line, Page, Word } from '../doc/types';
import type { Spider } from '../spider/spider';
import type { Summary } from '../summarize/types';
import type { CatchMark, HighlightSeg } from './state';

/**
 * The director turns a document + summary into choreography: which lines the spider walks
 * (boustrophedon, like an ox ploughing a field), which sentences it highlights, which words it
 * stops to catch, and how it gets from one page to the next. Everything it does on screen
 * reflects the real analysis: highlights are the summary sentences, cocoons are the keywords.
 */

/** World units per second at 1× speed. */
export const SPEEDS = { read: 270, skim: 540, travel: 560 };
/** If the plan runs long, everything walks up to this much faster rather than skipping more lines. */
const MAX_SPEEDUP = 1.6;
const CATCH_PAUSE = 0.55;
const JUMP_TIME = 0.75;
const RAPPEL_TIME = 1.25;
const MAX_STRIDE = 12;
/** Documents up to this many pages are crawled page by page; longer ones only visit pages that matter. */
const FULL_CRAWL_PAGES = 14;

type Action =
  | { kind: 'walk'; to: Vec2; speed: number; line?: { page: number; line: number; dir: 1 | -1; end: boolean } }
  | { kind: 'catch'; mark: number }
  | { kind: 'jump'; to: Vec2 }
  | { kind: 'rappel'; anchor: Vec2; to: Vec2 }
  | { kind: 'enter'; page: number }
  | { kind: 'finale' };

/** A word the spider's head just passed over while walking a line. */
export interface WordPass {
  page: number;
  line: number;
  word: Word;
  /** True when the word belongs to a highlighted summary sentence. */
  reading: boolean;
  /** True when the word is a keyword the spider will (or did) catch. */
  caught: boolean;
}

export interface DirectorEvents {
  onCatch?(mark: CatchMark): void;
  onWord?(pass: WordPass): void;
  onPage?(page: number): void;
  onFinale?(): void;
}

export interface DirectorOptions {
  /** Where the finale web hangs (world). */
  hub: Vec2;
}

export class Director {
  highlights: HighlightSeg[] = [];
  catches: CatchMark[] = [];
  carrot: Vec2 = { x: 0, y: 0 };
  page = 0;
  /** Char offset read so far. */
  cursor = 0;
  elapsed = 0;
  estimated = 0;
  done = false;
  /** Pages the spider will actually walk on. */
  crawled: number[] = [];

  private actions: Action[] = [];
  private index = 0;
  private actionTime = 0;
  private started = false;
  private segsByLine = new Map<string, HighlightSeg[]>();
  private wordStarts: number[] = [];
  private lineOfPage: Array<Map<number, Line>> = [];

  constructor(
    private doc: Doc,
    private summary: Summary,
    private spider: Spider,
    private events: DirectorEvents,
    private options: DirectorOptions,
  ) {
    for (const p of doc.pages) {
      const m = new Map<number, Line>();
      p.lines.forEach((l) => m.set(l.index, l));
      this.lineOfPage.push(m);
      for (const l of p.lines) for (const w of l.words) this.wordStarts.push(w.start);
    }
    this.wordStarts.sort((a, b) => a - b);
    this.buildHighlights();
    this.buildCatches();
    this.plan();
  }

  get totalWords(): number {
    return this.wordStarts.length;
  }

  get wordsRead(): number {
    if (this.done) return this.wordStarts.length;
    // Binary search: words that start before the cursor.
    let lo = 0;
    let hi = this.wordStarts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.wordStarts[mid] < this.cursor) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  get caught(): number {
    return this.catches.filter((c) => c.caughtAt !== null).length;
  }

  get progress(): number {
    return this.done ? 1 : clamp(this.elapsed / Math.max(1, this.estimated), 0, 0.99);
  }

  // ── Analysis → marks on pages ────────────────────────────────────────────

  private allLines(): Line[] {
    return this.doc.pages.flatMap((p) => p.lines);
  }

  private buildHighlights(): void {
    const lines = this.allLines();
    this.summary.points.forEach((point, pi) => {
      for (const line of lines) {
        if (line.end <= point.start || line.start >= point.end) continue;
        const words = line.words.filter((w) => w.end > point.start && w.start < point.end);
        if (!words.length) continue;
        const seg: HighlightSeg = {
          point: pi,
          page: line.page,
          line: line.index,
          x0: words[0].x,
          x1: words[words.length - 1].x + words[words.length - 1].w,
          top: Math.min(...words.map((w) => w.y)),
          bottom: Math.max(...words.map((w) => w.y + w.h)),
          from: Infinity,
          to: -Infinity,
          seed: (pi * 31 + line.index * 17 + line.page * 7) >>> 0,
        };
        this.highlights.push(seg);
        const key = `${line.page}:${line.index}`;
        const list = this.segsByLine.get(key) ?? [];
        list.push(seg);
        this.segsByLine.set(key, list);
      }
    });
  }

  /** One occurrence per keyword, spread evenly over the document so catches happen all along. */
  private buildCatches(): void {
    const lines = this.allLines();
    const total = Math.max(1, this.doc.text.length);
    const keywords = this.summary.keywords
      .map((k, i) => ({ k, i, first: k.occurrences[0]?.[0] ?? Infinity }))
      .filter((x) => isFinite(x.first))
      .sort((a, b) => a.first - b.first);
    const used: Array<{ page: number; rect: Rect }> = [];
    keywords.forEach(({ k, i }, order) => {
      const target = ((order + 0.5) / keywords.length) * total;
      const options = [...k.occurrences].sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target));
      for (const [s, e] of options.slice(0, 12)) {
        const line = findLine(lines, s);
        if (!line) continue;
        const words = line.words.filter((w) => w.end > s && w.start < e);
        if (!words.length) continue;
        const rect: Rect = {
          x: words[0].x,
          y: Math.min(...words.map((w) => w.y)),
          w: words[words.length - 1].x + words[words.length - 1].w - words[0].x,
          h: Math.max(...words.map((w) => w.y + w.h)) - Math.min(...words.map((w) => w.y)),
        };
        if (used.some((u) => u.page === line.page && overlaps(u.rect, rect, 30))) continue;
        used.push({ page: line.page, rect });
        this.catches.push({ keyword: i, page: line.page, line: line.index, rect, caughtAt: null });
        break;
      }
    });
  }

  // ── Planning ────────────────────────────────────────────────────────────

  private plan(): void {
    const pages = this.doc.pages;
    const interesting = new Set<number>([...this.highlights.map((h) => h.page), ...this.catches.map((c) => c.page)]);
    const nonEmpty = pages.filter((p) => p.lines.some((l) => l.words.length)).map((p) => p.index);
    let crawl = nonEmpty;
    if (nonEmpty.length > FULL_CRAWL_PAGES) {
      const keep = new Set<number>([nonEmpty[0], nonEmpty[nonEmpty.length - 1], ...interesting]);
      crawl = nonEmpty.filter((i) => keep.has(i));
    }
    if (!crawl.length) crawl = [0];
    this.crawled = crawl;

    const totalBudget = clamp(12 + 6.5 * crawl.length, 20, 60);
    const weight = (p: Page) =>
      1 + p.lines.length / 40 + this.highlights.filter((h) => h.page === p.index).length * 0.35 + this.catches.filter((c) => c.page === p.index).length * 0.3;
    const weights = crawl.map((i) => weight(pages[i]));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;

    const actions: Action[] = [];
    let walk = 0;
    let fixed = 0;
    const first = pages[crawl[0]];
    const firstLine = first.lines.find((l) => l.words.length);
    const startX = first.x + (firstLine ? firstLine.x0 - 10 : first.width * 0.2);
    const startY = first.y + (firstLine ? (firstLine.top + firstLine.bottom) / 2 : 120);
    actions.push({ kind: 'rappel', anchor: { x: startX, y: first.y - 900 }, to: { x: startX, y: startY } });
    actions.push({ kind: 'enter', page: crawl[0] });
    fixed += 1.6;
    let pos: Vec2 = { x: startX, y: startY };
    let dir: 1 | -1 = 1;

    crawl.forEach((pageIndex, ci) => {
      const page = pages[pageIndex];
      if (ci > 0) {
        const prev = pages[crawl[ci - 1]];
        const exitX = clamp(pos.x, prev.x + 50, prev.x + prev.width - 50);
        const exit = { x: exitX, y: prev.y + prev.height - 34 };
        actions.push({ kind: 'walk', to: exit, speed: SPEEDS.travel });
        walk += dist(pos, exit) / SPEEDS.travel;
        const land = { x: clamp(exitX, page.x + 50, page.x + page.width - 50), y: page.y + 40 };
        if (pageIndex === crawl[ci - 1] + 1) {
          actions.push({ kind: 'jump', to: land });
          fixed += JUMP_TIME;
        } else {
          actions.push({ kind: 'rappel', anchor: exit, to: land });
          fixed += RAPPEL_TIME;
        }
        actions.push({ kind: 'enter', page: pageIndex });
        pos = land;
        dir = land.x > page.x + page.width / 2 ? -1 : 1;
      }
      const budget = (totalBudget * weights[ci]) / sum;
      let best = this.planPage(page, 1, pos, dir);
      for (let stride = 2; stride <= MAX_STRIDE && best.time > budget; stride++) {
        best = this.planPage(page, stride, pos, dir);
      }
      actions.push(...best.actions);
      walk += best.walk;
      fixed += best.time - best.walk;
      pos = best.end;
      dir = best.dir;
    });

    // Down to the finale web.
    const last = pages[crawl[crawl.length - 1]];
    const exit = { x: last.x + last.width / 2, y: last.y + last.height - 34 };
    actions.push({ kind: 'walk', to: exit, speed: SPEEDS.travel });
    walk += dist(pos, exit) / SPEEDS.travel;
    actions.push({ kind: 'rappel', anchor: exit, to: this.options.hub });
    fixed += RAPPEL_TIME + 0.4;
    actions.push({ kind: 'finale' });

    // Over budget: walk faster (up to a limit) rather than skip even more lines.
    const over = (walk + fixed) / totalBudget;
    const speedup = clamp(over, 1, MAX_SPEEDUP);
    if (speedup > 1) for (const a of actions) if (a.kind === 'walk') a.speed *= speedup;
    this.actions = actions;
    this.estimated = walk / speedup + fixed;
  }

  private planPage(page: Page, stride: number, from: Vec2, startDir: 1 | -1): { actions: Action[]; time: number; walk: number; end: Vec2; dir: 1 | -1 } {
    const actions: Action[] = [];
    let walk = 0;
    let fixed = 0;
    let pos = from;
    let dir = startDir;
    const interest = new Set<number>();
    for (const h of this.highlights) if (h.page === page.index) interest.add(h.line);
    for (const c of this.catches) if (c.page === page.index) interest.add(c.line);
    const content = page.lines.filter((l) => l.words.length > 0);
    const lastIndex = content.length ? content[content.length - 1].index : -1;
    const visited = content.filter((l, k) => k % stride === 0 || interest.has(l.index) || l.index === lastIndex);

    for (const line of visited) {
      // Walk just under the baseline: the dragline then reads as an underline, not a strikethrough.
      const y = page.y + Math.min(line.bottom, line.baseline + 4);
      const xs = page.x + line.x0 - 12;
      const xe = page.x + line.x1 + 12;
      const start = { x: dir > 0 ? xs : xe, y };
      const end = { x: dir > 0 ? xe : xs, y };
      actions.push({ kind: 'walk', to: start, speed: SPEEDS.travel });
      walk += dist(pos, start) / SPEEDS.travel;

      // Cut the line where highlighted sentences start/end and where words get caught:
      // the spider slows down to read the sentences that matter and skims the rest.
      const segs = this.segsByLine.get(`${page.index}:${line.index}`) ?? [];
      const lineCatches = this.catches
        .map((c, i) => ({ x: page.x + c.rect.x + c.rect.w / 2, i, c }))
        .filter(({ c }) => c.page === page.index && c.line === line.index);
      const cuts = new Set<number>();
      for (const sg of segs) {
        cuts.add(page.x + sg.x0);
        cuts.add(page.x + sg.x1);
      }
      for (const lc of lineCatches) cuts.add(lc.x);
      const lo = Math.min(xs, xe);
      const hi = Math.max(xs, xe);
      const stops = [...cuts].filter((x) => x > lo && x < hi).sort((a, b) => (a - b) * dir);
      stops.push(end.x);
      let cur = start.x;
      for (const x of stops) {
        const mid = (cur + x) / 2 - page.x;
        const reading = segs.some((sg) => mid >= sg.x0 - 1 && mid <= sg.x1 + 1);
        const speed = reading ? SPEEDS.read : SPEEDS.skim;
        const isEnd = x === end.x;
        actions.push({ kind: 'walk', to: { x, y }, speed, line: { page: page.index, line: line.index, dir, end: isEnd } });
        walk += Math.abs(x - cur) / speed;
        for (const lc of lineCatches) {
          if (Math.abs(lc.x - x) < 0.01) {
            actions.push({ kind: 'catch', mark: lc.i });
            fixed += CATCH_PAUSE;
          }
        }
        cur = x;
      }
      pos = end;
      dir = dir > 0 ? -1 : 1;
    }
    return { actions, time: walk + fixed, walk, end: pos, dir };
  }

  // ── Execution ───────────────────────────────────────────────────────────

  /** Start position for the intro (the first action is a rappel). */
  begin(): void {
    this.index = 0;
    this.actionTime = 0;
    this.started = false;
    this.carrot = { ...this.spider.pos };
  }

  update(dt: number, now: number): void {
    if (this.done) return;
    this.elapsed += dt;
    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-6 && this.index < this.actions.length && guard++ < 64) {
      const a = this.actions[this.index];
      switch (a.kind) {
        case 'walk': {
          const before = this.carrot.x;
          const d = dist(this.carrot, a.to);
          const travel = a.speed * remaining;
          if (travel >= d) {
            this.carrot = { ...a.to };
            remaining -= d / a.speed;
            if (a.line) this.progressLine(a.line, true, before);
            this.next();
          } else {
            this.carrot = add(this.carrot, scale(norm(sub(a.to, this.carrot)), travel));
            remaining = 0;
            if (a.line) this.progressLine(a.line, false, before);
          }
          this.spider.goal = { ...this.carrot };
          break;
        }
        case 'catch': {
          const mark = this.catches[a.mark];
          if (!this.started) {
            this.started = true;
            this.actionTime = 0;
            mark.caughtAt = now;
            this.spider.tasting = 1;
            this.events.onCatch?.(mark);
          }
          this.actionTime += remaining;
          if (this.actionTime >= CATCH_PAUSE) {
            remaining = this.actionTime - CATCH_PAUSE;
            this.next();
          } else remaining = 0;
          break;
        }
        case 'jump':
        case 'rappel': {
          if (!this.started) {
            this.started = true;
            if (a.kind === 'jump') this.spider.jumpTo(a.to);
            else this.spider.rappelTo(a.anchor, a.to);
          }
          if (this.spider.mode === 'walk') {
            this.carrot = { ...a.to };
            this.spider.goal = { ...a.to };
            this.next();
          } else {
            this.carrot = { ...this.spider.pos };
            remaining = 0;
          }
          break;
        }
        case 'enter':
          this.page = a.page;
          this.events.onPage?.(a.page);
          this.next();
          break;
        case 'finale':
          this.finish();
          remaining = 0;
          break;
      }
    }
  }

  private next(): void {
    this.index++;
    this.actionTime = 0;
    this.started = false;
  }

  private progressLine(ref: { page: number; line: number; dir: 1 | -1; end: boolean }, arrived: boolean, beforeX: number): void {
    const page = this.doc.pages[ref.page];
    const x = this.carrot.x - page.x;
    const prev = beforeX - page.x;
    const segs = this.segsByLine.get(`${ref.page}:${ref.line}`);
    const line = this.lineOfPage[ref.page].get(ref.line);
    if (line && this.events.onWord) {
      const lo = Math.min(prev, x);
      const hi = Math.max(prev, x);
      for (const word of line.words) {
        const c = word.x + word.w / 2;
        if (c <= lo || c > hi) continue;
        const reading = !!segs?.some((sg) => c >= sg.x0 && c <= sg.x1);
        const caught = this.catches.some(
          (m) => m.page === ref.page && m.line === ref.line && c >= m.rect.x && c <= m.rect.x + m.rect.w,
        );
        this.events.onWord({ page: ref.page, line: ref.line, word, reading, caught });
      }
    }
    if (segs) {
      for (const s of segs) {
        if (arrived && ref.end) {
          s.from = s.x0;
          s.to = s.x1;
          continue;
        }
        if (ref.dir > 0 && x > s.x0) {
          s.from = s.x0;
          s.to = Math.max(s.to, Math.min(x, s.x1));
        } else if (ref.dir < 0 && x < s.x1) {
          s.to = s.x1;
          s.from = Math.min(s.from, Math.max(x, s.x0));
        }
      }
    }
    if (line && arrived && ref.end) this.cursor = Math.max(this.cursor, line.end);
  }

  private finish(): void {
    this.done = true;
    this.index = this.actions.length;
    this.cursor = this.doc.text.length;
    for (const h of this.highlights) {
      h.from = h.x0;
      h.to = h.x1;
    }
    this.events.onFinale?.();
  }

  /** Jump straight to the end: everything highlighted, every keyword caught. */
  skip(now: number): CatchMark[] {
    const fresh = this.catches.filter((c) => c.caughtAt === null);
    for (const c of fresh) c.caughtAt = now - 1;
    this.spider.place(this.options.hub, Math.PI / 2);
    this.carrot = { ...this.options.hub };
    this.finish();
    return fresh;
  }
}

function findLine(lines: Line[], offset: number): Line | undefined {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const l = lines[mid];
    if (offset < l.start) hi = mid - 1;
    else if (offset >= l.end) lo = mid + 1;
    else return l;
  }
  return undefined;
}

function overlaps(a: Rect, b: Rect, pad: number): boolean {
  return a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;
}
