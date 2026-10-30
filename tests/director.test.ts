import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markdownToBlocks } from '../src/doc/blocks';
import { layoutBlocks } from '../src/doc/layout';
import type { Doc, Measure } from '../src/doc/types';
import { Director } from '../src/scene/director';
import { Spider } from '../src/spider/spider';
import { skinById } from '../src/spider/skins';
import { summarize } from '../src/summarize';

const measure: Measure = (font, text) => text.length * Number(font.match(/([\d.]+)px/)?.[1] ?? 16) * 0.55;

function makeDoc(): Doc {
  const md = readFileSync(new URL('../public/samples/spider-silk.md', import.meta.url), 'utf8');
  const layout = layoutBlocks(markdownToBlocks(md), { measure });
  let y = 0;
  for (const p of layout.pages) {
    p.x = -p.width / 2;
    p.y = y;
    y += p.height + 150;
  }
  return { name: 'spider-silk.md', kind: 'markdown', text: layout.text, pages: layout.pages, fonts: layout.fonts, headings: layout.headings, warnings: [] };
}

describe('Director', () => {
  const doc = makeDoc();
  const summary = summarize(doc.text, { headings: doc.headings });

  it('maps every summary sentence to highlight segments on the page', () => {
    const director = new Director(doc, summary, new Spider({ x: 0, y: -400 }, skinById('blueprint')), {}, { hub: { x: 0, y: 99999 } });
    const covered = new Set(director.highlights.map((h) => h.point));
    expect(covered.size).toBe(summary.points.length);
    for (const h of director.highlights) expect(h.x1).toBeGreaterThan(h.x0);
  });

  it('plans one catch per keyword, spread over the document', () => {
    const director = new Director(doc, summary, new Spider({ x: 0, y: -400 }, skinById('blueprint')), {}, { hub: { x: 0, y: 99999 } });
    expect(director.catches.length).toBe(summary.keywords.length);
    expect(new Set(director.catches.map((c) => c.page)).size).toBeGreaterThan(1);
  });

  it('runs the whole show within its time budget and ends in the finale', () => {
    const spider = new Spider({ x: 0, y: -400 }, skinById('blueprint'));
    let finale = false;
    let caught = 0;
    const director = new Director(doc, summary, spider, { onFinale: () => (finale = true), onCatch: () => caught++ }, { hub: { x: 0, y: 8000 } });
    director.begin();
    let t = 0;
    const dt = 1 / 30;
    while (!finale && t < 200) {
      director.update(dt, t);
      spider.update(dt);
      t += dt;
    }
    expect(finale).toBe(true);
    expect(caught).toBe(director.catches.length);
    expect(director.wordsRead).toBe(director.totalWords);
    expect(director.highlights.every((h) => h.from === h.x0 && h.to === h.x1)).toBe(true);
    // Estimate and reality agree within 15%, and a 3-page article stays under a minute.
    expect(Math.abs(t - director.estimated) / director.estimated).toBeLessThan(0.15);
    expect(t).toBeLessThan(60);
  });
});
