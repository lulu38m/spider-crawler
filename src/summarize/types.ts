import type { Keyword } from './keywords';

export type { Keyword };

export interface SummarySentence {
  /** Char range in the source text. */
  start: number;
  end: number;
  text: string;
  score: number;
  /** 0 = most important. Points are stored in document order; rank says how they compare. */
  rank: number;
  /** Code mode: a short label such as "function solveLeg". */
  label?: string;
}

export interface SummaryStats {
  words: number;
  sentences: number;
  paragraphs: number;
  characters: number;
  /** Estimated silent reading time at 238 words per minute (Brysbaert, 2019). */
  readingMinutes: number;
}

export interface CodeFacts {
  language: string;
  lines: number;
  functions: number;
  classes: number;
  types: number;
  imports: number;
  comments: number;
  todos: number;
}

export interface Summary {
  mode: 'prose' | 'code';
  language: string;
  tldr: string;
  points: SummarySentence[];
  keywords: Keyword[];
  stats: SummaryStats;
  code?: CodeFacts;
  /** Filled in when an optional AI provider is configured. */
  ai?: AiSummary;
}

export interface AiSummary {
  provider: string;
  model: string;
  tldr: string;
  points: string[];
}

export interface SummarizeOptions {
  mode?: 'prose' | 'code';
  /** File extension for code mode, e.g. "ts". */
  codeExtension?: string;
  maxPoints?: number;
  maxKeywords?: number;
  /** Char ranges that are headings: never picked as summary sentences. */
  headings?: Array<[number, number]>;
}
