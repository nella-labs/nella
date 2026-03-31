/**
 * Search Quality Metrics
 *
 * Precision@K, Recall@K, and Mean Reciprocal Rank for
 * evaluating search result quality against ground truth.
 */

/**
 * Precision@K: fraction of top-K results that are relevant.
 *
 * @param resultFiles  Ordered list of file paths returned by search
 * @param relevantFiles  Set of relevant file paths (ground truth)
 * @param k  Number of top results to consider
 */
export function computePrecisionAtK(
  resultFiles: string[],
  relevantFiles: string[],
  k: number,
): number {
  if (k <= 0) return 0;

  const topK = resultFiles.slice(0, k);
  if (topK.length === 0) return 0;

  const relevantSet = new Set(relevantFiles);
  const hits = topK.filter((f) => relevantSet.has(f)).length;

  return hits / topK.length;
}

/**
 * Recall@K: fraction of relevant files that appear in top-K results.
 *
 * @param resultFiles  Ordered list of file paths returned by search
 * @param relevantFiles  Set of relevant file paths (ground truth)
 * @param k  Number of top results to consider
 */
export function computeRecallAtK(
  resultFiles: string[],
  relevantFiles: string[],
  k: number,
): number {
  if (relevantFiles.length === 0) return 0;
  if (k <= 0) return 0;

  const topK = new Set(resultFiles.slice(0, k));
  const hits = relevantFiles.filter((f) => topK.has(f)).length;

  return hits / relevantFiles.length;
}

/**
 * Mean Reciprocal Rank: 1 / rank of the first relevant result.
 * Returns 0 if no relevant result appears in the list.
 *
 * @param resultFiles  Ordered list of file paths returned by search
 * @param relevantFiles  Set of relevant file paths (ground truth)
 */
export function computeMRR(
  resultFiles: string[],
  relevantFiles: string[],
): number {
  const relevantSet = new Set(relevantFiles);

  for (let i = 0; i < resultFiles.length; i++) {
    if (relevantSet.has(resultFiles[i])) {
      return 1 / (i + 1);
    }
  }

  return 0;
}
