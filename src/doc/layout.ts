import type { Block, Decoration, FontSpec, Line, Measure, Page, Word } from './types';

/** Page geometry in world units. A4 proportions, generous margins: it should look like paper on camera. */
export const PAGE_WIDTH = 820;
export const PAGE_HEIGHT = 1160;
const MARGIN_X = 92;
const MARGIN_TOP = 96;
const MARGIN_BOTTOM = 92;

export const FONT_SERIF = "'Literata Variable', Literata, Georgia, 'Times New Roman', serif";
export const FONT_SANS = "'Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible', system-ui, sans-serif";
export const FONT_MONO = "'Atkinson Hyperlegible Mono Variable', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const INK = '#23253a';
const INK_SOFT = '#4a4d66';

interface Style {
  font: number;
  lineHeight: number;
  before: number;
  after: number;
  indent: number;
}

export interface LayoutResult {
  pages: Page[];
  text: string;
  fonts: FontSpec[];
  headings: Array<[number, number]>;
}

export interface LayoutOptions {
  measure: Measure;
  /** Source-file mode: everything monospace, with line numbers. */
  code?: boolean;
}

/** Fonts used by typeset pages. Index = FontSpec position (Line.draw.font). */
export function typesetFonts(): FontSpec[] {
  return [
    { css: `400 17.5px ${FONT_SERIF}`, size: 17.5, color: INK }, // 0 body
    { css: `700 34px ${FONT_SERIF}`, size: 34, color: INK }, // 1 h1
    { css: `650 25px ${FONT_SERIF}`, size: 25, color: INK }, // 2 h2
    { css: `650 20.5px ${FONT_SERIF}`, size: 20.5, color: INK }, // 3 h3
    { css: `italic 400 17.5px ${FONT_SERIF}`, size: 17.5, color: INK_SOFT }, // 4 quote
    { css: `400 14.5px ${FONT_MONO}`, size: 14.5, color: '#2c2f48' }, // 5 code
    { css: `400 12px ${FONT_MONO}`, size: 12, color: '#a2a5bb' }, // 6 line numbers
  ];
}

const STYLES: Record<Block['kind'], Style> = {
  h1: { font: 1, lineHeight: 44, before: 4, after: 20, indent: 0 },
  h2: { font: 2, lineHeight: 34, before: 26, after: 10, indent: 0 },
  h3: { font: 3, lineHeight: 29, before: 18, after: 6, indent: 0 },
  p: { font: 0, lineHeight: 29, before: 0, after: 13, indent: 0 },
  li: { font: 0, lineHeight: 29, before: 0, after: 5, indent: 28 },
  quote: { font: 4, lineHeight: 29, before: 4, after: 14, indent: 24 },
  code: { font: 5, lineHeight: 22, before: 6, after: 18, indent: 14 },
  hr: { font: 0, lineHeight: 0, before: 14, after: 22, indent: 0 },
};

/**
 * Typeset blocks onto pages: greedy line breaking with measured widths. Builds Doc.text alongside,
 * so each word knows its char range.
 */
export function layoutBlocks(blocks: Block[], options: LayoutOptions): LayoutResult {
  const { measure } = options;
  const fonts = typesetFonts();
  const pages: Page[] = [];
  const headings: Array<[number, number]> = [];
  let text = '';

  let page = newPage(0);
  pages.push(page);
  let y = MARGIN_TOP;
  const contentWidth = PAGE_WIDTH - MARGIN_X * 2;
  const bottom = PAGE_HEIGHT - MARGIN_BOTTOM;

  const spaceWidth = new Map<number, number>();
  const space = (font: number) => {
    let w = spaceWidth.get(font);
    if (w === undefined) spaceWidth.set(font, (w = measure(fonts[font].css, ' ')));
    return w;
  };

  const breakPage = () => {
    page = newPage(pages.length);
    pages.push(page);
    y = MARGIN_TOP;
  };

  /** Place one visual line; returns it so callers can attach decorations. */
  const placeLine = (words: Word[], font: number, lineHeight: number, drawText: string): Line => {
    if (y + lineHeight > bottom && page.lines.length > 0) breakPage();
    const size = fonts[font].size;
    const top = y;
    const baseline = top + lineHeight * 0.5 + size * 0.36;
    for (const w of words) {
      w.y = baseline - size * 0.8;
      w.h = size * 1.05;
    }
    const line: Line = {
      page: page.index,
      index: page.lines.length,
      words,
      x0: words[0]?.x ?? MARGIN_X,
      x1: words.length ? words[words.length - 1].x + words[words.length - 1].w : MARGIN_X,
      top,
      bottom: top + lineHeight,
      baseline,
      start: words[0]?.start ?? text.length,
      end: words.length ? words[words.length - 1].end : text.length,
      draw: { text: drawText, font, x: words[0]?.x ?? MARGIN_X },
    };
    page.lines.push(line);
    y += lineHeight;
    return line;
  };

  const addSpacing = (amount: number) => {
    // Never start a page with blank space.
    if (page.lines.length > 0 || page.decorations.length > 0) y += amount;
  };

  const ensureRoom = (needed: number) => {
    if (y + needed > bottom && page.lines.length > 0) breakPage();
  };

  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b];
    const style = STYLES[block.kind];
    if (text.length > 0) text += '\n\n';

    if (block.kind === 'hr') {
      addSpacing(style.before);
      ensureRoom(4);
      page.decorations.push({ kind: 'rule', x: MARGIN_X + contentWidth * 0.35, y, w: contentWidth * 0.3, h: 1 });
      y += style.after;
      continue;
    }

    if (block.kind === 'code') {
      layoutCode(block.text, !!options.code);
      continue;
    }

    const depth = block.depth ?? 0;
    const indent = style.indent + (block.kind === 'li' ? depth * 24 : 0);
    const left = MARGIN_X + indent;
    const maxWidth = contentWidth - indent;
    const font = style.font;
    const css = fonts[font].css;
    const normalized = block.text.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      text = text.replace(/\n\n$/, '');
      continue;
    }

    addSpacing(style.before);
    // Keep headings with at least two lines of what follows.
    if (block.kind.startsWith('h')) ensureRoom(style.lineHeight + 2 * STYLES.p.lineHeight);

    const blockStart = text.length;
    const firstLineIndex = page.lines.length;
    const firstPage = page;
    const sw = space(font);
    let lineWords: Word[] = [];
    let lineText = '';
    let x = left;
    const flush = () => {
      if (lineWords.length) placeLine(lineWords, font, style.lineHeight, lineText);
      lineWords = [];
      lineText = '';
      x = left;
    };
    for (const raw of normalized.split(' ')) {
      if (text.length > blockStart) text += ' ';
      const w = measure(css, raw);
      if (lineWords.length && x + w > left + maxWidth) flush();
      const word: Word = { text: raw, x, y: 0, w, h: 0, start: text.length, end: text.length + raw.length };
      text += raw;
      lineText += (lineText ? ' ' : '') + raw;
      lineWords.push(word);
      x += w + sw;
    }
    flush();

    if (block.kind === 'li') {
      const marker = block.ordinal !== undefined ? `${block.ordinal}.` : depth % 2 ? '◦' : '•';
      const firstLine = firstPage.lines[firstLineIndex];
      if (firstLine) {
        firstPage.decorations.push({ kind: 'bullet', x: left - 20, y: firstLine.baseline, w: 0, h: 0, text: marker });
      }
    }
    if (block.kind === 'quote') {
      // One bar per page the quote spans.
      for (let pi = firstPage.index; pi <= page.index; pi++) {
        const lines = pages[pi].lines.filter((l) => l.start >= blockStart);
        if (!lines.length) continue;
        pages[pi].decorations.push({ kind: 'quoteBar', x: MARGIN_X + 4, y: lines[0].top + 3, w: 3, h: lines[lines.length - 1].bottom - lines[0].top - 6 });
      }
    }
    if (block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3') headings.push([blockStart, text.length]);
    y += style.after;
  }

  return { pages, text, fonts, headings };

  /** Monospace layout with soft wrapping; source files also get line numbers. */
  function layoutCode(source: string, withNumbers: boolean) {
    const style = STYLES.code;
    const font = 5;
    const css = fonts[font].css;
    const charW = measure(css, 'M');
    const left = MARGIN_X + (withNumbers ? 30 : style.indent);
    const maxCols = Math.max(20, Math.floor((PAGE_WIDTH - MARGIN_X - left - (withNumbers ? 0 : style.indent)) / charW));
    const rawLines = source.replace(/\t/g, '  ').replace(/\s+$/, '').split('\n');
    if (!withNumbers) addSpacing(style.before);
    const boxStartY = new Map<Page, number>();
    const blockStart = text.length;
    rawLines.forEach((rawLine, lineNo) => {
      if (lineNo > 0) text += '\n';
      // Split into visual rows of at most maxCols characters, preferring whitespace breaks.
      const rows: Array<{ from: number; to: number }> = [];
      let from = 0;
      while (from < rawLine.length || rows.length === 0) {
        let to = Math.min(rawLine.length, from + maxCols);
        if (to < rawLine.length) {
          const space = rawLine.lastIndexOf(' ', to);
          if (space > from + maxCols * 0.5) to = space + 1;
        }
        rows.push({ from, to });
        from = to;
        if (from >= rawLine.length) break;
      }
      const lineStart = text.length;
      text += rawLine;
      rows.forEach((row, r) => {
        const segment = rawLine.slice(row.from, row.to);
        const words: Word[] = [];
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(segment))) {
          words.push({
            text: m[0],
            x: left + m.index * charW,
            y: 0,
            w: m[0].length * charW,
            h: 0,
            start: lineStart + row.from + m.index,
            end: lineStart + row.from + m.index + m[0].length,
          });
        }
        if (y + style.lineHeight > bottom && page.lines.length > 0) breakPage();
        if (!boxStartY.has(page)) boxStartY.set(page, y);
        const line = placeLine(words, font, style.lineHeight, segment.trimEnd());
        if (!words.length) {
          line.x0 = left;
          line.x1 = left;
          line.start = lineStart + row.from;
          line.end = lineStart + row.from;
        } else {
          // Indentation is meaningful in code: keep x0 at the first token.
          line.x0 = words[0].x;
        }
        // Code rows are drawn from the left edge with their indentation spaces.
        line.draw = { text: segment.trimEnd(), font, x: left };
        if (withNumbers && r === 0) {
          page.decorations.push({ kind: 'lineNumber', x: left - 12, y: line.baseline, w: 0, h: 0, text: String(lineNo + 1) });
        }
      });
    });
    if (!withNumbers) {
      for (const [p, startY] of boxStartY) {
        const lines = p.lines.filter((l) => l.start >= blockStart);
        if (!lines.length) continue;
        const endY = lines[lines.length - 1].bottom;
        p.decorations.unshift({ kind: 'codeBox', x: MARGIN_X, y: startY - 8, w: PAGE_WIDTH - MARGIN_X * 2, h: endY - startY + 16 });
      }
      y += style.after;
    }
  }
}

function newPage(index: number): Page {
  return { index, width: PAGE_WIDTH, height: PAGE_HEIGHT, x: 0, y: 0, lines: [], decorations: [] as Decoration[] };
}

/** Canvas-backed text measurement with a cache (layout measures the same words a lot). */
export function canvasMeasure(): Measure {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const cache = new Map<string, number>();
  let currentFont = '';
  return (font, s) => {
    const key = `${font}\u0000${s}`;
    let w = cache.get(key);
    if (w === undefined) {
      if (font !== currentFont) {
        ctx.font = font;
        currentFont = font;
      }
      w = ctx.measureText(s).width;
      cache.set(key, w);
    }
    return w;
  };
}
