import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markdownToBlocks, textToBlocks } from '../src/doc/blocks';
import { layoutBlocks, PAGE_HEIGHT, PAGE_WIDTH } from '../src/doc/layout';
import type { Measure } from '../src/doc/types';

// Deterministic fake measurement: 0.55em per character.
const measure: Measure = (font, text) => {
  const size = Number(font.match(/([\d.]+)px/)?.[1] ?? 16);
  return text.length * size * 0.55;
};

const md = readFileSync(new URL('../public/samples/spider-silk.md', import.meta.url), 'utf8');

describe('markdownToBlocks', () => {
  it('maps markdown structure to blocks', () => {
    const blocks = markdownToBlocks('# Title\n\nSome **bold** text with `code` and a [link](https://x.y).\n\n- one\n- two\n  1. nested\n\n> quoted\n\n```js\nlet a = 1;\n```\n\n---\n');
    expect(blocks.map((b) => b.kind)).toEqual(['h1', 'p', 'li', 'li', 'li', 'quote', 'code', 'hr']);
    expect(blocks[1].text).toBe('Some bold text with code and a link.');
    expect(blocks[4]).toMatchObject({ depth: 1, ordinal: 1, text: 'nested' });
  });

  it('drops front matter', () => {
    expect(markdownToBlocks('---\ntitle: x\n---\nHello there.')[0].text).toBe('Hello there.');
  });
});

describe('textToBlocks', () => {
  it('finds a title, paragraphs and lists', () => {
    const blocks = textToBlocks('My notes\n\nFirst paragraph\ncontinues here.\n\n- apples\n- pears');
    expect(blocks.map((b) => b.kind)).toEqual(['h1', 'p', 'li', 'li']);
    expect(blocks[1].text).toBe('First paragraph continues here.');
  });
});

describe('layoutBlocks', () => {
  const result = layoutBlocks(markdownToBlocks(md), { measure });

  it('keeps every word offset in sync with the text', () => {
    for (const page of result.pages) {
      for (const line of page.lines) {
        for (const w of line.words) expect(result.text.slice(w.start, w.end)).toBe(w.text);
      }
    }
  });

  it('keeps lines inside the page', () => {
    expect(result.pages.length).toBeGreaterThan(1);
    for (const page of result.pages) {
      expect(page.width).toBe(PAGE_WIDTH);
      for (const line of page.lines) {
        expect(line.x0).toBeGreaterThanOrEqual(0);
        expect(line.x1).toBeLessThanOrEqual(PAGE_WIDTH);
        expect(line.bottom).toBeLessThanOrEqual(PAGE_HEIGHT);
      }
    }
  });

  it('records headings', () => {
    expect(result.headings.length).toBe(9);
    const [a, b] = result.headings[0];
    expect(result.text.slice(a, b)).toBe('Spider Silk: The Thread That Holds Everything Together');
  });

  it('lays out source code with line numbers and exact offsets', () => {
    const src = 'function a() {\n  return 1;\n}\n\n// done';
    const code = layoutBlocks([{ kind: 'code', text: src }], { measure, code: true });
    expect(code.text).toBe(src);
    const numbers = code.pages[0].decorations.filter((d) => d.kind === 'lineNumber').map((d) => d.text);
    expect(numbers).toEqual(['1', '2', '3', '4', '5']);
    const words = code.pages.flatMap((p) => p.lines.flatMap((l) => l.words));
    for (const w of words) expect(src.slice(w.start, w.end)).toBe(w.text);
    // Indentation is kept: "return" starts two characters to the right of "function".
    const fn = words.find((w) => w.text === 'function')!;
    const ret = words.find((w) => w.text === 'return')!;
    expect(ret.x).toBeGreaterThan(fn.x);
  });
});
