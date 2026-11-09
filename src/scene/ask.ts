import { dist } from '../core/math';
import type { Doc } from '../doc/types';
import type { Spider } from '../spider/spider';
import type { HighlightSeg } from './state';

/** Speed at which the spider reads the answer (world px per simulated second). */
const READ_SPEED = 230;

interface LinePath {
  page: number;
  /** World coordinates of the walk along the line (just under the baseline). */
  x0: number;
  x1: number;
  y: number;
  seg: HighlightSeg;
}

/**
 * "Ask the spider": it goes to the passage that answers the question (rappelling in from above
 * when it's far away), then walks along it, highlighting it as it reads.
 */
export class AskRun {
  readonly segs: HighlightSeg[] = [];
  private lines: LinePath[] = [];
  private line = 0;
  private carrot = { x: 0, y: 0 };
  private arriving = true;
  done = false;
  /** Shown on the card: the answer, as found or as rewritten by the AI. */
  answer: { text: string; source: string } | null = null;
  readonly startedAt: number;

  constructor(
    doc: Doc,
    readonly range: [number, number],
    readonly question: string,
    now: number,
  ) {
    this.startedAt = now;
    const [start, end] = range;
    for (const page of doc.pages) {
      for (const [li, line] of page.lines.entries()) {
        if (line.end <= start || line.start >= end) continue;
        const words = line.words.filter((w) => w.end > start && w.start < end);
        if (!words.length) continue;
        const x0 = words[0].x;
        const x1 = words[words.length - 1].x + words[words.length - 1].w;
        const seg: HighlightSeg = {
          page: page.index,
          line: li,
          x0,
          x1,
          top: line.top,
          bottom: line.bottom,
          point: -1,
          from: x0,
          to: x0 - 1,
          seed: (li * 13 + page.index * 7) >>> 0,
          tone: 'answer',
        };
        this.segs.push(seg);
        this.lines.push({ page: page.index, x0: page.x + x0, x1: page.x + x1, y: page.y + Math.min(line.bottom, line.baseline + 4), seg });
      }
    }
  }

  /** The page the camera should look at. */
  get page(): number {
    return this.lines[Math.min(this.line, this.lines.length - 1)]?.page ?? 0;
  }

  get target(): { x: number; y: number } {
    const l = this.lines[0];
    return l ? { x: l.x0 - 24, y: l.y } : { x: 0, y: 0 };
  }

  /** Sends the spider to the passage: a short leap when close, a rappel from above when far. */
  begin(spider: Spider, sameView: boolean): void {
    const to = this.target;
    this.carrot = { ...to };
    if (!this.lines.length) {
      this.done = true;
      return;
    }
    const d = dist(spider.pos, to);
    if (sameView && d < 140) {
      spider.goal = { ...to };
    } else if (sameView && d < 700) {
      spider.jumpTo(to);
    } else {
      spider.place({ x: to.x, y: to.y - 520 }, Math.PI / 2);
      spider.rappelTo({ x: to.x, y: to.y - 900 }, to);
    }
  }

  update(dt: number, spider: Spider): void {
    if (this.done || !this.lines.length) return;
    if (this.arriving) {
      if (spider.mode !== 'walk') return;
      if (dist(spider.pos, this.target) > 40) {
        spider.goal = { ...this.target };
        return;
      }
      this.arriving = false;
      const l = this.lines[0];
      this.carrot = { x: l.x0, y: l.y };
    }
    let remaining = READ_SPEED * dt;
    while (remaining > 0 && this.line < this.lines.length) {
      const l = this.lines[this.line];
      // Back to the start of the next line first, like reading.
      if (this.carrot.y !== l.y || this.carrot.x < l.x0 - 1) {
        const d = dist(this.carrot, { x: l.x0, y: l.y });
        const step = Math.min(d, remaining * 2.4);
        const k = d ? step / d : 1;
        this.carrot = { x: this.carrot.x + (l.x0 - this.carrot.x) * k, y: this.carrot.y + (l.y - this.carrot.y) * k };
        remaining -= step / 2.4;
        if (d - step > 0.5) break;
        this.carrot = { x: l.x0, y: l.y };
      }
      const left = l.x1 - this.carrot.x;
      const step = Math.min(left, remaining);
      this.carrot.x += step;
      remaining -= step;
      l.seg.to = Math.max(l.seg.to, this.carrot.x - (l.x0 - l.seg.x0));
      if (l.x1 - this.carrot.x <= 0.5) {
        l.seg.to = l.seg.x1;
        this.line++;
      }
    }
    spider.goal = { ...this.carrot };
    if (this.line >= this.lines.length) this.done = true;
  }
}
