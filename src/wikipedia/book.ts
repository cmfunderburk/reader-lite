// A Wikipedia article's stored file: a stored zip of the article (with its
// raw extract) and its lead image, so it can be re-parsed, read offline and
// carried in backups like any other book.

import type { ParsedBook } from '../epub/parse';
import { decodeText, type ZipArchive } from '../epub/zip';
import { buildStoredZip } from '../epub/zipWriter';
import { articleChapters, LEAD_IMAGE_PATH, WikipediaError, type WikiArticle } from './article';

export const ARTICLE_FILE = 'wikipedia-article.json';

export interface LeadImage {
  bytes: Uint8Array<ArrayBuffer>;
  mediaType: string;
}

interface StoredArticle extends WikiArticle {
  imageType?: string;
}

export function wikipediaFile(article: WikiArticle, image: LeadImage | undefined): Uint8Array<ArrayBuffer> {
  const stored: StoredArticle = { ...article, imageType: image?.mediaType };
  const entries = [{ name: ARTICLE_FILE, data: new TextEncoder().encode(JSON.stringify(stored)) }];
  if (image) entries.push({ name: LEAD_IMAGE_PATH, data: image.bytes });
  return buildStoredZip(entries);
}

export async function readWikipediaFile(zip: ZipArchive): Promise<{ article: WikiArticle; image?: LeadImage }> {
  const { imageType, ...article } = JSON.parse(decodeText(await zip.bytes(ARTICLE_FILE))) as StoredArticle;
  if (typeof article.title !== 'string' || typeof article.extract !== 'string') throw new WikipediaError('damaged article file');
  const image =
    imageType && zip.has(LEAD_IMAGE_PATH) ? { bytes: (await zip.bytes(LEAD_IMAGE_PATH)).slice(), mediaType: imageType } : undefined;
  return { article, image };
}

export function wikipediaBook(article: WikiArticle, image: LeadImage | undefined): ParsedBook {
  return {
    title: article.title,
    chapters: articleChapters(article, !!image),
    assets: image ? [{ path: LEAD_IMAGE_PATH, mediaType: image.mediaType, bytes: image.bytes }] : [],
  };
}
