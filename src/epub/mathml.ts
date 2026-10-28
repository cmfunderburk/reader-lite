// MathML as one line of plain text, for the reader's monospaced line flow:
// scripts in TeX style (x_i, x^{2t}), fractions as a/b with parentheses
// around compound parts, accents as combining marks (β̂).
//
// Some EPUBs (InDesign exports, e.g. the AEA journals) carry no <math> at all:
// each formula is an image whose alt attribute holds the MathML source.

import { childElements, localName } from './xml';

const TEXT_NODE = 3;

/** Operators set off by spaces in running math (not in scripts). */
const SPACED_OPERATORS = new Set([
  '=', '≠', '≈', '≃', '≅', '≡', '∼', '∝', '<', '>', '≤', '≥', '≪', '≫', '⩽', '⩾',
  '→', '←', '↔', '⇒', '⇐', '⇔', '↦', '∈', '∉', '⊂', '⊆', '⊃', '⊇',
  '+', '−', '±', '∓', '×', '÷', '·', '⋅', '∗',
]);
const SEPARATORS = new Set([',', ';']);

/** Spacing accents (and dashes used as overbars) to the combining marks they stand for. */
const ACCENTS: Record<string, string> = {
  'ˆ': '̂', '^': '̂', '˜': '̃', '~': '̃', '¯': '̄', '‾': '̄',
  '–': '̄', '—': '̄', '−': '̄', '_': '̄', '˙': '̇', '¨': '̈',
  'ˇ': '̌', '´': '́', '`': '̀', '→': '⃗',
};
const COMBINING = /^[̀-ͯ⃐-⃿]$/;

// Zero-width characters: BOMs used as invisible fences, function application, invisible times.
const INVISIBLE = /[﻿​⁡-⁤]/g;
const FUNCTION_NAME = /^[A-Za-z]{2,}$/;
/** Text that needs parentheses to stay one operand: a space or an operator outside brackets. */
const COMPOUND = /[\s+\-−=,/±·×<>≤≥]/;

const SCRIPTED = new Set(['msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover']);

interface Token {
  text: string;
  kind: 'atom' | 'operator' | 'separator' | 'function';
  /** Ends in a script or is a fraction: set off from the next factor (F_L L, a/b c). */
  open?: boolean;
  fraction?: boolean;
}

/** The MathML in an image's alt text, or undefined if the alt isn't MathML. */
export function mathFromAlt(alt: string): Element | undefined {
  if (!/^\s*<math[\s>]/.test(alt)) return undefined;
  const doc = new DOMParser().parseFromString(alt, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return undefined;
  const root = doc.documentElement;
  return root && localName(root) === 'math' ? root : undefined;
}

export function mathText(math: Element): string {
  return render(math, 0).replace(/\s+/g, ' ').trim();
}

function render(el: Element, level: number): string {
  const kids = childElements(el);
  const arg = (i: number, at = level) => (kids[i] ? render(kids[i]!, at) : '');
  switch (localName(el)) {
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
    case 'ms':
      return leafText(el);
    case 'mspace':
      return Number.parseFloat(el.getAttribute('width') ?? '') >= 0.15 ? ' ' : '';
    case 'mphantom':
    case 'annotation':
    case 'annotation-xml':
    case 'none':
    case 'mprescripts':
      return '';
    case 'semantics':
      return arg(0);
    case 'mfrac':
      return `${group(arg(0))}/${group(arg(1))}`;
    case 'msqrt':
      return `√${group(row(kids, level))}`;
    case 'mroot':
      return `${script(arg(1, level + 1))}√${group(arg(0))}`;
    case 'msub':
    case 'munder':
      return group(arg(0)) + scripts(arg(1, level + 1), '');
    case 'msup':
      return group(arg(0)) + scripts('', arg(1, level + 1));
    case 'msubsup':
    case 'munderover':
      return group(arg(0)) + scripts(arg(1, level + 1), arg(2, level + 1));
    case 'mover': {
      const over = arg(1, level + 1).trim();
      const mark = ACCENTS[over] ?? (COMBINING.test(over) ? over : undefined);
      return mark ? group(arg(0)) + mark : group(arg(0)) + scripts('', over);
    }
    case 'mfenced': {
      const open = (el.getAttribute('open') ?? '(').replace(INVISIBLE, '');
      const close = (el.getAttribute('close') ?? ')').replace(INVISIBLE, '');
      const separator = (el.getAttribute('separators') ?? ',').trim().charAt(0);
      const items = kids.map((kid) => render(kid, level).trim());
      return open + items.join(level === 0 && separator ? `${separator} ` : separator) + close;
    }
    case 'mtable':
      return kids.map((tr) => childElements(tr).map((td) => render(td, level).trim()).join(' ')).join('; ');
    default:
      return row(kids, level);
  }
}

function leafText(el: Element): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) if (node.nodeType === TEXT_NODE) text += node.nodeValue ?? '';
  return text.replace(INVISIBLE, '');
}

/** A row's children joined, with spaces around operators in running math. */
function row(kids: Element[], level: number): string {
  const tokens = kids.map((kid): Token => {
    const text = render(kid, level);
    const name = localName(kid);
    const trimmed = text.trim();
    if ((name === 'mo' || name === 'mi') && FUNCTION_NAME.test(trimmed)) return { text: trimmed, kind: 'function' };
    if (name !== 'mo') {
      return { text, kind: 'atom', open: name === 'mfrac' || (SCRIPTED.has(name) && /[_^]/.test(text)), fraction: name === 'mfrac' };
    }
    if (SEPARATORS.has(trimmed)) return { text: trimmed, kind: 'separator' };
    return { text: trimmed, kind: SPACED_OPERATORS.has(trimmed) ? 'operator' : 'atom' };
  });

  let out = '';
  tokens.forEach((token, i) => {
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (level > 0) {
      out += token.text;
    } else if (token.kind === 'operator') {
      // A leading or doubled operator is a sign (−1, = −x): no space after it.
      const prefix = !prev || prev.kind === 'operator' || prev.kind === 'separator';
      out += prefix ? token.text : ` ${token.text} `;
    } else if (token.kind === 'separator') {
      out += `${token.text} `;
    } else if (token.kind === 'function') {
      out += (prev?.open ? ' ' : '') + (next && /^[\p{L}\p{N}]/u.test(next.text) ? `${token.text} ` : token.text);
    } else {
      // A factor after a script or a fraction, or a fraction after a factor, gets a space.
      const factor = prev?.kind === 'atom' && /^[\p{L}\p{N}(]/u.test(token.text);
      out += factor && (prev.open || (token.fraction && /[\p{L}\p{N})]$/u.test(prev.text))) ? ` ${token.text}` : token.text;
    }
  });
  return out;
}

function group(text: string): string {
  const trimmed = text.trim();
  return COMPOUND.test(trimmed) && !isBracketed(trimmed) ? `(${trimmed})` : trimmed;
}

/** _sub^sup, leaving out an empty script. */
function scripts(sub: string, sup: string): string {
  return (sub.trim() ? `_${script(sub)}` : '') + (sup.trim() ? `^${script(sup)}` : '');
}

/** A script's text, in braces when it's more than one character. */
function script(text: string): string {
  const trimmed = text.trim();
  return [...trimmed].length > 1 && !isBracketed(trimmed) ? `{${trimmed}}` : trimmed;
}

/** Text wrapped in one pair of matching brackets, e.g. (a + b) but not (a)(b). */
function isBracketed(text: string): boolean {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '|': '|', '⟨': '⟩' };
  const close = pairs[text[0] ?? ''];
  if (!close || !text.endsWith(close) || text.length < 2) return false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === text[0] && (close !== text[0] || i === 0)) depth++;
    else if (text[i] === close) depth--;
    if (depth === 0 && i < text.length - 1) return false;
  }
  return true;
}
