import { REPO_URL } from '../config';
import { Camera } from '../scene/camera';
import { drawBackdrop } from '../scene/background';
import { drawCocoon } from '../scene/cocoons';
import { catchTargets } from '../scene/director';
import { drawLogo, drawMiniSpider } from '../scene/hud';
import { PALETTE, UI_FONT } from '../scene/palette';
import { drawOrbWeb, makeOrbWeb, WEB_DONE } from '../scene/web';
import { CODE_EXTENSIONS } from '../summarize/code';
import type { Summary } from '../summarize/types';

const fmt = new Intl.NumberFormat('en');

const KNOWN_EXTENSIONS = new Set(['pdf', 'docx', 'md', 'markdown', 'mdx', 'txt', 'text', 'html', 'htm', 'xhtml', 'csv', 'log', 'rst', 'tex', ...CODE_EXTENSIONS]);

/** The document's name without its file extension ("notes.md" → "notes", but "Node.js" stays). */
export function baseName(name: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i);
  const base = m && KNOWN_EXTENSIONS.has(m[1].toLowerCase()) ? name.slice(0, -m[0].length) : name;
  return base.trim() || 'document';
}

/** A name that is safe to save on any system: "What is a spider? | Wiki" → "What-is-a-spider-Wiki". */
export function fileSafe(name: string): string {
  const safe = baseName(name)
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/[\s.]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return safe || 'document';
}

/** The summary as Markdown (copy or download). */
export function summaryMarkdown(name: string, s: Summary, source?: string): string {
  const out: string[] = [`# ${baseName(name)}: the gist`, ''];
  if (source) out.push(`Source: <${source}>`, '');
  if (s.ai) {
    out.push(`**TL;DR** (${s.ai.provider}, ${s.ai.model}): ${s.ai.tldr}`, '');
    if (s.ai.points.length) out.push(...s.ai.points.map((p) => `- ${p}`), '');
  } else {
    out.push(`**TL;DR:** ${s.tldr}`, '');
  }
  if (s.figures?.length) {
    out.push('## Key figures', '', '| | Value | Change | Period |', '| --- | --- | --- | --- |');
    for (const f of s.figures) out.push(`| ${f.label} | ${f.value} | ${f.change ?? ''} | ${f.period ?? ''} |`);
    out.push('', '_As stated in the document. Not financial advice._', '');
  }
  out.push(s.ai ? '## Key sentences, as written in the document' : '## Key sentences', '');
  if (s.mode === 'code') out.push(...s.points.map((p) => `- \`${p.label ?? ''}\`: \`${p.text.trim()}\``));
  else out.push(...s.points.map((p) => `- ${p.text}`));
  if (s.keywords.length) out.push('', '## Keywords', '', s.keywords.map((k) => `\`${k.phrase}\``).join(', '));
  const minutes = Math.max(1, Math.round(s.stats.readingMinutes));
  out.push('', '---', '', `${fmt.format(s.stats.words)} words, about ${minutes} min of reading. Crawled by [Spider Crawler](${REPO_URL}), a literal web crawler.`, '');
  return out.join('\n');
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > width && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && text.length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '…');
  return lines;
}

/** A 1200×630 share card (the size social networks use for link previews). */
export async function shareCard(name: string, s: Summary, tldr: string): Promise<Blob> {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  await document.fonts?.load(`600 30px ${UI_FONT}`).catch(() => undefined);
  const cam = new Camera();
  cam.set(W / 2, H / 2, 1);
  cam.snap();
  drawBackdrop(ctx, W, H, 1, cam, 1);

  const web = makeOrbWeb({ x: 250, y: 330 }, 190, { radials: 26, frameSides: 6, spacing: 190 / 14, mooringLength: 900, seed: 3, slots: 8 });
  drawOrbWeb(ctx, web, WEB_DONE, { rgb: PALETTE.silkRgb, alpha: 0.9, width: 1.2, time: 1.3, glint: false });
  // Figures first: in a report they are the point.
  const targets = catchTargets(s).sort((a, b) => Number(b.figure) - Number(a.figure));
  targets.slice(0, 8).forEach((k, i) => {
    const p = web.slots[i];
    ctx.strokeStyle = 'rgba(232, 236, 247, 0.7)';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 10);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    drawCocoon(ctx, k.label, p, (i % 3 - 1) * 0.08, 1.05, 1, true, k.badge);
  });
  drawMiniSpider(ctx, { x: 250, y: 330 }, 9, 0.4);

  const x = 500;
  drawLogo(ctx, x, 92, 32, 0.2, false);
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 18px ${UI_FONT}`;
  ctx.fillStyle = PALETTE.hudMuted;
  ctx.fillText(name, x, 132);
  ctx.font = `600 31px ${UI_FONT}`;
  ctx.fillStyle = PALETTE.silk;
  const lines = wrap(ctx, tldr, W - x - 70, 7);
  lines.forEach((l, i) => ctx.fillText(l, x, 196 + i * 42));
  ctx.font = `400 18px ${UI_FONT}`;
  ctx.fillStyle = PALETTE.hudText;
  const minutes = Math.max(1, Math.round(s.stats.readingMinutes));
  ctx.fillText(`${fmt.format(s.stats.words)} words, about ${minutes} min of reading`, x, 196 + lines.length * 42 + 22);
  ctx.font = `500 16px ${UI_FONT}`;
  ctx.fillStyle = PALETTE.hudMuted;
  ctx.textAlign = 'right';
  ctx.fillText(REPO_URL.replace(/^https?:\/\//, ''), W - 40, H - 32);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the image'))), 'image/png'));
}
