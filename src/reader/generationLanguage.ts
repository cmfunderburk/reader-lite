// Copied from Reader@f2d4f14 (src/lib/generationLanguage.ts).
export const GERMAN_CHAR_REGEX = /[ÄÖÜäöüß]/;

export const GERMAN_CONTEXT_CUES: ReadonlySet<string> = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des',
  'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'und', 'nicht', 'mit', 'fuer', 'fur',
  'ich', 'wir', 'sie', 'ist', 'sind', 'dass',
  'vom', 'zum', 'zur', 'im', 'am',
]);

export const NAME_PREFIXES: ReadonlySet<string> = new Set([
  'von', 'van', 'de', 'del', 'da', 'di', 'du', 'la', 'le',
]);

export const NAME_TITLES: ReadonlySet<string> = new Set([
  'dr', 'prof', 'herr', 'frau',
]);

export const GERMAN_DETERMINERS: ReadonlySet<string> = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des',
  'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
]);
