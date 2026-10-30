import { describe, expect, it } from 'vitest';
import { extractFigures, findPeriod, isReportFiller, looksFinancial } from '../src/summarize/finance';
import { summarize } from '../src/summarize';
import { detectLanguage, splitSentences } from '../src/summarize/text';
import { summaryMarkdown } from '../src/ui/export';

// Fictional companies, invented for these tests.
const EN = `Orbweaver Silkworks reports third quarter 2026 results

PORTLAND, Oregon, October 22, 2026. Orbweaver Silkworks, Inc. today reported financial results for the third quarter of fiscal 2026.

Revenue grew 18% year over year to $412.6 million, driven by strong demand for dragline fiber. Gross margin was 61.4%, up 230 basis points from a year ago. Operating income rose to $58.1 million, compared with $39.7 million in the third quarter of 2025. Net income was $44.3 million, or $1.12 per diluted share, up 31% from the prior year. Diluted earnings per share were $1.12, compared with $0.86. Free cash flow reached $71.0 million and the company ended the quarter with net debt of $120 million.

Sales and marketing expenses were $63.2 million. The board declared a quarterly dividend of $0.24 per share.

For the full fiscal year 2026, the company expects revenue of $1.60 billion to $1.62 billion and an operating margin of about 14%. "We are spinning faster than ever," said the CEO.`;

const FR = `Toile & Fils publie ses résultats du premier semestre 2026

Le chiffre d'affaires du premier semestre 2026 s'établit à 1 234,5 millions d'euros, en hausse de 7,2 % par rapport au premier semestre 2025. La croissance organique atteint 5,8 %. Le résultat opérationnel progresse de 12 % à 187 M€, soit une marge opérationnelle de 15,2 %, en amélioration de 70 points de base. Le résultat net part du groupe ressort à 121,3 M€, en baisse de 4 %. Le bénéfice par action s'élève à 2,41 €. La dette nette s'établit à 412 M€ au 30 juin 2026.

Pour l'ensemble de l'exercice 2026, le groupe vise un chiffre d'affaires d'environ 2,5 milliards d'euros.`;

const PLAIN = `Spiders spin silk from glands. Dragline silk is strong. Orb weavers rebuild their webs every night, and they eat the old silk to recycle its proteins. Some species live for two years.`;

const figuresOf = (text: string) => {
  const lang = detectLanguage(text);
  return extractFigures(text, splitSentences(text, lang), lang);
};
const byId = (text: string) => Object.fromEntries(figuresOf(text).map((f) => [f.id, f]));

describe('finance mode', () => {
  it('only kicks in for reports', () => {
    expect(looksFinancial(EN)).toBe(true);
    expect(looksFinancial(FR)).toBe(true);
    expect(looksFinancial(PLAIN)).toBe(false);
    expect(figuresOf(PLAIN)).toEqual([]);
  });

  it('finds the headline figures of an English release, with change and period', () => {
    const f = byId(EN);
    expect(f.revenue).toMatchObject({ label: 'Revenue', value: '$412.6 million', short: '$412.6m', change: '+18%', period: 'Q3 2026' });
    expect(f['net-income']).toMatchObject({ value: '$44.3 million', change: '+31%' });
    expect(f.eps).toMatchObject({ value: '$1.12' });
    expect(f['gross-margin']).toMatchObject({ value: '61.4%', change: '+230 bps' });
    // Comparisons later in the sentence don't change the period.
    expect(f['operating-income']).toMatchObject({ value: '$58.1 million', period: 'Q3 2026' });
    expect(figuresOf(EN).length).toBeLessThanOrEqual(6);
    // Value ranges point at the number in the text.
    const r = f.revenue;
    expect(EN.slice(r.start, r.end)).toBe('$412.6 million');
  });

  it('reads French reports: spaces in numbers, "M€", "en hausse de"', () => {
    const f = byId(FR);
    expect(f.revenue).toMatchObject({ label: "Chiffre d'affaires", value: "1 234,5 millions d'euros", change: '+7,2%', period: 'H1 2026' });
    expect(f['net-income']).toMatchObject({ label: 'Résultat net', value: '121,3 M€', change: '−4%' });
    // The change belongs to the metric it follows, not to the margin mentioned next.
    expect(f['operating-income']).toMatchObject({ value: '187 M€', change: '+12%' });
    expect(f['organic-growth']).toMatchObject({ value: '5,8 %' });
  });

  it('keeps forecasts apart from results', () => {
    const text = `Tangle Corp. reported fiscal 2026 results. Revenue rose 9% to €2.1 billion and net income was €140 million, up 12%. The operating margin was 11.5%, up 40 basis points, and the dividend was raised to €1.10 per share. For fiscal 2027, the group expects revenue of about €2.3 billion.`;
    const f = byId(text);
    expect(f.revenue).toMatchObject({ value: '€2.1 billion', change: '+9%', period: 'FY 2026' });
    expect(f['revenue-outlook']).toMatchObject({ label: 'Revenue outlook', value: '€2.3 billion', period: 'FY 2027' });
  });

  it('normalizes periods', () => {
    expect(findPeriod('for the third quarter of fiscal 2026, compared with Q3 2025')).toBe('Q3 2026');
    expect(findPeriod('FY25 results')).toBe('FY 2025');
    expect(findPeriod('au premier semestre 2026')).toBe('H1 2026');
    expect(findPeriod('H2 2025 was slower')).toBe('H2 2025');
    expect(findPeriod('no period here')).toBeUndefined();
  });

  it('spots filler keywords', () => {
    expect(isReportFiller('third quarter')).toBe(true);
    expect(isReportFiller('share')).toBe(true);
    expect(isReportFiller('dragline fiber')).toBe(false);
  });
});

describe('summaries of reports', () => {
  it('leads with the results and lists the figures', () => {
    const s = summarize(EN);
    expect(s.figures?.length).toBeGreaterThanOrEqual(4);
    expect(s.tldr).toMatch(/\$\d/);
    // Figures and keywords share the web.
    expect(s.figures!.length + s.keywords.length).toBeLessThanOrEqual(10);
    expect(s.keywords.some((k) => /^(?:revenue|net income|third quarter|share)$/i.test(k.phrase))).toBe(false);
    const md = summaryMarkdown('orbweaver-q3.md', s);
    expect(md).toContain('## Key figures');
    expect(md).toContain('| Revenue | $412.6 million | +18% | Q3 2026 |');
  });

  it('leaves other documents alone', () => {
    expect(summarize(PLAIN).figures).toBeUndefined();
  });
});
