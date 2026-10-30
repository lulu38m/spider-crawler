import type { Token } from './text';

export interface Keyword {
  /** Display form, e.g. "spider silk" or "Madagascar". */
  phrase: string;
  /** Normalized tokens joined by a space. */
  key: string;
  score: number;
  count: number;
  /** Char ranges [start, end) of every occurrence in the source text. */
  occurrences: Array<[number, number]>;
}

interface Candidate {
  key: string;
  words: string[];
  count: number;
  occurrences: Array<[number, number]>;
  surfaces: Map<string, number>;
  score: number;
}

const isAcronym = (t: Token) => t.text.length >= 2 && t.text.length <= 6 && t.text === t.text.toUpperCase() && /\p{Lu}/u.test(t.text);

/**
 * Keyphrase extraction in the spirit of RAKE: candidates are runs of content words between
 * stopwords/punctuation, scored by frequency, word length, proper-noun evidence and cohesion.
 */
export function extractKeywords(text: string, tokens: Token[], stop: Set<string>, max = 10): Keyword[] {
  const content = tokens.map((t) => {
    if (isAcronym(t)) return true;
    if (t.norm.length < 3) return false;
    return !stop.has(t.lower) && !stop.has(t.norm);
  });

  // Per-word statistics.
  const freq = new Map<string, number>();
  const midCaps = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    if (!content[i]) continue;
    const t = tokens[i];
    freq.set(t.norm, (freq.get(t.norm) ?? 0) + 1);
    if (t.capitalized && !t.boundaryBefore) midCaps.set(t.norm, (midCaps.get(t.norm) ?? 0) + 1);
  }

  const wordWeight = (w: string): number => {
    const f = freq.get(w) ?? 1;
    const lengthFactor = Math.min(1.4, Math.max(0.8, 0.6 + w.length / 10));
    const properRatio = (midCaps.get(w) ?? 0) / f;
    return lengthFactor * (properRatio > 0.5 ? 1.3 : 1);
  };

  // Collect n-grams (1..3) inside runs of content words.
  const cands = new Map<string, Candidate>();
  const push = (from: number, to: number) => {
    const words: string[] = [];
    for (let k = from; k <= to; k++) words.push(tokens[k].norm);
    const key = words.join(' ');
    let c = cands.get(key);
    if (!c) {
      c = { key, words, count: 0, occurrences: [], surfaces: new Map(), score: 0 };
      cands.set(key, c);
    }
    c.count++;
    c.occurrences.push([tokens[from].start, tokens[to].end]);
    const surface = text.slice(tokens[from].start, tokens[to].end).replace(/\s+/g, ' ');
    c.surfaces.set(surface, (c.surfaces.get(surface) ?? 0) + 1);
  };

  let runStart = -1;
  const flush = (end: number) => {
    if (runStart < 0) return;
    for (let i = runStart; i < end; i++) {
      for (let n = 1; n <= 3 && i + n - 1 < end; n++) push(i, i + n - 1);
    }
    runStart = -1;
  };
  for (let i = 0; i < tokens.length; i++) {
    if (!content[i] || tokens[i].boundaryBefore) flush(i);
    if (content[i] && runStart < 0) runStart = i;
  }
  flush(tokens.length);

  // Single mentions only count in very short texts, and only to fill the list.
  const minCount = 1;

  const scored: Candidate[] = [];
  for (const c of cands.values()) {
    if (c.count < minCount) continue;
    if (c.words.length > 1 && c.count < 2) continue;
    // Phrases that repeat a word ("silk silk") are noise.
    if (new Set(c.words).size !== c.words.length) continue;
    const weight = c.words.reduce((s, w) => s + wordWeight(w), 0);
    // Multi-word phrases get a bonus that grows with how often their words appear together.
    let cohesion = 1;
    if (c.words.length > 1) {
      const minFreq = Math.min(...c.words.map((w) => freq.get(w) ?? 1));
      cohesion = 1.15 * (0.5 + 0.5 * Math.min(1, c.count / minFreq));
    }
    c.score = Math.pow(c.count, 0.9) * weight * cohesion;
    scored.push(c);
  }
  const repeated = (c: Candidate) => (c.count >= 2 ? 1 : 0);
  scored.sort((a, b) => repeated(b) - repeated(a) || b.score - a.score || a.key.localeCompare(b.key));
  // Long texts: drop one-off phrases entirely.
  if (tokens.length >= 250) scored.splice(0, scored.length, ...scored.filter((c) => c.count >= 2));

  // Greedy selection with sub/super-phrase handling: prefer the longer phrase when it is strong enough.
  const selected: Candidate[] = [];
  const contains = (big: string[], small: string[]) => {
    outer: for (let i = 0; i + small.length <= big.length; i++) {
      for (let j = 0; j < small.length; j++) if (big[i + j] !== small[j]) continue outer;
      return true;
    }
    return false;
  };
  for (const c of scored) {
    if (selected.length >= max) break;
    // Already covered by a longer selected phrase.
    if (selected.some((sel) => contains(sel.words, c.words))) continue;
    const subs = selected.filter((sel) => contains(c.words, sel.words));
    if (subs.length === 0) {
      selected.push(c);
      continue;
    }
    // A frequent longer phrase ("spider silk") replaces the shorter ones it contains ("spider", "silk").
    const strongest = Math.max(...subs.map((sel) => sel.score));
    if (c.count >= 3 && c.score >= 0.3 * strongest) {
      const at = selected.indexOf(subs[0]);
      for (const sel of subs) selected.splice(selected.indexOf(sel), 1);
      selected.splice(Math.min(at, selected.length), 0, c);
    }
  }

  return selected.slice(0, max).map((c) => ({
    phrase: displayForm(c),
    key: c.key,
    score: c.score,
    count: c.count,
    occurrences: c.occurrences,
  }));
}

function displayForm(c: Candidate): string {
  let best = '';
  let bestN = -1;
  for (const [surface, n] of c.surfaces) {
    if (n > bestN) {
      best = surface;
      bestN = n;
    }
  }
  // Acronyms (DNA, NASA) and brand casing (iPhone, GitHub) stay as written.
  if (best.length <= 6 && best === best.toUpperCase() && /\p{Lu}/u.test(best)) return best;
  const surfaces = [...c.surfaces.keys()];
  if (surfaces.every((s) => /\p{Ll}\p{Lu}/u.test(s))) return best;
  // Proper nouns are capitalized everywhere; anything else is shown in lowercase.
  return surfaces.every((s) => /^\p{Lu}/u.test(s)) ? best : best.toLowerCase();
}
