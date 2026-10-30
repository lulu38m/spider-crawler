import { extractKeywords } from './keywords';
import { summarizeCode } from './code';
import { stopwordsFor } from './stopwords';
import { countWords, detectLanguage, splitSentences, tokenize, type Token } from './text';
import { mmrSelect, textRank, tfidfVectors } from './textrank';
import type { Summary, SummarizeOptions, SummarySentence } from './types';

export type { Summary, SummarizeOptions, SummarySentence } from './types';

const WORDS_PER_MINUTE = 238;

const ABSTRACT_START = /^(?:abstract|summary|executive summary|tl;?dr|résumé|resumen|zusammenfassung|sommario|resumo)\b[\s.:—–-]*/i;

const DANGLING_STARTS: Record<string, Set<string>> = {
  en: new Set('it its this these those that they them here there however but and so instead also then thus such he she his her'.split(' ')),
  fr: new Set('il elle ils elles cela ceci ce cette ces mais donc ainsi alors puis aussi cependant pourtant en'.split(' ')),
  es: new Set('esto esta este estos estas eso pero así entonces también ello ella él'.split(' ')),
  de: new Set('es dies diese dieser dieses aber also dann jedoch auch er sie'.split(' ')),
  it: new Set('questo questa questi queste ma quindi poi anche esso essa lui lei'.split(' ')),
  pt: new Set('isso isto este esta estes estas mas então também ele ela'.split(' ')),
};
const MAX_GRAPH_SENTENCES = 1500;

/**
 * Local, extractive summary: no network, no model download. Picks the sentences the document
 * itself considers central (TextRank + MMR) and the phrases it keeps coming back to.
 */
export function summarize(text: string, options: SummarizeOptions = {}): Summary {
  if (options.mode === 'code') return summarizeCode(text, options.codeExtension);

  const language = detectLanguage(text);
  const stop = stopwordsFor(language);
  const sentences = splitSentences(text, language);
  const tokens = tokenize(text, language);
  const words = countWords(text, language);
  const maxKeywords = options.maxKeywords ?? (words < 300 ? 5 : words < 1500 ? 8 : 10);
  const keywords = extractKeywords(text, tokens, stop, maxKeywords);

  // Assign tokens to sentences (both are sorted by offset).
  const sentTokens: Token[][] = sentences.map(() => []);
  let si = 0;
  for (const t of tokens) {
    while (si < sentences.length && t.start >= sentences[si].end) si++;
    if (si >= sentences.length) break;
    if (t.start >= sentences[si].start) sentTokens[si].push(t);
  }

  const headings = options.headings ?? [];
  const paragraphSize = new Map<number, number>();
  for (const s of sentences) paragraphSize.set(s.paragraph, (paragraphSize.get(s.paragraph) ?? 0) + 1);
  const isHeading = (s: (typeof sentences)[number], wordCount: number) => {
    if (headings.some(([a, b]) => s.start < b && s.end > a)) return true;
    if (/[.!?…;"”»)]$/.test(s.text)) return false;
    // No closing punctuation: short lines, or whole short paragraphs (titles in PDFs), are headings.
    return wordCount < 7 || (paragraphSize.get(s.paragraph) === 1 && wordCount < 16);
  };

  const keywordStarts = new Set<number>();
  for (const k of keywords) for (const [a] of k.occurrences) keywordStarts.add(a);

  interface Candidate {
    idx: number;
    tokens: Token[];
    bag: string[];
  }
  let candidates: Candidate[] = [];
  sentences.forEach((s, idx) => {
    const toks = sentTokens[idx];
    if (toks.length < 5 || toks.length > 80) return;
    if (isHeading(s, toks.length)) return;
    const letters = (s.text.match(/\p{L}/gu) ?? []).length;
    if (letters / s.text.length < 0.55) return;
    const bag = toks.filter((t) => t.norm.length > 1 && !stop.has(t.lower) && !stop.has(t.norm)).map((t) => t.norm);
    if (bag.length < 2) return;
    candidates.push({ idx, tokens: toks, bag });
  });

  const stats = {
    words,
    sentences: sentences.length,
    paragraphs: sentences.length ? sentences[sentences.length - 1].paragraph + 1 : 0,
    characters: text.length,
    readingMinutes: words / WORDS_PER_MINUTE,
  };

  if (candidates.length === 0) {
    const fallback = sentences.slice(0, 2).map((s) => s.text).join(' ') || text.trim();
    return { mode: 'prose', language, tldr: clip(fallback, 320), points: [], keywords, stats };
  }

  // Very long documents: keep the most promising sentences so the O(n²) graph stays fast.
  if (candidates.length > MAX_GRAPH_SENTENCES) {
    const termFreq = new Map<string, number>();
    for (const c of candidates) for (const term of c.bag) termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
    const cheap = (c: Candidate) => c.bag.reduce((s, term) => s + Math.log(1 + (termFreq.get(term) ?? 0)), 0) / Math.sqrt(c.bag.length);
    const keep = new Set([...candidates].sort((a, b) => cheap(b) - cheap(a)).slice(0, MAX_GRAPH_SENTENCES));
    candidates = candidates.filter((c) => keep.has(c));
  }

  const vecs = tfidfVectors(candidates.map((c) => c.bag));
  const pr = textRank(vecs);
  const n = sentences.length;
  const dangling = DANGLING_STARTS[language] ?? DANGLING_STARTS.en;
  const abstractParagraphs = new Set<number>();
  for (const s of sentences) {
    if (s.firstInParagraph && ABSTRACT_START.test(s.text)) abstractParagraphs.add(s.paragraph);
  }
  const scores = candidates.map((c, i) => {
    const s = sentences[c.idx];
    const position = c.idx / Math.max(1, n - 1);
    // Short documents usually state their point up front; long ones only slightly so.
    const short = candidates.length <= 10;
    const lead = 1 + (short ? 1 : 0.6) * Math.pow(1 - position, short ? 2 : 3);
    const paragraphLead = s.firstInParagraph ? 1.12 : 1;
    // Sentences opening with "It", "This", "However"... lean on context and read badly alone.
    const firstWord = c.tokens[0]?.lower ?? '';
    const standalone = dangling.has(firstWord) ? 0.78 : 1;
    // Questions rarely summarize anything; an explicit abstract almost always does.
    const question = s.text.endsWith('?') ? 0.55 : 1;
    const abstract = abstractParagraphs.has(s.paragraph) ? 1.6 : 1;
    const len = c.tokens.length;
    const lengthFactor = len < 8 ? 0.65 : len < 12 ? 0.88 : len > 50 ? 0.8 : 1;
    let kwHits = 0;
    for (const t of c.tokens) if (keywordStarts.has(t.start)) kwHits++;
    const keywordBoost = 1 + Math.min(0.3, 0.07 * kwHits);
    return pr[i] * lead * paragraphLead * lengthFactor * keywordBoost * standalone * question * abstract;
  });

  const k = Math.min(options.maxPoints ?? clampInt(Math.round(1.6 * Math.log(candidates.length + 1)), 3, 8), candidates.length);
  const picked = mmrSelect(scores, vecs, k);
  const byScore = [...picked].sort((a, b) => scores[b] - scores[a]);
  const points: SummarySentence[] = picked
    .map((ci) => {
      const s = sentences[candidates[ci].idx];
      return { start: s.start, end: s.end, text: s.text, score: scores[ci], rank: byScore.indexOf(ci) };
    })
    .sort((a, b) => a.start - b.start);

  // TL;DR: the strongest point, nudged toward the beginning (documents tend to state their point early).
  // Short notes have too few sentences for a graph to mean much: their first real sentence wins.
  const tldrScore = (p: SummarySentence) => p.score * (1 + 0.8 * Math.pow(1 - p.start / Math.max(1, text.length), 2));
  let best = points.reduce((a, b) => (tldrScore(b) > tldrScore(a) ? b : a));
  if (candidates.length <= 10) {
    const first = sentences[candidates[0].idx];
    if (!first.text.endsWith('?')) {
      best = points.find((p) => p.start === first.start) ?? { start: first.start, end: first.end, text: first.text, score: 0, rank: points.length };
    }
  }
  let tldr = best.text;
  if (countWords(best.text, language) < 14) {
    const second = points.filter((p) => p.start !== best.start).sort((a, b) => b.score - a.score)[0];
    if (second) tldr = second.start < best.start ? `${second.text} ${best.text}` : `${best.text} ${second.text}`;
  }

  return { mode: 'prose', language, tldr: clip(tldr, 420), points, keywords, stats };
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}
