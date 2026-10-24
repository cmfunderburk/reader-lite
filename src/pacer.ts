export const MIN_WPM = 100;
export const MAX_WPM = 800;
export const WPM_STEP = 10;
export const DEFAULT_WPM = 200;

/** Line duration in ms: 5 characters = 1 word at the given WPM. */
export function lineDurationMs(textLength: number, wpm: number): number {
  if (textLength <= 0 || wpm <= 0) return 0;
  return (textLength / 5) * (60000 / wpm);
}

export function clampWpm(wpm: number): number {
  const stepped = Math.round(wpm / WPM_STEP) * WPM_STEP;
  return Math.max(MIN_WPM, Math.min(MAX_WPM, stepped));
}
