import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PAGE_WIDTH } from './layout';
import type { Doc, Line, Measure, Page, Word } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGES = 400;

interface Run {
  str: string;
  x: number;
  baseline: number;
  size: number;
  width: number;
}

interface RawWord extends Word {
  /** Glue to the previous word without a space (the word was split across text runs). */
  glued: boolean;
  size: number;
}

interface RawLine {
  words: RawWord[];
  baseline: number;
  size: number;
  xEnd: number;
}

/**
 * Real PDFs keep their real look: pages are rasterized by pdf.js, and the text layer gives each
 * word's position so the spider walks on the actual words.
 */
export async function parsePdf(data: ArrayBuffer, name: string, measure: Measure, onProgress?: (done: number, total: number) => void): Promise<Doc> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const pdf = await task.promise;
  const total = Math.min(pdf.numPages, MAX_PAGES);
  const warnings: string[] = [];
  if (pdf.numPages > MAX_PAGES) warnings.push(`Only the first ${MAX_PAGES} of ${pdf.numPages} pages were read.`);

  const pages: Page[] = [];
  const allLines: Array<{ page: Page; raw: RawLine; line: Line }> = [];

  for (let i = 1; i <= total; i++) {
    const pdfPage = await pdf.getPage(i);
    const unit = PAGE_WIDTH / pdfPage.getViewport({ scale: 1 }).width;
    const viewport = pdfPage.getViewport({ scale: unit });
    const content = await pdfPage.getTextContent();
    const runs: Run[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue;
      const tx = pdfjs.Util.transform(viewport.transform, item.transform);
      // Skip rotated or vertical text; the spider reads horizontally.
      if (Math.abs(tx[1]) > 0.01 || Math.abs(tx[2]) > 0.01) continue;
      const size = Math.hypot(tx[2], tx[3]);
      if (size < 2) continue;
      runs.push({ str: item.str, x: tx[4], baseline: tx[5], size, width: item.width * unit });
    }

    const page: Page = {
      index: i - 1,
      width: PAGE_WIDTH,
      height: viewport.height,
      x: 0,
      y: 0,
      lines: [],
      decorations: [],
      rasterize: async (pixelsPerUnit: number) => {
        const vp = pdfPage.getViewport({ scale: unit * pixelsPerUnit });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        // pdf.js renders into an opaque context: paint the paper color, not transparency.
        await pdfPage.render({ canvas, viewport: vp, background: '#fbfbf8' }).promise;
        return canvas;
      },
    };

    for (const raw of groupLines(runs, measure)) {
      const words = raw.words;
      const line: Line = {
        page: page.index,
        index: page.lines.length,
        words,
        x0: words[0].x,
        x1: Math.max(...words.map((w) => w.x + w.w)),
        top: Math.min(...words.map((w) => w.y)),
        bottom: Math.max(...words.map((w) => w.y + w.h)),
        baseline: raw.baseline,
        start: 0,
        end: 0,
      };
      page.lines.push(line);
      allLines.push({ page, raw, line });
    }
    pages.push(page);
    onProgress?.(i, total);
  }

  // Build Doc.text: words joined by spaces, lines by newlines, paragraphs by blank lines.
  const sizes = allLines.flatMap(({ raw }) => raw.words.map((w) => w.size)).sort((a, b) => a - b);
  const bodySize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;
  const headings: Array<[number, number]> = [];
  let text = '';
  let hyphenated = false;
  for (let li = 0; li < allLines.length; li++) {
    const { raw, line, page } = allLines[li];
    const prev = li > 0 ? allLines[li - 1] : null;
    if (prev && !hyphenated) {
      const gap = line.top - prev.line.bottom;
      const sizeJump = Math.abs(raw.size - prev.raw.size) > 0.15 * Math.max(raw.size, prev.raw.size);
      // Paragraphs: extra vertical space or a change of font size. Page breaks usually continue a paragraph.
      const newParagraph = sizeJump || (prev.page === page && gap > 0.5 * raw.size);
      text += newParagraph ? '\n\n' : '\n';
    }
    hyphenated = false;
    raw.words.forEach((w, wi) => {
      if (wi > 0 && !w.glued) text += ' ';
      let surface = w.text;
      // "spin-" at the end of a line followed by "ning": rejoin the word in the text.
      if (wi === raw.words.length - 1 && /\p{L}-$/u.test(surface) && surface.length > 2) {
        const next = allLines[li + 1]?.raw.words[0];
        if (next && /^\p{Ll}/u.test(next.text)) {
          surface = surface.slice(0, -1);
          hyphenated = true;
        }
      }
      w.start = text.length;
      text += surface;
      w.end = text.length;
    });
    line.start = raw.words[0].start;
    line.end = raw.words[raw.words.length - 1].end;
    if (raw.size > bodySize * 1.28 && raw.words.length < 16) headings.push([line.start, line.end]);
  }

  if (text.replace(/\s/g, '').length < 40 * total) {
    warnings.push('This PDF has little or no selectable text. It may be a scan; the spider can only read text layers for now.');
  }

  return {
    name,
    kind: 'pdf',
    text,
    pages,
    fonts: [],
    headings,
    warnings,
    dispose: () => void task.destroy(),
  };
}

/** Group runs into lines in content-stream order (which follows reading order, columns included). */
function groupLines(runs: Run[], measure: Measure): RawLine[] {
  const lines: RawLine[] = [];
  let cur: RawLine | null = null;
  let prevRun: Run | null = null;
  for (const run of runs) {
    const sameLine =
      cur !== null &&
      Math.abs(run.baseline - cur.baseline) < cur.size * 0.45 &&
      run.x > cur.xEnd - cur.size * 0.6 &&
      run.x - cur.xEnd < cur.size * 2.5;
    if (!sameLine) {
      cur = { words: [], baseline: run.baseline, size: run.size, xEnd: run.x };
      lines.push(cur);
      prevRun = null;
    }
    const line = cur!;
    const font = `${Math.max(4, Math.round(run.size))}px serif`;
    const full = measure(font, run.str) || 1;
    const k = run.width / full;
    const gapToPrev = run.x - line.xEnd;
    const startsWithSpace = /^\s/.test(run.str);
    const prevEndsWithSpace = prevRun ? /\s$/.test(prevRun.str) : true;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    let first = true;
    while ((m = re.exec(run.str))) {
      const x = run.x + measure(font, run.str.slice(0, m.index)) * k;
      const w = Math.max(1, measure(font, m[0]) * k);
      const glued = first && line.words.length > 0 && !startsWithSpace && !prevEndsWithSpace && gapToPrev < run.size * 0.18;
      line.words.push({
        text: m[0],
        x,
        y: run.baseline - run.size * 0.82,
        w,
        h: run.size * 1.08,
        start: 0,
        end: 0,
        glued,
        size: run.size,
      });
      first = false;
    }
    line.xEnd = Math.max(line.xEnd, run.x + run.width);
    if (run.size > line.size) line.size = run.size;
    prevRun = run;
  }
  return lines.filter((l) => l.words.length > 0);
}
