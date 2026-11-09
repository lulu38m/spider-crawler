import { grammarStopwords } from './stopwords';
import { normalizeWord, splitSentences, stripDiacritics, type SentenceSpan } from './text';

/**
 * "Ask the spider": finds the passage of a document that answers a question, offline.
 * BM25 over sentences, with a few touches that matter for questions people actually ask:
 * word stems, a small bilingual list of synonyms, and a bonus when the sentence holds the kind of
 * thing asked for (a date for "when", an amount for "how much"…).
 */

export interface Passage {
  /** Char range of the answering sentence (or two, when the next one carries on). */
  start: number;
  end: number;
  text: string;
  score: number;
}

export interface AnswerResult {
  /** Best passage first; empty when nothing in the document looks like an answer. */
  passages: Passage[];
  /** Question words that were found in the document, for "Found: renewal, cancel". */
  matched: string[];
}

// Question words: they say what kind of answer is wanted, not what it is about.
const QUESTION_WORDS = new Set(
  `what which who whom whose when where why how much many long does do did is are was were can could should would will
  quoi que qu quel quelle quels quelles qui quand ou où pourquoi comment combien est sont fait faut peut peux doit dois
  qué cuál quién cuándo dónde por cómo cuánto was wer wann wo warum wie viel welche`.split(/\s+/),
);

// Longest first, so "refundable" loses "able", not just "e".
const SUFFIXES = ['ations', 'ation', 'ements', 'ement', 'ments', 'ment', 'ings', 'ing', 'ness', 'ities', 'ity', 'ies', 'ied', 'ed', 'er', 'ly', 'al', 'es', 'e', 'ions', 'ion', 'eur', 'euse', 'ique', 'iques', 'able', 'ible'].sort((a, b) => b.length - a.length);

/** A light stemmer: enough to match "renews" with "renewal", "cancellation" with "cancel". */
export function stem(word: string): string {
  let w = normalizeWord(word);
  if (w.length <= 4) return w;
  for (const suffix of SUFFIXES) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  // Doubled final consonants ("cancell" from "cancelled") and French accents are already gone.
  return w.replace(/([bdglmnprt])\1$/, '$1');
}

// Words people use in questions, and the words documents use for the same thing.
const SYNONYMS: string[][] = [
  ['end', 'ends', 'finish', 'finit', 'fin', 'expire', 'expiry', 'expiration', 'terminate', 'termination', 'échéance', 'duration', 'durée', 'term', 'until', "jusqu"],
  ['cancel', 'cancellation', 'quit', 'leave', 'stop', 'unsubscribe', 'terminate', 'résilier', 'résiliation', 'arrêter', 'désabonner', 'rétractation'],
  ['renew', 'renewal', 'renews', 'automatically', 'reconduction', 'reconduit', 'renouvellement', 'tacite'],
  ['price', 'prices', 'cost', 'costs', 'fee', 'fees', 'charge', 'charges', 'pay', 'paid', 'payment', 'prix', 'coût', 'tarif', 'tarifs', 'frais', 'payer', 'paiement'],
  ['refund', 'refunds', 'refundable', 'money back', 'rembourser', 'remboursement', 'remboursable'],
  ['data', 'information', 'privacy', 'personal', 'données', 'informations', 'vie privée', 'personnelles'],
  ['share', 'shared', 'sell', 'third', 'partners', 'partager', 'partage', 'tiers', 'partenaires', 'vendre'],
  ['revenue', 'sales', 'turnover', 'chiffre', 'affaires', 'ventes', 'ingresos', 'umsatz'],
  ['profit', 'income', 'earnings', 'résultat', 'bénéfice', 'net'],
  ['debt', 'dette', 'endettement'],
  ['dividend', 'dividende'],
  ['outlook', 'guidance', 'forecast', 'expects', 'perspectives', 'objectif', 'prévisions', 'prévoit'],
  ['strong', 'strength', 'tensile', 'tough', 'toughness', 'solide', 'résistant', 'résistance'],
  ['why', 'because', 'reason', 'pourquoi', 'parce', 'raison', 'car'],
  ['author', 'wrote', 'written', 'auteur', 'écrit'],
  ['salary', 'pay', 'wage', 'salaire', 'rémunération'],
  ['notice', 'préavis', 'advance', 'before', 'avant'],
];

const synonymIndex = new Map<string, Set<string>>();
for (const group of SYNONYMS) {
  const stems = new Set(group.flatMap((w) => w.split(/\s+/)).map(stem));
  for (const s of stems) {
    const set = synonymIndex.get(s) ?? new Set<string>();
    for (const t of stems) set.add(t);
    synonymIndex.set(s, set);
  }
}

type Want = 'date' | 'amount' | 'number' | 'duration' | 'percent' | 'reason' | null;

/** What kind of thing the question asks for. */
export function wantOf(question: string): Want {
  const q = stripDiacritics(question.toLowerCase());
  if (/\b(how long|combien de temps|duree|duration|quelle duree|for how many (?:days|months|years))\b/.test(q)) return 'duration';
  if (/\b(when|quand|what date|quelle date|until when|jusqu.?a quand|cuando|wann)\b/.test(q)) return 'date';
  if (/\b(how much|combien (?:coute|ca coute|faut-il payer)|what does it cost|price|prix|cout|tarif|cuanto cuesta)\b/.test(q)) return 'amount';
  if (/\b(what percentage|quel pourcentage|what share|margin|marge|growth|croissance)\b/.test(q)) return 'percent';
  if (/\b(how many|combien de|cuantos|wie viele)\b/.test(q)) return 'number';
  if (/\b(why|pourquoi|por que|warum)\b/.test(q)) return 'reason';
  return null;
}

const WANT_RES: Record<Exclude<Want, null>, RegExp> = {
  date: /\b(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|(?:19|20)\d{2}|january|february|march|april|may|june|july|august|september|october|november|december|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|\d+\s?(?:days?|months?|years?|jours?|mois|ans?|années?))\b/iu,
  duration: /\b\d+\s?(?:days?|weeks?|months?|years?|hours?|minutes?|jours?|semaines?|mois|ans?|années?|heures?)\b/iu,
  amount: /(?:[$€£¥]\s?\d|\d\s?(?:€|\$|£|eur|usd|euros?|dollars?)\b|\d+(?:[.,]\d+)?\s?(?:million|billion|bn|m)\b)/iu,
  percent: /\d+(?:[.,]\d+)?\s?(?:%|percent|pour cent|bps|basis points)/iu,
  number: /\d|\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|hundreds?|deux|trois|quatre|cinq|sept|huit|neuf|dix|onze|douze|dizaines?|centaines?)\b/iu,
  reason: /\b(?:because|since|due to|thanks to|so that|parce que|car|grâce à|en raison|afin de|pour que)\b/iu,
};

interface Indexed {
  span: SentenceSpan;
  stems: string[];
}

function terms(text: string, stop: Set<string>): string[] {
  const out: string[] = [];
  // Hyphens split words: "non-refundable" should match "refund".
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu)) {
    const raw = m[0].replace(/^(?:l|d|j|m|n|s|t|c|qu|jusqu)['’]/iu, '');
    const lower = raw.toLowerCase();
    if (lower.length < 2 || stop.has(lower) || stop.has(normalizeWord(lower))) continue;
    out.push(stem(lower));
  }
  return out;
}

/**
 * Ranks the document's sentences against the question. Sentences shorter than four words
 * (headings) never answer; the sentence after the best one is joined when it is short and
 * leans on it ("It…", "This…").
 */
export function findAnswer(text: string, question: string, language = 'en', sentences?: SentenceSpan[]): AnswerResult {
  // Grammar words only: for questions, "make" or "kind" are content ("how many kinds…").
  const stop = new Set([...grammarStopwords(language), ...grammarStopwords('en'), ...grammarStopwords('fr')]);
  const asked = terms(question, new Set([...stop, ...QUESTION_WORDS]));
  if (!asked.length) return { passages: [], matched: [] };
  // Headings name a topic; sentences answer. A heading is short and has no final punctuation.
  const spans = (sentences ?? splitSentences(text, language)).filter((s) => {
    const words = s.text.split(/\s+/).length;
    return s.text.length < 1200 && words >= 4 && (words >= 9 || /[.!?:;)"”»]\s*$/.test(s.text));
  });
  if (!spans.length) return { passages: [], matched: [] };

  const index: Indexed[] = spans.map((span) => ({ span, stems: terms(span.text, stop) }));
  const df = new Map<string, number>();
  for (const s of index) for (const t of new Set(s.stems)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = index.length;
  const avg = index.reduce((a, s) => a + s.stems.length, 0) / n || 1;
  const idf = (t: string) => Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));

  // Each asked term, with its synonyms at a discount.
  // Each asked term at full weight; its synonyms at a discount, all with the group's mean idf so a
  // rare synonym ("terminate") doesn't outrank the common word the document uses ("cancel").
  const query = new Map<string, { weight: number; idf: number }>();
  for (const t of asked) {
    query.set(t, { weight: 1, idf: idf(t) });
    const group = [...(synonymIndex.get(t) ?? [])].filter((x) => x !== t && df.has(x));
    if (!group.length) continue;
    const mean = group.reduce((a, x) => a + idf(x), 0) / group.length;
    for (const syn of group) if (!query.has(syn)) query.set(syn, { weight: 0.6, idf: mean });
  }
  const want = wantOf(question);
  const k1 = 1.2;
  const b = 0.75;
  const matched = new Set<string>();

  const scored = index.map((s, i) => {
    const tf = new Map<string, number>();
    for (const t of s.stems) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    let hits = 0;
    for (const [t, q] of query) {
      const f = tf.get(t);
      if (!f) continue;
      hits++;
      score += q.weight * q.idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * s.stems.length) / avg)));
    }
    // Covering more of the question beats repeating one word of it.
    const coverage = hits / Math.max(1, asked.length);
    if (want && WANT_RES[want].test(s.span.text)) score *= 1.35;
    score *= 0.75 + 0.5 * Math.min(1, coverage);
    return { i, score, hits };
  });

  const ranked = scored.filter((x) => x.hits > 0 && x.score > 0).sort((a, b) => b.score - a.score);
  if (!ranked.length) return { passages: [], matched: [] };
  // A weak best match is no answer: one common word in common isn't enough.
  const best = ranked[0];
  const strongTerm = asked.some((t) => (df.get(t) ?? 0) > 0 && idf(t) > 0.9);
  if (best.score < 0.9 && !strongTerm) return { passages: [], matched: [] };

  // Report the question's own words ("cancel"), not their stems ("cancel" / "disput").
  const surface = new Map<string, string>();
  for (const m of question.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu)) {
    const word = m[0].replace(/^(?:l|d|j|m|n|s|t|c|qu|jusqu)['’]/iu, '').toLowerCase();
    if (!surface.has(stem(word))) surface.set(stem(word), word);
  }
  for (const t of asked) if (df.has(t) || [...(synonymIndex.get(t) ?? [])].some((s) => df.has(s))) matched.add(surface.get(t) ?? t);
  const passages = ranked.slice(0, 5).map(({ i, score }) => {
    let { start, end } = index[i].span;
    let body = index[i].span.text;
    const next = index[i + 1]?.span;
    // Join the next sentence when it leans on this one ("It…"), or when this one is too short to stand alone.
    const leans = next && /^(?:it|its|this|that|these|they|their|il|elle|ils|elles|cela|ce|ces|cette|sa|son|ses|leur|leurs)\b/i.test(next.text);
    if (next && next.start - end < 4 && next.text.length < 220 && (leans || body.length < 70)) {
      end = next.end;
      body = `${body} ${next.text}`;
    }
    return { start, end, text: body.replace(/\s+/g, ' ').trim(), score };
  });
  return { passages, matched: [...matched] };
}
