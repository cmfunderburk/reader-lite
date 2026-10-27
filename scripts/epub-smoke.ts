// Parse EPUBs with the app's parser and print a summary, for checking
// conversion against real books: bun scripts/epub-smoke.ts <file.epub>... [--chapter N]
import '../test/dom';
import { parseEpub } from '../src/epub/parse';

const args = process.argv.slice(2);
const chapterFlag = args.indexOf('--chapter');
const showChapter = chapterFlag === -1 ? undefined : Number(args.splice(chapterFlag, 2)[1]);

for (const file of args) {
  const started = performance.now();
  try {
    const book = await parseEpub(await Bun.file(file).arrayBuffer());
    const ms = Math.round(performance.now() - started);
    const chars = book.chapters.reduce((sum, c) => sum + c.content.length, 0);
    console.log(`\n== ${file}\n${book.title} — ${book.author ?? '?'} | ${book.chapters.length} chapters, ${chars} chars, ${book.assets.length} images, ${ms}ms`);
    book.chapters.forEach((c, i) => console.log(`  ${String(i).padStart(3)} ${c.title.slice(0, 60).padEnd(60)} ${c.content.length}`));
    if (showChapter !== undefined) console.log(`\n${book.chapters[showChapter]?.content.slice(0, 3000)}`);
  } catch (err) {
    console.log(`\n== ${file}\nFAILED: ${err instanceof Error ? err.message : err}`);
  }
}
