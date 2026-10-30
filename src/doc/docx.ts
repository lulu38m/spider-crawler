import mammoth from 'mammoth/mammoth.browser.min.js';
import { htmlToBlocks } from './blocks';
import type { Block } from './types';

/** Word documents go through mammoth (DOCX → semantic HTML), then the shared HTML → blocks step. */
export async function docxToBlocks(data: ArrayBuffer): Promise<Block[]> {
  const result = await mammoth.convertToHtml({ arrayBuffer: data }, { includeDefaultStyleMap: true });
  const dom = new DOMParser().parseFromString(`<body>${result.value}</body>`, 'text/html');
  return htmlToBlocks(dom.body);
}
