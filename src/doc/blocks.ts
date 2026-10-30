import { marked, type Token, type Tokens } from 'marked';
import type { Block } from './types';

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** Markdown → blocks, with inline formatting flattened to plain text. */
export function markdownToBlocks(src: string): Block[] {
  const tokens = marked.lexer(src.replace(/^---\n[\s\S]*?\n---\n/, '')); // drop YAML front matter
  const blocks: Block[] = [];
  walk(tokens, blocks, 0, false);
  return blocks;
}

function inline(tokens: Token[] | undefined, fallback = ''): string {
  if (!tokens) return decodeEntities(fallback);
  let out = '';
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        out += (t as Tokens.Text).tokens ? inline((t as Tokens.Text).tokens) : decodeEntities((t as Tokens.Text).text);
        break;
      case 'strong':
      case 'em':
      case 'del':
      case 'link':
        out += inline((t as Tokens.Strong).tokens);
        break;
      case 'codespan':
        out += decodeEntities((t as Tokens.Codespan).text);
        break;
      case 'image':
        out += (t as Tokens.Image).text ? `${(t as Tokens.Image).text}` : '';
        break;
      case 'br':
        out += ' ';
        break;
      case 'escape':
        out += (t as Tokens.Escape).text;
        break;
      case 'html':
        out += decodeEntities((t as Tokens.HTML).text.replace(/<[^>]+>/g, ''));
        break;
      case 'checkbox':
        break;
      default:
        if ('text' in t && typeof t.text === 'string') out += decodeEntities(t.text);
    }
  }
  return out;
}

function walk(tokens: Token[], blocks: Block[], depth: number, inQuote: boolean) {
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const h = t as Tokens.Heading;
        blocks.push({ kind: h.depth <= 1 ? 'h1' : h.depth === 2 ? 'h2' : 'h3', text: inline(h.tokens, h.text) });
        break;
      }
      case 'paragraph': {
        const p = t as Tokens.Paragraph;
        blocks.push({ kind: inQuote ? 'quote' : 'p', text: inline(p.tokens, p.text) });
        break;
      }
      case 'text': {
        const tx = t as Tokens.Text;
        blocks.push({ kind: inQuote ? 'quote' : 'p', text: inline(tx.tokens, tx.text) });
        break;
      }
      case 'blockquote':
        walk((t as Tokens.Blockquote).tokens, blocks, depth, true);
        break;
      case 'list': {
        const list = t as Tokens.List;
        let n = typeof list.start === 'number' ? list.start : 1;
        for (const item of list.items) {
          const own: Token[] = [];
          const nested: Token[] = [];
          for (const child of item.tokens) (child.type === 'list' ? nested : own).push(child);
          const text = own
            .map((c) => (c.type === 'text' || c.type === 'paragraph' ? inline((c as Tokens.Text).tokens, (c as Tokens.Text).text) : 'text' in c ? String(c.text) : ''))
            .join(' ')
            .trim();
          if (text) blocks.push({ kind: 'li', text: (item.task ? (item.checked ? '☑ ' : '☐ ') : '') + text, depth, ordinal: list.ordered ? n : undefined });
          n++;
          walk(nested, blocks, depth + 1, inQuote);
        }
        break;
      }
      case 'code':
        blocks.push({ kind: 'code', text: (t as Tokens.Code).text });
        break;
      case 'hr':
        blocks.push({ kind: 'hr', text: '' });
        break;
      case 'table': {
        const table = t as Tokens.Table;
        const row = (cells: Tokens.TableCell[]) => cells.map((c) => inline(c.tokens, c.text)).join('  |  ');
        blocks.push({ kind: 'p', text: row(table.header) });
        for (const r of table.rows) blocks.push({ kind: 'li', text: row(r), depth: 0 });
        break;
      }
      case 'html': {
        const html = (t as Tokens.HTML).text;
        const text = decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ')).trim();
        if (text) blocks.push({ kind: 'p', text });
        break;
      }
      default:
        break;
    }
  }
}

/** Plain text → paragraphs. Bullet-looking lines become list items, short lone first lines a title. */
export function textToBlocks(src: string): Block[] {
  const paragraphs = src.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
  const blocks: Block[] = [];
  paragraphs.forEach((para, i) => {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    if (i === 0 && lines.length === 1 && lines[0].length < 90 && !/[.!?,;:]$/.test(lines[0])) {
      blocks.push({ kind: 'h1', text: lines[0] });
      return;
    }
    if (lines.every((l) => /^(?:[-*•‣◦]|\d+[.)])\s+/.test(l))) {
      for (const l of lines) {
        const ord = l.match(/^(\d+)[.)]\s+/);
        blocks.push({ kind: 'li', text: l.replace(/^(?:[-*•‣◦]|\d+[.)])\s+/, ''), depth: 0, ordinal: ord ? Number(ord[1]) : undefined });
      }
      return;
    }
    blocks.push({ kind: 'p', text: lines.join(' ') });
  });
  return blocks;
}

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE', 'TR', 'DT', 'DD', 'FIGCAPTION', 'CAPTION', 'HR']);
const CONTAINER_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'BODY', 'UL', 'OL', 'DL', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'FIGURE', 'DETAILS', 'SUMMARY', 'ASIDE', 'CENTER', 'FORM', 'FIELDSET']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'NAV', 'FOOTER', 'BUTTON', 'SELECT', 'TEXTAREA', 'INPUT', 'IMG', 'VIDEO', 'AUDIO', 'OBJECT', 'HEAD']);

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Inline text of an element, ignoring nested lists (they become their own blocks). */
function ownText(el: Element): string {
  let out = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
    else if (n.nodeType === Node.ELEMENT_NODE) {
      const e = n as Element;
      if (SKIP_TAGS.has(e.tagName) || e.tagName === 'UL' || e.tagName === 'OL') return;
      if (e.tagName === 'BR') out += ' ';
      else out += ownText(e);
    }
  });
  return out;
}

/** HTML (from a web page or from mammoth's DOCX conversion) → blocks. */
export function htmlToBlocks(root: Element): Block[] {
  const blocks: Block[] = [];
  const visit = (el: Element, listDepth: number, inQuote: boolean) => {
    const tag = el.tagName;
    if (SKIP_TAGS.has(tag)) return;
    if (BLOCK_TAGS.has(tag)) {
      switch (tag) {
        case 'H1':
          blocks.push({ kind: 'h1', text: clean(el.textContent ?? '') });
          return;
        case 'H2':
          blocks.push({ kind: 'h2', text: clean(el.textContent ?? '') });
          return;
        case 'H3':
        case 'H4':
        case 'H5':
        case 'H6':
          blocks.push({ kind: 'h3', text: clean(el.textContent ?? '') });
          return;
        case 'PRE':
          blocks.push({ kind: 'code', text: el.textContent ?? '' });
          return;
        case 'HR':
          blocks.push({ kind: 'hr', text: '' });
          return;
        case 'BLOCKQUOTE': {
          const hasBlocks = [...el.children].some((c) => BLOCK_TAGS.has(c.tagName) || CONTAINER_TAGS.has(c.tagName));
          if (hasBlocks) [...el.children].forEach((c) => visit(c, listDepth, true));
          else blocks.push({ kind: 'quote', text: clean(el.textContent ?? '') });
          return;
        }
        case 'LI': {
          const parent = el.parentElement;
          const ordered = parent?.tagName === 'OL';
          const ordinal = ordered ? [...parent!.children].filter((c) => c.tagName === 'LI').indexOf(el) + Number(parent!.getAttribute('start') ?? 1) : undefined;
          const text = clean(ownText(el));
          if (text) blocks.push({ kind: 'li', text, depth: Math.max(0, listDepth - 1), ordinal });
          el.querySelectorAll(':scope > ul, :scope > ol').forEach((sub) => visit(sub, listDepth + 1, inQuote));
          return;
        }
        case 'TR': {
          const cells = [...el.children].map((c) => clean(c.textContent ?? '')).filter(Boolean);
          if (cells.length) blocks.push({ kind: 'p', text: cells.join('  |  ') });
          return;
        }
        default: {
          const text = clean(ownText(el));
          if (text) blocks.push({ kind: inQuote ? 'quote' : 'p', text });
          return;
        }
      }
    }
    // Containers: block children are visited, loose inline text becomes paragraphs.
    let pending = '';
    const flushPending = () => {
      const t = clean(pending);
      if (t) blocks.push({ kind: inQuote ? 'quote' : 'p', text: t });
      pending = '';
    };
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        pending += n.textContent ?? '';
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const child = n as Element;
        if (BLOCK_TAGS.has(child.tagName) || CONTAINER_TAGS.has(child.tagName)) {
          flushPending();
          visit(child, child.tagName === 'UL' || child.tagName === 'OL' ? listDepth + 1 : listDepth, inQuote);
        } else if (child.tagName === 'BR') {
          pending += '\n';
        } else if (!SKIP_TAGS.has(child.tagName)) {
          pending += child.textContent ?? '';
        }
      }
    });
    flushPending();
  };
  visit(root, 0, false);
  return blocks.filter((b) => b.kind === 'hr' || b.text.trim().length > 0);
}
