// src/model/opds/rels.ts
// The vocabulary seams between the OPDS wire format and our domain model.
//
// Every function here is TOTAL AND STRICT: it either returns a value from a
// closed union or throws MALFORMED_FEED. None of them fall back to a default.
// That is deliberate — a silent default here becomes a wrong button, a wrong
// reader, or an unhonourable cipher much further downstream, with nothing left
// in the stack to explain why. Failing at the boundary keeps the blame local.
import type { AcquisitionRel } from '@model/types';
import type { ContentFormat } from '@/shared/types/primitives';
import { CatalogueError, CatalogueFailure } from '@model/errors';

function malformed(what: string, value: string): CatalogueFailure {
  return new CatalogueFailure(CatalogueError.MALFORMED_FEED, `${what}: ${value}`);
}

// OPDS acquisition rel → what the user can do. Exhaustive by design: L-3 says the
// action vocabulary is still moving, so an unrecognised rel is news, not noise.
const ACTION_BY_REL: Record<string, AcquisitionRel> = {
  'http://opds-spec.org/acquisition/borrow': 'borrow',
  'http://opds-spec.org/acquisition': 'acquire',
  'http://opds-spec.org/acquisition/open-access': 'openAccess',
};

export function toActionId(rel: string): AcquisitionRel {
  const action = ACTION_BY_REL[rel];
  if (!action) throw malformed('unknown acquisition rel', rel);
  return action;
}

// Acquisition mime type → ContentFormat. The format comes from the ACQUISITION
// LINK, not from metadata: OPDS metadata says "a Book" for both a PDF and an
// audiobook, so the link's type is the only place the real format lives.
const FORMAT_BY_MIME: Record<string, ContentFormat> = {
  'application/pdf': 'PDF',
  'application/epub+zip': 'EPUB',
  'audio/mpeg': 'AUDIO',
};

export function toContentFormat(mime: string): ContentFormat {
  const format = FORMAT_BY_MIME[mime];
  if (!format) throw malformed('unknown acquisition mime type', mime);
  return format;
}

// Seam 1: the feed identifies the cipher by W3C xmlenc URI; the frozen
// EncryptionDescriptor names it with a literal. Mapping here means the crypto
// layer never sees a URI and the two representations cannot drift apart.
const ALGORITHM_BY_URI: Record<string, 'AES-256-GCM'> = {
  'http://www.w3.org/2009/xmlenc11#aes256-gcm': 'AES-256-GCM',
};

export function toAlgorithm(uri: string): 'AES-256-GCM' {
  const algorithm = ALGORITHM_BY_URI[uri];
  if (!algorithm) throw malformed('unsupported encryption algorithm', uri);
  return algorithm;
}

// Last path segment of an href, used for publication and shelf ids.
//
// Ids come from the `self` href rather than from `metadata.identifier` because
// the backend keys by itemId while `identifier` is an ISBN — which open-access
// titles may lack entirely, and which is not what any other endpoint accepts.
export function idFromHref(href: string): string {
  // Strip query and fragment before splitting: shelf self-hrefs are paginated
  // ('.../groups/ebooks?page=1') and the page must not become part of the id.
  const path = href.split(/[?#]/)[0].replace(/\/+$/, '');
  // Drop scheme://host FIRST. Without this, 'https://api.tf' has a plausible
  // last segment ('api.tf' — the `//` in the scheme provides the slash), so a
  // host-only href would silently yield the domain as an id.
  const pathOnly = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const segment = pathOnly.slice(pathOnly.lastIndexOf('/') + 1);
  if (!segment) throw malformed('href has no id segment', href);
  return segment;
}
