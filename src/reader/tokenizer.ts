// Copied from Reader@f2d4f14 src/lib/tokenizer.ts, trimmed to the word-scoring
// helpers the guided line layout needs.

// --- Word scoring model (shared with saccade fixation placement) ---

export const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'is', 'it', 'or', 'as',
  'by', 'if', 'so', 'no', 'do', 'be', 'am', 'are', 'was', 'were', 'he',
  'she', 'we', 'they', 'you', 'my', 'your', 'our', 'us', 'up', 'and',
  'for', 'but', 'nor', 'yet', 'with', 'from', 'into', 'onto', 'this',
  'that', 'these', 'those', 'its',
]);

const FUNCTION_WORD_PENALTY = 1.25;

export function lengthPenalty(len: number): number {
  if (len <= 1) return 5.0;
  if (len === 2) return 4.0;
  if (len === 3) return 2.5;
  if (len === 4) return 1.5;
  if (len === 5) return 0.5;
  return 0.0;
}

export function wordPenalty(word: string): number {
  const fp = FUNCTION_WORDS.has(word.toLowerCase().replace(/[^a-z]/g, ''))
    ? FUNCTION_WORD_PENALTY : 0;
  return lengthPenalty(word.length) + fp;
}

/**
 * Calculate the Optimal Reading Point (ORP) index within a chunk.
 *
 * For single words: uses 35% position (well-validated OVP research).
 * For multi-word chunks: uses center position, since the 35% OVP research
 * was conducted on single words and doesn't directly apply to phrases.
 */
export function calculateORP(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  if (trimmed.length <= 1) return 0;
  if (trimmed.length <= 3) return 1;

  const isMultiWord = trimmed.includes(' ');

  // Single word: use 35% OVP (research-backed)
  // Multi-word: use center (heuristic, since OVP doesn't apply to phrases)
  const orpPosition = isMultiWord
    ? Math.floor(trimmed.length / 2)
    : Math.floor(trimmed.length * 0.35);

  // Adjust to avoid landing on whitespace
  let adjusted = orpPosition;
  while (adjusted > 0 && trimmed[adjusted] === ' ') {
    adjusted--;
  }

  return adjusted;
}

/**
 * Normalize text by ensuring spaces after sentence-ending punctuation.
 * Handles cases like "word.Next" -> "word. Next"
 * But preserves abbreviations like "U.S.A." (uppercase before period)
 */
export function normalizeText(text: string): string {
  // Only add space when a lowercase letter precedes the punctuation
  // This catches real sentence endings but not abbreviations like U.S.A.
  return text.replace(/([a-z])([.!?])([A-Z])/g, '$1$2 $3');
}
