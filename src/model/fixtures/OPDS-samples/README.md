# OPDS sample feeds

Rebuilt 16 August 2026 from the pinned contracts in `docs/contracts/`, replacing the
hand-written Week 1 samples.

| File | Feed |
|---|---|
| `01-home-catalogue.json` | `inst_7f3` root feed — 4 navigation rows, 3 curated previews |
| `02-home-catalogue-new-institution.json` | `inst_a21` root feed — nothing curated yet |
| `03-shelf-all-page0.json` / `04-shelf-all-page1.json` | `all`, across two pages |
| `05-shelf-curated-page0.json` | `shelf_1`, one page |
| `06-shelf-curated-alt-page0.json` | `shelf_2`, one page |
| `07-publication-detail.json` | `item_42` as a standalone document |
| `08-public-catalogue-page0.json` / `09-public-catalogue-page1.json` | `/opds/v1/public/catalogue`, across two pages |

## The public feed has no shelves, and that is the point

`08`/`09` back A1 — the catalogue a reader sees before choosing an institution. Shelves are
configured per institution, so a reader without one has none: it is a single flat list, and
these are the only fixtures here with no `groups` concept at all.

Every title in them is `OPEN_ACCESS`, which the contract requires of this feed — browsing
shows what you can read right now. Discovery search (`/opds/v1/public/search`) returns
locked titles too, and is deliberately **not** fixtured: those payloads carry a `subscribe`
link with no `indirectAcquisition`, which `normalize.ts` cannot parse yet.

## The shelves are not a fixed set

An administrator configures the shelves for their institution and names them, so the
count, the titles and the ids are all theirs (AGENTS.md, settled decisions, `L-5`). These
fixtures are built to make that impossible to miss:

- **Curated ids carry no meaning.** `shelf_1`, `shelf_2`, `shelf_3`. If you can guess a
  shelf's contents from its id, someone will branch on it. `all` is the one exception:
  the contract reserves it for the whole entitled catalogue, which is why
  `conformance.ts` may rely on it.
- **A title an administrator typed.** "Nineteenth-century literary criticism" is a real
  shelf name, not a content type.
- **A navigation title that differs from the shelf's own feed title.** The nav row reads
  "Nineteenth-century literary criticism"; `shelf_2`'s feed calls itself
  "Criticism & theory, 1800–1899". Both are correct, and the code already allows it.
- **A second institution with nothing curated.** `inst_a21` has one navigation row and no
  `groups` key at all — the contract's brand-new-institution case.

`navigation` is `minItems: 1`, so a legal feed always has at least the *All titles* row.
The zero-row case cannot be expressed as a fixture; it is covered by handing the screen an
empty array directly. See `CatalogueScreen.test.tsx`.

## Deliberate gaps

`shelf_3` ("Audio picks") appears in `navigation` and as a preview group, but has **no
page fixture**, so opening it is a NOT_FOUND. That keeps the not-found path exercised from
the UI rather than only from a synthetic id.

Worth knowing: the contract says a shelf that would 404 is also absent from the root feed
(`getGroupFeed`, "there is nothing to link to"). This fixture set breaks that on purpose,
because a reachable not-found is more useful to build against than a correct one nobody
can hit. Do not read `shelf_3` as a claim about server behaviour.

## Reading the shape

- The acquisition link's own `type` is `application/json` — the href points at flambeau and
  answers with JSON. **The book's media type is `properties.indirectAcquisition[0].type`.**
- `licenceModel` is on every acquisition link including open access, and uses the one tier
  vocabulary: `OPEN_ACCESS`, `SUBSCRIPTION`, `ELITE`.
- `copies` appears only for `ELITE`.
- `encrypted` is absent for open access and for all audio.

**The counts in the table above are one instance, not the schema.** None of them is
guaranteed. Read `docs/contracts/*.yaml` for what actually holds (`required`, `minItems`,
`maxItems`, `enum`).

## The shelf cap is contested — do not settle it here

`wokay-api.yaml` pins `groupId` to `enum: [shelf_1, shelf_2, shelf_3, all]` and caps
`groups` at `maxItems: 3`, on an operation marked `x-stability: FROZEN`. wokay also told us
in chat on 16 Aug that an administrator can add any number of shelves, named anything. Both
cannot be true, and the question is out to them.

Until they answer, the split is deliberate:

- **These fixtures stay contract-legal** — at most `All titles` plus `shelf_1..3`. A fixture
  claims what the server sends, and a `shelf_4` here would make `MockAdapter` accept a shape
  `ApiAdapter` could never receive.
- **The tests claim more.** `normalize.test.ts` and `CatalogueScreen.test.tsx` hand the code
  eight navigation entries directly and assert it renders them in order. That is a property
  of the code, which is the right place for it.

**So do not "fix" those tests down to four entries to match the enum.** They are testing the
rule (`L-5`: handle none, one and many), not this contract revision.
