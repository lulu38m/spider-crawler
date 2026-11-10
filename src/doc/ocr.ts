import type { Worker as TesseractWorker } from 'tesseract.js';
import { PAGE_WIDTH } from './layout';
import { UnsupportedFileError } from './load';
import type { Doc, Line, Page, Word } from './types';

/**
 * OCR for photos, screenshots and scanned PDFs, with Tesseract compiled to WebAssembly.
 * Everything runs in the browser and is served by this app (no CDN): the engine and the English
 * and French models are copied next to the app at build time (see vite.config.ts), downloaded
 * the first time they're needed (about 15 MB) and cached by the browser.
 */

export interface OcrWord {
  text: string;
  /** Page units, like every other word box. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrLine {
  words: OcrWord[];
  baseline: number;
  /** Median word height: stands in for the font size. */
  size: number;
  /** Lines of the same paragraph share this number. */
  paragraph: number;
}

/** Below this, a word is more likely noise (a smudge, a fold) than text. */
const MIN_CONFIDENCE = 35;
/** OCR works best on text around 30 px tall: images are scaled to about this width. */
const OCR_MIN_WIDTH = 1600;
const OCR_MAX_WIDTH = 2600;

let worker: Promise<TesseractWorker> | null = null;
let onRecognizing: ((fraction: number) => void) | null = null;

function assetUrl(file = ''): string {
  return new URL(`${import.meta.env.BASE_URL}ocr/${file}`, location.href).href;
}

async function getWorker(): Promise<TesseractWorker> {
  worker ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    // OEM 1: the LSTM engine only, the most accurate and the smallest download.
    return createWorker(['eng', 'fra'], 1, {
      workerPath: assetUrl('worker.min.js'),
      corePath: assetUrl().replace(/\/$/, ''),
      langPath: assetUrl().replace(/\/$/, ''),
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') onRecognizing?.(m.progress);
      },
    });
  })();
  try {
    return await worker;
  } catch (err) {
    worker = null;
    throw new UnsupportedFileError(`The text reader (OCR) couldn't start: ${err instanceof Error ? err.message : err}`);
  }
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface BlocksOutput {
  blocks?: Array<{
    paragraphs: Array<{
      lines: Array<{
        bbox: Box;
        baseline?: Box & { has_baseline?: boolean };
        words: Array<{ text: string; confidence: number; bbox: Box }>;
      }>;
    }>;
  }> | null;
}

/** Reads the text of a canvas. `ppu` is the canvas' pixels per page unit, to convert the boxes. */
export async function recognize(canvas: HTMLCanvasElement, ppu: number, onProgress?: (fraction: number) => void): Promise<OcrLine[]> {
  const tesseract = await getWorker();
  onRecognizing = onProgress ?? null;
  let data: BlocksOutput;
  try {
    ({ data } = (await tesseract.recognize(canvas, {}, { blocks: true, text: false })) as unknown as { data: BlocksOutput });
  } finally {
    onRecognizing = null;
  }
  const lines: OcrLine[] = [];
  let paragraph = 0;
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      paragraph++;
      for (const line of para.lines) {
        const words: OcrWord[] = line.words
          .filter((w) => w.confidence >= MIN_CONFIDENCE && /[\p{L}\p{N}]/u.test(w.text))
          .map((w, wi) => ({
            // A list bullet read as "«" or "•" stuck to the first word.
            text: (wi === 0 ? w.text.replace(/^[«»•·▪●■*◦‣]+(?=\p{L})/u, '') : w.text).trim(),
            x: w.bbox.x0 / ppu,
            y: w.bbox.y0 / ppu,
            w: Math.max(1, (w.bbox.x1 - w.bbox.x0) / ppu),
            h: Math.max(1, (w.bbox.y1 - w.bbox.y0) / ppu),
          }))
          .filter((w) => w.text);
        if (!words.length) continue;
        const heights = words.map((w) => w.h).sort((a, b) => a - b);
        const size = heights[Math.floor(heights.length / 2)];
        const b = line.baseline;
        const baseline = b && b.has_baseline !== false ? (b.y0 + b.y1) / 2 / ppu : line.bbox.y1 / ppu;
        lines.push({ words, baseline, size, paragraph });
      }
    }
  }
  return lines;
}

/** Draws `source` at a width OCR likes (small images are enlarged, huge ones reduced). */
export function ocrCanvas(source: CanvasImageSource & { width: number; height: number }): { canvas: HTMLCanvasElement; ppu: number } {
  const width = Math.round(Math.min(OCR_MAX_WIDTH, Math.max(OCR_MIN_WIDTH, source.width)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round((source.height * width) / source.width);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, ppu: width / PAGE_WIDTH };
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
};

/**
 * A photo or a screenshot becomes a one-page document: the page is the picture itself, and the
 * spider walks on the words OCR found in it.
 */
export async function parseImage(data: ArrayBuffer, name: string, ext: string, onProgress?: (message: string, fraction?: number) => void): Promise<Doc> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([data], { type: IMAGE_TYPES[ext] ?? '' }), { imageOrientation: 'from-image' });
  } catch {
    throw new UnsupportedFileError(
      ext === 'heic' || ext === 'heif'
        ? "This browser can't open HEIC photos. Export it as JPEG (or take the photo with “Most compatible” in the camera settings)."
        : "This image couldn't be opened. Try a PNG or a JPEG.",
    );
  }
  onProgress?.('Getting the text reader ready…', 0);
  const { canvas, ppu } = ocrCanvas(bitmap);
  const lines = await recognize(canvas, ppu, (f) => onProgress?.(`Reading the picture… ${Math.round(f * 100)}%`, f));
  const words = lines.reduce((n, l) => n + l.words.length, 0);
  if (words < 3) {
    bitmap.close();
    throw new UnsupportedFileError("The spider couldn't find readable text in this picture. Try a sharper photo, taken straight on, in good light.");
  }
  const page: Page = {
    index: 0,
    width: PAGE_WIDTH,
    height: (bitmap.height * PAGE_WIDTH) / bitmap.width,
    x: 0,
    y: 0,
    lines: [],
    decorations: [],
    rasterize: async (pixelsPerUnit: number) => {
      const c = document.createElement('canvas');
      c.width = Math.ceil(PAGE_WIDTH * pixelsPerUnit);
      c.height = Math.ceil(page.height * pixelsPerUnit);
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      return c;
    },
  };
  const { text, headings } = assemble([{ page, lines }]);
  return {
    name,
    kind: 'image',
    text,
    pages: [page],
    fonts: [],
    headings,
    warnings: ['Read with OCR: a few words may be misread.'],
    dispose: () => bitmap.close(),
  };
}

/**
 * Fills the pages' lines and words from OCR results and builds the document text: words joined by
 * spaces, lines by newlines, paragraphs by blank lines, hyphenated line ends rejoined.
 */
export function assemble(pages: Array<{ page: Page; lines: OcrLine[] }>): { text: string; headings: Array<[number, number]> } {
  const all = pages.flatMap(({ page, lines }) => lines.map((l) => ({ page, l })));
  const sizes = all.map(({ l }) => l.size).sort((a, b) => a - b);
  const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;
  const widths = all.map(({ l }) => l.words[l.words.length - 1].x + l.words[l.words.length - 1].w - l.words[0].x).sort((a, b) => a - b);
  const fullWidth = widths.length ? widths[Math.floor(widths.length * 0.75)] : 0;
  /**
   * Tesseract often returns a whole column as one paragraph. A new one starts after extra space,
   * at a change of text size (headings), or after a short line that ends a sentence.
   */
  const breaksBefore = (prev: OcrLine, l: OcrLine) => {
    if (prev.paragraph !== l.paragraph) return true;
    const prevBottom = Math.max(...prev.words.map((w) => w.y + w.h));
    const top = Math.min(...l.words.map((w) => w.y));
    if (top - prevBottom > 0.6 * Math.min(prev.size, l.size)) return true;
    if (Math.abs(prev.size - l.size) > 0.2 * Math.max(prev.size, l.size)) return true;
    const last = prev.words[prev.words.length - 1];
    const prevWidth = last.x + last.w - prev.words[0].x;
    return prevWidth < 0.7 * fullWidth && /[.!?:;)"”»]$/.test(last.text);
  };
  const headings: Array<[number, number]> = [];
  let text = '';
  let hyphenated = false;
  all.forEach(({ page, l }, li) => {
    const prev = all[li - 1];
    if (prev && !hyphenated) text += prev.page !== page || breaksBefore(prev.l, l) ? '\n\n' : '\n';
    hyphenated = false;
    const words: Word[] = l.words.map((w, wi) => {
      if (wi > 0) text += ' ';
      let surface = w.text;
      if (wi === l.words.length - 1 && /\p{L}-$/u.test(surface) && surface.length > 2) {
        const next = all[li + 1]?.l.words[0];
        if (next && /^\p{Ll}/u.test(next.text) && !breaksBefore(l, all[li + 1].l)) {
          surface = surface.slice(0, -1);
          hyphenated = true;
        }
      }
      const start = text.length;
      text += surface;
      return { text: w.text, x: w.x, y: w.y, w: w.w, h: w.h, start, end: text.length };
    });
    const line: Line = {
      page: page.index,
      index: page.lines.length,
      words,
      x0: Math.min(...words.map((w) => w.x)),
      x1: Math.max(...words.map((w) => w.x + w.w)),
      top: Math.min(...words.map((w) => w.y)),
      bottom: Math.max(...words.map((w) => w.y + w.h)),
      baseline: l.baseline,
      start: words[0].start,
      end: words[words.length - 1].end,
    };
    page.lines.push(line);
    if (l.size > body * 1.35 && words.length < 14) headings.push([line.start, line.end]);
  });
  return { text, headings };
}
