// Wikipedia articles as books. Fetching follows Reader's wikipedia.ts: the
// featured-article feed for a UTC date gives the title, description and lead
// image; the Action API gives the plain-text extract. The extract becomes one
// chapter per top-level section (the lead is the first), with display maths
// kept as written and the reference sections dropped.

import { ASSET_SCHEME, codeBlock, guardMarkup } from '../epub/content';
import type { ParsedBook } from '../epub/parse';

/** What's stored for an article; enough to rebuild its chapters offline. */
export interface WikiArticle {
  title: string;
  url: string;
  description?: string;
  /** Plain-text extract with `== Section ==` headings, as the API returns it. */
  extract: string;
  /** The UTC date it was (or will be) the featured article, YYYY-MM-DD. */
  featuredOn: string;
  imageUrl?: string;
  fetchedAt: number;
}

export const LEAD_IMAGE_PATH = 'lead-image';

export class WikipediaError extends Error {}

const API = 'https://en.wikipedia.org';
const TIMEOUT_MS = 20_000;
const HEADING = /^(={2,6})\s*(.+?)\s*\1$/;
const TRAILING_SECTION = /^(see also|notes|references|citations|bibliography|further reading|external links|sources|footnotes)$/i;
const DISPLAY_MATH = /^\s*\{\\displaystyle\s*(.*)\}\s*$/;

export function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Remove `{\displaystyle …}` (with nested braces) left inside running text. */
function stripInlineTex(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{\\displaystyle', i);
    if (start < 0) break;
    out += text.slice(i, start);
    let depth = 0;
    let j = start;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    i = j + 1;
  }
  return out + text.slice(i);
}

function cleanParagraph(text: string): string {
  return stripInlineTex(text)
    .replace(/ /g, ' ')
    .replace(/\[\d+\]/g, '')
    .replace(/\[(?:note|nb|lower-alpha)\s*\d+\]/gi, '')
    .replace(/\[(?:citation needed|clarification needed|who\?|when\?|according to whom\?)\]/gi, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const captionText = (text: string) => text.replace(/\s+/g, ' ').replace(/\[/g, '(').replace(/\]/g, ')').trim();

const TEX_SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ',
  tau: 'τ', phi: 'φ', omega: 'ω', Delta: 'Δ', Gamma: 'Γ', Sigma: 'Σ', Omega: 'Ω', Pi: 'Π', cdot: '·', times: '×',
  leq: '≤', geq: '≥', le: '≤', ge: '≥', neq: '≠', approx: '≈', infty: '∞', pm: '±', to: '→', rightarrow: '→', in: '∈',
};
const SUPERSCRIPTS: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', n: 'ⁿ', '-': '⁻' };

/** Inline TeX made readable in running text: √2, x², a/b, π. Anything unusual stays as written. */
export function plainTex(tex: string): string {
  let text = tex.replace(/\\(?:displaystyle|textstyle)\s*/g, '');
  for (let i = 0; i < 4; i++) {
    text = text
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, (_, x: string) => (x.length === 1 ? `√${x}` : `√(${x})`))
      .replace(/\^\{([0-9n-]+)\}|\^([0-9n])/g, (_, a?: string, b?: string) => [...(a ?? b ?? '')].map((c) => SUPERSCRIPTS[c] ?? c).join(''))
      .replace(/\\(?:mathrm|mathbf|mathit|text|operatorname)\s*\{([^{}]*)\}/g, '$1')
      // Bare groups only; a command's argument waits for the command's own rule.
      .replace(/(?<!\\[A-Za-z]+\s*)\{([^{}]*)\}/g, '$1');
  }
  return text
    .replace(/\\([A-Za-z]+)/g, (whole, name: string) => TEX_SYMBOLS[name] ?? whole)
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

type Token = { kind: 'text'; text: string } | { kind: 'math'; tex: string } | { kind: 'heading'; level: number; text: string };

/**
 * The extract as lines of text, headings, and maths. Maths arrives as a run of
 * indented MathML tokens ending in `{\displaystyle …}`; only the TeX is kept.
 */
function tokenize(extract: string): Token[] {
  const tokens: Token[] = [];
  let tex: string | null = null; // inside a maths run
  const endMath = () => {
    if (tex) tokens.push({ kind: 'math', tex });
    tex = null;
  };
  for (const line of extract.replace(/\r/g, '').split('\n')) {
    if (/^\s/.test(line)) {
      tex = line.match(DISPLAY_MATH)?.[1] ?? tex ?? '';
      continue;
    }
    endMath();
    if (!line.trim()) continue;
    const heading = line.trim().match(HEADING);
    if (heading) tokens.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! });
    else tokens.push({ kind: 'text', text: line });
  }
  endMath();
  return tokens;
}

/**
 * Chapters from an extract: the lead, then one per `==` section, each opening
 * with its heading. Paragraphs are one per line. Maths between word joiners
 * (U+2060) is inline and rejoins its sentence; other maths is shown as TeX.
 */
export function articleChapters(article: WikiArticle, hasImage: boolean): ParsedBook['chapters'] {
  const chapters: { title: string; blocks: string[] }[] = [{ title: article.title, blocks: [`# ${article.title}`] }];
  if (hasImage) {
    chapters[0]!.blocks.push(`[FIGURE_URL:${ASSET_SCHEME}${LEAD_IMAGE_PATH}]`);
    chapters[0]!.blocks.push(`[FIGURE ${captionText(article.description ? `${article.title}: ${article.description}` : article.title)}]`);
  }
  let current = chapters[0]!;
  let paragraph: string | null = null; // text waiting in case inline maths continues it
  const flush = () => {
    const text = paragraph === null ? '' : cleanParagraph(paragraph.replace(/\u2060/g, ''));
    if (text) current.blocks.push(guardMarkup(text));
    paragraph = null;
  };

  const tokens = tokenize(article.extract);
  for (const [i, token] of tokens.entries()) {
    if (token.kind === 'math') {
      const next = tokens[i + 1];
      const inline = paragraph?.endsWith('\u2060') || (next?.kind === 'text' && next.text.startsWith('\u2060'));
      if (inline) {
        paragraph = `${paragraph ?? ''} ${plainTex(token.tex)}`;
      } else {
        flush();
        const block = codeBlock(token.tex);
        if (block) current.blocks.push(block);
      }
      continue;
    }
    if (token.kind === 'text') {
      const continues = paragraph !== null && (paragraph.endsWith('\u2060') || token.text.startsWith('\u2060')) && tokens[i - 1]?.kind === 'math';
      if (continues) paragraph += token.text;
      else {
        flush();
        paragraph = token.text;
      }
      continue;
    }
    flush();
    const text = cleanParagraph(token.text);
    if (!text) continue;
    if (TRAILING_SECTION.test(text)) break;
    if (token.level === 2) {
      current = { title: text, blocks: [`# ${text}`] };
      chapters.push(current);
    } else {
      current.blocks.push(`${'#'.repeat(Math.min(6, token.level - 1))} ${text}`);
    }
  }
  flush();

  const kept = chapters.filter((chapter, i) => i === 0 || chapter.blocks.length > 1);
  kept[kept.length - 1]!.blocks.push(
    guardMarkup(`From the Wikipedia article “${article.title}”, available under CC BY-SA 4.0: ${article.url}`),
  );
  return kept.map((chapter) => ({ title: chapter.title, content: chapter.blocks.join('\n\n') }));
}

async function getJson(url: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new WikipediaError("couldn't reach Wikipedia");
  }
  if (!response.ok) throw new WikipediaError(`Wikipedia answered ${response.status}`);
  return response.json();
}

/** The featured article for a UTC date (YYYY-MM-DD). */
export async function fetchFeatured(date: string): Promise<WikiArticle> {
  const feed = await getJson(`${API}/api/rest_v1/feed/featured/${date.replaceAll('-', '/')}`);
  const tfa = feed?.tfa;
  if (!tfa) throw new WikipediaError(`no featured article for ${date}`);
  const rawTitle: string = tfa.titles?.canonical ?? tfa.title;

  const params = new URLSearchParams({
    action: 'query',
    titles: rawTitle,
    prop: 'extracts|pageimages',
    explaintext: 'true',
    exsectionformat: 'wiki',
    piprop: 'thumbnail',
    pithumbsize: '960',
    redirects: '1',
    formatversion: '2',
    format: 'json',
    origin: '*',
  });
  const page = (await getJson(`${API}/w/api.php?${params}`))?.query?.pages?.[0];
  if (!page?.extract) throw new WikipediaError('the article had no text');

  return {
    title: (tfa.titles?.normalized ?? rawTitle).replace(/_/g, ' '),
    url: tfa.content_urls?.desktop?.page ?? `${API}/wiki/${encodeURIComponent(rawTitle)}`,
    description: tfa.description,
    extract: page.extract,
    featuredOn: date,
    imageUrl: tfa.thumbnail?.source ?? page.thumbnail?.source,
    fetchedAt: Date.now(),
  };
}

/** A featured article from a random day between 2021-01-01 and yesterday. */
export async function fetchRandomFeatured(random: () => number = Math.random): Promise<WikiArticle> {
  const start = Date.UTC(2021, 0, 1);
  const end = Date.now() - 86_400_000;
  let lastError: unknown;
  // Some days have no featured article payload; try a few.
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await fetchFeatured(utcDate(new Date(start + random() * (end - start))));
    } catch (err) {
      lastError = err;
      if (err instanceof WikipediaError && err.message === "couldn't reach Wikipedia") break;
    }
  }
  throw lastError instanceof Error ? lastError : new WikipediaError("couldn't find a featured article");
}

/** The lead image's bytes, or undefined if there's none or it can't be fetched. */
export async function fetchImage(url: string | undefined): Promise<{ bytes: Uint8Array<ArrayBuffer>; mediaType: string } | undefined> {
  if (!url) return undefined;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const mediaType = response.headers.get('Content-Type')?.split(';')[0] ?? '';
    if (!response.ok || !mediaType.startsWith('image/')) return undefined;
    return { bytes: new Uint8Array(await response.arrayBuffer()), mediaType };
  } catch {
    return undefined; // the article reads fine without it
  }
}
