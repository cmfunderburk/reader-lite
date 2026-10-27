// Copied from Reader@f2d4f14 (src/lib/generationMask.ts).
export type GenerationDifficulty = 'normal' | 'hard' | 'recall';
import { FUNCTION_WORDS } from './tokenizer';
import {
  GERMAN_CHAR_REGEX,
  GERMAN_CONTEXT_CUES,
  GERMAN_DETERMINERS,
  NAME_PREFIXES,
  NAME_TITLES,
} from './generationLanguage';
import {
  type TokenInfo,
  type CoreParts,
  HYPHEN_SEPARATOR_REGEX,
  HYPHEN_SPLIT_REGEX,
  LETTER_REGEX,
  LETTER_OR_DIGIT_REGEX,
  hashToUnitInterval,
  splitCoreParts,
  extractTokens,
  isAcronym,
  normalizeAlpha,
  isSimpleTitleCase,
  isInternalCapWord,
  isLikelyTitleCaseLine,
} from './generationTokens';

interface MaskProfile {
  strategy: 'ratio' | 'first-last';
  maxMaskRatio: number;
}

interface MaskContext {
  tokenIndex: number;
  partsByTokenIndex: Map<number, CoreParts>;
  titleCaseLine: boolean;
  likelyGermanLine: boolean;
}

const DIFFICULTY_PROFILES: Record<GenerationDifficulty, MaskProfile> = {
  normal: { strategy: 'ratio', maxMaskRatio: 0.25 },
  hard: { strategy: 'ratio', maxMaskRatio: 0.4 },
  recall: { strategy: 'first-last', maxMaskRatio: 1 },
};

function isNameLikeTitleWord(core: string): boolean {
  if (!isSimpleTitleCase(core)) return false;
  const alphaOnly = normalizeAlpha(core);
  if (alphaOnly.length < 3) return false;
  if (FUNCTION_WORDS.has(alphaOnly)) return false;
  if (GERMAN_CONTEXT_CUES.has(alphaOnly)) return false;
  return true;
}

function hasAdjacentNameLikeTitleWord(tokenIndex: number, partsByTokenIndex: Map<number, CoreParts>): boolean {
  const prev = partsByTokenIndex.get(tokenIndex - 1);
  if (prev && isNameLikeTitleWord(prev.core)) return true;
  const next = partsByTokenIndex.get(tokenIndex + 1);
  if (next && isNameLikeTitleWord(next.core)) return true;
  return false;
}

function hasNameLikeWordAcrossPrefix(tokenIndex: number, partsByTokenIndex: Map<number, CoreParts>): boolean {
  const prev = partsByTokenIndex.get(tokenIndex - 1);
  const prevPrev = partsByTokenIndex.get(tokenIndex - 2);
  if (prev && prevPrev) {
    const prevAlpha = normalizeAlpha(prev.core);
    if (NAME_PREFIXES.has(prevAlpha) && isNameLikeTitleWord(prevPrev.core)) {
      return true;
    }
  }

  const next = partsByTokenIndex.get(tokenIndex + 1);
  const nextNext = partsByTokenIndex.get(tokenIndex + 2);
  if (next && nextNext) {
    const nextAlpha = normalizeAlpha(next.core);
    const before = partsByTokenIndex.get(tokenIndex - 1);
    const beforeAlpha = before ? normalizeAlpha(before.core) : '';
    const precededByDeterminer = GERMAN_DETERMINERS.has(beforeAlpha);

    if (!precededByDeterminer && NAME_PREFIXES.has(nextAlpha) && isNameLikeTitleWord(nextNext.core)) {
      return true;
    }
  }

  return false;
}

function hasHonorificBefore(tokenIndex: number, partsByTokenIndex: Map<number, CoreParts>): boolean {
  const prev = partsByTokenIndex.get(tokenIndex - 1);
  if (!prev) return false;
  const prevAlpha = normalizeAlpha(prev.core);
  return NAME_TITLES.has(prevAlpha);
}

function isLikelyGermanLine(tokens: TokenInfo[], partsByTokenIndex: Map<number, CoreParts>): boolean {
  let alphaTokenCount = 0;
  let germanCueCount = 0;
  let hasGermanChar = false;

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const parts = partsByTokenIndex.get(tokenIndex);
    if (!parts) continue;
    const alphaOnly = normalizeAlpha(parts.core);
    if (alphaOnly.length === 0) continue;

    alphaTokenCount += 1;
    if (GERMAN_CONTEXT_CUES.has(alphaOnly)) {
      germanCueCount += 1;
    }
    if (!hasGermanChar && GERMAN_CHAR_REGEX.test(parts.core)) {
      hasGermanChar = true;
    }
  }

  if (alphaTokenCount < 3) return false;
  if (germanCueCount >= 2) return true;
  return hasGermanChar && germanCueCount >= 1;
}

function isProperNoun(core: string, sentenceInitial: boolean, context: MaskContext): boolean {
  if (isInternalCapWord(core)) return true;
  if (sentenceInitial) return false;
  if (!isSimpleTitleCase(core)) return false;

  if (context.likelyGermanLine) {
    if (hasHonorificBefore(context.tokenIndex, context.partsByTokenIndex)) {
      return true;
    }
    return hasAdjacentNameLikeTitleWord(context.tokenIndex, context.partsByTokenIndex)
      || hasNameLikeWordAcrossPrefix(context.tokenIndex, context.partsByTokenIndex);
  }

  if (!context.titleCaseLine) {
    return true;
  }

  // In heading/title-case lines, only preserve likely multi-word names.
  return hasAdjacentNameLikeTitleWord(context.tokenIndex, context.partsByTokenIndex);
}

function isMaskEligible(core: string, sentenceInitial: boolean, context: MaskContext): boolean {
  if (/\d/.test(core)) return false;
  if (isAcronym(core)) return false;
  if (isProperNoun(core, sentenceInitial, context)) return false;

  const alphaOnly = normalizeAlpha(core);
  if (alphaOnly.length === 0) return false;
  if (FUNCTION_WORDS.has(alphaOnly)) return false;

  return true;
}

function maskSingleCoreWord(core: string, maxMaskRatio: number, seed: string): string {
  const letters: number[] = [];
  for (let i = 0; i < core.length; i++) {
    if (LETTER_REGEX.test(core[i]!)) letters.push(i);
  }
  if (letters.length <= 1) return core;

  const first = letters[0];
  const last = letters[letters.length - 1];
  const maskCandidates = letters.filter((idx) => idx !== first && idx !== last);
  if (maskCandidates.length === 0) return core;

  const maxMaskCount = Math.max(1, Math.floor(letters.length * maxMaskRatio));
  const maskCount = Math.min(maskCandidates.length, maxMaskCount);
  if (maskCount <= 0) return core;

  const maskSet = selectNonConsecutiveIndices(maskCandidates, maskCount, seed);
  if (maskSet.size === 0) return core;

  const chars = core.split(''); // code units, as `letters` indexes them
  for (const letterIndex of letters) {
    if (!maskSet.has(letterIndex)) continue;
    chars[letterIndex] = '_';
  }

  return chars.join('');
}

function maskCoreWord(core: string, maxMaskRatio: number, seed: string): string {
  if (!HYPHEN_SEPARATOR_REGEX.test(core)) {
    return maskSingleCoreWord(core, maxMaskRatio, seed);
  }

  const segments = core.split(HYPHEN_SPLIT_REGEX);
  return segments
    .map((segment, segmentIndex) => {
      if (segmentIndex % 2 === 1) return segment;
      return maskSingleCoreWord(segment, maxMaskRatio, `${seed}|seg:${segmentIndex}`);
    })
    .join('');
}

function maskSingleCoreWordToFirstLast(core: string): string {
  const letters: number[] = [];
  for (let i = 0; i < core.length; i++) {
    if (LETTER_REGEX.test(core[i]!)) letters.push(i);
  }
  if (letters.length <= 2) return core;

  const first = letters[0];
  const last = letters[letters.length - 1];
  const chars = core.split(''); // code units, as `letters` indexes them

  for (const letterIndex of letters) {
    if (letterIndex === first || letterIndex === last) continue;
    chars[letterIndex] = '_';
  }

  return chars.join('');
}

function maskCoreWordToFirstLast(core: string): string {
  if (!HYPHEN_SEPARATOR_REGEX.test(core)) {
    return maskSingleCoreWordToFirstLast(core);
  }

  const segments = core.split(HYPHEN_SPLIT_REGEX);
  return segments
    .map((segment, segmentIndex) => {
      if (segmentIndex % 2 === 1) return segment;
      return maskSingleCoreWordToFirstLast(segment);
    })
    .join('');
}

function maskCoreWordByProfile(core: string, profile: MaskProfile, seed: string): string {
  if (profile.strategy === 'first-last') {
    return maskCoreWordToFirstLast(core);
  }
  return maskCoreWord(core, profile.maxMaskRatio, seed);
}

function selectNonConsecutiveIndices(candidates: number[], desiredCount: number, seed: string): Set<number> {
  if (candidates.length === 0 || desiredCount <= 0) return new Set();

  const sorted = [...candidates].sort((a, b) => a - b);
  const scores = sorted.map((idx) => hashToUnitInterval(`${seed}|${idx}`));
  const n = sorted.length;
  const memo = new Map<string, number>();

  const getCost = (index: number, remaining: number, prevSelected: boolean): number => {
    if (remaining === 0) return 0;
    if (index >= n) return Number.POSITIVE_INFINITY;

    const key = `${index}|${remaining}|${prevSelected ? 1 : 0}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const skipCost = getCost(index + 1, remaining, false);
    let takeCost = Number.POSITIVE_INFINITY;
    const prevAdjacent = prevSelected && index > 0 && (sorted[index]! - sorted[index - 1]! === 1);
    if (!prevAdjacent) {
      const tailCost = getCost(index + 1, remaining - 1, true);
      if (Number.isFinite(tailCost)) {
        takeCost = scores[index]! + tailCost;
      }
    }

    const best = Math.min(skipCost, takeCost);
    memo.set(key, best);
    return best;
  };

  let target = Math.min(desiredCount, n);
  while (target > 0 && !Number.isFinite(getCost(0, target, false))) {
    target -= 1;
  }
  if (target === 0) return new Set();

  const selected = new Set<number>();
  const rebuild = (index: number, remaining: number, prevSelected: boolean): void => {
    if (remaining === 0 || index >= n) return;

    const current = getCost(index, remaining, prevSelected);
    const skipCost = getCost(index + 1, remaining, false);
    const prevAdjacent = prevSelected && index > 0 && (sorted[index]! - sorted[index - 1]! === 1);
    let takeCost = Number.POSITIVE_INFINITY;
    if (!prevAdjacent) {
      const tailCost = getCost(index + 1, remaining - 1, true);
      if (Number.isFinite(tailCost)) {
        takeCost = scores[index]! + tailCost;
      }
    }

    if (Number.isFinite(takeCost) && Math.abs(current - takeCost) <= 1e-12) {
      selected.add(sorted[index]!);
      rebuild(index + 1, remaining - 1, true);
      return;
    }
    if (Number.isFinite(skipCost)) {
      rebuild(index + 1, remaining, false);
    }
  };

  rebuild(0, target, false);
  return selected;
}

export function maskGenerationLine(
  lineText: string,
  difficulty: GenerationDifficulty,
  seed: number,
  lineIndex: number
): string {
  if (!lineText.trim()) return lineText;

  const profile = DIFFICULTY_PROFILES[difficulty];
  const tokens = extractTokens(lineText);
  if (tokens.length === 0) return lineText;

  const partsByTokenIndex = new Map<number, CoreParts>();

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex]!;
    const parts = splitCoreParts(token.raw);
    if (!parts) continue;
    partsByTokenIndex.set(tokenIndex, parts);
  }
  const titleCaseLine = isLikelyTitleCaseLine(tokens, partsByTokenIndex);
  const likelyGermanLine = isLikelyGermanLine(tokens, partsByTokenIndex);

  let cursor = 0;
  let result = '';

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex]!;
    result += lineText.slice(cursor, token.start);

    const parts = partsByTokenIndex.get(tokenIndex);
    if (!parts) {
      result += token.raw;
      cursor = token.end;
      continue;
    }

    const maskEligible = difficulty === 'recall'
      ? LETTER_OR_DIGIT_REGEX.test(parts.core) && normalizeAlpha(parts.core).length > 0
      : isMaskEligible(parts.core, token.sentenceInitial, {
        tokenIndex,
        partsByTokenIndex,
        titleCaseLine,
        likelyGermanLine,
      });

    if (!maskEligible) {
      result += token.raw;
      cursor = token.end;
      continue;
    }

    const maskedCore = maskCoreWordByProfile(
      parts.core,
      profile,
      `${seed}|${lineIndex}|${tokenIndex}|${parts.core}`
    );
    result += `${parts.leading}${maskedCore}${parts.trailing}`;
    cursor = token.end;
  }

  result += lineText.slice(cursor);
  return result;
}

// reader-lite addition: masking for code lines. Keywords stay so the
// structure reads; identifiers (and words in strings and comments) are
// masked like prose words, each snake_case part on its own.
const CODE_KEYWORDS: ReadonlySet<string> = new Set(
  (
    // Python
    'and as assert async await break class continue def del elif else except finally for from global if import in is ' +
    'lambda nonlocal not or pass raise return try while with yield none true false self cls print len range ' +
    // Rust, C, C++, Go
    'fn let mut pub struct enum impl trait use mod crate super where match loop ref move const static unsafe extern ' +
    'type dyn box vec some ok err option result string str usize isize u8 u16 u32 u64 i8 i16 i32 i64 f32 f64 bool char ' +
    'int long short float double void unsigned signed sizeof typedef switch case default goto do auto register volatile ' +
    'include define ifdef ifndef endif struct union namespace template typename public private protected virtual ' +
    'new delete this nullptr func go chan defer select package interface map make nil ' +
    // JavaScript, TypeScript
    'var function export extends instanceof typeof undefined null void throw catch of yield async implements readonly ' +
    // SQL
    'select from where group by order having limit offset join inner outer left right full on union all distinct ' +
    'insert into values update set delete create table drop alter index view with recursive case when then end ' +
    'null not like between exists asc desc count sum avg min max cast primary key foreign references ' +
    // Lisp, shell
    'define lambda let quote cond begin car cdr cons list echo fi then esac done'
  ).split(' '),
);

export function maskCodeLine(lineText: string, difficulty: GenerationDifficulty, seed: number, lineIndex: number): string {
  const profile = DIFFICULTY_PROFILES[difficulty];
  return lineText.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (word, offset: number) => {
    if (CODE_KEYWORDS.has(word.toLowerCase())) return word;
    return word
      .split(/(_+)/)
      .map((part, i) => {
        if (i % 2 === 1 || part.length < 3 || /^\d+$/.test(part)) return part;
        return maskCoreWordByProfile(part, profile, `${seed}|${lineIndex}|${offset}|${i}|${part}`);
      })
      .join('');
  });
}
