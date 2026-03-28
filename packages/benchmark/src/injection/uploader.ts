import type { InjectionBenchmarkResults } from "./types";

export async function uploadResults(
  results: InjectionBenchmarkResults,
  apiUrl: string,
  apiKey: string,
): Promise<void> {
  const body = {
    feature: "prompt-injection-defense",
    version: results.corpusVersion,
    corpus_stats: results.corpus,
    headline: results.headline,
    by_category: results.byCategory,
    by_difficulty: results.byDifficulty,
    by_layer: results.byLayer,
  };

  const response = await fetch(`${apiUrl}/api/v1/benchmarks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed: ${response.status} ${text}`);
  }
}
