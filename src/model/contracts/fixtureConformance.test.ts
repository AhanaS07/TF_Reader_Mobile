// Every mock fixture, checked against the contract example it was built from.
//
// This is the test that was missing when the Week 1 samples went stale: wokay
// renamed a field, our hand-written mocks kept the old one, and nothing failed
// until a screen rendered wrong days later. Now the pinned contract and the
// fixtures are compared on every run.
//
// Shapes only — see contractShape.ts for why values are not compared.
import { loadContractExample } from '@model/contracts/contractExample';
import { compareShape } from '@model/contracts/contractShape';
import institutions from '@model/fixtures/institutions.json';
import homeCatalogue from '@model/fixtures/OPDS-samples/01-home-catalogue.json';
import newInstitutionCatalogue from '@model/fixtures/OPDS-samples/02-home-catalogue-new-institution.json';
import allTitlesPage0 from '@model/fixtures/OPDS-samples/03-shelf-all-page0.json';
import allTitlesPage1 from '@model/fixtures/OPDS-samples/04-shelf-all-page1.json';
import curatedShelf from '@model/fixtures/OPDS-samples/05-shelf-curated-page0.json';
import curatedShelfAlt from '@model/fixtures/OPDS-samples/06-shelf-curated-alt-page0.json';
import publicationDetail from '@model/fixtures/OPDS-samples/07-publication-detail.json';
import searchAudio from '@search/fixtures/search-audio.json';
import searchBrowseInstead from '@search/fixtures/search-browse-instead.json';
import searchResultsPage2 from '@search/fixtures/search-results-page-2.json';
import searchResults from '@search/fixtures/search-results.json';

type FixtureCase = {
  /** The fixture's filename, so a failure says which file to open. */
  file: string;
  document: unknown;
  operationId: string;
  /** Only for operations that carry more than one example. */
  exampleName?: string;
  /**
   * Paths the fixture carries and the example does not. Every entry needs a
   * reason: an unexplained allowance is how this check quietly stops working.
   */
  allowedExtraPaths?: string[];
  /** Optional blocks this fixture deliberately does not carry, and why. */
  omittedBranches?: string[];
};

// Cover art is ours, not wokay's: the contract examples give an image href and
// nothing else, while our fixtures size them so a card can reserve space.
const COVER_DIMENSIONS = [
  'publications[].images[].width :number',
  'publications[].images[].height :number',
];

// OPDS lets any link carry a human label, and ours do.
const LINK_TITLES = ['links[].title :string'];

// An edited volume has editors and no author. The contract models both — its
// getPublicFeed example uses `editor` — so this is a real case, not a mistake.
const EDITED_VOLUME = ['publications[].metadata.editor[].name :string'];

const FIXTURE_CASES: FixtureCase[] = [
  {
    file: '01-home-catalogue.json',
    document: homeCatalogue,
    operationId: 'getRootFeed',
    allowedExtraPaths: [
      ...LINK_TITLES,
      'groups[].links[].title :string',
      // We stamp when the feed was built; the root-feed example does not.
      'metadata.modified :string',
      'groups[].publications[].images[].width :number',
      'groups[].publications[].images[].height :number',
    ],
  },
  {
    file: '02-home-catalogue-new-institution.json',
    document: newInstitutionCatalogue,
    operationId: 'getRootFeed',
    allowedExtraPaths: [...LINK_TITLES, 'metadata.modified :string'],
    // The whole point of this fixture: a brand-new institution has curated
    // nothing, so there is no `groups` key at all. `navigation` is minItems 1,
    // which is why that one still has to be there.
    omittedBranches: ['groups'],
  },
  {
    file: '03-shelf-all-page0.json',
    document: allTitlesPage0,
    operationId: 'getGroupFeed',
    allowedExtraPaths: COVER_DIMENSIONS,
  },
  {
    file: '04-shelf-all-page1.json',
    document: allTitlesPage1,
    operationId: 'getGroupFeed',
    allowedExtraPaths: [...COVER_DIMENSIONS, ...EDITED_VOLUME],
  },
  {
    file: '05-shelf-curated-page0.json',
    document: curatedShelf,
    operationId: 'getGroupFeed',
    allowedExtraPaths: COVER_DIMENSIONS,
  },
  {
    file: '06-shelf-curated-alt-page0.json',
    document: curatedShelfAlt,
    operationId: 'getGroupFeed',
    allowedExtraPaths: COVER_DIMENSIONS,
  },
  {
    file: '07-publication-detail.json',
    document: publicationDetail,
    operationId: 'getPublication',
  },
  {
    file: 'institutions.json',
    document: institutions,
    operationId: 'listInstitutions',
    // Added for us on 16 Aug so the catalogue link is discovered rather than
    // built; the contract carries it in the schema but not in this example.
    allowedExtraPaths: ['items[].catalogueUrl :string'],
  },
  {
    file: 'search-results.json',
    document: searchResults,
    operationId: 'searchCatalogue',
    exampleName: 'hits',
    allowedExtraPaths: COVER_DIMENSIONS,
  },
  {
    file: 'search-results-page-2.json',
    document: searchResultsPage2,
    operationId: 'searchCatalogue',
    exampleName: 'hits',
    allowedExtraPaths: [...COVER_DIMENSIONS, ...EDITED_VOLUME],
    omittedBranches: [
      // This page carries editors instead — see EDITED_VOLUME above.
      'publications[].metadata.author',
      // `copies` is ELITE-only and `encrypted` never appears on open access,
      // which is all this page holds.
      'publications[].links[].properties.copies',
      'publications[].links[].properties.encrypted',
    ],
  },
  {
    file: 'search-audio.json',
    document: searchAudio,
    operationId: 'searchCatalogue',
    exampleName: 'hits',
    allowedExtraPaths: [
      ...COVER_DIMENSIONS,
      // What an audiobook has instead of a page count.
      'publications[].metadata.duration :number',
      'publications[].metadata.narrator[].name :string',
    ],
    omittedBranches: [
      // An audiobook has no pages, and audio is never encrypted (README).
      'publications[].metadata.numberOfPages',
      'publications[].links[].properties.encrypted',
      'publications[].links[].properties.copies',
    ],
  },
  {
    file: 'search-browse-instead.json',
    document: searchBrowseInstead,
    operationId: 'searchCatalogue',
    exampleName: 'noResults',
  },
];

describe('fixtures conform to the pinned contracts', () => {
  for (const testCase of FIXTURE_CASES) {
    describe(testCase.file, () => {
      const example = loadContractExample(
        'wokay-api.yaml',
        testCase.operationId,
        testCase.exampleName,
      );
      const result = compareShape(testCase.document, example, {
        allowedExtraPaths: testCase.allowedExtraPaths,
        omittedBranches: testCase.omittedBranches,
      });

      // The failure that means the contract moved and we have not followed it.
      it(`carries every field ${testCase.operationId} sends`, () => {
        expect(result.missingFromFixture).toEqual([]);
      });

      // The softer direction, but still pinned: an extra needs a stated reason.
      it('carries no unexplained extra fields', () => {
        expect(result.extraInFixture).toEqual([]);
      });
    });
  }
});
