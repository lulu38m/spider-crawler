import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarize } from '../src/summarize';
import { summarizeCode } from '../src/summarize/code';
import { detectLanguage, normalizeWord, splitSentences, tokenize } from '../src/summarize/text';

const article = readFileSync(new URL('../public/samples/spider-silk.md', import.meta.url), 'utf8')
  // The markdown parser does this in the app; tests use the raw text with headings stripped of '#'.
  .replace(/^#+\s*/gm, '');

describe('text utilities', () => {
  it('normalizes plurals, possessives, elisions and accents', () => {
    expect(normalizeWord('Spiders')).toBe('spider');
    expect(normalizeWord("spider's")).toBe('spider');
    expect(normalizeWord("l'araignée")).toBe('araignee');
    expect(normalizeWord('process')).toBe('process');
  });

  it('keeps offsets pointing into the original text', () => {
    const text = 'Silk is strong.\n\nWebs, too!';
    const tokens = tokenize(text);
    for (const t of tokens) expect(text.slice(t.start, t.end)).toBe(t.text);
    const sentences = splitSentences(text);
    expect(sentences.map((s) => s.text)).toEqual(['Silk is strong.', 'Webs, too!']);
    for (const s of sentences) expect(text.slice(s.start, s.end)).toBe(s.text);
  });

  it('treats single newlines inside a paragraph as spaces', () => {
    const sentences = splitSentences('The spider walked\nacross the page. Then it\nstopped.');
    expect(sentences).toHaveLength(2);
  });

  it('detects common languages', () => {
    expect(detectLanguage('The spider is on the wall and it is looking at you.')).toBe('en');
    expect(detectLanguage("L'araignée est sur le mur et elle nous regarde depuis la fenêtre.")).toBe('fr');
    expect(detectLanguage('La araña está en la pared y nos mira desde la ventana.')).toBe('es');
    expect(detectLanguage('Die Spinne ist an der Wand und sie schaut uns durch das Fenster an.')).toBe('de');
  });
});

describe('summarize (prose)', () => {
  const summary = summarize(article);

  it('produces a TL;DR and a handful of points in document order', () => {
    expect(summary.mode).toBe('prose');
    expect(summary.language).toBe('en');
    expect(summary.tldr.length).toBeGreaterThan(40);
    expect(summary.points.length).toBeGreaterThanOrEqual(3);
    expect(summary.points.length).toBeLessThanOrEqual(8);
    const starts = summary.points.map((p) => p.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    for (const p of summary.points) expect(article.slice(p.start, p.end)).toBe(p.text);
    expect(new Set(summary.points.map((p) => p.rank)).size).toBe(summary.points.length);
  });

  it('finds the topic in its keywords', () => {
    const phrases = summary.keywords.map((k) => k.phrase.toLowerCase());
    expect(phrases.some((p) => p.includes('silk'))).toBe(true);
    for (const k of summary.keywords) {
      expect(k.occurrences.length).toBeGreaterThan(0);
      for (const [a, b] of k.occurrences) expect(b).toBeGreaterThan(a);
    }
  });

  it('never picks headings as summary sentences', () => {
    for (const p of summary.points) expect(p.text).not.toMatch(/^Many silks from one spider$/);
  });

  it('computes reading stats', () => {
    expect(summary.stats.words).toBeGreaterThan(600);
    expect(summary.stats.readingMinutes).toBeGreaterThan(2);
  });

  it('handles tiny inputs gracefully', () => {
    const tiny = summarize('Hello spider.');
    expect(tiny.tldr).toBe('Hello spider.');
    expect(tiny.points).toEqual([]);
    expect(summarize('').tldr).toBe('');
  });

  it('summarizes French text in French', () => {
    const fr = summarize(
      "La soie d'araignée est une fibre protéique remarquable. Les araignées tisseuses peuvent produire jusqu'à sept types de soie différents. " +
        "La soie de trait sert de fil de sécurité et forme le cadre de la toile. La spirale de capture est élastique et couverte de gouttelettes de colle. " +
        "Beaucoup d'araignées mangent leur ancienne toile pour recycler les protéines de soie. Les jeunes araignées voyagent dans les airs grâce à leurs fils de soie.",
    );
    expect(fr.language).toBe('fr');
    expect(fr.points.length).toBeGreaterThan(0);
    expect(fr.keywords.map((k) => k.phrase.toLowerCase()).some((p) => p.includes('soie'))).toBe(true);
  });
});

describe('summarizeCode', () => {
  const source = `/**
 * Two-bone inverse kinematics for spider legs.
 */
import { clamp } from './math';

export interface Leg { hip: number; foot: number }

export class Spider {
  legs: Leg[] = [];
  update(dt: number) {
    // TODO: smarter gait
    return dt;
  }
}

export function solveLeg(leg: Leg, reach: number) {
  return clamp(leg.foot - leg.hip, 0, reach);
}

const stepLeg = (leg: Leg) => solveLeg(leg, 10);
`;
  const summary = summarizeCode(source, 'ts');

  it('describes the file', () => {
    expect(summary.mode).toBe('code');
    expect(summary.code?.language).toBe('TypeScript');
    expect(summary.code?.classes).toBe(1);
    expect(summary.code?.functions).toBeGreaterThanOrEqual(2);
    expect(summary.code?.todos).toBe(1);
    expect(summary.tldr).toMatch(/^Two-bone inverse kinematics for spider legs\./);
    expect(summary.tldr).toMatch(/TypeScript/);
  });

  it('points at declarations and frequent identifiers', () => {
    expect(summary.points.some((p) => p.label?.startsWith('class Spider'))).toBe(true);
    expect(summary.keywords.map((k) => k.phrase)).toContain('Leg');
    for (const p of summary.points) expect(source.slice(p.start, p.end)).toBe(p.text);
  });
});
