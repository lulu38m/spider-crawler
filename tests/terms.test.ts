import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarize } from '../src/summarize';
import { findClauses, isContractFiller, looksLikeTerms } from '../src/summarize/terms';
import { detectLanguage, splitSentences } from '../src/summarize/text';
import { summaryMarkdown } from '../src/ui/export';
import { catchTargets } from '../src/scene/director';

// Fictional services, invented for these tests and the sample.
const EN = readFileSync('public/samples/silkthread-terms.md', 'utf8');
const FR = `Conditions générales d'utilisation de Toilou. En utilisant le service, vous acceptez les présentes conditions. L'abonnement est reconduit tacitement pour une durée d'un an, sauf résiliation par l'utilisateur au moins 30 jours avant l'échéance. Des frais de résiliation de 29 € s'appliquent en cas de départ anticipé. Les sommes versées ne seront pas remboursées. Nous pouvons partager vos données avec nos partenaires commerciaux à des fins publicitaires. Toilou se réserve le droit de modifier les présentes conditions à tout moment. Toilou ne saurait être tenue responsable des pertes de données. Article 12 : droit applicable.`;

const clausesOf = (text: string) => {
  const lang = detectLanguage(text);
  return Object.fromEntries(findClauses(text, splitSentences(text, lang), lang).map((c) => [c.id, c]));
};

describe('terms mode', () => {
  it('recognizes terms and contracts, and nothing else', () => {
    expect(looksLikeTerms(EN)).toBe(true);
    expect(looksLikeTerms(FR)).toBe(true);
    for (const f of ['README.md', 'CONTRIBUTING.md', 'public/samples/spider-silk.md']) expect(looksLikeTerms(readFileSync(f, 'utf8')), f).toBe(false);
  });

  it('flags the clauses that matter in English terms, with their details', () => {
    const c = clausesOf(EN);
    expect(EN.slice(c['auto-renewal'].start, c['auto-renewal'].end)).toBe('renews automatically');
    expect(c.commitment.detail).toBe('12 months');
    expect(c.cancellation.detail).toBe('30 days');
    expect(c.fees.detail).toBe('€5');
    expect(c['no-refund']).toBeDefined();
    expect(c['data-sharing']).toBeDefined();
    expect(c.arbitration).toBeDefined();
    expect(Object.keys(c).length).toBeLessThanOrEqual(9);
    // Every clause has a sentence of its own.
    const sentences = Object.values(c).map((x) => x.sentence[0]);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('reads French CGU', () => {
    const c = clausesOf(FR);
    expect(c['auto-renewal']).toMatchObject({ label: 'Renouvellement automatique' });
    expect(c.cancellation).toMatchObject({ label: 'Résiliation', detail: '29 €' });
    expect(c['no-refund']).toBeDefined();
    expect(c['data-sharing']).toBeDefined();
    expect(c.changes).toBeDefined();
    expect(c.liability).toBeDefined();
  });

  it('spots contract filler', () => {
    expect(isContractFiller('terms')).toBe(true);
    expect(isContractFiller('user account')).toBe(true);
    expect(isContractFiller('silk storage')).toBe(false);
  });
});

describe('summaries of terms', () => {
  it('lists the clauses, catches them in red and exports them', () => {
    const s = summarize(EN);
    expect(s.clauses?.length).toBeGreaterThanOrEqual(6);
    expect(s.figures).toBeUndefined();
    const flags = catchTargets(s).filter((t) => t.flag);
    expect(flags.length).toBe(s.clauses!.length);
    expect(flags[0]).toMatchObject({ label: 'Auto-renewal' });
    const md = summaryMarkdown('silkthread-terms.md', s);
    expect(md).toContain('## Clauses to read');
    expect(md).toContain('- **Minimum commitment** (12 months)');
  });
});
