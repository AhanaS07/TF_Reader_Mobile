// Runs against the real pinned YAML rather than a stub, because half of what
// this needs to get right is where wokay actually put their examples.
import { loadContractExample } from '@model/contracts/contractExample';

describe('loadContractExample', () => {
  it('reads the single example block off an operation', () => {
    const example = loadContractExample('wokay-api.yaml', 'getRootFeed');

    expect(example).toHaveProperty('navigation');
  });

  // searchCatalogue is the one operation using named examples, and the two
  // names are what let search-results and search-browse-instead be checked
  // against the case each was built for.
  it('reads a named example when the operation carries several', () => {
    const example = loadContractExample('wokay-api.yaml', 'searchCatalogue', 'noResults');

    expect(example).toHaveProperty('metadata');
  });

  it('reads an example that is a paged wrapper rather than a feed', () => {
    const example = loadContractExample('wokay-api.yaml', 'listInstitutions');

    expect(example).toHaveProperty('items');
  });

  // A typo must not resolve to undefined: comparing a fixture against nothing
  // would report a meaningless difference instead of naming the real mistake.
  it('throws naming the operation when it is not in the contract', () => {
    expect(() => loadContractExample('wokay-api.yaml', 'getNothing')).toThrow(/getNothing/);
  });

  it('throws when the named example does not exist', () => {
    expect(() => loadContractExample('wokay-api.yaml', 'searchCatalogue', 'nope')).toThrow(/nope/);
  });

  it('throws when an operation has no example at all', () => {
    expect(() => loadContractExample('wokay-api.yaml', 'adminLogout')).toThrow(/adminLogout/);
  });
});
