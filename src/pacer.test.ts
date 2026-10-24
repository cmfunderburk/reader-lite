import { describe, expect, test } from 'bun:test';
import { clampWpm, lineDurationMs } from './pacer';

describe('lineDurationMs', () => {
  test('60 chars at 240 WPM is 3 seconds', () => {
    expect(lineDurationMs(60, 240)).toBe(3000);
  });

  test('empty lines and zero WPM take no time', () => {
    expect(lineDurationMs(0, 300)).toBe(0);
    expect(lineDurationMs(40, 0)).toBe(0);
  });
});

describe('clampWpm', () => {
  test('clamps to range and rounds to step', () => {
    expect(clampWpm(50)).toBe(100);
    expect(clampWpm(950)).toBe(800);
    expect(clampWpm(203)).toBe(200);
    expect(clampWpm(206)).toBe(210);
  });
});
