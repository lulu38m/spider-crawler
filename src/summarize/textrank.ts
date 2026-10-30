/**
 * TextRank (Mihalcea & Tarau, 2004) over sentences: sentences are nodes, TF-IDF cosine similarity
 * is the edge weight, and PageRank finds the sentences the rest of the document "agrees" with.
 */

export type SparseVec = Map<string, number>;

export interface WeightedVectors {
  vectors: SparseVec[];
  norms: number[];
}

/** Turn bags of normalized terms into L2-normalizable TF-IDF vectors (sentences are the "documents"). */
export function tfidfVectors(bags: string[][]): WeightedVectors {
  const n = bags.length;
  const df = new Map<string, number>();
  const tfs = bags.map((bag) => {
    const tf = new Map<string, number>();
    for (const term of bag) tf.set(term, (tf.get(term) ?? 0) + 1);
    for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    return tf;
  });
  const vectors: SparseVec[] = [];
  const norms: number[] = [];
  for (const tf of tfs) {
    const v: SparseVec = new Map();
    let sq = 0;
    for (const [term, count] of tf) {
      const idf = Math.log((n + 1) / ((df.get(term) ?? 0) + 0.5));
      const w = (1 + Math.log(count)) * Math.max(idf, 0.05);
      v.set(term, w);
      sq += w * w;
    }
    vectors.push(v);
    norms.push(Math.sqrt(sq));
  }
  return { vectors, norms };
}

export function cosine(a: SparseVec, na: number, b: SparseVec, nb: number): number {
  if (na === 0 || nb === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, w] of small) {
    const o = big.get(term);
    if (o !== undefined) dot += w * o;
  }
  return dot / (na * nb);
}

/** Weighted PageRank over the similarity graph. Returns one score per sentence (mean ≈ 1). */
export function textRank({ vectors, norms }: WeightedVectors, damping = 0.85, iterations = 50): number[] {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const edges: Array<Array<[number, number]>> = Array.from({ length: n }, () => []);
  const outWeight = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = cosine(vectors[i], norms[i], vectors[j], norms[j]);
      if (w > 0.03) {
        edges[i].push([j, w]);
        edges[j].push([i, w]);
        outWeight[i] += w;
        outWeight[j] += w;
      }
    }
  }
  let scores = new Float64Array(n).fill(1);
  for (let it = 0; it < iterations; it++) {
    const next = new Float64Array(n).fill(1 - damping);
    for (let j = 0; j < n; j++) {
      if (outWeight[j] === 0) continue;
      const share = (damping * scores[j]) / outWeight[j];
      for (const [i, w] of edges[j]) next[i] += share * w;
    }
    let delta = 0;
    for (let i = 0; i < n; i++) delta += Math.abs(next[i] - scores[i]);
    scores = next;
    if (delta < 1e-6 * n) break;
  }
  return Array.from(scores);
}

/**
 * Maximal Marginal Relevance: pick `k` items balancing relevance against redundancy with
 * what has already been picked, so the summary doesn't say the same thing three times.
 */
export function mmrSelect(scores: number[], vecs: WeightedVectors, k: number, lambda = 0.72): number[] {
  const n = scores.length;
  if (n <= k) return scores.map((_, i) => i);
  const max = Math.max(...scores) || 1;
  const rel = scores.map((s) => s / max);
  const picked: number[] = [];
  const maxSim = new Float64Array(n);
  const used = new Uint8Array(n);
  while (picked.length < k) {
    let best = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const val = lambda * rel[i] - (1 - lambda) * maxSim[i];
      if (val > bestVal) {
        bestVal = val;
        best = i;
      }
    }
    if (best < 0) break;
    used[best] = 1;
    picked.push(best);
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const s = cosine(vecs.vectors[i], vecs.norms[i], vecs.vectors[best], vecs.norms[best]);
      if (s > maxSim[i]) maxSim[i] = s;
    }
  }
  return picked;
}
