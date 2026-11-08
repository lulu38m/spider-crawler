import type { SentenceSpan } from './text';

/**
 * Terms mode: terms of service, privacy policies and contracts hide what matters to you
 * (automatic renewal, cancellation, fees, data sharing, arbitration…) in walls of legalese.
 * This finds the clauses worth reading, by their wording, and quotes them.
 *
 * It flags; it doesn't judge. A flagged clause can be perfectly fair: the point is that you
 * read it. Nothing here is legal advice.
 */

export interface Clause {
  /** Stable id, e.g. "auto-renewal". */
  id: string;
  /** Display label in the document's language: "Automatic renewal", "Renouvellement automatique". */
  label: string;
  /** Short label for the web: "Auto-renewal". */
  tag: string;
  /** Why it matters, one line, in the document's language. */
  why: string;
  /** A detail the clause states, when there is one: "30 days", "€39", "12 months". */
  detail?: string;
  /** Char range of the phrase that triggered it (what the spider catches). */
  start: number;
  end: number;
  /** Char range of the whole sentence (what gets highlighted in red). */
  sentence: [number, number];
}

interface Category {
  id: string;
  en: [label: string, tag: string, why: string];
  fr: [label: string, tag: string, why: string];
  /** Lower is shown first. */
  order: number;
  /** Phrases, matched case-insensitively on whole words. */
  patterns: string[];
}

const CATEGORIES: Category[] = [
  {
    id: 'auto-renewal', order: 0,
    en: ['Automatic renewal', 'Auto-renewal', 'It renews and charges you again unless you cancel in time.'],
    fr: ['Renouvellement automatique', 'Reconduction', "Il se renouvelle et vous est facturé à nouveau si vous ne résiliez pas à temps."],
    patterns: [
      String.raw`(?:automatically|auto-?)\s?renew\p{L}*`, String.raw`renew\p{L}*\s+automatically`, 'recurring (?:billing|charges?|payments?)', 'until you cancel',
      'tacite reconduction', String.raw`reconduit\p{L}*\s+(?:tacitement|automatiquement)`, String.raw`renouvel\p{L}*\s+automatiquement`, 'renouvellement automatique',
      String.raw`renov\p{L}*\s+automáticamente`, String.raw`verlängert sich automatisch`,
    ],
  },
  {
    id: 'commitment', order: 1,
    en: ['Minimum commitment', 'Commitment', 'You are tied in for a minimum period.'],
    fr: ["Durée d'engagement", 'Engagement', 'Vous êtes engagé pour une durée minimale.'],
    patterns: ['minimum (?:term|period|commitment)', 'initial term', 'commitment period', String.raw`durée (?:minimale|d['’]engagement)`, String.raw`engagement (?:de|d['’]une durée de) \d+`, 'période initiale'],
  },
  {
    id: 'cancellation', order: 2,
    en: ['Cancellation', 'Cancellation', 'How and when you can leave, and what it costs.'],
    fr: ['Résiliation', 'Résiliation', 'Comment et quand vous pouvez partir, et ce que ça coûte.'],
    patterns: [
      String.raw`(?:early )?termination fees?`, 'cancellation fees?', String.raw`notice period`, String.raw`(?:you|customer) (?:may|can|must) (?:cancel|terminate)`, 'to cancel',
      String.raw`frais de résiliation`, 'préavis', String.raw`résili\p{L}+`, 'droit de rétractation',
    ],
  },
  {
    id: 'fees', order: 3,
    en: ['Fees and price changes', 'Fees', 'Extra charges, or prices that can change.'],
    fr: ['Frais et hausses de prix', 'Frais', 'Des frais en plus, ou des prix qui peuvent changer.'],
    patterns: [
      'late (?:payment )?fees?', 'penalt(?:y|ies)', 'administrative fees?', 'processing fees?', String.raw`(?:change|increase|modify|adjust) (?:our |the )?(?:prices|fees|pricing|subscription fees?)`, 'price (?:changes?|increases?)',
      String.raw`frais (?:de dossier|supplémentaires|de retard|administratifs)`, String.raw`pénalit\p{L}+`, String.raw`(?:modifier|augmenter|réviser) (?:les |nos |ses )?(?:prix|tarifs)`, 'hausse (?:de|des) (?:prix|tarifs)',
    ],
  },
  {
    id: 'no-refund', order: 4,
    en: ['No refunds', 'No refund', 'Money you pay may not come back.'],
    fr: ['Pas de remboursement', 'Non remboursable', "L'argent versé peut ne pas être rendu."],
    patterns: ['non-?refundable', 'no refunds?', String.raw`(?:will|shall) not (?:be )?refund\p{L}*`, 'not entitled to (?:a )?refund', String.raw`non[- ]remboursable\p{L}*`, 'aucun remboursement', String.raw`ne (?:sera|seront) pas rembours\p{L}+`],
  },
  {
    id: 'data-sharing', order: 5,
    en: ['Data sharing', 'Data sharing', 'Your data can go to other companies.'],
    fr: ['Partage de données', 'Données partagées', 'Vos données peuvent aller à d’autres entreprises.'],
    patterns: [
      String.raw`(?:share|sell|disclose|transfer)\p{L}* (?:your |personal |such )?(?:personal )?(?:data|information) (?:with|to) (?:third[- ]part(?:y|ies)|partners|affiliates|advertisers)`,
      String.raw`(?:sell|rent)\p{L}* (?:your )?(?:personal )?(?:data|information)`, 'advertising partners', 'third-party advertisers',
      String.raw`(?:partag\p{L}+|transmett\p{L}+|commerciali\p{L}+|vend\p{L}+|cèd\p{L}+) (?:vos |les |ces )?(?:données|informations)`, String.raw`partenaires (?:commerciaux|publicitaires)`, String.raw`tiers à des fins (?:publicitaires|commerciales|de prospection)`,
    ],
  },
  {
    id: 'content-license', order: 6,
    en: ['Rights over your content', 'Your content', 'They get a broad licence to what you post or upload.'],
    fr: ['Droits sur vos contenus', 'Vos contenus', 'Ils obtiennent une licence large sur ce que vous publiez.'],
    patterns: [String.raw`(?:worldwide|perpetual|irrevocable|royalty-free)[,\s]+(?:non-exclusive[,\s]+)?(?:royalty-free[,\s]+|perpetual[,\s]+|irrevocable[,\s]+|transferable[,\s]+|sublicensable[,\s]+)*licen[cs]e`, String.raw`licence (?:mondiale|gratuite|irrévocable|perpétuelle)`, String.raw`cédez (?:à|au profit)`],
  },
  {
    id: 'arbitration', order: 7,
    en: ['Arbitration, no class action', 'Arbitration', 'Disputes go to a private arbitrator, often without a class action.'],
    fr: ['Arbitrage, pas d’action collective', 'Arbitrage', 'Les litiges vont devant un arbitre privé, souvent sans action collective.'],
    patterns: [String.raw`binding (?:individual )?arbitration`, 'class action', 'waive (?:your|any) right', 'jury trial', String.raw`arbitrage (?:obligatoire|contraignant)?`, 'action (?:collective|de groupe)', String.raw`renonc\p{L}+ (?:à|au) (?:toute|votre|tout)`],
  },
  {
    id: 'liability', order: 8,
    en: ['Limited liability', 'Liability', 'Their responsibility if something goes wrong is limited or excluded.'],
    fr: ['Responsabilité limitée', 'Responsabilité', 'Leur responsabilité en cas de problème est limitée ou exclue.'],
    patterns: [String.raw`(?:shall|will) not be (?:held )?liable`, 'limitation of liability', String.raw`(?:provided |on an )?["“]?as is["”]?`, 'without warrant(?:y|ies)', String.raw`(?:décline|exclut) toute responsabilité`, String.raw`ne (?:saurait|pourra) (?:en aucun cas )?être tenu\p{L}* (?:pour )?responsable`, 'limitation de responsabilité'],
  },
  {
    id: 'changes', order: 9,
    en: ['They can change the terms', 'Changes', 'The rules can change after you agree, sometimes without notice.'],
    fr: ['Conditions modifiables', 'Modifications', 'Les règles peuvent changer après votre accord, parfois sans prévenir.'],
    patterns: [
      String.raw`(?:may|can|reserve the right to) (?:change|modify|update|amend|revise)\p{L}* (?:these|this|the) (?:terms|agreement|conditions|policy)`, String.raw`(?:at any time|from time to time),? (?:with or )?without (?:prior )?notice`, 'without (?:prior )?notice',
      String.raw`(?:modifier|faire évoluer|mettre à jour) (?:les présentes|ces conditions|les conditions)`, 'à tout moment', 'sans préavis',
    ],
  },
  {
    id: 'account-termination', order: 10,
    en: ['They can close your account', 'Account closure', 'Your account can be suspended or closed at their discretion.'],
    fr: ['Compte fermé à leur discrétion', 'Fermeture du compte', 'Votre compte peut être suspendu ou fermé à leur discrétion.'],
    patterns: [String.raw`(?:suspend|terminate|disable|close)\p{L}* (?:or (?:suspend|terminate|disable|close)\p{L}* )?(?:your )?(?:account|access)`, String.raw`(?:sole|absolute) discretion`, String.raw`(?:suspendre|résilier|fermer|supprimer) (?:votre |le )?(?:compte|accès)`, 'seule discrétion'],
  },
  {
    id: 'data-retention', order: 11,
    en: ['Data kept or tracked', 'Tracking', 'What is collected about you, and how long it is kept.'],
    fr: ['Données conservées ou suivies', 'Suivi', 'Ce qui est collecté sur vous, et combien de temps c’est gardé.'],
    patterns: [String.raw`(?:retain|keep|store)\p{L}* (?:your )?(?:personal )?(?:data|information) (?:for|indefinitely|as long)`, 'location data', 'precise location', 'track(?:ing)? (?:your|you)', String.raw`conserv\p{L}+ (?:vos |les )?données`, String.raw`données de (?:localisation|géolocalisation)`],
  },
];

const MAX_CLAUSES = 9;

const DETAIL_RES: RegExp[] = [
  // Notice periods and durations: "30 days", "12 mois", "one month".
  /\b(\d{1,3}|one|two|three|six|twelve|un|deux|trois|six|douze)\s?(days?|business days?|weeks?|months?|years?|jours?(?: ouvrés)?|semaines?|mois|ans?|années?)\b/iu,
  // Money: "$9.99", "39 €", "EUR 50".
  /(?:[$€£]\s?\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s?(?:€|EUR|USD|euros?|dollars?))/iu,
  // Percentages: "a 10% fee".
  /\d+(?:[.,]\d+)?\s?%/u,
];

/** For money clauses the amount says more than a delay ("€5" rather than "10 days"). */
const MONEY_FIRST = new Set(['fees', 'no-refund']);

function detailIn(text: string, id: string): string | undefined {
  const order = MONEY_FIRST.has(id) ? [DETAIL_RES[1], DETAIL_RES[2], DETAIL_RES[0]] : DETAIL_RES;
  for (const re of order) {
    const m = text.match(re);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return undefined;
}

const compiled = CATEGORIES.map((c) => ({
  category: c,
  re: new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${c.patterns.join('|')})(?![\p{L}\p{N}])`, 'giu'),
}));

const TERMS_VOCAB = /(?<![\p{L}])(?:terms of (?:service|use)|terms and conditions|privacy policy|user agreement|this agreement|these terms|you agree|by using|the services?|subscriber|licensee|hereby|herein|thereof|governing law|conditions générales|CGU|CGV|politique de confidentialité|vous acceptez|l['’]utilisateur|le souscripteur|les présentes|ci-après|le présent contrat|article \d+)(?![\p{L}])/giu;

/** A contract or terms page talks to "you" about "these terms", with legal set phrases. */
export function looksLikeTerms(text: string): boolean {
  const sample = text.slice(0, 80000);
  const hits = sample.match(TERMS_VOCAB) ?? [];
  const distinct = new Set(hits.map((h) => h.toLowerCase())).size;
  if (distinct < 3 || hits.length < 5) return false;
  let categories = 0;
  for (const { re } of compiled) {
    re.lastIndex = 0;
    if (re.test(sample)) categories++;
  }
  return categories >= 3;
}

/**
 * The clauses worth reading, at most one per kind and nine in all, in a fixed order that puts
 * money and lock-in first. Returns [] for documents that aren't terms or contracts.
 */
export function findClauses(text: string, sentences: SentenceSpan[], language: string): Clause[] {
  if (!looksLikeTerms(text)) return [];
  const fr = language === 'fr';
  const candidates = new Map<string, Array<Clause & { score: number }>>();
  const n = sentences.length;
  sentences.forEach((s, si) => {
    if (s.text.length > 900) return;
    // Headings ("12. Cancellation") name the topic; the sentences under them say the rule.
    if (s.text.split(/\s+/).length < 5) return;
    for (const { category, re } of compiled) {
      re.lastIndex = 0;
      const m = re.exec(s.text);
      if (!m) continue;
      const detail = detailIn(s.text, category.id);
      const position = si / Math.max(1, n - 1);
      // Specific beats vague; earlier beats later (definitions and summaries come first).
      const score = (detail ? 1.5 : 1) * (1 + 0.3 * (1 - position)) * (s.text.length < 400 ? 1.1 : 1);
      const [label, tag, why] = fr ? category.fr : category.en;
      const start = s.start + m.index;
      const list = candidates.get(category.id) ?? [];
      list.push({ id: category.id, label, tag, why, detail, start, end: start + m[0].length, sentence: [s.start, s.end], score });
      candidates.set(category.id, list);
    }
  });
  // One sentence, one flag: kinds pick in order, each taking its best sentence not taken yet.
  const used = new Set<number>();
  const out: Clause[] = [];
  for (const category of [...CATEGORIES].sort((a, b) => a.order - b.order)) {
    const pick = (candidates.get(category.id) ?? []).sort((a, b) => b.score - a.score).find((c) => !used.has(c.sentence[0]));
    if (!pick) continue;
    used.add(pick.sentence[0]);
    const { score: _s, ...clause } = pick;
    out.push(clause);
    if (out.length === MAX_CLAUSES) break;
  }
  return out;
}

/** Words every contract is full of: poor keywords next to the clauses. */
const CONTRACT_FILLER = new Set(
  `terms term agreement service services user users party parties customer subscriber account section article law laws provision provisions
  conditions condition utilisateur utilisateurs service services contrat présentes article articles client clients partie parties compte`.split(/\s+/),
);

export function isContractFiller(phrase: string): boolean {
  return phrase.toLowerCase().split(/\s+/).every((w) => CONTRACT_FILLER.has(w));
}
