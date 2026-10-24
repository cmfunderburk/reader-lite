import { expect, test } from 'bun:test';
import { clampWpm } from './pacer';

test('clampWpm clamps to range and rounds to step', () => {
  expect(clampWpm(50)).toBe(100);
  expect(clampWpm(950)).toBe(800);
  expect(clampWpm(203)).toBe(200);
  expect(clampWpm(206)).toBe(210);
});
