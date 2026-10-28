import { describe, expect, test } from 'bun:test';
import { mathFromAlt, mathText } from './mathml';

const NS = 'http://www.w3.org/1998/Math/MathML';

function text(inner: string): string {
  return mathText(mathFromAlt(`<math xmlns="${NS}">${inner}</math>`)!);
}

describe('mathText', () => {
  test('reads identifiers, numbers and spaced operators', () => {
    expect(text('<mrow><mi>μ</mi></mrow>')).toBe('μ');
    expect(text('<mrow><mi>μ</mi><mo>=</mo><mn>1.07</mn></mrow>')).toBe('μ = 1.07');
    expect(text('<mrow><mn>1</mn><mo>−</mo><mi>s</mi></mrow>')).toBe('1 − s');
    // A leading or doubled operator is a sign.
    expect(text('<mrow><mo>−</mo><mn>1</mn><mo>=</mo><mo>−</mo><mi>x</mi></mrow>')).toBe('−1 = −x');
    expect(text('<mrow><mi>a</mi><mo>,</mo><mi>b</mi></mrow>')).toBe('a, b');
  });

  test('writes scripts TeX-style, compact inside', () => {
    expect(text('<msub><mi>Y</mi><mi>t</mi></msub>')).toBe('Y_t');
    expect(text('<msubsup><mi>C</mi><mi>i</mi><mi>S</mi></msubsup>')).toBe('C_i^S');
    expect(text('<msubsup><mrow><mi>M</mi><mi>A</mi></mrow><mi>i</mi><mrow><mi>o</mi><mi>u</mi><mi>t</mi></mrow></msubsup>')).toBe('MA_i^{out}');
    expect(text('<msub><mi>τ</mi><mrow><mi>t</mi><mo>+</mo><mn>1</mn></mrow></msub>')).toBe('τ_{t+1}');
    expect(text('<msup><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mn>2</mn></msup>')).toBe('(a + b)^2');
    // A factor after a script is set off from it.
    expect(text('<mrow><msub><mi>F</mi><mi>L</mi></msub><mi>L</mi></mrow>')).toBe('F_L L');
    expect(text('<mrow><msup><mi>μ</mi><mi>G</mi></msup><msup><mi>s</mi><mi>M</mi></msup></mrow>')).toBe('μ^G s^M');
    expect(text('<mrow><msup><mi>ε</mi><mi>S</mi></msup><mo>ln</mo><mi>L</mi></mrow>')).toBe('ε^S ln L');
    expect(text('<munderover><mo>∑</mo><mi>i</mi><mrow/></munderover>')).toBe('∑_i');
  });

  test('writes fractions with parentheses around compound parts', () => {
    expect(text('<mfrac><mi>W</mi><mi>P</mi></mfrac>')).toBe('W/P');
    expect(text('<mfrac><mrow><mi>W</mi><mi>L</mi></mrow><mrow><mi>P</mi><mi>Y</mi></mrow></mfrac>')).toBe('WL/PY');
    expect(text('<mfrac><mrow><mo>∂</mo><mo>ln</mo><mi>Y</mi></mrow><mrow><mo>∂</mo><mo>ln</mo><mi>L</mi></mrow></mfrac>')).toBe('(∂ln Y)/(∂ln L)');
    expect(text('<mrow><mi>μ</mi><mspace width="0.167em"/><mfrac><mi>W</mi><mi>P</mi></mfrac></mrow>')).toBe('μ W/P');
    expect(text('<mrow><mi>μ</mi><mfrac><mi>W</mi><mi>P</mi></mfrac><mi>Δ</mi><mi>l</mi></mrow>')).toBe('μ W/P Δl');
  });

  test('puts accents on their base as combining marks', () => {
    expect(text('<mover accent="true"><mi>β</mi><mo>ˆ</mo></mover>')).toBe('β̂');
    expect(text('<mover accent="true"><mi>I</mi><mo>̇</mo></mover>')).toBe('İ');
    // InDesign fences a barred letter with invisible BOMs.
    expect(text('<mover><mfenced open="﻿" close="﻿"><mi>H</mi></mfenced><mo>–</mo></mover>')).toBe('H̄');
  });

  test('keeps fences and text', () => {
    expect(text('<mrow><mi>μ</mi><mfenced><mrow><mn>1</mn><mo>−</mo><msub><mi>s</mi><mi>π</mi></msub></mrow></mfenced></mrow>')).toBe('μ(1 − s_π)');
    expect(text('<mfenced open="[" close="]"><mi>a</mi><mi>b</mi></mfenced>')).toBe('[a, b]');
    expect(text('<mfrac><mrow><mtext>Total </mtext><mi>c</mi><mtext>ost</mtext></mrow><mtext>Revenue</mtext></mfrac>')).toBe('(Total cost)/Revenue');
  });
});

describe('mathFromAlt', () => {
  test('only takes alt text that is MathML', () => {
    expect(mathFromAlt('A chart')).toBeUndefined();
    expect(mathFromAlt('<math><mi>x</mi>')).toBeUndefined();
    expect(mathFromAlt(`<math xmlns="${NS}"><mi>x</mi></math>`)).toBeDefined();
  });
});
