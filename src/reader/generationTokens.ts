// Copied from Reader@f2d4f14 (src/lib/generationTokens.ts).
export interface TokenInfo {
  raw: string;
  start: number;
  end: number;
  sentenceInitial: boolean;
}

export interface CoreParts {
  leading: string;
  core: string;
  trailing: string;
}

export const HYPHEN_SEPARATOR_REGEX = /[-\u2010\u2011\u2012\u2013\u2014]/;
export const HYPHEN_SPLIT_REGEX = /([-\u2010\u2011\u2012\u2013\u2014]+)/;
export const LETTER_REGEX = /\p{L}/u;
export const LETTER_OR_DIGIT_REGEX = /[\p{L}\p{N}]/u;

export function hashToUnitInterval(input: string): number {
  // FNV-1a 32-bit hash
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) & 0xffffffff) / 0x100000000;
}

export function splitCoreParts(token: string): CoreParts | null {
  const match = token.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}''-]*)([^\p{L}\p{N}]*)$/u);
  if (!match) return null;
  return {
    leading: match[1]!,
    core: match[2]!,
    trailing: match[3]!,
  };
}

function isSentenceBoundaryToken(token: string): boolean {
  return /[.!?]["')\]]*$/.test(token);
}

export function extractTokens(lineText: string): TokenInfo[] {
  const regex = /\S+/g;
  const tokens: TokenInfo[] = [];
  let match;
  let sentenceInitial = true;

  while ((match = regex.exec(lineText)) !== null) {
    const raw = match[0];
    tokens.push({
      raw,
      start: match.index,
      end: match.index + raw.length,
      sentenceInitial,
    });
    sentenceInitial = isSentenceBoundaryToken(raw);
  }

  return tokens;
}

export function isAcronym(core: string): boolean {
  const normalized = core.replace(/[^\p{L}]/gu, '');
  return /^\p{Lu}{2,}$/u.test(normalized);
}

export function normalizeAlpha(core: string): string {
  return core
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}]/gu, '');
}

export function isSimpleTitleCase(core: string): boolean {
  return /^\p{Lu}\p{Ll}+(?:[''-]\p{Lu}?\p{Ll}+)*$/u.test(core);
}

export function isInternalCapWord(core: string): boolean {
  return /^\p{Lu}\p{Ll}+(?:\p{Lu}\p{Ll}+)+$/u.test(core);
}

export function isLikelyTitleCaseLine(tokens: TokenInfo[], partsByTokenIndex: Map<number, CoreParts>): boolean {
  let alphaTokenCount = 0;
  let titleCaseCount = 0;

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const parts = partsByTokenIndex.get(tokenIndex);
    if (!parts) continue;
    const alphaOnly = normalizeAlpha(parts.core);
    if (alphaOnly.length === 0) continue;

    alphaTokenCount += 1;
    if (isSimpleTitleCase(parts.core) || isInternalCapWord(parts.core) || isAcronym(parts.core)) {
      titleCaseCount += 1;
    }
  }

  if (alphaTokenCount < 3) return false;
  return (titleCaseCount / alphaTokenCount) >= 0.65;
}
