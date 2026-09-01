# CLAUDE.md — standing instructions for this repo

TF Reader mobile (Expo / React Native), team t4targaryen, CAP-7 Reader & Offline.
Read `README.md` (repo-wide) and `T4_Readme.md` (CAP-7 specifics) for context. This file is only
the rules that must survive across sessions.

## Reader ⇄ WebView bridge — read the doc before touching it

**`src/features/reader/WEBVIEW_BRIDGE.md` is the source of truth for the reader bridge.**

**The WebView half is typechecked TypeScript, as of 2026-08-18.** It imports `ReaderMessage` and
`ReaderCommand` from `readerBridge.ts`, so the two halves are one contract with two consumers rather
than two hand-synced descriptions of one protocol. `npm run typecheck` is the drift guard now — the
tests that used to read the templates as text are gone, and deleting them was the point.

| File                                                    | Holds                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `webview/src/bridge.ts`                                 | `post`/`fail`/`showFallback`/`base64ToArrayBuffer`, `TFReaderApi`   |
| `webview/src/epub.entry.ts`                             | epub.js renderer, `openEpub`                                        |
| `webview/src/pdf.entry.ts`                              | pdf.js renderer, `openPdf`, the worker wiring                       |
| `webview/src/readerMetrics.ts`                          | typography arithmetic + the stylesheet — **pure, unit-tested**      |
| `webview/src/epubOutline.ts`, `pdfOutline.ts`            | navigation/outline → `toc`, page + scale maths — **pure, unit-tested** |
| `webview/src/highlightSeam.ts`, `pdfHighlightSeam.ts`   | the ONLY callers of `rendition.annotations` / the PDF text+box layers |
| `webview/src/epubViewGeometry.ts`                       | the ONLY caller of epub.js's `View.expand()` — makes a re-styled chapter re-measure |
| `webview/src/highlightNaming.ts`, `highlightPaint.ts`, `epubCfiRange.ts`, `epubLayoutSignature.ts`, `pdfTextRange.ts`, `touchGesture.ts`, `selectionTheme.ts` | owner naming, paint diffing, CFI range join/split, which appearance changes move a glyph, PDF offset maths, swipe/long-press thresholds, `::selection` colour — **pure, unit-tested** |
| `webview/reader-{epub,pdf}.template.html`               | **HTML and CSS only** — the DOM each entry queries                  |

`buildReaderHtml.ts` compiles each entry with **esbuild** (one IIFE per format) and inlines it beside
the libraries. `esbuild` is pinned **exactly** in `package.json` on purpose: CI regenerates both
artifacts and `git diff --exit-code`s them, so output determinism is load-bearing. A flapping diff
means the version drifted — do not "fix" it by loosening the CI check.

**Both reading gestures are recognised INSIDE the WebView** — long-press (select text / press a
highlight) and the directional drag that turns the page. There is no RN gesture overlay over the
book any more, and there must not be one again: an overlay is the topmost hit-test target for every
touch in the viewer, so the document beneath it can never receive a `touchstart`, and text selection
(the first half of highlighting) stops working with nothing to explain why. See
`webview/src/touchGesture.ts`.

**Keep DOM-reading code in the entries and everything else in the pure modules.** That split is what
makes the outline flatteners, the line grid and the page/scale arithmetic testable by *calling* them.
If you are about to write a loop with a `+1` in it inside an entry, it belongs next door.

**Read the doc before** adding or changing any `ReaderMessage` type, any `READER_COMMANDS` entry, any
`window.TFReader` method, or anything in a template. **Then update it.** In the same change:

1. Change `readerBridge.ts` and let the compiler find the rest — a new message case or command fails
   to compile in the WebView half until it is handled.
2. Add the case to `parseReaderMessage()`. **`tsc` will not catch this one**: a missing case returns
   `null` and surfaces as `BRIDGE_PARSE_FAILED` at runtime. `parseReaderMessage` is NOT redundant now
   that types are shared — compile-time types do not survive the JSON hop, and the payload is built
   from book content.
3. Run `npm run reader:build-html`. **Both** `assets/reader/reader-epub.html` and `reader-pdf.html`
   are **generated but tracked**, and a change to `bridge.ts` or a shared pure module invalidates
   both.
4. Update the **Current surface** table in `WEBVIEW_BRIDGE.md`.
5. Run it on the simulator for anything that affects rendering. Unit tests cannot see a blank page.

**Format routing does NOT cross this bridge, and must not start.** `ContentFormat` is frozen, so the
host picks between `openEpub` and `openPdf` in typechecked TS and only the command *name* travels.
Each entry declares `TFReaderApi<'openEpub'>` or `TFReaderApi<'openPdf'>`, so defining the wrong one
is a compile error; and a test in `readerBridge.test.ts` fails if a `ContentFormat` literal ever
appears in a command script. Collapsing them into `open(base64, format)` reads tidier and puts a
frozen enum value on the wire.

**The trigger list is history, not a forecast — do not re-run it.** It existed to date the hand-sync
debt, prefs-application called it in, and the conversion happened before that command was written.
`WEBVIEW_BRIDGE.md` keeps the record of how that was decided, because a written expiry date whose
ending nobody records is how the next person re-litigates it.

**Prefs-application is the next task in `reader/`, and it is no longer blocked.** See "The
prefs-application design, as signed off" in `WEBVIEW_BRIDGE.md`: one `applyAppearance(ReaderAppearance)`,
sent **before** `open*`, resolved host-side into a flat primitive-only payload
(`features/personalization/readerAppearance.ts`). Adding it to `CommandArgs` now *requires* both
entries to define it, so the "must be in both halves" trap is enforced rather than remembered. Do not
let the payload split into a second `applyA11y` sibling — one command carries everything the WebView
renders with, for all three claimants (Personalization's typography/theme, Reader's `reduceMotion`,
Accessibility's `announce.pageChanges`).

## Reader accessibility — three rules that are easy to undo by accident

`src/features/reader/READER_ANNOUNCEMENTS.md` is the source of truth for the announcement seam;
`src/features/accessibility/WEBVIEW_A11Y_SPIKE.md` is the device evidence. Three things in the code
look like tidy-ups and are not:

**1. `ReaderWebView`'s container must NOT carry an `accessibilityLabel`.** On Android RN maps it to
`setContentDescription`, and a ViewGroup that is important-for-accessibility with one is a
screen-reader focus LEAF — TalkBack announces the container and never descends into the WebView's
virtual node tree, so no heading, paragraph or link in the book is reachable. This is the
"accessibilityLabel trap" three docs in `src/features/accessibility/` name, using the exact string
`"Book content"` as the example, and it was in this repo for two days. The named stop is a 1x1
`accessible` sibling INSIDE the container instead. Adding a label back to the container makes the
book unreadable to TalkBack with nothing on screen to explain why.

**2. A screen reader forces `flow: 'scrolled-doc'`, and the user is TOLD.** epub.js paginates with a
CSS multi-column strip that Android's WebView cannot compute usable accessibility bounds for (spike
F4/F6: the whole book present in the node tree at `bounds=[0,0][0,0]`). `readerA11yLayout.ts` is the
rule; it is applied in `ReaderScreen`'s `buildAppearanceWithFont`, NOT in Personalization's
`toReaderAppearance` — that function resolves preferences, and screen-reader state is not one.
**Never make this silent.** `ReaderScreen` shows a one-time `Alert` with a "Use pages anyway"
opt-out, and `DevPreferencesMenu` disables and annotates its Flow/Spread rows while it applies. The
opt-out lives in `a11yOverrideChoice.ts` — a module, not component state, because the prefs menu
arrives through `toolbarExtra` and is not `ReaderScreen`'s child.

**3. Nothing announces unconditionally.** Every announcement passes three gates: a previous value
exists, the user's `announce.pageChanges`/`announce.chapterChanges` allows it, and TTS is not
speaking. That last one is not optional — react-native-tts and the screen reader share one output
device and neither ducks, and `useTtsSession`'s `autoContinueChapter` turns pages *while reading*.
`announce()` (`a11yAnnounce.ts`) is the shared transport and is deliberately opinion-free; the rules
and wording are `readerAnnouncements.ts`, which is pure. Search results are **declined**, not
overlooked — `SearchMatchBar.tsx:50-64` carries the argument.

**A painted highlight's RECTS live for one layout, and epub.js will not re-measure them for you.**
marks-pane re-measures only inside `View.reframe()`, which a stylesheet change never reaches — the
chapter body is pinned to a fixed size in paginated flow, so more text means more columns and no
observed box changes; and even when it does fire, the reframe is gated on the strip's *rounded* width
moving. So `epub.entry.ts` asks for the re-measure itself (`scheduleGeometryRefresh` →
`forceReflow` + `repaintLiveAnnotations`), and `epubLayoutSignature.ts` decides when. That module is
exhaustive over `ReaderAppearance` by a compile-time canary: **adding a typography field there fails
to compile until it is classified as geometry or paint-only.** Classifying a new field as paint-only
when the shell renders with it is how the drift comes back, and no test can see it —
`HIGHLIGHT_LAYERS.md` §3a is the full account.

## Generated and tracked artifacts

| Artifact | Generated by | CI-checked? |
| -------- | ------------ | ----------- |
| `assets/reader/reader-epub.html` | `npm run reader:build-html` | **yes** |
| `assets/reader/reader-pdf.html` | `npm run reader:build-html` | **yes** |
| `assets/reader/sample-plaintext.pdf` | `npm run reader:build-sample-pdf` | **yes** |
| `assets/reader/sample-plaintext.epub` | `npm run reader:build-sample` | no — see below |
| `assets/reader/sample-search-index.json` | `npm run reader:build-sample-index` | no — see below |

Never hand-edit any of them; regenerate and commit the result.

The two HTML files come from one generator and share `webview/src/bridge.ts` (plus the pure modules),
so **one shared-module edit invalidates both** — rebuild and commit both, or CI's "Reader HTML is
freshly generated" step fails on whichever you forgot. Forgetting is a red build, not a silent stale
ship.

`sample-plaintext.pdf` is checked the same way ("Sample PDF is freshly generated"), because unlike
the EPUB it *is* byte-reproducible: `generateSamplePdf.ts` emits no `/CreationDate`, `/ModDate` or
`/ID`, and asserts their absence itself. **Do not add a date to it** — that breaks the CI check on
every run, and the honest fix would be removing the check rather than loosening it.

`sample-plaintext.epub` is **not** covered — JSZip stamps each entry with the generation time, so
it is not byte-reproducible and the same check would fail every run. That one is still on you.

`sample-search-index.json` is not covered either, but for a different reason: it *is* byte-
reproducible (no timestamps), so a freshness check would work. It is left out to keep CI's scope
unchanged for a file that is temporary scaffolding — see the deletion table below. Regenerate it if
the sample EPUB changes, or its CFIs will point into a book that no longer matches.

## Frozen contracts

`src/shared/contracts/` is the Week-1 freeze — the interface between seven capabilities owned by
five people. `__typecheck__.ts` is the canary. **If the canary goes red, a freeze broke: find out
why, don't "fix" the canary.** It is in `.prettierignore` deliberately (`@ts-expect-error` is
line-positional). Import via the `index.ts` barrel, never deep paths.

Relaxing a frozen field to match a **published** external spec is not a freeze break — it is the
freeze doing its job, because the frozen type was wrong about the wire. Pin the new shape in
`__typecheck__.ts` in the same change. Removing or renaming an exported type **is** a break, and
that is a Contracts Gate conversation.

## The external API contracts — read your capability's notes before touching wire code

`src/shared/contracts/` is the *internal* freeze. The **external** contracts are team wokay's and
team flambeau's published OpenAPI specs, and this app diverges from them in ways that are tracked,
not accidental. Findings have stable IDs (`A1`, `B4`, `C7`) — quote the ID rather than restating the
problem.

| Read this | Before touching | Owner |
| --------------------------------------------------------- | ---------------------------------------- | --------- |
| `src/shared/contracts/CONTRACT_ALIGNMENT.md` | anything in `src/shared/contracts/` | Ahana |
| `src/features/download/API_CONTRACT_NOTES.md` | any HTTP call, `DownloadError`, the open path | Abhinav |
| `src/features/encryption/API_CONTRACT_NOTES.md` | licence/key logic, `deviceKeypair.ts` | Abhinav |
| `src/features/sync/API_CONTRACT_NOTES.md` | `syncApi.ts` URLs, `syncConfig.ts`, a new entity | Karthik |
| `src/features/search/API_CONTRACT_NOTES.md` | `queryIndex.ts`, anything catalogue-shaped | Vaishnavi |
| `src/features/personalization/API_CONTRACT_NOTES.md` | prefs shapes that sync | Vaishnavi |
| `src/features/accessibility/API_CONTRACT_NOTES.md` | prefs scope, the TTS seam | Hruthik |

`CONTRACT_ALIGNMENT.md` is the ledger — status of every finding, and who has to close it. The
per-capability files are the detail: what breaks, what to change, what is blocked on another team's
answer, and which things look wrong but are correct and must not be "fixed".
`src/shared/contracts/API_CONTRACT_REVIEW_CONTEXT.md` is the full evidence base (every quote and
mapping table); it is committed rather than linked because three tracked files used to cite a
`flambeau-contract-comparison.md` that has never existed on any branch. **If you add a contract
citation, cite a path that resolves.**

**When you close a finding, strike it in both the capability file and the ledger, in the same
change.** A ledger that lags the code is worse than no ledger.

Two items are blocking and are questions for other teams, not code: **`C6`** (neither contract says
how the app receives its token after the SAML browser round trip — blocks all auth) and **`C7`**
(the `keyFingerprint` digest recipe is a guess, and the check now fails closed, so a wrong guess
rejects every encrypted download).

## Ownership — flag before editing another team's files

| Area                                                    | Owner        |
| ------------------------------------------------------- | ------------ |
| `src/features/reader/`                                  | Ahana        |
| `src/features/download/`, `src/features/encryption/`    | Abhinav      |
| `src/features/sync/`                                    | Karthik      |
| `src/features/personalization/`, `src/features/search/` (in-book search only) | Vaishnavi    |
| `src/features/accessibility/`                           | Hruthik      |
| `src/shared/`, `samples/`                               | Ahana (lead) |

`src/features/search/` is **in-book full-text** search over a decrypted per-book index — it touches
neither external contract. **Catalogue/discovery search** (wokay's OPDS feeds, institution picker,
`items:batch`) is a *different* capability that shares the word "search" and is currently
**unowned** — finding `C3` in `CONTRACT_ALIGNMENT.md`. This row does not cover it; do not assume the
OPDS client falls to Vaishnavi because it says "search."

Editing outside Reader needs the owner looped in. Prefer a test that documents the defect plus a
local workaround, and say clearly that the real fix needs sign-off.

The same boundary applies to **tooling strictness**, not just code. Type-aware ESLint
(`no-floating-promises`, `no-misused-promises`, `await-thenable`) is enabled for
`src/features/reader/**` only — see the scoped block at the bottom of `eslint.config.js`. It is
scoped because turning it on repo-wide would hand every other capability a pile of lint failures
on Reader's schedule. **To opt your directory in, add it to that block's `files` list** — the rule
set and the `projectService` wiring are already there, so it is a one-line change. Do not enable
it for someone else's directory on their behalf.

`__mocks__/react-native-quick-crypto.js` gained `randomBytes` on 2026-08-18 so `ensureSeeded()` could
be exercised under Jest, and `createCipheriv`/`createDecipheriv` the same day for `aesGcm.ts`'s swap
onto this module. Test-only, additive, and one-line passthroughs to Node's `crypto` in keeping with
that file's design — but it is a shared mock, so it is recorded here rather than only in git. Both
halves arrived on separate branches and collided on rebase; the resolution keeps every passthrough
and names both consumers, because the next such edit will collide the same way.

`__mocks__/expo-file-system.js` gained `Directory.list()` on 2026-08-25, for
`audioAssetResolver.ts`'s scratch-directory sweep. Same rules as the mock above and the same reason
for recording it here: it is shared (`contentStore.ts` is its other consumer). It mirrors the real
`Directory.list()` including the part that matters — it **throws** when the directory does not
exist, rather than returning `[]`, so a caller that stops guarding on `.exists` fails in the test
run instead of silently passing.

### Known open items — both are Abhinav's call

This list used to have four. **The stale keychain-cached BEK is fixed:** `store()` now clears the
cached BEK when the incoming `wrappedBek` differs from the persisted one
(`invalidateStaleCachedKeyIfRotated`, `contentStore.ts:206`), and
`contentStore.edgecases.test.ts` pins the fix rather than the defect. `devContentSeed.ts`'s
`destroy()`-before-`store()` stays, but for the other things destroy() clears, not for this.

The two below are memory/lifecycle defects found from Reader's side. They are **not** the whole
list of open items in Download/Encryption — the contract-driven ones live in those directories'
`API_CONTRACT_NOTES.md` (see the table above).

**The resident-ciphertext-after-`close()` item is FIXED**, by Abhinav on 2026-08-18: `close()` now
does `packageCache.delete(bookId)`, and `decryptBook()` additionally empties `pkg.content` for
non-Elite packages once the plaintext exists (two of the "roughly six" copies item 2 counts). The
cold-read trade-off it names below was taken deliberately and is documented at both call sites. The
cost lands in Reader — `prepareBook`'s `getFormat` is now only cheap WARM, because a cold
`resolvePackage` reads the whole ciphertext with a synchronous `bytesSync()`; `readerAssets.ts`
records that where the call is made.

**1. `close()` is now TERMINAL for Elite, which the frozen contract says only `destroy()` is.**
Introduced by the fix above: `close()` deletes the `packageCache` entry unconditionally, but Elite
(`licence.canPersist === false`) never persists — `store()` returns before its `writeFile` calls, so
that cache entry is the **only** copy. After `close()` an Elite book cannot be reopened at all:
`openSession` → `resolvePackage` → cache miss → `loadPersisted` finds no meta → the whole read fails
`DECRYPTION_FAILED` ("no stored package for this book"). Confirmed by probe, 2026-08-18.

`content-provider.ts` draws exactly the distinction this erases: `openSession` is specified for "a
stored (**or in-memory Elite**) book", `close()` is "REVERSIBLE", and `destroy()` is the "TERMINAL"
one. So this is a frozen-contract divergence, not a preference. It is invisible today because
nothing ships Elite content — `devContentSeed.ts` seeds `canPersist: true` — which is precisely why
it needs writing down rather than discovering later. **No test covers Elite close-then-reopen**;
`contentStore.test.ts`'s Elite block stops at `store()` and `decryptBook()`.

The fix is to guard the delete on the package rather than drop it unconditionally (Elite has no disk
copy to fall back to, so it must stay cached until `destroy()`). Reader has no workaround and this is
Abhinav's call — same reasoning as the item it replaced: `contentProvider.ts` exposes only
`closeBook`, and reaching past that seam is what the seam exists to prevent.

**2. Peak memory tracks the NUMBER of full-size copies, not the cost of making them.** The headline
holds and is now proven twice over: **both** codec swaps have landed, time fell by ~30x, and the
peak did not move. Measured on a real 20 MB EPUB (iPhone 17 Pro simulator, dev build):

| | 2026-08-13, before codec swaps | 2026-08-17, both landed | Verdict |
| --- | --- | --- | --- |
| App RSS peak | 609 MB | **631 MB — still unchanged** | 🔴 the real problem |
| WebContent RSS peak | 389 MB | 385 MB | 🟢 |
| `encode` (Reader's hop) | 1820 ms | 21 ms | ✅ fixed |
| `decrypt` (`getBook`) | 4882 ms | **104–118 ms** | ✅ fixed by Abhinav, `47bc4ce` |
| `getBookBase64` TOTAL | ~6.7 s | **149–310 ms** | ✅ |

Abhinav's `47bc4ce` swapped `aesGcm.ts` to `react-native-quick-base64` directly — better than this
file's earlier proposal to route `base64.ts` through it, because `base64.ts` stays the portable,
no-native-dependency fallback its own header promises. **Time is no longer the lever; nothing here
is waiting on a codec.**

What did NOT change is the point: opening a book still materialises the payload at full size
roughly **six** times, so a ~630 MB peak survives making every one of those copies ~30x faster. Only
*removing* copies moves the peak. That is now the sole remaining lever, and it is a design change
(streaming, or a bytes-in/bytes-out native API), not an optimisation.

**Copy removal has since STARTED, and the peak above predates it — do not quote the 631 MB as
current.** Abhinav's 2026-08-18 work removes two of those full-size residents for non-Elite books
(`decryptBook` empties `pkg.content` once the plaintext exists; `close()` drops the `packageCache`
entry). By this item's own logic that should move the peak, which makes it the first change here that
is worth re-measuring rather than reasoning about — and it is **unmeasured**: the numbers in the
table were taken before it landed. `READER_MEASUREMENTS.md` has the procedure.

Caveat that must travel with these numbers: **simulator, dev build, and the simulator has no
jetsam.** ~1.0 GB combined would be a likely foreground kill on a 2 GB device. Real-device
confirmation is still outstanding. Also still unmeasured: the post-`closeBook` drop.
`src/navigation/RootNavigator.tsx` has now landed (2026-08-23), and navigating BookList -> Reader ->
back to BookList genuinely unmounts `ReaderScreen` (`ReaderRouteScreen.tsx`'s own instance, not a
kept-alive one), so this measurement is no longer blocked — it just hasn't been taken yet.

**Confirmed for PDF on 2026-08-18, and it makes this item's headline stronger rather than weaker.**
The app-side cost is **8.66 MB of peak per MB of book, identical to three significant figures for
both formats** — which is exactly what "peak tracks the number of copies, and the copies are
Encryption's" predicts, now measured rather than argued. The renderers differ only inside the
WebView (7.30×/MB for pdf.js against 11.21×/MB for epub.js), so **no renderer choice moves this
item**; only removing copies does. Full tables, procedure and the four-process RSS correction —
app+WebContent undercounts by ~263 MB, because `WebKit.GPU` and `WebKit.Networking` were never
counted — are in `src/features/reader/READER_MEASUREMENTS.md`. Read that before re-measuring.

## Temporary scaffolding

`src/features/reader/devContentSeed.ts` stands in for Download's real download pass. Drop the
`ensureSeeded()` call in `readerAssets.ts` and delete the file when the real pass lands — Abhinav's
`src/features/download/downloadManager.ts` is that pass and has now landed, so this is closer than
it reads.

It has a **second** call site that is easy to miss: `src/navigation/BookListScreen.tsx` imports
`DEV_SAMPLE_EPUB_BOOK_ID`/`DEV_SAMPLE_PDF_BOOK_ID`/`DEV_FIXTURE_EPUB_BOOK_ID`/`DEV_FIXTURE_PDF_BOOK_ID`
from it to build the fixture rows that route to `<ReaderScreen bookId={...} />`. This moved from
`App.tsx` when `src/navigation/RootNavigator.tsx` landed (2026-08-23) — **but landing a navigator did
not unblock this deletion**, and it was never going to: the blocker was always "no real book
catalogue to list", not "no navigator to push a screen with". `BookListScreen` still lists the same
four dev fixtures the old picker did, now as real routes instead of a state-swapped tab bar. Deleting
`devContentSeed.ts` still needs a real library screen backed by an actual catalogue/download-listing
API before `BookListScreen`'s fixture rows (and the temp wiring around them) can go.

**`assets/reader/sample-plaintext.epub` is NO LONGER Reader's to delete alongside it.** This file
used to say to remove both together. Since Vaishnavi's search extractor landed, that EPUB is a
**shared fixture**: `src/features/search/extractor.ts:43` hard-codes its path, and deleting it breaks
`search.test.ts`. So its removal now needs Search looped in, separately from and later than
`devContentSeed.ts`.

**The dev search index goes with `devContentSeed.ts` too — five items, not one.** Nothing ships a
search index for the seeded book, so `queryBookIndex` returns `[]` for every search and the search
UI cannot be exercised on a device. `devContentSeed.ts` therefore encrypts a generated index into
`EncryptedPackage.index` (same BEK, own nonce) so there is something real to find. Delete together:

| # | Delete |
| - | ------ |
| 1 | `src/features/reader/scripts/buildSampleSearchIndex.ts` |
| 2 | `assets/reader/sample-search-index.json` (EPUB) |
| 3 | `assets/reader/sample-pdf-search-index.json` (PDF) |
| 4 | the `reader:build-sample-index` script in `package.json` |
| 5 | the `searchIndex` attachments in `devContentSeed.ts` |
| 6 | `src/features/reader/devSearchIndex.test.ts` (guards 2 and 3 against 5) |
| 7 | this table |

**There is one index PER FORMAT, and they are not interchangeable.** `queryBookIndex` throws when an
index's `bookId` is not the book requested, so attaching the EPUB's index to a PDF book turns every
search into an *error* rather than an empty list. That is why the PDF fixtures carried no index at all
for a while, which made PDF search look unimplemented — it was not. Search's PDF extractor
(`pdfSampleExtractor`, proven by `searchPdf.test.ts`) had been working the whole time; nothing fed it.
`DevFixture.searchIndex` names the index rather than saying whether to attach one, so a new fixture
cannot silently inherit the wrong book's.

`SearchPanel.tsx`, `useBookSearch.ts` and the search wiring in `ReaderScreen.tsx` are **not** on
that list — the UI is permanent and does not know the fixture exists. Removing all five must leave
it compiling and green, with on-device searches simply returning `[]` again. If deleting the
fixture breaks the UI or a test, the boundary has leaked and that is the bug.

`devContentSeed.ts` also reads `EXPO_PUBLIC_READER_FIXTURE_EPUB` and `EXPO_PUBLIC_READER_FIXTURE_PDF`
when set, to load the large books in `samples/fixtures/` instead of the bundled samples (measurement
scaffolding — Metro cannot `require()` an untracked 20 MB asset, and real content must never be
committed). **One path per format since 2026-08-20**, so both are populated in the same run and
`BookListScreen` offers four rows; the older single `EXPO_PUBLIC_READER_FIXTURE_PATH`, scoped to
`EXPO_PUBLIC_READER_FORMAT`, still works so recorded runs reproduce. It all goes with the rest of the
file.

**Point these at `samples/fixtures/` (gitignored), not at a copy pushed into the app container.**
Both work — the path is read directly and the simulator can see the repo — but a container copy is
an unencrypted book sitting in the app's own Documents directory, which is exactly what a
storage-leak sweep should flag and exactly what it will find. If you do push one in, delete it when
finished.

**The sample PDF goes with `devContentSeed.ts` as well — three items.** There is no `.pdf` anywhere
else in the repo, and there must never be a real one, so without a generated stand-in the entire
pdf.js path is unreachable on a device. Unlike `sample-plaintext.epub`, nothing else consumes this
one, so it has no shared-fixture entanglement and needs nobody looped in.

| # | Delete |
| - | ------ |
| 1 | `src/features/reader/scripts/generateSamplePdf.ts` |
| 2 | `assets/reader/sample-plaintext.pdf` + the `reader:build-sample-pdf` script and its CI step |
| 3 | `DEV_FORMAT` / `EXPO_PUBLIC_READER_FORMAT` and the PDF branch in `devContentSeed.ts` |

**The measurement fixture paths go with `devContentSeed.ts` as well — five more items**, added
2026-08-18 when the fixture path was extended to PDF, and widened 2026-08-20 to one path per format
so both large books are reachable at once. It is the same scaffolding as the rest of that file and
dies with it.

| # | Delete |
| - | ------ |
| 1 | `DEV_FIXTURE_EPUB_BOOK_ID` / `DEV_FIXTURE_PDF_BOOK_ID` and their `DEV_FIXTURES` entries |
| 2 | `EXPO_PUBLIC_READER_FIXTURE_EPUB` / `_PDF` / `_PATH` and the `*_FIXTURE_PATH` consts they feed |
| 3 | `src/features/reader/devFixturePath.test.ts` (it tests only the env-var crossings) |
| 4 | the `DEV_FIXTURES` table in `src/navigation/BookListScreen.tsx`, with the rest of that screen |
| 5 | whatever sits in `samples/fixtures/` — real content, gitignored, never committed |

**The two `Big` rows are the ones features get rolled out against, and the bundled pair is what gets
deleted first.** That is the stated intent as of 2026-08-20: `EPUB`/`PDF` (the generated ~3 KB
stand-ins) exist so the renderers are reachable with nothing pushed, and they retire once every
feature has been exercised on the real books. Deleting them is NOT the same removal as the table
above — `sample-plaintext.epub` is Search's fixture too (see that note). Nor does either removal
happen automatically when a real library screen replaces `BookListScreen`: that replacement is what
retires the `Big` rows (once every feature has been exercised on them) and, separately, is what
finally unblocks deleting `devContentSeed.ts` itself (see this section's opening note) — landing
`RootNavigator` did not do either, only a real catalogue behind it will.

`READER_MEASUREMENTS.md` is **not** on that list. It records numbers and a procedure that outlive the
fixture; what it needs then is a note saying how the books were loaded, not deletion. Neither is
`readerTiming.ts` — the probes are permanent and off by default.

`reader-pdf.template.html`, `pdfjs-dist` and the `openPdf` command are **not** on that list — PDF
support is permanent. What goes is only the fixture that lets it be tested before a library screen
exists.

`EXPO_PUBLIC_READER_FORMAT=PDF` is how you reach the pdf.js path on a device: it flips
`DEV_SAMPLE_BOOK_ID` to a distinct id and seeds the PDF fixture with `format: 'PDF'`, and everything
downstream routes off the stored format. A distinct id is load-bearing, not cosmetic —
`ensureSeeded()` short-circuits on `isAvailableOffline()`, so a shared id would serve whichever book
was stored first and `getFormat()` would report the wrong format for it.

### `fakeReaderTextProvider.ts` — stands in for the real TTS text provider

`src/features/reader/tts/fakeReaderTextProvider.ts` serves canned sentences with **synthetic CFIs
that resolve against no book**, so Accessibility (Hruthik) can build a TTS session before the real
provider exists. The real one is blocked behind the typechecked-WebView conversion; without the
fake, Accessibility either idles or hand-rolls a stub, and a hand-rolled stub is a guess at the
interface that makes integration a rewrite rather than a substitution.

**`src/features/reader/tts/readerTextProvider.ts` is NOT scaffolding.** It is the permanent,
agreed contract and it stays. Only the fake goes. Delete together:

| # | Delete |
| - | ------ |
| 1 | `src/features/reader/tts/fakeReaderTextProvider.ts` |
| 2 | `src/features/reader/tts/fakeReaderTextProvider.test.ts` |
| 3 | every `createFakeReaderTextProvider` call site outside `src/features/reader/tts/` |
| 4 | the fake's section in `src/features/reader/TTS_PROVIDER.md`, and this one |

Port `fakeReaderTextProvider.test.ts` rather than dropping it — every case pins a property of the
seam, not of the fake, so it is the checklist the real provider must satisfy. The test-only handles
live on `FakeReaderTextProvider` and deliberately **not** on `ReaderTextProvider`, so production
code typed against the interface cannot reach them; if deleting the fake breaks something outside
`tts/`, the boundary has leaked and that is the bug.

`src/features/reader/TTS_PROVIDER.md` is the source of truth for this seam — the decisions, the
ownership boundary, the sequencing, and the open items. Read it before changing
`readerTextProvider.ts`, and update it in the same change.

## Session-only reading progress — not a Sync/Personalization concern

`src/features/reader/sessionProgress.ts` is an in-memory `Map<BookId, ReaderPosition>`, written from
`ReaderScreen`'s `onRelocated` prop and read by `src/navigation/ReaderRouteScreen.tsx` to resume a
book at the position it was left at, as long as `BookListScreen -> Reader -> BookListScreen ->
Reader` all happens within one app run. It is **not** durable: module state, gone on relaunch, on
purpose — that is what "session" means here.

**Do not confuse this with `progressStore.savePage()`/`savePosition()`** (Sync's side, referenced in
`ReaderScreen.tsx`'s own note on its `position` state) — that is the durable, cross-device progress
record, and writing it is deliberately Personalization/Sync's stage, not Reader's. This module solves
a narrower, permanent-Reader-scaffolding problem: an in-app navigator with no durable-progress wiring
behind it yet would otherwise always reopen a book at its start.

## Verifying a change

```
npm test          # jest
npm run typecheck # tsc --noEmit
npm run lint      # eslint --max-warnings=0
```

All three must pass. For reader changes that affect rendering, also run it on the simulator
(`npm run ios`) — `expo-dev-client` is required; Expo Go cannot load the crypto native modules.

## Comment style in this codebase

Comments explain **decisions and traps**, not what the code plainly does — why a whitelist includes
`about:*`, why teardown is its own effect, why `require()` appears in a `.ts` file. Match that.
Do not leave historical narrative ("this used to be…") once it stops being load-bearing, and do not
let prose describe a state the code has moved past.
