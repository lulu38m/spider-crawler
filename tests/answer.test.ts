import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findAnswer, stem, wantOf } from '../src/summarize/answer';

const terms = readFileSync('public/samples/silkthread-terms.md', 'utf8');
const silk = readFileSync('public/samples/spider-silk.md', 'utf8');
const best = (text: string, q: string) => findAnswer(text, q, 'en').passages[0]?.text ?? '';

describe('ask the spider', () => {
  it('finds the passage that answers', () => {
    expect(best(terms, 'How do I cancel?')).toMatch(/^You can cancel your subscription/);
    expect(best(terms, 'How much is the late fee?')).toMatch(/late fee of €5/);
    expect(best(terms, 'Can I get a refund?')).toMatch(/non-refundable/);
    expect(best(terms, 'Do they sell my data?')).toMatch(/share your personal information/);
    expect(best(terms, 'Where are disputes resolved?')).toMatch(/binding individual arbitration/);
    expect(best(silk, 'How strong is dragline silk?')).toMatch(/tensile strength/);
  });

  it('understands a French question about an English document', () => {
    expect(best(terms, 'quand puis-je résilier ?')).toMatch(/cancel at least 30 days/);
  });

  it('says nothing rather than something wrong', () => {
    expect(findAnswer(terms, 'What is the capital of France?', 'en').passages).toEqual([]);
    expect(findAnswer(silk, 'banana bread recipe', 'en').passages).toEqual([]);
    expect(findAnswer(silk, 'what is it?', 'en').passages).toEqual([]);
  });

  it('joins a short sentence with the next one, and reports the words it matched', () => {
    const r = findAnswer(silk, 'How many kinds of silk does a spider make?', 'en');
    expect(r.passages[0].text).toMatch(/single kind of silk\. Orb-weaving spiders can make up to seven/);
    expect(r.matched).toEqual(expect.arrayContaining(['kinds', 'silk', 'spider']));
    expect(silk.slice(r.passages[0].start, r.passages[0].end)).toContain('seven different silks');
  });

  it('stems and reads question types', () => {
    expect(stem('cancellation')).toBe(stem('cancel'));
    expect(stem('refundable')).toBe(stem('refund'));
    expect(wantOf('When does it end?')).toBe('date');
    expect(wantOf('Combien ça coûte ?')).toBe('amount');
    expect(wantOf('How long is the notice?')).toBe('duration');
  });
});
