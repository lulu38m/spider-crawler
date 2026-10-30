import type { Rect } from '../core/math';

/** A piece of a summary sentence on one line: the spider highlights it as it walks over. */
export interface HighlightSeg {
  /** Index into summary.points. */
  point: number;
  page: number;
  line: number;
  /** Page-local extent of the sentence on this line. */
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** Covered so far (page-local x). from > to means nothing yet. */
  from: number;
  to: number;
  seed: number;
}

/** Something the spider catches: a keyword, or a headline figure in a financial report. */
export interface CatchTarget {
  /** What the cocoon says: "spider silk", "Revenue $412.6m". */
  label: string;
  /** A figure's change, shown in green or pink on the cocoon: "+18%". */
  badge?: string;
  figure: boolean;
  occurrences: Array<[number, number]>;
}

/** A keyword occurrence the spider will catch. */
export interface CatchMark {
  /** Index into Director.targets. */
  keyword: number;
  page: number;
  line: number;
  /** Page-local box of the word(s). */
  rect: Rect;
  /** Scene time when the wrapping started (null until caught). */
  caughtAt: number | null;
}
