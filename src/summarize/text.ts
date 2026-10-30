import { grammarStopwords, LANGUAGES } from './stopwords';

export interface Token {
  /** Surface form as it appears in the text. */
  text: string;
  /** Normalized form used for matching: lowercase, no diacritics, light plural stemming. */
  norm: string;
  /** Lowercase surface form (diacritics kept) used for stopword lookup. */
  lower: string;
  start: number;
  end: number;
  /** True when punctuation separates this token from the previous one (phrase boundary). */
  boundaryBefore: boolean;
  /** Starts with an uppercase letter. */
  capitalized: boolean;
}

export interface SentenceSpan {
  start: number;
  end: number;
  text: string;
  paragraph: number;
  firstInParagraph: boolean;
}

const segmenters = new Map<string, Intl.Segmenter>();

function segmenter(lang: string, granularity: 'word' | 'sentence'): Intl.Segmenter {
  const key = `${lang}:${granularity}`;
  let seg = segmenters.get(key);
  if (!seg) {
    try {
      seg = new Intl.Segmenter(lang, { granularity });
    } catch {
      seg = new Intl.Segmenter('en', { granularity });
    }
    segmenters.set(key, seg);
  }
  return seg;
}

const ELISION = /^(?:l|d|j|m|n|s|t|c|qu|jusqu|lorsqu|puisqu|dell|all|dall|nell|sull)['’]/u;
const POSSESSIVE = /['’]s$/u;
const DIACRITICS = /\p{M}/gu;
const HAS_LETTER = /\p{L}/u;
const PUNCT_BOUNDARY = /[.,;:!?()[\]{}"“”«»…/\\|—–•·]/u;

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS, '');
}

/** Lowercase, drop elisions/possessives and diacritics, strip a plural "s". Good enough to merge "spider" & "spiders". */
export function normalizeWord(word: string): string {
  let w = word.toLowerCase().replace(ELISION, '').replace(POSSESSIVE, '');
  w = stripDiacritics(w);
  if (w.length > 3 && w.endsWith('s') && !/(?:ss|us|is|ys)$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** Split `text[from, to)` into word tokens with char offsets. */
export function tokenize(text: string, lang = 'en', from = 0, to = text.length): Token[] {
  const out: Token[] = [];
  const slice = text.slice(from, to);
  let boundary = true;
  for (const seg of segmenter(lang, 'word').segment(slice)) {
    if (!seg.isWordLike) {
      if (PUNCT_BOUNDARY.test(seg.segment) || seg.segment.includes('\n\n')) boundary = true;
      continue;
    }
    let surface = seg.segment;
    let start = from + seg.index;
    const elided = surface.match(ELISION);
    if (elided && surface.length > elided[0].length + 1) {
      surface = surface.slice(elided[0].length);
      start += elided[0].length;
    }
    surface = surface.replace(POSSESSIVE, '');
    if (!HAS_LETTER.test(surface)) {
      // Pure numbers act as phrase breakers but are not keyword material.
      boundary = true;
      continue;
    }
    const lower = surface.toLowerCase();
    out.push({
      text: surface,
      norm: normalizeWord(surface),
      lower,
      start,
      end: start + surface.length,
      boundaryBefore: boundary,
      capitalized: surface[0] !== lower[0],
    });
    boundary = false;
  }
  return out;
}

/** Count word-like segments (for stats). */
export function countWords(text: string, lang = 'en'): number {
  let n = 0;
  for (const seg of segmenter(lang, 'word').segment(text)) if (seg.isWordLike) n++;
  return n;
}

/** Guess the language from stopword frequency. Returns a BCP-47 base code we have lists for. */
export function detectLanguage(text: string): string {
  const sample = text.slice(0, 20000).toLowerCase();
  const words = sample.match(/\p{L}+(?:['’]\p{L}+)?/gu) ?? [];
  if (words.length === 0) return 'en';
  let best = 'en';
  let bestScore = 0;
  for (const lang of LANGUAGES) {
    const stop = grammarStopwords(lang);
    let hits = 0;
    for (const w of words) if (stop.has(w)) hits++;
    // Slightly penalize huge lists so they don't win on noise.
    const score = hits / Math.pow(stop.size, 0.15);
    if (score > bestScore) {
      bestScore = score;
      best = lang;
    }
  }
  return best;
}

/**
 * Split into sentences, paragraph by paragraph. Single newlines inside a paragraph are treated as
 * spaces (PDF lines), blank lines as paragraph breaks. Offsets always point into the original text.
 */
export function splitSentences(text: string, lang = 'en'): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  const paraRe = /\n[ \t]*\n/g;
  let paraStart = 0;
  let paragraph = 0;
  const handle = (pStart: number, pEnd: number) => {
    const raw = text.slice(pStart, pEnd);
    if (!raw.trim()) return;
    const flat = raw.replace(/\n/g, ' ');
    let first = true;
    for (const seg of segmenter(lang, 'sentence').segment(flat)) {
      const s = seg.segment;
      const lead = s.length - s.trimStart().length;
      const trimmed = s.trim();
      if (!trimmed) continue;
      const start = pStart + seg.index + lead;
      out.push({ start, end: start + trimmed.length, text: trimmed, paragraph, firstInParagraph: first });
      first = false;
    }
    paragraph++;
  };
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(text))) {
    handle(paraStart, m.index);
    paraStart = m.index + m[0].length;
  }
  handle(paraStart, text.length);
  return out;
}
