/** Greedy word wrap of plain paragraphs into lines of at most `width` characters. */
export function wrapParagraphs(paragraphs: string[], width: number): string[] {
  const lines: string[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) lines.push('');
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  });
  return lines;
}
