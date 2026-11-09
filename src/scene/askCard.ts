import { clamp } from '../core/math';
import type { AskRun } from './ask';
import { UI_FONT } from './palette';

const wrapCache = new Map<string, string[]>();

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const key = `${ctx.font}|${width}|${maxLines}|${text}`;
  const hit = wrapCache.get(key);
  if (hit) return hit;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else line = next;
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '…');
  if (wrapCache.size > 200) wrapCache.clear();
  wrapCache.set(key, lines);
  return lines;
}

/**
 * The question and its answer, drawn on the canvas (so recordings show them) at the bottom of the
 * screen while the spider reads the passage.
 */
export function drawAskCard(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, run: AskRun, now: number, bottom = 0): void {
  const t = now - run.startedAt;
  const a = clamp(t / 0.4, 0, 1);
  if (a <= 0) return;
  const m = 26 * u;
  const cw = Math.min(780 * u, w - 2 * m);
  const pad = 20 * u;
  const inner = cw - 2 * pad;

  ctx.save();
  ctx.font = `700 ${19 * u}px ${UI_FONT}`;
  const q = wrap(ctx, run.question, inner - 30 * u, 2);
  ctx.font = `400 ${17 * u}px ${UI_FONT}`;
  const answer = run.answer?.text ?? '';
  const lines = answer ? wrap(ctx, `“${answer}”`, inner, 4) : [];
  const qh = q.length * 25 * u;
  const ah = lines.length ? 10 * u + lines.length * 24 * u : 0;
  const sh = run.answer ? 26 * u : 0;
  const ch = pad * 2 + 18 * u + qh + ah + sh;
  const x = (w - cw) / 2;
  const y = h - Math.max(m, bottom) - ch + (1 - a) * 20 * u;

  ctx.globalAlpha = a;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 28 * u;
  ctx.shadowOffsetY = 8 * u;
  ctx.fillStyle = 'rgba(12, 24, 52, 0.92)';
  ctx.beginPath();
  ctx.roundRect(x, y, cw, ch, 16 * u);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(56, 217, 150, 0.55)';
  ctx.lineWidth = 1.5 * u;
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  let cy = y + pad + 13 * u;
  ctx.font = `700 ${12.5 * u}px ${UI_FONT}`;
  ctx.fillStyle = '#38d996';
  ctx.fillText('YOU ASKED THE SPIDER', x + pad, cy);
  cy += 8 * u;
  ctx.font = `700 ${19 * u}px ${UI_FONT}`;
  ctx.fillStyle = '#ffffff';
  for (const l of q) {
    cy += 25 * u;
    ctx.fillText(l, x + pad, cy - 4 * u);
  }
  if (lines.length) {
    cy += 10 * u;
    ctx.font = `400 ${17 * u}px ${UI_FONT}`;
    ctx.fillStyle = '#dfe6f5';
    for (const l of lines) {
      cy += 24 * u;
      ctx.fillText(l, x + pad, cy - 4 * u);
    }
  }
  if (run.answer) {
    cy += 22 * u;
    ctx.font = `500 ${13 * u}px ${UI_FONT}`;
    ctx.fillStyle = '#93a3c7';
    ctx.fillText(run.answer.source, x + pad, cy);
  }
  ctx.restore();
}
