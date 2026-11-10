import { describe, expect, it } from 'vitest';
import { assemble, type OcrLine } from '../src/doc/ocr';
import type { Page } from '../src/doc/types';

const page = (): Page => ({ index: 0, width: 800, height: 1000, x: 0, y: 0, lines: [], decorations: [] });

/** A line of OCR words at height `y`, `size` tall, starting at x = 40. */
function line(text: string, y: number, size = 12, paragraph = 1): OcrLine {
  let x = 40;
  const words = text.split(' ').map((t) => {
    const w = { text: t, x, y, w: t.length * size * 0.5, h: size };
    x += w.w + size * 0.4;
    return w;
  });
  return { words, baseline: y + size * 0.8, size, paragraph };
}

describe('OCR text assembly', () => {
  it('turns OCR lines into text, lines and words with char ranges', () => {
    const p = page();
    const lines = [line('Quarterly results', 40, 24), line('Revenue grew 18% to $412.6 million, driven by strong', 90), line('demand for dragline fiber.', 106)];
    const { text, headings } = assemble([{ page: p, lines }]);
    expect(text).toBe('Quarterly results\n\nRevenue grew 18% to $412.6 million, driven by strong\ndemand for dragline fiber.');
    expect(headings.map(([a, b]) => text.slice(a, b))).toEqual(['Quarterly results']);
    expect(p.lines).toHaveLength(3);
    const w = p.lines[1].words[4];
    expect(text.slice(w.start, w.end)).toBe('$412.6');
    expect(p.lines[2].start).toBe(text.indexOf('demand'));
  });

  it('rejoins words hyphenated at the end of a line', () => {
    const p = page();
    const { text } = assemble([{ page: p, lines: [line('the spider keeps spin-', 40), line('ning all night long', 56)] }]);
    expect(text).toBe('the spider keeps spinning all night long');
    // The word boxes still say what's printed.
    expect(p.lines[0].words.at(-1)!.text).toBe('spin-');
  });

  it('starts a new paragraph after a gap or a short closing line', () => {
    const p = page();
    const lines = [
      line('A first paragraph that runs across the whole width of the page here.', 40),
      line('It ends here.', 56),
      line('A second paragraph starts on the next line, without any extra space.', 72),
      line('And a third one after a gap.', 120),
    ];
    const { text } = assemble([{ page: p, lines }]);
    expect(text.split('\n\n')).toHaveLength(3);
  });
});
