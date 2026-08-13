// TEMPORARY SCRATCH FILE — delete when you are done.
// Not part of the suite, not meant to be committed or linted. It asserts
// nothing; it just prints what MockAdapter does for each institution id so you
// can see the behaviour with your own eyes.
import { MockAdapter } from '@adapters/MockAdapter';

const IDS = [
  'inst_7f3', // the one institution the catalogue fixtures describe
  'inst_a21', // real: listed in institutions.json, but has no catalogue fixtures
  'inst_zzz', // fake: nowhere in the fixtures at all
];

// Runs a call and reports how it ended, instead of letting a rejection fail the
// test — the rejection IS what we are here to look at.
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'RESOLVED';
  } catch (error) {
    const code = (error as { code?: string }).code;
    return `REJECTED (${code ?? 'no code'})`;
  }
}

it('scratch: what MockAdapter does per institution id', async () => {
  const adapter = new MockAdapter();

  for (const id of IDS) {
    const home = await outcome(() => adapter.getHomeCatalogue(id));
    const shelf = await outcome(() => adapter.getShelf(id, 'ebooks'));
    const institution = await outcome(() => adapter.getInstitution(id));

    // eslint-disable-next-line no-console
    console.log(
      [
        id.padEnd(10),
        `getHomeCatalogue: ${home.padEnd(22)}`,
        `getShelf: ${shelf.padEnd(22)}`,
        `getInstitution: ${institution}`,
      ].join('  '),
    );
  }
});
