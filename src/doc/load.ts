import { markdownToBlocks, textToBlocks } from './blocks';
import { layoutBlocks, typesetFonts } from './layout';
import { CODE_EXTENSIONS } from '../summarize/code';
import type { Block, Doc, DocKind, Measure } from './types';

export interface LoadInput {
  name: string;
  data: ArrayBuffer | string;
  /** Format hint when the name has no extension (pages opened from a link), e.g. "html". */
  ext?: string;
  /** Where the document came from, for links. */
  source?: string;
}

export type Progress = (message: string, fraction?: number) => void;

export class UnsupportedFileError extends Error {}

const UNSUPPORTED: Record<string, string> = {
  doc: 'Old .doc files are not supported. Save it as .docx or PDF and drop it again.',
  odt: 'OpenDocument files are not supported yet. Export it as PDF or .docx.',
  rtf: 'RTF is not supported yet. Export it as PDF or .docx.',
  pages: 'Pages files are not supported. Export it as PDF from Pages.',
  epub: 'EPUB is not supported yet (it is on the roadmap). Try a PDF.',
  pptx: 'Slides are not supported yet. Export them as PDF.',
  ppt: 'Slides are not supported yet. Export them as PDF.',
  key: 'Keynote files are not supported. Export them as PDF.',
  xlsx: 'Spreadsheets are not supported. The spider reads prose and code.',
  xls: 'Spreadsheets are not supported. The spider reads prose and code.',
  zip: 'Archives are not supported. Drop a single document.',
  tiff: 'TIFF images are not supported. Export it as PNG, JPEG or PDF.',
  tif: 'TIFF images are not supported. Export it as PNG, JPEG or PDF.',
  svg: 'SVG drawings are not supported. Export it as PNG.',
};

/** Photos and screenshots are read with OCR. */
export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp']);

export const ACCEPT =
  '.pdf,.docx,.md,.markdown,.mdx,.txt,.text,.html,.htm,.csv,.log,.rst,.tex,' +
  [...IMAGE_EXT].map((e) => `.${e}`).join(',') +
  ',image/*,' +
  [...CODE_EXTENSIONS].map((e) => `.${e}`).join(',');

export function extensionOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function bytesStartWith(buf: ArrayBuffer, sig: number[]): boolean {
  const view = new Uint8Array(buf, 0, Math.min(buf.byteLength, sig.length));
  return sig.every((b, i) => view[i] === b);
}

function decodeText(data: ArrayBuffer | string): string {
  if (typeof data === 'string') return data;
  const text = new TextDecoder('utf-8').decode(data).replace(/^﻿/, '');
  const sample = text.slice(0, 4000);
  const control = (sample.match(/[\u0000-\u0008\u000E-\u001F]/g) ?? []).length;
  if (sample.length && control / sample.length > 0.02) {
    throw new UnsupportedFileError("This looks like a binary file. The spider reads PDF, Word, Markdown, HTML, text and code.");
  }
  return text.replace(/\r\n?/g, '\n');
}

async function ensureFonts(css: string[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(css.map((f) => document.fonts.load(f).catch(() => undefined)));
}

export async function loadDocument(input: LoadInput, measure: Measure, progress?: Progress): Promise<Doc> {
  const ext = input.ext ?? extensionOf(input.name);
  if (UNSUPPORTED[ext]) throw new UnsupportedFileError(UNSUPPORTED[ext]);
  const image = typeof input.data !== 'string' ? (IMAGE_EXT.has(ext) ? ext : sniffImage(input.data)) : null;
  if (image && typeof input.data !== 'string') {
    const { parseImage } = await import('./ocr');
    const doc = await parseImage(input.data, input.name, image, progress);
    return { ...doc, source: input.source };
  }

  if (typeof input.data !== 'string' && bytesStartWith(input.data, [0x25, 0x50, 0x44, 0x46])) {
    progress?.('Unrolling the PDF…', 0);
    const { parsePdf } = await import('./pdf');
    const doc = await parsePdf(input.data, input.name, measure, (done, total, ocr) =>
      progress?.(ocr ? `Reading scanned page ${done} of ${total}…` : `Unrolling page ${done} of ${total}…`, done / total),
    );
    return { ...doc, source: input.source };
  }

  let blocks: Block[];
  let kind: DocKind;
  let code = false;
  if (ext === 'docx' || (typeof input.data !== 'string' && bytesStartWith(input.data, [0x50, 0x4b, 0x03, 0x04]))) {
    if (ext !== 'docx') throw new UnsupportedFileError(UNSUPPORTED.zip);
    progress?.('Opening the Word document…');
    const { docxToBlocks } = await import('./docx');
    blocks = await docxToBlocks(input.data as ArrayBuffer);
    kind = 'docx';
  } else {
    const text = decodeText(input.data);
    if (!text.trim()) throw new UnsupportedFileError('This file is empty. The spider needs at least a few sentences.');
    if (ext === 'html' || ext === 'htm' || ext === 'xhtml' || (!ext && /^\s*<(!doctype|html)/i.test(text))) {
      const { htmlFileToBlocks } = await import('./html');
      blocks = htmlFileToBlocks(text);
      kind = 'html';
    } else if (CODE_EXTENSIONS.has(ext) && !['md', 'txt'].includes(ext)) {
      blocks = [{ kind: 'code', text }];
      kind = 'code';
      code = true;
    } else if (ext === 'md' || ext === 'markdown' || ext === 'mdx' || looksLikeMarkdown(text)) {
      blocks = markdownToBlocks(text);
      kind = 'markdown';
    } else {
      blocks = textToBlocks(text);
      kind = 'text';
    }
  }

  if (!blocks.length) throw new UnsupportedFileError('The spider could not find any text in this file.');
  await ensureFonts(typesetFonts().map((f) => f.css));
  progress?.('Setting the type…');
  const layout = layoutBlocks(blocks, { measure, code });
  return {
    name: input.name,
    kind,
    text: layout.text,
    pages: layout.pages,
    fonts: layout.fonts,
    headings: layout.headings,
    codeExtension: code ? ext : undefined,
    warnings: [],
    source: input.source,
  };
}

/** Images that come without a usable name (pasted from the clipboard, linked from the web). */
function sniffImage(buf: ArrayBuffer): string | null {
  if (bytesStartWith(buf, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (bytesStartWith(buf, [0xff, 0xd8, 0xff])) return 'jpg';
  if (bytesStartWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  const head = new Uint8Array(buf, 0, Math.min(12, buf.byteLength));
  if (head.length === 12 && String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}

function looksLikeMarkdown(text: string): boolean {
  const head = text.slice(0, 5000);
  return /^#{1,6}\s+\S/m.test(head) || /\[[^\]]+\]\([^)]+\)/.test(head) || /^```/m.test(head);
}
