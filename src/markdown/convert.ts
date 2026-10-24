// Converts Markdown into the reader's content format (see epub/content.ts).
// Covers what study notes and guides use: CommonMark blocks (headings,
// paragraphs, fenced code, lists, block quotes, rules), pipe tables, and
// Obsidian's callouts (`> [!type]- Title`), [[wikilinks]] and ![[embeds]].
// Inline formatting is flattened to plain text, as for EPUBs.

import {
  ASSET_SCHEME,
  CALLOUT_END,
  CALLOUT_START,
  LIST_MARKER,
  codeBlock,
  guardMarkup,
  tableBlock,
} from '../epub/content';

export interface MarkdownContext {
  /** An image reference (relative path or embed name) to an archive path, if it's in the import. */
  resolveImage: (src: string) => string | undefined;
  /** A wikilink target (file name without extension) to that file's title, if it's in the import. */
  linkTitle: (target: string) => string | undefined;
}

export interface ConvertedMarkdown {
  /** Front matter `title`, else the first `#` heading. */
  title?: string;
  content: string;
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/;
const FENCE = /^(\s*)(`{3,}|~{3,})/;
const CALLOUT_HEADER = /^\[!([\w-]+)\]([-+]?)\s*(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const IMAGE_ONLY = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)$/;
const EMBED_ONLY = /^!\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…' };
const BULLETS = ['•', '◦', '▪'];

/** Front matter's `title`, and the text after the front matter. */
export function splitFrontMatter(source: string): { title?: string; body: string } {
  const match = source.match(/^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/);
  if (!match) return { body: source };
  const title = match[1]!.match(/^title:\s*(.+?)\s*$/m)?.[1]?.replace(/^(["'])(.*)\1$/, '$2');
  return { title: title || undefined, body: source.slice(match[0].length) };
}

/** A file's title without converting it: front matter title, else its first `#` heading. */
export function markdownTitle(source: string): string | undefined {
  const { title, body } = splitFrontMatter(source.replace(/\r\n?/g, '\n'));
  if (title) return title;
  let inFence = false;
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    const heading = !inFence && line.match(/^ {0,3}#\s+(.*?)(?:\s+#+)?\s*$/);
    if (heading) return flattenInline(heading[1]!, { resolveImage: () => undefined, linkTitle: () => undefined });
  }
  return undefined;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Inline Markdown to plain text: code spans kept verbatim, links to their text, emphasis dropped. */
export function flattenInline(text: string, context: MarkdownContext): string {
  const kept: string[] = [];
  const keep = (value: string) => `\u0000${kept.push(value) - 1}\u0000`;

  let out = text
    .replace(/(`+)(.+?)\1(?!`)/g, (_, _ticks, code: string) => keep(code.trim()))
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~=$<])/g, (_, char: string) => keep(char))
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g, (_, target: string, heading?: string, alias?: string) => {
      if (alias) return alias;
      const title = target ? (context.linkTitle(target.trim()) ?? target.trim()) : '';
      return [title, heading?.trim()].filter(Boolean).join(' › ');
    })
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/(\*\*|__)(?=\S)(.*?\S)\1/g, '$2')
    .replace(/\*(?=\S)(.*?\S)\*/g, '$1')
    .replace(/(^|\W)_(?=\S)(.*?\S)_(?=\W|$)/g, '$1$2')
    .replace(/~~(?=\S)(.*?\S)~~/g, '$1')
    .replace(/==(?=\S)(.*?\S)==/g, '$1')
    .replace(/\s\^[\w-]+$/, '');
  out = decodeEntities(out).replace(/\u0000(\d+)\u0000/g, (_, index: string) => kept[Number(index)]!);
  return out.replace(/\s+/g, ' ').trim();
}

function splitRow(line: string): string[] {
  const cells = line.replace(/\\\|/g, '\u0001').trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  return cells.map((cell) => cell.replace(/\u0001/g, '|'));
}

function indentWidth(line: string): number {
  return line.length - line.trimStart().length;
}

class BlockParser {
  readonly blocks: string[] = [];
  title?: string;

  constructor(private readonly context: MarkdownContext) {}

  private inline(text: string): string {
    return flattenInline(text, this.context);
  }

  parse(lines: string[]): void {
    let paragraph: string[] = [];
    const flush = () => {
      if (paragraph.length > 0) this.paragraph(paragraph);
      paragraph = [];
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!;
      const trimmed = line.trim();

      if (!trimmed) {
        flush();
        i++;
        continue;
      }

      const fence = line.match(FENCE);
      if (fence) {
        flush();
        const indent = fence[1]!.length;
        const marker = fence[2]!;
        const closing = new RegExp(`^\\s*${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
        const code: string[] = [];
        for (i++; i < lines.length && !closing.test(lines[i]!); i++) {
          code.push(lines[i]!.replace(new RegExp(`^ {0,${indent}}`), ''));
        }
        i++;
        this.push(codeBlock(code.join('\n')));
        continue;
      }

      if (trimmed.startsWith('$$')) {
        // Display math has no rendering here; it reads best kept as written.
        flush();
        const math = [trimmed];
        if (!(trimmed.length > 2 && trimmed.endsWith('$$'))) {
          for (i++; i < lines.length; i++) {
            math.push(lines[i]!.trim());
            if (lines[i]!.trim().endsWith('$$')) break;
          }
        }
        i++;
        this.push(codeBlock(math.join('\n')));
        continue;
      }

      const heading = line.match(/^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/);
      if (heading) {
        flush();
        const text = this.inline(heading[2]!);
        if (heading[1]!.length === 1) this.title ??= text;
        if (text) this.blocks.push(`${heading[1]} ${text}`);
        i++;
        continue;
      }

      if (paragraph.length > 0 && /^ {0,3}(=+|-+)\s*$/.test(line)) {
        // Setext heading: the paragraph so far is its text.
        const level = trimmed[0] === '=' ? 1 : 2;
        const text = this.inline(paragraph.join(' '));
        paragraph = [];
        if (level === 1) this.title ??= text;
        this.blocks.push(`${'#'.repeat(level)} ${text}`);
        i++;
        continue;
      }

      if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flush();
        this.blocks.push('* * *');
        i++;
        continue;
      }

      if (/^ {0,3}>/.test(line)) {
        flush();
        const quote: string[] = [];
        for (; i < lines.length && /^ {0,3}>/.test(lines[i]!); i++) quote.push(lines[i]!.replace(/^ {0,3}> ?/, ''));
        this.quote(quote);
        continue;
      }

      if (trimmed.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]!) && lines[i + 1]!.includes('-')) {
        flush();
        const rows = [splitRow(line)];
        for (i += 2; i < lines.length && lines[i]!.trim() && lines[i]!.includes('|'); i++) rows.push(splitRow(lines[i]!));
        this.push(tableBlock(1, rows.map((row) => row.map((cell) => this.inline(cell)))));
        continue;
      }

      if (LIST_ITEM.test(line)) {
        flush();
        i = this.list(lines, i);
        continue;
      }

      if (/^ {0,3}<!--/.test(line)) {
        flush();
        while (i < lines.length && !lines[i]!.includes('-->')) i++;
        i++;
        continue;
      }

      paragraph.push(trimmed);
      i++;
    }
    flush();
  }

  private push(block: string | undefined): void {
    if (block) this.blocks.push(block);
  }

  private paragraph(lines: string[]): void {
    // A paragraph of nothing but images is a run of figures.
    if (lines.every((line) => IMAGE_ONLY.test(line) || EMBED_ONLY.test(line))) {
      for (const line of lines) {
        const image = line.match(IMAGE_ONLY);
        const src = image ? image[2]! : line.match(EMBED_ONLY)![1]!.trim();
        const alt = image ? this.inline(image[1]!) : '';
        const path = this.context.resolveImage(src);
        if (path) {
          this.blocks.push(`[FIGURE_URL:${ASSET_SCHEME}${path}]`);
          if (alt) this.blocks.push(`[FIGURE ${alt.replace(/\[/g, '(').replace(/\]/g, ')')}]`);
        } else if (alt) {
          this.blocks.push(guardMarkup(alt));
        }
      }
      return;
    }

    const footnote = lines[0]!.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (footnote) {
      lines = [`(${footnote[1]}) ${footnote[2]}`, ...lines.slice(1)];
    }
    const text = this.inline(lines.join(' '));
    if (text) this.blocks.push(guardMarkup(text));
  }

  private quote(lines: string[]): void {
    const header = lines[0]?.trim().match(CALLOUT_HEADER);
    const type = header ? header[1]!.toLowerCase() : 'quote';
    const fold = header ? header[2] || '.' : '.';
    const title = header ? this.inline(header[3]!) || type[0]!.toUpperCase() + type.slice(1) : '';
    this.blocks.push(`${CALLOUT_START}${type} ${fold}]${title}`);
    this.parse(header ? lines.slice(1) : lines);
    this.blocks.push(CALLOUT_END);
  }

  /** A list, one item per line with its nesting shown by indent and bullet. Returns the next line's index. */
  private list(lines: string[], start: number): number {
    const items: string[] = [];
    const indents: number[] = [];
    let current: { level: number; bullet: string; text: string[] } | undefined;
    let topOrdered = false;
    const finish = () => {
      if (!current) return;
      const text = this.inline(current.text.join(' '));
      items.push(`${'  '.repeat(current.level)}${current.bullet} ${text}`);
      current = undefined;
    };

    let i = start;
    while (i < lines.length) {
      const line = lines[i]!;
      const item = line.match(LIST_ITEM);
      if (item && !FENCE.test(line)) {
        const indent = item[1]!.length;
        // Switching between bullets and numbers at the top level starts a new list.
        const ordered = /\d/.test(item[2]!);
        if (i > start && indent <= (indents[0] ?? 0) && ordered !== topOrdered) break;
        if (i === start) topOrdered = ordered;
        finish();
        while (indents.length > 0 && indents[indents.length - 1]! > indent) indents.pop();
        if (indents.length === 0 || indent > indents[indents.length - 1]!) indents.push(indent);
        const level = indents.length - 1;
        let text = item[3] ?? '';
        let bullet = /\d/.test(item[2]!) ? item[2]! : BULLETS[Math.min(level, BULLETS.length - 1)]!;
        const task = text.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          bullet = task[1] === ' ' ? '☐' : '☑';
          text = task[2]!;
        }
        current = { level, bullet, text: [text] };
        i++;
        continue;
      }
      if (!line.trim()) {
        // A blank line continues the list only if more of it follows.
        let next = i + 1;
        while (next < lines.length && !lines[next]!.trim()) next++;
        const following = lines[next];
        if (following === undefined || FENCE.test(following) || !(LIST_ITEM.test(following) || indentWidth(following) >= 2)) break;
        i = next;
        continue;
      }
      // A fence or a block quote ends the list; the list resumes as a new one after it.
      if (FENCE.test(line) || /^ {0,3}>/.test(line.trimStart())) break;
      if (!current) break;
      current.text.push(line.trim());
      i++;
    }
    finish();
    if (items.length > 0) this.blocks.push([LIST_MARKER, ...items].join('\n'));
    return i;
  }
}

export function convertMarkdown(source: string, context: MarkdownContext): ConvertedMarkdown {
  const normalized = source.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const { title, body } = splitFrontMatter(normalized);
  // Obsidian comments are for the author only.
  const visible = body.replace(/%%[\s\S]*?%%/g, '');
  const parser = new BlockParser(context);
  parser.parse(visible.split('\n'));
  return { title: title ?? parser.title, content: parser.blocks.join('\n\n') };
}
