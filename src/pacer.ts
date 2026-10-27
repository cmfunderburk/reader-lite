export const MIN_WPM = 100;
export const MAX_WPM = 800;
export const WPM_STEP = 10;
export const DEFAULT_WPM = 200;

export function clampWpm(wpm: number): number {
  const stepped = Math.round(wpm / WPM_STEP) * WPM_STEP;
  return Math.max(MIN_WPM, Math.min(MAX_WPM, stepped));
}
