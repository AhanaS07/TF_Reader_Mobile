// src/model/validate.test.ts
// These are the rules TypeScript cannot express: relationships BETWEEN fields.
// `strict` proves a Publication has a format and an encryption slot; only an
// assertion can prove that an AUDIO publication's encryption slot is null.
import { CatalogueError } from '@model/errors';
import { assertPublication } from '@model/validate';
import type { Publication } from '@model/types';

function publication(overrides: Partial<Publication> = {}): Publication {
  return {
    id: 'item_42',
    title: 'Rights for Robots',
    authors: ['Joshua C. Gellers'],
    subjects: ['Law'],
    format: 'PDF',
    acquisition: {
      actionId: 'borrow',
      href: 'https://api.tf/api/v1/loans?itemId=item_42',
      licenceModel: 'CONCURRENT',
      copiesTotal: 2,
      encryption: { algorithm: 'AES-256-GCM', originalLength: 6373752 },
      hasSearchIndex: true,
      canPersist: false,
    },
    ...overrides,
  };
}

it('accepts a well-formed publication', () => {
  expect(() => assertPublication(publication())).not.toThrow();
});

it('accepts an audiobook that is plaintext and unindexed', () => {
  const audiobook = publication({
    format: 'AUDIO',
    acquisition: {
      actionId: 'acquire',
      href: 'https://api.tf/api/v1/loans?itemId=item_stat',
      licenceModel: 'UNLIMITED',
      encryption: null,
      hasSearchIndex: false,
      canPersist: true,
    },
  });
  expect(() => assertPublication(audiobook)).not.toThrow();
});

// primitives.ts, verbatim: "AUDIO is never encrypted and never has a search index."
it('rejects encrypted audio', () => {
  const encryptedAudio = publication({
    format: 'AUDIO',
    acquisition: {
      ...publication().acquisition,
      encryption: { algorithm: 'AES-256-GCM', originalLength: 10 },
    },
  });
  expect(() => assertPublication(encryptedAudio)).toThrow(
    expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
  );
});

it('rejects audio claiming a search index', () => {
  const indexedAudio = publication({
    format: 'AUDIO',
    acquisition: { ...publication().acquisition, encryption: null, hasSearchIndex: true },
  });
  expect(() => assertPublication(indexedAudio)).toThrow(
    expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
  );
});

// Open access is unlicensed and unencrypted by definition. An open-access title
// carrying a licence model would mean resolveAccess gets contradictory inputs.
it('rejects open access that carries a licence model', () => {
  const licensedOpenAccess = publication({
    acquisition: {
      actionId: 'openAccess',
      href: 'https://cdn.tf/oa/item_ab6.epub',
      licenceModel: 'UNLIMITED',
      encryption: null,
      hasSearchIndex: true,
      canPersist: true,
    },
  });
  expect(() => assertPublication(licensedOpenAccess)).toThrow(
    expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
  );
});

it('rejects open access that claims encryption', () => {
  const encryptedOpenAccess = publication({
    acquisition: {
      actionId: 'openAccess',
      href: 'https://cdn.tf/oa/item_ab6.epub',
      encryption: { algorithm: 'AES-256-GCM', originalLength: 10 },
      hasSearchIndex: true,
      canPersist: true,
    },
  });
  expect(() => assertPublication(encryptedOpenAccess)).toThrow(
    expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
  );
});

// A concurrent licence with no copy count cannot be reasoned about: resolveAccess
// needs the total to decide whether a copy is free.
it('rejects a concurrent licence with no copy count', () => {
  const noCopies = publication({
    acquisition: { ...publication().acquisition, licenceModel: 'CONCURRENT', copiesTotal: undefined },
  });
  expect(() => assertPublication(noCopies)).toThrow(
    expect.objectContaining({ code: CatalogueError.MALFORMED_FEED }),
  );
});
