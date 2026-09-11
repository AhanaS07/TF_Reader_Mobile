// src/model/batchItems.ts
// Normalizer for wokay's POST /catalogue/items:batch (F9, getItemsBatch) — plain
// JSON, explicitly not OPDS, so this does not live in opds/normalize.ts and is
// not shared through it. Both MockAdapter and ApiAdapter call this, so they
// cannot disagree about the shape they produce.
import type { AccessTier, BatchItemsResult, BookSummary } from '@model/types';
import type { ContentFormat } from '@/shared/types/primitives';
import { CatalogueError, CatalogueFailure } from '@model/errors';

const CONTENT_FORMATS: ContentFormat[] = ['PDF', 'EPUB', 'AUDIO'];
const ACCESS_TIERS: AccessTier[] = ['OPEN_ACCESS', 'SUBSCRIPTION', 'ELITE'];

// wokay's frozen items:batch cap. Exported so MockAdapter and ApiAdapter check
// the same number rather than each hardcoding 100 and risking drift.
export const MAX_BATCH_IDS = 100;

function malformed(what: string): CatalogueFailure {
  return new CatalogueFailure(CatalogueError.MALFORMED_FEED, what);
}

function reqString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw malformed(`batch item is missing ${field}`);
  }
  return value;
}

function normalizeBookSummary(raw: unknown): BookSummary {
  if (typeof raw !== 'object' || raw === null) {
    throw malformed('batch item is not an object');
  }
  const item = raw as Record<string, unknown>;
  const id = reqString(item.id, 'id');
  const title = reqString(item.title, 'title');

  const format = item.contentType;
  if (!CONTENT_FORMATS.includes(format as ContentFormat)) {
    throw malformed(`${id}: unrecognised contentType ${String(format)}`);
  }
  const accessTier = item.accessTier;
  if (!ACCESS_TIERS.includes(accessTier as AccessTier)) {
    throw malformed(`${id}: unrecognised accessTier ${String(accessTier)}`);
  }

  const summary: BookSummary = {
    id,
    title,
    format: format as ContentFormat,
    accessTier: accessTier as AccessTier,
    hasSearchIndex: item.hasSearchIndex === true,
  };
  if (Array.isArray(item.authors)) {
    summary.authors = item.authors.filter((author): author is string => typeof author === 'string');
  }
  if (typeof item.coverUrl === 'string') {
    summary.coverUrl = item.coverUrl;
  }
  if (typeof item.isbn === 'string') {
    summary.isbn = item.isbn;
  }
  if (typeof item.totalCopies === 'number') {
    summary.totalCopies = item.totalCopies;
  }
  return summary;
}

export function normalizeBatchItemsResponse(doc: unknown): BatchItemsResult {
  if (typeof doc !== 'object' || doc === null) {
    throw malformed('batch response is not an object');
  }
  const body = doc as Record<string, unknown>;
  if (!Array.isArray(body.items)) {
    throw malformed('batch response has no items array');
  }
  if (!Array.isArray(body.notFound)) {
    throw malformed('batch response has no notFound array');
  }
  if (!Array.isArray(body.denied)) {
    throw malformed('batch response has no denied array');
  }

  return {
    items: body.items.map(normalizeBookSummary),
    notFound: body.notFound.map((id) => reqString(id, 'notFound id')),
    denied: body.denied.map((id) => reqString(id, 'denied id')),
  };
}
