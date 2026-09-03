# Contracts-Gate proposal: a time-based addressing mode for reading position

**Status: ACCEPTED AND LANDED, BOTH TASK A AND TASK B.** Option A (§3) was taken as written and
merged in `bf3e4e8` (2026-08-25, Karthik, "per Ahana's proposal") — `src/shared/contracts/annotations.ts`'s
`Locator` now carries the `AUDIO` variant exactly as proposed below, and `__typecheck__.ts` pins it.
Karthik's Q3 (§5, "what should `offset` hold for an AUDIO row") was answered as `0`:
`progressStore.ts`'s `savePosition` has the `locator.type === 'AUDIO' ? 0 : ...` branch. Q1 (LWW is
fine, no furthest-position-wins needed) and Q4 (the real backend expects `offset: 0` with
`positionMs` inside `locator`, exactly as sent) are answered too. **Task B — switching
`AudioPlayerScreen`/`AudioPlayerRouteScreen` onto `progressStore`, retiring `audioSessionProgress.ts`
— landed 2026-09-02; see §7.** The one thing still open: the non-exhaustive-site hazard flagged
below in §4 for `progressStore.ts`'s `currentLocator()` fallback was never resolved — it still
mislabels a corrupt/null AUDIO or EPUB `locator` row as `PDF` (pinned by a test in
`contractConformance.test.ts`, not yet fixed — Karthik's call). This document is otherwise kept as
the historical record of the proposal and its measured blast radius; treat the sections below as
describing the state *before* landing, except where noted above and in §7.

**Author:** Ahana (Reader), AUDIO PHASE 4.
**Proposes changing:** `src/shared/contracts/annotations.ts` (frozen — see §2, this is NOT
`progress.ts`), `src/shared/contracts/__typecheck__.ts` (canary).
**Would follow, owned by others, NOT part of this ask:** `src/features/sync/localDb/mappers.ts` and
`stores/progressStore.ts` (Karthik), `src/features/personalization/readerBookmarks.ts` (Vaishnavi).

---

## 1. Problem

Audio position is a third addressing scheme and the contract has only two.

`Progress` (`progress.ts`) carries `offset: number` and `locator: Locator | null`. `Locator`
(`annotations.ts:25-26`) is:

```ts
export type Locator =
  { type: 'EPUB'; cfi: string } | { type: 'PDF'; page: number; offset?: number };
```

A position in an audiobook is *time within a track*. It is not a CFI and it is not a page. There is
no member for it, so today Reader cannot write an audio position into the synced model at all.

**Reader is NOT blocked on this.** AUDIO PHASE 4 / Task A already shipped durable single-device
resume (`audioSessionProgress.ts`) — a reader-owned, deliberately **local and unsynced** JSON store.
What this proposal unblocks is **cross-device** resume, not the feature. That ordering is deliberate:
it means this can be decided at Gate pace rather than under delivery pressure.

**This is now the only audio item on the Gate agenda.** Audio's other proposal — a plaintext-path
accessor, to lift the size ceiling on the asset resolver — was **withdrawn on 2026-08-25** once the
catalogue's own 20 MB storage limit made that ceiling unreachable (`AUDIO_PLAYER_DECISION.md`
Part 2). Nothing about that decision touches this one: the two shared a directory and a phase, not a
problem. This proposal is about a position that **cannot be expressed** in the frozen types at all,
which no agreement about content size can resolve.

### The anti-pattern this proposal exists to avoid

The tempting shortcut is to write seconds (or milliseconds) into the existing `offset: number`.
**Do not.** `offset` is already spoken for — it is the PDF page number
(`progressStore.ts:63`, `progressStore.ts:86`), and the freeze documents it as "still authoritative
for PDF". Putting a second, incompatible meaning behind the same integer gives two addressing
schemes distinguished by nothing a reader can inspect, which is precisely the failure `Locator` was
introduced to fix for EPUB. It must be its own variant.

## 2. FINDING FIRST: the union to change is in `annotations.ts`, not `progress.ts`

Task B was framed as "a new member of `progress.ts`'s discriminated union". **`progress.ts` contains
no union.** `Progress` is an interface; the discriminated union it addresses positions with is
`Locator`, *imported* from `annotations.ts`. `progress.ts` itself would not change at all under
Option A below.

This matters because `Locator` is **shared**, and the Gate needs to see the real blast radius:

| Consumer | Field | Owner |
| --- | --- | --- |
| `Progress` | `locator: Locator \| null` | Personalization / Sync |
| `Bookmark` | `locator: Locator` | Personalization / Sync |
| `Highlight` | `startLocator`, `endLocator` | Personalization / Sync |
| `Posting` (search) | via `SearchIndex` | Search (Vaishnavi) — **and it does break, see §4** |

So adding an `AUDIO` member to `Locator` does not only give Progress a time position — it makes
"a bookmark at 00:14:32 of an audiobook" and "a highlight spanning audio" *expressible in the type
system*, whether or not anything implements them. That may be desirable (audiobook bookmarks are a
real product feature) or may be unwanted surface area. **It is a Gate decision, not Reader's**, which
is why §6 offers a narrower Option B.

## 3. Proposed diff — Option A (extend `Locator`)

### `src/shared/contracts/annotations.ts`

```diff
 // Position addressing differs by content type (Reader emits this):
 //   EPUB → CFI string (epub.js text-selection anchor)
 //   PDF  → page number (+ optional offset)
+//   AUDIO → elapsed time within a track (there is no page and no CFI in a waveform)
 // RECONCILED (format casing): discriminants are UPPERCASE to match ContentFormat
 // (PDF | EPUB | AUDIO) in primitives.ts — no more 'epub' / 'EPUB' split.
 export type Locator =
-  { type: 'EPUB'; cfi: string } | { type: 'PDF'; page: number; offset?: number };
+  | { type: 'EPUB'; cfi: string }
+  | { type: 'PDF'; page: number; offset?: number }
+  // `trackId` is present but OPTIONAL: single-file audiobooks (all this app ships today) have no
+  // meaningful track identity, while a multi-track book cannot be addressed without one. Omitted
+  // means "the book's only track". Making it required would force every current writer to invent
+  // an id; leaving it out entirely would make the member unable to grow into multi-track.
+  | { type: 'AUDIO'; positionMs: number; trackId?: string };
```

**`positionMs`, an integer of milliseconds — not seconds, and not a float.** Three reasons, in
order of weight:

1. It matches how every audio engine in this stack already reports position natively.
2. An integer survives a JSON round trip and a SQLite `INTEGER` column without the float-equality
   ambiguity `12.339999999999998` introduces into LWW comparisons.
3. It leaves `offset`'s meaning untouched.

Reader's own store holds seconds (`audioSessionProgress.ts`) because that is what `expo-audio`'s JS
surface reports; the conversion is Reader's to do at the boundary, and is one multiplication.

### `src/shared/contracts/__typecheck__.ts`

The canary must pin the new member the same way it pins the existing two. Note the file is in
`.prettierignore` because `@ts-expect-error` is line-positional — **add, do not reflow**:

```diff
 // --- Locator discriminants are UPPERCASE ----------------------------------
 ({ type: 'EPUB', cfi: 'epubcfi(/6/4)' }) satisfies Locator;
 ({ type: 'PDF', page: 12 }) satisfies Locator;
+({ type: 'AUDIO', positionMs: 872_000 }) satisfies Locator;
+({ type: 'AUDIO', positionMs: 872_000, trackId: 'ch-03' }) satisfies Locator;
+// @ts-expect-error audio position is milliseconds under its own key, never PDF's `offset`
+({ type: 'AUDIO', offset: 872_000 }) satisfies Locator;
+// @ts-expect-error seconds-as-`position` was considered and rejected — see the proposal doc
+({ type: 'AUDIO', position: 872 }) satisfies Locator;
 // @ts-expect-error lowercase discriminants were reconciled out
 ({ type: 'epub', cfi: 'x' }) satisfies Locator;
```

The two `@ts-expect-error` lines are the load-bearing half: they are what makes a later "just put the
milliseconds in `offset`" regression fail the canary instead of passing review.

**Verified:** with §3's diff applied, `__typecheck__.ts` itself reports **no** errors — both
`satisfies` lines pass and both `@ts-expect-error` lines are genuinely unsatisfied assertions, so
neither is a silently-unused suppression. The canary needs no other change.

## 4. How existing EPUB/PDF consumers stay unaffected

Adding a union member cannot change the type of an existing member, so every site that *constructs*
an EPUB or PDF locator keeps compiling untouched. The risk is entirely on sites that *consume* one,
and it splits cleanly in two:

**Exhaustive sites — the compiler catches these. This is the good case.**

**MEASURED, NOT PREDICTED.** The diff in §3 was applied locally, `npm run typecheck` run, and the
diff reverted (`src/shared/contracts/` is clean — that is the whole point of this being a proposal).
The exact result: **7 errors across 5 files**, in three capabilities:

| File | Owner | What breaks |
| --- | --- | --- |
| `personalization/readerBookmarks.ts:52` | Vaishnavi | `.page` on a `PDF \| AUDIO` narrowing |
| `search/queryIndex.ts:49,50` | Vaishnavi | `.cfi` on an `EPUB \| AUDIO` narrowing (×2) |
| `search/scripts/searchEpub.ts:36` | Vaishnavi | `.page` |
| `search/scripts/searchPdf.ts:37` | Vaishnavi | `.cfi` |
| `reader/useBookSearch.ts:73` | **Ahana (mine)** | `.page` and `.offset` (×2) |

**This is materially wider than "Progress and bookmarks", and the Gate should see that before
deciding.** In particular **Search is a third consuming capability** — `Posting`/`SearchIndex` carry
`Locator` too, so an in-book search result is typed as something that could be an audio position even
though no audio index exists. Every one of these is a *narrowing* failure, not a logic failure: the
code says "if not EPUB then it's PDF", which stops being true.

One of the seven is Reader's own and I will fix it as part of landing this. The other six are not
mine to touch.

The good news is that this is the freeze doing exactly its job: **the change cannot land silently.**
`readerBookmarks.ts:49` is even self-documented as *"Total over the `Locator` union"* — the comment
predicted its own breakage, and the compiler enforced it.

**Non-exhaustive sites — the compiler does NOT catch these. This is the real hazard.**

`progressStore.ts:63` (Karthik) already has an `else`, so it keeps compiling and starts being wrong:

```ts
offset: locator.type === 'PDF' ? locator.page : (existing?.offset ?? 0),
```

An AUDIO locator would take the `else` branch and write a stale/zero `offset` while the real position
lives in the `locator` column. Whether that is acceptable (the `locator` column *is* authoritative)
or needs an explicit AUDIO branch is Karthik's call — flagged, not assumed. Same for
`progressStore.ts:86`, whose legacy fallback `return { type: 'PDF', page: row.offset }` would keep
claiming PDF for a row that never was one.

**Forward compatibility, and it is asymmetric.** `mappers.ts`'s `parseLocator` returns `null` for an
unknown `type`. So a client running *older* code that receives an AUDIO locator from sync degrades to
"no stored position" rather than crashing or mis-seeking — a genuinely good failure mode, and worth
keeping deliberately. But it means an AUDIO position written by a new client is **invisible**, not
merely unused, on an old one.

## 5. Questions for the two consuming owners

Framed as questions because these are their calls, not mine.

### For Karthik (Sync)

1. **LWW on a time position — is `updatedAt` enough?** Progress is last-write-wins on `updatedAt`.
   Two devices playing the same audiobook produce a monotonically advancing number on each, so LWW
   picks the most *recently written*, which is not necessarily the *furthest listened*. Is
   "furthest-position-wins" wanted for AUDIO specifically, or is plain LWW (consistent with EPUB/PDF)
   the right call?
2. **Does the `progress` table need a column?** `locator TEXT` already stores JSON, so `positionMs`
   needs no schema change — the AUDIO variant serialises into the existing column. Confirm you agree
   no migration is required. If so this is a rare contract widening with **zero** DB migration.
3. **What should `offset` hold for an AUDIO row?** `NOT NULL` in `schema.ts:15`, so it must hold
   *something*. Options: `0`; the position in whole seconds as a lossy convenience mirror; or
   `positionMs` itself (which I'd argue against — it re-creates the ambiguity §1 exists to prevent).
4. **Server side:** does team wokay's / flambeau's progress endpoint accept an unrecognised `locator`
   shape, or does it validate the discriminant? If it validates, this needs their sign-off too and
   becomes a cross-team item, not just ours. I could not answer this from the specs in
   `API_CONTRACT_REVIEW_CONTEXT.md`.

### For Vaishnavi (Personalization)

1. **`toTarget` (`readerBookmarks.ts:49`) will stop compiling** — by design. `ReaderTarget` is a
   WebView-bridge type and audio has no WebView, so there is likely no sensible `ReaderTarget` for an
   AUDIO locator at all. Should it throw, return a nullable, or should the bookmark list filter AUDIO
   rows out upstream? Reader has no opinion it should be imposing here.
2. **Do you read `Progress.offset` anywhere directly**, rather than going through `locator`? If so,
   an AUDIO row's `offset` (question 3 above) becomes visible to you and the answer matters.
3. **Do you want audio bookmarks?** Option A makes `Bookmark.locator` accept AUDIO as a side effect.
   If that is unwanted surface, say so — Option B below avoids it.

### For Vaishnavi (in-book Search) — a consumer I did not expect

Four of the seven measured errors are in Search (`queryIndex.ts:49,50`, `searchEpub.ts:36`,
`searchPdf.ts:37`), because `Posting`/`SearchIndex` carry `Locator`.

1. **Is a `Locator` in a search `Posting` conceptually the same thing as a position in `Progress`?**
   If a posting is always a *text* anchor, then AUDIO is meaningless there and Search is paying for a
   variant it can never produce — an argument for Option B, or for splitting `Locator` into a text
   locator and a position locator (a bigger change than this proposal, but the measured breakage is
   the evidence for it).
2. `BookSearchIndex.format` already excludes AUDIO outright (`search.ts`), so no audio index can
   exist. Would you rather assert that impossibility at the type level than handle an AUDIO case in
   `queryIndex.ts`?

## 6. Option B, if the Gate wants a narrower blast radius

Leave `Locator` alone; give `Progress` its own optional field:

```diff
 export interface Progress extends SyncRecordBase {
   bookId: string;
   offset: number;
   locator: Locator | null;
+  // Time-based position, for AUDIO. Mutually exclusive with `locator` in practice: a book is
+  // addressed one way or the other, never both.
+  audioPosition?: { positionMs: number; trackId?: string };
 }
```

**Trade-off, stated honestly.** Option B touches `progress.ts` instead of `annotations.ts`, adds no
surface to Bookmark/Highlight, and breaks no existing exhaustive switch — nothing stops compiling.
That last property is its **weakness as much as its strength**: nothing forces a consumer to notice
audio exists, and "two fields, use whichever is non-null" is a weaker invariant than one union the
compiler can check. It also needs a real DB column, so unlike Option A it *does* require a migration.

**Reader's recommendation, stated with the measurement in hand.** I went into this preferring Option
A on principle — the precedent already set in this codebase is "*positions discriminated by
addressing scheme, not by format*" (`WEBVIEW_BRIDGE.md`), and Option A is that precedent applied.
**The measured 7-errors-across-3-capabilities changes how confidently I can say that**, and it would
be dishonest to present the recommendation without it: Option A makes three other people's code stop
compiling, two of whom (Search) get a variant they can never construct.

I still lean Option A, for one reason that survives the measurement: every one of those 7 failures is
a place where the code currently assumes "not EPUB implies PDF", and that assumption is *already*
false in the product — audio exists. Option B leaves all 7 sites compiling on an assumption that has
stopped being true, which buys a quiet landing at the cost of the exact class of latent bug the
freeze exists to surface.

**But if the Gate's read is that a search `Posting` and a reading `Progress` are simply not the same
kind of thing** (§5, Search question 1), then the honest conclusion is neither option as written —
it is that `Locator` is currently overloaded across two concepts, and audio is the thing that
revealed it. That is a bigger conversation than Reader should be opening unilaterally, which is why
it is here as a question rather than a third proposed diff.

## 7. What changes in Reader once this lands

**LANDED, 2026-09-02.** `audioSessionProgress.ts` was deleted outright rather than kept as a cache —
`progressStore`'s SQLite row is now the only copy, matching the option this section named. Nothing
else in `audio/` changed shape: `AudioPlayerScreen` still reports positions through
`onPositionChange`/`onPositionCommit` props without knowing where they go; the migration was a
wiring change confined to `AudioPlayerRouteScreen.tsx` (the write path, now throttled and routed to
`progressStore.savePosition({type:'AUDIO', positionMs, trackId?}, bookId)`) and
`audioPlayerInstance.ts`'s `commitCurrentPlayerPosition()` (the backgrounding/book-switch edge) —
the same property that let the player library be swapped underneath the resolver without touching a
call site.

One thing did NOT carry over cleanly: the old file's read was **synchronous** (`textSync()`), so
`AudioPlayerRouteScreen` could compute `initialPosition` during render. `progressStore.currentLocator()`
queries SQLite and is genuinely async, so the route screen now gates on a brief loading state before
mounting `AudioPlayerScreen` — see that file's own header for why. And `commitCurrentPlayerPosition()`
was a synchronous write specifically because it runs at "the last reliable callback before the OS may
terminate the process" (`useAudioPlayerSetup.ts`'s AppState listener) — that write is now a
fire-and-forget promise, which is a real, accepted reduction in guarantee at exactly that edge. See
the comment on `commitCurrentPlayerPosition()` itself.

Karthik's two open questions (§5) were answered before this landed: plain LWW is fine for AUDIO
conflicts (furthest-position-wins was not required), and the real backend expects `offset: 0` with
the actual position carried in `locator`, exactly as `progressStore.ts` already sends it.
