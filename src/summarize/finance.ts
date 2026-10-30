import type { SentenceSpan } from './text';

/**
 * Finance mode: earnings releases, annual reports and analyst notes are about numbers, which an
 * extractive summary of sentences tends to bury. This finds the headline figures (revenue, net
 * income, margins, EPS…) as they are written in the document, with their change and period.
 *
 * Everything here is pattern matching on the text itself: nothing is computed or inferred, so a
 * figure is only shown if the document states it.
 */

export interface KeyFigure {
  /** Stable id, e.g. "revenue" or "revenue-outlook". */
  id: string;
  /** Display label in the document's language, e.g. "Revenue" or "Chiffre d'affaires". */
  label: string;
  /** Short label for tight spots (the cocoons on the web): "Op. income", "CA". */
  tag: string;
  /** The value as written, tidied: "€12.4 billion", "18.2%", "$1.37". */
  value: string;
  /** Compact form for the web: "€12.4bn". */
  short: string;
  /** Change as written, normalized: "+8%", "−3.1%", "+120 bps". */
  change?: string;
  /** "Q3 2026", "FY 2025", "H1 2026"… when the sentence or the document says so. */
  period?: string;
  /** Char range of the value in the source text. */
  start: number;
  end: number;
  /** Char range of the sentence it was found in. */
  sentence: [number, number];
}

type Kind = 'money' | 'percent' | 'multiple' | 'per-share';

interface Metric {
  id: string;
  kind: Kind;
  en: string;
  fr: string;
  /** Short labels, [en, fr]. */
  tags?: [string, string];
  /** Lower is shown first. */
  order: number;
  /** Case-insensitive phrases (word-bounded). */
  words: string[];
  /** Case-sensitive acronyms. */
  acronyms?: string[];
}

const METRICS: Metric[] = [
  {
    id: 'revenue', tags: ['Revenue', 'CA'], kind: 'money', en: 'Revenue', fr: "Chiffre d'affaires", order: 0,
    words: ['revenue', 'revenues', 'net sales', 'total sales', 'sales', 'turnover', "chiffre d'affaires", 'chiffre d’affaires', 'ventes', 'produit net bancaire', 'ingresos', 'ventas', 'facturación', 'umsatz', 'umsatzerlöse', 'fatturato', 'ricavi', 'receita', 'faturamento'],
    acronyms: ['PNB'],
  },
  {
    id: 'net-income', tags: ['Net income', 'Rés. net'], kind: 'money', en: 'Net income', fr: 'Résultat net', order: 1,
    words: ['net income', 'net profit', 'net earnings', 'net loss', 'profit attributable', 'profit for the period', 'profit for the year', 'résultat net', 'bénéfice net', 'perte nette', 'beneficio neto', 'resultado neto', 'nettogewinn', 'konzernergebnis', 'jahresüberschuss', 'utile netto', 'lucro líquido'],
  },
  {
    id: 'eps', kind: 'per-share', en: 'EPS', fr: 'BPA', order: 2,
    words: ['earnings per share', 'diluted earnings per share', 'bénéfice par action', 'bénéfice net par action', 'beneficio por acción', 'ergebnis je aktie', 'utile per azione', 'lucro por ação'],
    acronyms: ['EPS', 'BPA'],
  },
  {
    id: 'operating-income', tags: ['Op. income', 'Rés. op.'], kind: 'money', en: 'Operating income', fr: 'Résultat opérationnel', order: 3,
    words: ['operating income', 'operating profit', 'income from operations', 'résultat opérationnel', "résultat d'exploitation", 'résultat d’exploitation', 'beneficio operativo', 'resultado operativo', 'betriebsergebnis', 'utile operativo'],
    acronyms: ['EBIT'],
  },
  { id: 'ebitda', kind: 'money', en: 'EBITDA', fr: 'EBITDA', order: 4, words: [], acronyms: ['EBITDA'] },
  {
    id: 'operating-margin', tags: ['Op. margin', 'Marge op.'], kind: 'percent', en: 'Operating margin', fr: 'Marge opérationnelle', order: 5,
    words: ['operating margin', 'ebit margin', 'marge opérationnelle', "marge d'exploitation", 'marge d’exploitation', 'margen operativo', 'operative marge', 'margine operativo'],
  },
  {
    id: 'gross-margin', kind: 'percent', en: 'Gross margin', fr: 'Marge brute', order: 6,
    words: ['gross margin', 'marge brute', 'margen bruto', 'bruttomarge', 'margine lordo'],
  },
  {
    id: 'ebitda-margin', tags: ['EBITDA mgn', 'Marge EBITDA'], kind: 'percent', en: 'EBITDA margin', fr: "Marge d'EBITDA", order: 7,
    words: ['ebitda margin', "marge d'ebitda", 'marge d’ebitda', 'marge ebitda'],
  },
  {
    id: 'net-margin', kind: 'percent', en: 'Net margin', fr: 'Marge nette', order: 8,
    words: ['net margin', 'marge nette', 'margen neto'],
  },
  {
    id: 'organic-growth', tags: ['Organic', 'Croiss. org.'], kind: 'percent', en: 'Organic growth', fr: 'Croissance organique', order: 9,
    words: ['organic growth', 'organic revenue growth', 'like-for-like growth', 'croissance organique', 'crecimiento orgánico', 'organisches wachstum'],
  },
  {
    id: 'free-cash-flow', tags: ['FCF', 'FCF'], kind: 'money', en: 'Free cash flow', fr: 'Free cash-flow', order: 10,
    words: ['free cash flow', 'free cash-flow', 'flux de trésorerie disponible', 'flujo de caja libre'],
    acronyms: ['FCF'],
  },
  {
    id: 'net-debt', kind: 'money', en: 'Net debt', fr: 'Dette nette', order: 11,
    words: ['net debt', 'dette nette', 'endettement net', 'deuda neta', 'nettoverschuldung'],
  },
  {
    id: 'orders', tags: ['Orders', 'Commandes'], kind: 'money', en: 'Order intake', fr: 'Prises de commandes', order: 12,
    words: ['order intake', 'new orders', 'bookings', 'backlog', 'order backlog', 'prises de commandes', 'carnet de commandes'],
  },
  {
    id: 'dividend', kind: 'per-share', en: 'Dividend', fr: 'Dividende', order: 13,
    words: ['dividend', 'dividend per share', 'dividende', 'dividende par action', 'dividendo', 'dividende je aktie'],
  },
  {
    id: 'price-target', tags: ['Target', 'Objectif'], kind: 'per-share', en: 'Price target', fr: 'Objectif de cours', order: 14,
    words: ['price target', 'target price', 'objectif de cours', 'precio objetivo', 'kursziel'],
  },
  {
    id: 'pe', kind: 'multiple', en: 'P/E', fr: 'PER', order: 15,
    words: ['price-to-earnings', 'price/earnings', 'p/e ratio', 'p/e'],
    acronyms: ['PER', 'P/E'],
  },
];

const MAX_FIGURES = 6;

// ── Numbers ─────────────────────────────────────────────────────────────

const NUM = String.raw`\d{1,3}(?:[,.   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;
const CUR_PREFIX = String.raw`US\$|C\$|A\$|[$€£¥₹]|(?:USD|EUR|GBP|CHF|JPY|CAD|AUD|CNY|SEK|NOK|DKK)\s?`;
const MAG = String.raw`trillions?|billions?|millions?|thousands?|milliards?|mrd\.?|mds?|md|mio\.?|mn|mln|bn|tn|[kmbKMB](?![\p{L}])`;
const CUR_SUFFIX = String.raw`\s?(?:€|\$|£|USD|EUR|GBP|CHF|JPY|(?:d['’]|de\s)?(?:euros?|dollars?|livres?)|euros?|dollars?|pounds?)`;

// Money needs a currency or a magnitude, so years and counts don't qualify.
const MONEY = new RegExp(
  String.raw`(?<![\p{L}\d])(?<pre>${CUR_PREFIX})?\s?(?<num>${NUM})(?:\s?(?<mag>${MAG}))?(?<suf>${CUR_SUFFIX})?(?![\p{L}\d])`,
  'giu',
);
const PERCENT = new RegExp(String.raw`(?<sign>[+\-−–])?\s?(?<num>\d+(?:[.,]\d+)?)\s?(?<unit>%|percent\b|per cent\b|pour cent\b|pct\b|pts?\b|points? de pourcentage|percentage points?)`, 'giu');
const BPS = new RegExp(String.raw`(?<sign>[+\-−–])?\s?(?<num>\d+(?:[.,]\d+)?)\s?(?<unit>bps\b|basis points?|bp\b|pb\b|points de base)`, 'giu');
const MULTIPLE = new RegExp(String.raw`(?<num>\d+(?:[.,]\d+)?)\s?(?:x\b|×|times\b|fois\b)`, 'giu');

/** Whole words, accents included (\b only knows ASCII). */
function wordsRe(list: string, flags = 'iu'): RegExp {
  return new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${list})(?![\p{L}\p{N}])`, flags);
}
const UP_WORDS = String.raw`up|rose|rising|risen|grew|grown|growth of|increase[sd]?|increase of|increasing|higher|improved|improvement of|expanded|gain(?:ed)?|jump(?:ed)?|climb(?:ed)?|hausse|en hausse de|progression|progress(?:e|ent|é|ait)|augment\p{L}*|croissance de|amélior\p{L}*|subió|aumento|anstieg|gestiegen|crescita`;
const DOWN_WORDS = String.raw`down|fell|fallen|falling|declined?|declining|decrease[sd]?|decrease of|decreasing|lower|dropped|drop|contracted|shrank|baisse|en baisse de|recul|recule|reculé|diminu\p{L}*|repli|chute|bajó|caída|rückgang|gesunken|calo`;
const UP = wordsRe(UP_WORDS, 'giu');
const DOWN = wordsRe(DOWN_WORDS, 'giu');
const FORWARD = wordsRe(String.raw`expects?|expected|guidance|outlook|forecasts?|projects?|projected|targets?|aims?|anticipates?|will|prévoit|prévoyons|attend|attendons|objectifs?|perspectives?|anticip\p{L}*|vise|visons|prevé|espera|erwartet|prognose`);
/** Words that make the next percentage a change rather than a level. */
const CHANGE_LEAD = new RegExp(String.raw`(?:${UP_WORDS}|${DOWN_WORDS}|by|de)\s*$`, 'iu');

function lastIndex(re: RegExp, text: string): number {
  let last = -1;
  for (const m of text.matchAll(re)) last = m.index!;
  return last;
}

const PERIOD_RES: RegExp[] = [
  /\b(?:Q|T)([1-4])\s?['’]?(20\d{2}|\d{2})\b/,
  /\b([1-4])Q\s?(20\d{2}|\d{2})\b/,
  /\b(first|second|third|fourth)[\s-]quarter(?: of)?(?: fiscal)?\s+(20\d{2})\b/i,
  /\b(premier|deuxième|second|troisième|quatrième)\s+trimestre(?:\s+(?:de\s+l['’]année\s+)?(20\d{2}))?/i,
  /\b(?:FY|fiscal(?: year)?|exercice(?: fiscal)?|financial year)\s?['’]?(20\d{2}|\d{2})\b/i,
  /\b(H[12]|S[12])\s?(20\d{2})\b/,
  /\b(first|second)[\s-]half(?: of)?\s+(20\d{2})\b/i,
  /\b(premier|second)\s+semestre(?:\s+(20\d{2}))?/i,
];
const ORDINAL: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, premier: 1, deuxième: 2, troisième: 3, quatrième: 4 };

function year(y: string | undefined): string {
  if (!y) return '';
  return y.length === 2 ? `20${y}` : y;
}

/** Normalizes the period phrases a report uses into "Q3 2026", "FY 2025", "H1 2026". */
export function findPeriod(text: string): string | undefined {
  // The first period mentioned is the one the text is about; later ones are comparisons.
  let first: { at: number; label: string } | undefined;
  PERIOD_RES.forEach((re, i) => {
    const m = text.match(re);
    if (!m || (first && first.at <= m.index!)) return;
    const ord = (w: string) => ORDINAL[w.toLowerCase()];
    const label =
      i <= 1 ? `Q${m[1]} ${year(m[2])}`
      : i === 2 ? `Q${ord(m[1])} ${m[2]}`
      : i === 3 ? `Q${ord(m[1])}${m[2] ? ` ${m[2]}` : ''}`
      : i === 4 ? `FY ${year(m[1])}`
      : i === 5 ? `H${m[1].slice(1)} ${m[2]}`
      : i === 6 ? `H${m[1].toLowerCase() === 'first' ? 1 : 2} ${m[2]}`
      : `H${m[1].toLowerCase() === 'premier' ? 1 : 2}${m[2] ? ` ${m[2]}` : ''}`;
    first = { at: m.index!, label };
  });
  return first?.label;
}

interface Found {
  start: number;
  end: number;
  value: string;
  short: string;
  sign?: string;
}

const MAG_SHORT: Array<[RegExp, string]> = [
  [/^(?:trillions?|tn)$/i, 'tn'],
  [/^(?:billions?|bn|b|milliards?|mds?|md|mrd\.?)$/i, 'bn'],
  [/^(?:millions?|mn|mln|m|mio\.?)$/i, 'm'],
  [/^(?:thousands?|k)$/i, 'k'],
];
const CUR_SYMBOL: Record<string, string> = { usd: '$', 'us$': '$', eur: '€', gbp: '£', jpy: '¥', euro: '€', euros: '€', dollar: '$', dollars: '$', pound: '£', pounds: '£', livre: '£', livres: '£' };

function currencySymbol(raw: string | undefined): string {
  if (!raw) return '';
  const t = raw.trim().replace(/^(?:d['’]|de\s)/i, '').toLowerCase();
  if (/^[$€£¥₹]$/.test(t)) return t;
  return CUR_SYMBOL[t] ?? `${raw.trim().toUpperCase()} `;
}

function tidy(s: string): string {
  return s.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function moneyIn(text: string, base: number, perShare: boolean): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(MONEY)) {
    const g = m.groups!;
    const hasCurrency = !!(g.pre || g.suf);
    if (!hasCurrency && !g.mag) continue;
    // Per-share figures (EPS, dividends, price targets) are small and always carry a currency.
    if (perShare && !hasCurrency) continue;
    // A bare "m" or "b" after a number without a currency is too ambiguous (minutes, metres…).
    if (!hasCurrency && g.mag && /^[mbk]$/i.test(g.mag)) continue;
    const lead = m[0].length - m[0].trimStart().length;
    const start = base + m.index! + lead;
    const value = tidy(m[0]);
    const mag = g.mag ? (MAG_SHORT.find(([re]) => re.test(g.mag!))?.[1] ?? g.mag) : '';
    const sym = currencySymbol(g.pre) || currencySymbol(g.suf);
    out.push({ start, end: start + m[0].trim().length, value, short: `${sym}${tidy(g.num)}${mag}` });
  }
  return out;
}

function percentIn(text: string, base: number): Found[] {
  const out: Found[] = [];
  for (const re of [PERCENT, BPS]) {
    for (const m of text.matchAll(re)) {
      const g = m.groups!;
      const lead = m[0].length - m[0].trimStart().length;
      const start = base + m.index! + lead;
      const bps = re === BPS;
      const unit = bps ? ' bps' : /^(?:pts?|points?|percentage)/i.test(g.unit) ? ' pts' : '%';
      const sign = g.sign ? (g.sign === '+' ? '+' : '−') : undefined;
      out.push({ start, end: start + m[0].trim().length, value: tidy(m[0]), short: `${g.num}${unit}`, sign });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function multipleIn(text: string, base: number): Found[] {
  return [...text.matchAll(MULTIPLE)].map((m) => {
    const start = base + m.index!;
    return { start, end: start + m[0].length, value: tidy(m[0]), short: `${m.groups!.num}x` };
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

const metricRes = METRICS.map((m) => {
  const words = [...m.words].sort((a, b) => b.length - a.length).map(escapeRe);
  return {
    metric: m,
    words: words.length ? new RegExp(String.raw`(?<![\p{L}])(?:${words.join('|')})(?![\p{L}])`, 'giu') : null,
    acronyms: m.acronyms?.length ? new RegExp(String.raw`(?<![\p{L}])(?:${m.acronyms.map(escapeRe).join('|')})(?![\p{L}])`, 'gu') : null,
  };
});

/**
 * The change that goes with a value, stated before it ("grew 8% to €12.4bn") or after it
 * ("€12.4bn, up 8%", "(+8%)", "en hausse de 8 %", "+120 bps"). Signed or next to a direction word.
 */
function changeNear(sentence: string, from: number, sentenceStart: number, value: Found, limit: number): string | undefined {
  const valueEnd = value.end - sentenceStart;
  const window = sentence.slice(from, Math.min(limit, valueEnd + 90));
  const stop = window.slice(valueEnd - from).search(/;|\bwhile\b|\balors que\b|\bwhereas\b|\bcompared to [^,]*\bwhich\b/i);
  const scope = stop >= 0 ? window.slice(0, valueEnd - from + stop) : window;
  for (const p of percentIn(scope, sentenceStart + from)) {
    if (p.start < value.end && p.end > value.start) continue;
    const before = sentence.slice(Math.max(0, p.start - sentenceStart - 40), p.start - sentenceStart);
    let sign = p.sign;
    if (!sign) {
      // The direction word closest to the number wins: "up from 7% … down 3%".
      const up = lastIndex(UP, before);
      const down = lastIndex(DOWN, before);
      if (up < 0 && down < 0) continue;
      sign = up > down ? '+' : '−';
    }
    return `${sign}${p.short}`;
  }
  return undefined;
}

interface Candidate extends KeyFigure {
  score: number;
  order: number;
}

/**
 * Looks for headline figures sentence by sentence. Returns at most six, one per metric, in a
 * reading order that puts revenue and profit first. Returns [] for documents that don't read
 * like financial reports.
 */
export function extractFigures(text: string, sentences: SentenceSpan[], language: string): KeyFigure[] {
  if (!looksFinancial(text)) return [];
  const fr = language === 'fr';
  const docPeriod = findPeriod(text.slice(0, 3000));
  const best = new Map<string, Candidate>();
  const n = sentences.length;

  sentences.forEach((s, si) => {
    const body = s.text;
    if (body.length > 600) return;
    const forward = FORWARD.test(body);
    // Where each metric is mentioned: a change belongs to the metric it follows, not the next one.
    const mentions = metricRes.map(({ words, acronyms }) => {
      const hits: Array<{ index: number; length: number }> = [];
      for (const re of [words, acronyms]) if (re) for (const m of body.matchAll(re)) hits.push({ index: m.index!, length: m[0].length });
      return hits.sort((a, b) => a.index - b.index);
    });
    metricRes.forEach(({ metric }, mi) => {
      const hits = mentions[mi];
      if (!hits.length) return;
      hits.sort((a, b) => a.index - b.index);
      // "sales and marketing expenses", "revenue recognition": the metric must be what the sentence measures.
      const hit = hits.find((h) => !/^\s*(?:and marketing|recognition|force|team|expenses?|costs?|tax)\b/i.test(body.slice(h.index + h.length, h.index + h.length + 22)));
      if (!hit) return;
      const after = hit.index + hit.length;
      const values =
        metric.kind === 'percent' ? percentIn(body, s.start)
        : metric.kind === 'multiple' ? multipleIn(body, s.start)
        : moneyIn(body, s.start, metric.kind === 'per-share');
      // The first value after the metric, within reach; a percentage that is a change doesn't count as a margin.
      const growth = metric.id === 'organic-growth';
      const value = values.find((v) => {
        const rel = v.start - s.start;
        if (rel < after || rel - after > 90) return false;
        if (metric.kind !== 'percent' || growth) return true;
        // A margin is a level ("18.2%"), not a change ("up 2%", "+120 bps").
        if (!v.short.endsWith('%') || v.sign) return false;
        return !CHANGE_LEAD.test(body.slice(Math.max(after, rel - 24), rel));
      });
      if (!value) return;
      const valueEnd = value.end - s.start;
      const next = mentions
        .flatMap((h, i) => (i === mi ? [] : h.filter((x) => x.index >= valueEnd && !(x.index < after))))
        .reduce((lo, x) => Math.min(lo, x.index), body.length);
      const change = growth ? undefined : changeNear(body, after, s.start, value, next);
      const id = forward ? `${metric.id}-outlook` : metric.id;
      const label = (fr ? metric.fr : metric.en) + (forward ? (fr ? ' (objectif)' : ' outlook') : '');
      const tag = (metric.tags?.[fr ? 1 : 0] ?? (fr ? metric.fr : metric.en)) + (forward ? (fr ? ' obj.' : ' guide') : '');
      const period = findPeriod(body.slice(0, valueEnd)) ?? (forward ? findPeriod(body) : docPeriod);
      const position = si / Math.max(1, n - 1);
      const score = (1 + 0.6 * (1 - position)) * (change ? 1.4 : 1) * (period ? 1.1 : 1) * (forward ? 0.55 : 1);
      const prev = best.get(id);
      if (prev && prev.score >= score) return;
      best.set(id, {
        id,
        label,
        tag,
        value: value.value,
        short: value.short,
        change: change && change !== value.short ? change : undefined,
        period,
        start: value.start,
        end: value.end,
        sentence: [s.start, s.end],
        score,
        order: metric.order + (forward ? 100 : 0),
      });
    });
  });

  // The same number can't be two things: keep it for the stronger metric.
  const picked: Candidate[] = [];
  for (const c of [...best.values()].sort((a, b) => b.score - a.score)) {
    if (picked.some((p) => p.start === c.start)) continue;
    picked.push(c);
  }
  return picked
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_FIGURES)
    .map(({ score: _s, order: _o, ...f }) => f);
}

const FINANCE_VOCAB = /\b(?:revenue|net income|operating (?:income|margin|profit)|EBITDA|EBIT|earnings per share|EPS|free cash flow|guidance|fiscal|quarter|dividend|shareholders?|net debt|gross margin|year[- ]over[- ]year|chiffre d['’]affaires|résultat (?:net|opérationnel)|marge (?:brute|opérationnelle|nette)|bénéfice par action|trimestre|semestre|exercice|dette nette|actionnaires|dividende|ingresos|beneficio|umsatz|fatturato)\b/giu;

/** A financial report mentions its metrics several times and is full of currency amounts. */
export function looksFinancial(text: string): boolean {
  const sample = text.slice(0, 60000);
  const vocab = new Set((sample.match(FINANCE_VOCAB) ?? []).map((w) => w.toLowerCase())).size;
  const mentions = (sample.match(FINANCE_VOCAB) ?? []).length;
  let money = 0;
  for (const m of sample.matchAll(MONEY)) {
    const g = m.groups!;
    if (g.pre || g.suf || (g.mag && !/^[mbk]$/i.test(g.mag))) money++;
    if (money >= 4) break;
  }
  return vocab >= 3 && mentions >= 5 && money >= 3;
}

/** Words every report is full of: poor keywords next to the figures. */
const REPORT_FILLER = new Set(
  `share shares outlook quarter quarters year years fiscal results result period prior company group business million billion percent
  basis points growth increase decrease compared trimestre semestre exercice résultats résultat groupe société année hausse baisse`.split(/\s+/),
);
const PERIOD_PHRASE = /^(?:(?:first|second|third|fourth|full)[\s-](?:quarter|half|year)|(?:premier|deuxième|second|troisième|quatrième)\s(?:trimestre|semestre)|fiscal\s(?:year|20\d{2}))$/i;

/** True for keywords that only say "this is a report": "share", "third quarter", "outlook". */
export function isReportFiller(phrase: string): boolean {
  const words = phrase.toLowerCase().split(/\s+/);
  return PERIOD_PHRASE.test(phrase.trim()) || words.every((w) => REPORT_FILLER.has(w));
}
