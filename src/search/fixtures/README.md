# `src/search/fixtures/` — search responses, ours not wokay's

**These are invented, and that is why they are here rather than in
`src/model/fixtures/OPDS-samples/`.** That folder holds the three responses wokay
confirmed on 11 Aug as "whatever is in the samples is latest"; team1_README calls
them _the contract_, and dropping a hand-written file in beside them would make a
guess look like a frozen sample. None of these four is confirmed by anyone.

The search endpoint is **R3c** and arrives in Week 4. Until then these stand in for
it, and two things in them are explicitly unverified:

- **`browseInstead`** — the key name comes from the B1 spec, not from a response.
  `normalizeSearchFeed` accepts `navigation` as well for exactly that reason.
- **`next` as a whole href** — a search response's paging scheme has never been
  seen. The client follows the value verbatim, so a cursor would work unchanged.

They go through the real `normalizeSearchFeed` and the real `assertPublication`,
same as `MockAdapter` does with the frozen samples — so if the normalizer
mishandles this shape, `FixtureSearchPipeline` says so today rather than in Week 4.

The publication blocks are copied unchanged from `01-home-catalogue.json`, so no
new claim about a `Publication` is made anywhere in this folder.

## Which file answers what

`FixtureSearchPipeline` is a **lookup, not a matcher** — it selects a canned file
from the request's query parameters and never inspects a title. The pairing of
query to results below is therefore arbitrary demo data; `climate` is used only
because it is already the canonical example query in `SearchInput.gallery.tsx`.

| Request parameters | File | Exercises |
|---|---|---|
| `query=climate` | `search-results.json` | results + a `next` |
| `query=climate&page=1` (the `next` above) | `search-results-page-2.json` | last page, no `next` |
| `query=climate&contentType=AUDIO` | `search-audio.json` | a filter reaching the server before pagination |
| anything else | `search-browse-instead.json` | **zero results with no `publications` key at all** |
