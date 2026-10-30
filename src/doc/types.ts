/**
 * Every input format becomes the same thing: pages of positioned lines and words, plus the
 * plain text the summarizer reads. Word offsets point into `Doc.text`, which is how a summary
 * sentence finds its way back to pixels on a page.
 */

export type DocKind = 'pdf' | 'docx' | 'markdown' | 'text' | 'code' | 'html';

export interface Word {
  text: string;
  /** Page-local box, y = top. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Char range in Doc.text. */
  start: number;
  end: number;
}

export interface Line {
  page: number;
  /** Index within the page. */
  index: number;
  words: Word[];
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** Baseline (page-local). */
  baseline: number;
  /** Char range in Doc.text. */
  start: number;
  end: number;
  /** Typeset docs: the string to draw and its font. PDF lines are drawn from the page bitmap. */
  draw?: { text: string; font: number; x: number };
}

export type DecorationKind = 'bullet' | 'rule' | 'quoteBar' | 'codeBox' | 'lineNumber';

export interface Decoration {
  kind: DecorationKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
}

/** Renders a PDF page into a canvas at `pixelsPerUnit` resolution. */
export type PageRasterizer = (pixelsPerUnit: number) => Promise<HTMLCanvasElement>;

export interface Page {
  index: number;
  width: number;
  height: number;
  /** World position of the top-left corner (set by the scene). */
  x: number;
  y: number;
  lines: Line[];
  decorations: Decoration[];
  rasterize?: PageRasterizer;
}

export interface FontSpec {
  css: string;
  size: number;
  color: string;
}

export interface Doc {
  name: string;
  kind: DocKind;
  text: string;
  pages: Page[];
  fonts: FontSpec[];
  /** Char ranges that are headings. */
  headings: Array<[number, number]>;
  /** For source files, e.g. "ts". */
  codeExtension?: string;
  warnings: string[];
  /** The web address it was crawled from, for documents opened from a link. */
  source?: string;
  /** Releases resources such as the PDF worker. */
  dispose?: () => void;
}

export type BlockKind = 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'quote' | 'code' | 'hr';

export interface Block {
  kind: BlockKind;
  text: string;
  /** List nesting depth (0 = top level). */
  depth?: number;
  /** Ordered-list number, if any. */
  ordinal?: number;
}

export type Measure = (font: string, text: string) => number;
