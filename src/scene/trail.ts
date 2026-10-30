import { dist, type Vec2 } from '../core/math';
import type { Spider } from '../spider/spider';

interface Anchor {
  p: Vec2;
  t: number;
}

/**
 * The dragline: spiders trail a safety thread and glue it down every so often. We keep the
 * attachment points; the newest segment runs to the spinnerets. Old silk fades so the page
 * stays readable.
 */
export class Dragline {
  anchors: Anchor[] = [];
  fadeAfter = 3;
  fadeDuration = 2.5;
  private lastHeading = 0;

  reset(): void {
    this.anchors = [];
  }

  attach(p: Vec2, time: number): void {
    this.anchors.push({ p: { ...p }, t: time });
    if (this.anchors.length > 600) this.anchors.splice(0, this.anchors.length - 600);
  }

  update(spider: Spider, time: number): void {
    const tip = spider.spinnerets;
    const last = this.anchors[this.anchors.length - 1];
    if (!last) {
      this.attach(tip, time);
      this.lastHeading = spider.heading;
      return;
    }
    if (spider.mode !== 'walk') return;
    const turned = Math.abs(Math.atan2(Math.sin(spider.heading - this.lastHeading), Math.cos(spider.heading - this.lastHeading)));
    if (dist(last.p, tip) > 140 || (turned > 0.7 && dist(last.p, tip) > 12)) {
      this.attach(tip, time);
      this.lastHeading = spider.heading;
    }
    // Drop fully faded anchors (keep the one before the visible run).
    while (this.anchors.length > 2 && time - this.anchors[1].t > this.fadeAfter + this.fadeDuration) this.anchors.shift();
  }

  draw(ctx: CanvasRenderingContext2D, spider: Spider, time: number, zoom: number): void {
    if (!this.anchors.length) return;
    const pts = [...this.anchors.map((a) => ({ p: a.p, t: a.t })), { p: spider.spinnerets, t: time }];
    const px = 1 / zoom;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      const age = time - pts[i - 1].t;
      const fade = age < this.fadeAfter ? 1 : Math.max(0, 1 - (age - this.fadeAfter) / this.fadeDuration);
      if (fade <= 0) continue;
      const a = pts[i - 1].p;
      const b = pts[i].p;
      // A faint shadow line keeps silver silk visible on white paper.
      ctx.strokeStyle = `rgba(40, 44, 90, ${0.16 * fade})`;
      ctx.lineWidth = Math.max(px * 1.4, 1.1);
      ctx.beginPath();
      ctx.moveTo(a.x + 0.9, a.y + 1.4);
      ctx.lineTo(b.x + 0.9, b.y + 1.4);
      ctx.stroke();
      ctx.strokeStyle = `rgba(200, 208, 236, ${0.85 * fade})`;
      ctx.lineWidth = Math.max(px * 1.1, 0.75);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // Attachment discs.
    ctx.fillStyle = 'rgba(210, 216, 240, 0.8)';
    for (let i = 0; i < this.anchors.length; i++) {
      const age = time - this.anchors[i].t;
      const fade = age < this.fadeAfter ? 1 : Math.max(0, 1 - (age - this.fadeAfter) / this.fadeDuration);
      if (fade <= 0) continue;
      ctx.globalAlpha = fade * 0.8;
      ctx.beginPath();
      ctx.arc(this.anchors[i].p.x, this.anchors[i].p.y, Math.max(px * 1.6, 1.3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
