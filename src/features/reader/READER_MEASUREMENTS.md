# Reader whole-book measurements — procedure and results

**Owner:** Reader (Ahana) · **Scope:** the whole-book open path, per content format.

This file exists because the numbers that drive Reader's design decisions were recorded in four
places, all of them EPUB, and none of them recorded **how** they were taken. A number without its
procedure cannot be re-run, and a number that cannot be re-run becomes an assumption with a date on
it — the exact failure `WEBVIEW_BRIDGE.md` calls out for triggers.

The EPUB numbers stay where they are, in `CLAUDE.md`'s "Known open items" table: there they are the
_evidence for open item 2_ (peak tracks the number of full-size copies), which is Abhinav's to close.
This file is the procedure, the PDF results, and the per-format comparison.

---

## What is already known — the EPUB baseline

Real 20 MB EPUB (`samples/fixtures/20mb_EPUB.epub`, 20,951,889 bytes), **iPhone 17 Pro simulator,
dev build**, warm open.

|                         | 2026-08-13, before codec swaps | 2026-08-17, both landed |
| ----------------------- | ------------------------------ | ----------------------- |
| App RSS peak            | 609 MB                         | **631 MB — unchanged**  |
| WebContent RSS peak     | 389 MB                         | 385 MB                  |
| `encode` (Reader's hop) | 1820 ms                        | 21 ms                   |
| `decrypt` (`getBook`)   | 4882 ms                        | 104–118 ms              |
| `getBookBase64 TOTAL`   | ~6.7 s                         | 149–310 ms              |

**Two base64 lengths are quoted in the tree and they are not the same measurement.**
`readerAssets.ts:148` says 27,935,852 chars; `WEBVIEW_BRIDGE.md:317` says 27,962,028. The real book's
is the former — `ceil(20951889 / 3) * 4 = 27,935,852`. The larger figure is the **synthetic payload**
used to smoke-test `injectJavaScript` before the real book existed. Both are correct about different
things; neither should be quoted without saying which.

---

## What is not known, and why this run exists

Every figure above is EPUB. Nothing about the PDF path has been measured, and it differs in ways that
cut both directions:

- `assets/reader/reader-pdf.html` is **1,436,749 bytes** against the EPUB shell's 360,995 — pdf.js
  plus its worker, inlined. That is parsed on every open, before `ready`.
- pdf.js runs a real worker thread and rasterises to a canvas; epub.js unzips 388 entries and lays
  out 364 image blobs. These are not the same memory shape at all.
- Until the fixture work below landed, the pdf.js path was only reachable with the 2,922-byte bundled
  sample, which measures nothing.

---

## Procedure

### Prerequisites

- `expo-dev-client`. Expo Go cannot load the crypto native modules.
- A **real, image-heavy PDF** at `samples/fixtures/`. `15mb_PDF.pdf` (14.66 MB, 50 pages) is what the
  results below use. It is **smaller** than the ~20 MB EPUB baseline, which is why every comparison
  below is stated **per MB of book** rather than as a raw peak. Three constraints:
  - **≤ 25 MB.** `MAX_DECRYPTED_BYTES` (`contentStore.ts:41`) is checked against the persisted
    `originalLength` _before the bytes are read_ (`:275-280`), so an oversized book is refused rather
    than measured.
  - **With an outline, if you can find one.** `15mb_PDF.pdf` has none, which is why H7 below is
    untested. A PDF carrying a few hundred bookmarks is the missing fixture.
  - **Not synthetic.** A real PDF is 20 MB because of embedded images and fonts, and that is what
    drives worker RSS and rasterisation cost. A text-only PDF at 20 MB would be roughly 33,000 pages
    of a few hundred bytes each: it would stress the page tree, not the raster path, and would return
    a _reassuring_ WebContent number that means nothing.
- `samples/` is gitignored in full (`.gitignore:53`, a bare `samples` rule). Confirm with
  `git check-ignore -v <path>` rather than assuming — moving the directory silently un-ignores it.

### Launch

```
EXPO_PUBLIC_READER_TIMING=1 \
EXPO_PUBLIC_READER_FORMAT=PDF \
EXPO_PUBLIC_READER_FIXTURE_PDF="$PWD/samples/fixtures/<book>.pdf" \
EXPO_PUBLIC_READER_FIXTURE_EPUB="$PWD/samples/fixtures/<book>.epub" \
npx expo start --dev-client --clear
```

**One path per format since 2026-08-20**, so both large books are populated in the same run and the
picker can offer all four at once. `EXPO_PUBLIC_READER_FORMAT` no longer decides which large book
_exists_ — only which one is open before the first tap. Set just the one you are measuring if you
prefer; the other tab then raises an error naming its variable rather than falling back to a
stand-in.

`EXPO_PUBLIC_READER_FIXTURE_PATH` still works and still applies to whichever format
`EXPO_PUBLIC_READER_FORMAT` selects, so every run recorded in this file reproduces unchanged.

`--clear` is **not optional**: `EXPO_PUBLIC_*` values are inlined at transform time, so a warm Metro
cache keeps serving the previous one (`T4_Readme.md`). Getting this wrong measures the last run.

The two env vars are **independent axes** — `FIXTURE_PATH` picks the source, `EXPO_PUBLIC_READER_FORMAT`
picks the format — and each of the four combinations lands on its own book id, so none can be served
another's stored package. `devFixturePath.test.ts` pins that.

### Three ways to measure the wrong thing

1. **Measure the SECOND launch.** The first one seeds: a synchronous whole-file read
   (`devContentSeed.ts:220`) plus an in-process encrypt (`:252`), which peaks higher than any warm
   open and is not what the EPUB numbers measured.
2. **Do not tap the picker mid-run.** It offers four fixed tabs (`devFixtureOptions` in `App.tsx`):
   `EPUB` and `PDF` are the ~3 KB bundled stand-ins, `Big EPUB` and `Big PDF` are the pushed books.
   A stray tap on either of the first two switches you to a stand-in and the numbers stay plausible
   while the book is wrong. Check the selected tab is the `Big` one before recording anything —
   which is easier than it was when the pushed fixture was an unlabelled first row.
3. **If you swap the fixture file while keeping the id**, clear the seed marker or you re-measure
   the previous book:
   `rm -f "$(xcrun simctl get_app_container booted com.taylorandfrancis.tfreader.dev data)/Documents/dev-seed-dev-fixture-pdf.version"`

### Spans to record

`EXPO_PUBLIC_READER_TIMING=1` emits `[TFPERF]` lines to the Metro terminal and the Xcode console.

| Span                           | Source                | Notes                                                                  |
| ------------------------------ | --------------------- | ---------------------------------------------------------------------- |
| `seed`                         | `readerAssets.ts:124` | First run only; discard                                                |
| `format`                       | `readerAssets.ts:128` | **Must say `format=PDF`. If it says EPUB, stop — the wiring is wrong** |
| `verifyAccess`                 | `readerAssets.ts:200` | Network; noise here                                                    |
| `decrypt bytes=N`              | `readerAssets.ts:215` | Encryption's hop; format-blind, expect the EPUB figure                 |
| `encode chars=N`               | `readerAssets.ts:226` | Reader's `fromByteArray`                                               |
| `getBookBase64 TOTAL`          | `readerAssets.ts:228` | Host-side total                                                        |
| `ready at=`                    | `ReaderScreen.tsx`    | **The new number** — 1.4 MB shell parse vs 360 KB                      |
| `open sent chars=N format=PDF` | `ReaderScreen.tsx`    | Payload crossing the bridge                                            |
| `open -> rendered`             | `ReaderScreen.tsx`    | Decode + transfer + parse page 1 + rasterise page 1                    |
| `open -> toc`                  | `ReaderScreen.tsx`    | Outline resolution — see H7                                            |
| `open -> error code=`          | `ReaderScreen.tsx`    | If the transport dies                                                  |

Every line carries `heapMB=`, which is the **Hermes JS heap only**. It excludes the WebView, the
pdf.js worker and native buffers — which is the whole reason RSS has to come from outside the app.

### Capturing RSS

There is no RSS instrumentation in code, and there should not be: it would report from a path holding
decrypted licensed content.

- **App RSS** — Xcode → Debug navigator → Memory gauge, peak during the open. This is what "App RSS
  peak" above means. It only sees the debugged process.
- **WebContent RSS** — Xcode's gauge cannot see it. Simulator processes are ordinary macOS processes,
  so poll and keep the maximum (`rss` is in KB):
  ```
  while true; do ps -Ao rss,comm | grep -i WebContent; sleep 0.2; done
  ```
  Expect more than one WebContent process with the app running; take the one that grows.
- **>>> AND TWO MORE, WHICH THIS FILE ORIGINALLY MISSED. <<<** The WebView spans **four** processes,
  not two: `WebKit.GPU` (canvas rasterisation — 127 MB below) and `WebKit.Networking` (136 MB) are
  never counted by the pair above. Enumerate rather than grep for one name, filtering to the
  simulator's own copies by path:
  ```
  ps -Ao pid,rss,comm | grep -E "CoreSimulator.*(WebKit|TFReader.app/TFReader)" | grep -v grep
  ```
  Both extras are **shared** WebKit services, so not all of their footprint is the reader's — which is
  why the app+WebContent pair is kept as the baseline-comparable number and read as a **lower bound**
  rather than replaced. See H6 in the results.
- Page through the whole document and jump via Contents **before** reading the peak. It is not at
  first render.

Carry the same caveat the EPUB numbers carry: **simulator, dev build, and the simulator has no
jetsam.** ~1.0 GB combined would be a likely foreground kill on a 2 GB device — and per H6 the true
combined figure is **higher** than the two-column pair reports, so that estimate is optimistic rather
than conservative. Real-device confirmation is separate and still outstanding.

### Run matrix

Run 4 matters more than it looks: without it, any PDF/EPUB delta is confounded with everything that
has landed since 2026-08-17.

| #   | Shell | Book             | Isolates                                                        |
| --- | ----- | ---------------- | --------------------------------------------------------------- |
| 1   | PDF   | bundled 2,922 B  | Shell + canvas + worker floor; `ready at=` for the 1.4 MB shell |
| 2   | PDF   | ~20 MB real      | The answer. Subtract #1 for the book's own cost                 |
| 3   | EPUB  | bundled 3,638 B  | Shell floor for the 360 KB shell — the `ready at=` comparison   |
| 4   | EPUB  | `20mb_EPUB.epub` | Reconfirms 631/385 on today's build                             |

---

## Hypotheses — predictions before the run

Recorded **before** measuring, deliberately. A prediction written afterwards is not a prediction, and
this path has already had two comments that asserted an unmeasured performance claim and were wrong
(see `WEBVIEW_BRIDGE.md`'s Day 4 row).

| #   | Prediction                                                                                                                                                                                                                                                                                                                     | Actual                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| H1  | **App RSS ≈ unchanged at ~631 MB.** Everything up to `injectJavaScript` is format-agnostic — same `getBookBase64`, same ~6 full-size copies, all Encryption's. A material difference means something format-specific leaked into the app half, which is itself the finding                                                     | **CONFIRMED** — 8.66×/MB, both formats             |
| H2  | **WebContent RSS BELOW the EPUB's 385 MB.** See the transfer finding below: one 20 MB copy inside WebContent, against EPUB's 388 inflated zip entries and 364 image blobs                                                                                                                                                      | **CONFIRMED** — 7.30× vs 11.21×/MB                 |
| H3  | **The base64 STRING is the larger WebView-side cost, not the bytes.** `openPdf`'s parameter is captured by its whole `.then` chain, so a ~28M-char string stays reachable until the open settles: expect a 28–56 MB step (JSC may store latin1 at 1 byte/char or UTF-16 at 2) that does not fall until then                    | not isolated — needs an in-WebView probe           |
| H4  | **`ready at=` measurably later for the PDF shell** — tens of ms, not hundreds — and RSS carries the _parsed-code_ cost, typically several× source size, so budget ~5–15 MB rather than 1.4 MB. This is the number nobody has, and it is what tells you whether the two-template split earned its keep                          | memory **CONFIRMED** (~24 MB); time not measurable |
| H5  | **Canvas cost tracks the DEVICE, not the book.** `canvas.width` is `fit × devicePixelRatio`, so a 3× phone is a fixed ~8 MB backing store whether the PDF is 2.9 KB or 20 MB — and because one page is rasterised at a time, **peak does not grow with page count**. That is the real answer to "does this scale to 400 pages" | **NOT TESTED** — no page-turn automation           |
| H6  | **The pdf.js worker is a thread inside WebContent, not its own process**, so its 20 MB lands in that one number and there is no third column to capture                                                                                                                                                                        | **CONFIRMED**, and found 2 uncounted processes     |
| H7  | **`open -> toc` is where a large PDF stalls**, not `open -> rendered`. Every outline destination is one or two worker round trips, resolved concurrently but still N of them. Over ~1 s, the fix is batching or lazy resolution — not the bridge                                                                               | not tested — this fixture has no outline           |

### The transfer finding, verified in the installed dist

H2 rests on this, so it was checked rather than assumed — an earlier draft of this plan had it
backwards, predicting a structured clone.

`pdfjs-dist` 3.11.174, `build/pdf.js`:

- `:1058` — `sendWithPromise("GetDocRequest", source, source.data ? [source.data.buffer] : null)`
- `:9201-9212` — `sendWithPromise(actionName, data, transfers)` passes that third argument straight to
  `comObj.postMessage(msg, transfers)`, i.e. as the structured-clone **transfer list**
- `:1077-1091` — `getDataProp` takes our `ArrayBuffer` down the `isArrayBuffer` branch to
  `new Uint8Array(val)`, a **view**, not a copy

So pdf.js **transfers** the buffer to its worker zero-copy and leaves the main-thread buffer
**detached**. That is a performance fact and a data-minimisation one: after the handoff, the WebView's
main thread no longer holds the book's bytes at all.

---

## Results

**Measured 2026-08-18, iPhone 17 Pro simulator (iOS 26.5), dev build, warm opens.**
PDF fixture: `samples/fixtures/15mb_PDF.pdf` — 15,368,312 bytes (14.66 MB), 50 pages, PDF 1.3
linearized, ~307 KB/page with one image draw op per page plus real text, **no outline**.

| Run | Shell | Book         | App RSS    | WebContent RSS | `decrypt` | `encode` | `TOTAL` | `open -> rendered` | `open -> toc`       |
| --- | ----- | ------------ | ---------- | -------------- | --------- | -------- | ------- | ------------------ | ------------------- |
| 1   | PDF   | 2,922 B      | 453 MB     | 184 MB         | 4 ms      | 0 ms     | 42 ms   | 46 ms              | 50 ms (`items=4`)   |
| 2   | PDF   | **14.66 MB** | **580 MB** | **291 MB**     | 85 ms     | 18 ms    | 142 ms  | 249 ms             | 256 ms (`items=0`)  |
| 3   | EPUB  | 3,638 B      | 453 MB     | 160 MB         | 5 ms      | 0 ms     | 42 ms   | 69 ms              | 69 ms (`items=3`)   |
| 4   | EPUB  | 19.98 MB     | 626 MB     | 384 MB         | 107 ms    | 21 ms    | 168 ms  | 322 ms             | 323 ms (`items=22`) |

**Run 4 reconfirms the 2026-08-17 baseline within 1%** — 626/384 against the recorded 631/385 — so
runs 1–3 are comparable to it rather than to a build that has drifted. That was the whole point of
including it, and it is the reason the numbers below can be trusted against the older table.

### The book's own cost, isolated

Subtracting each shell's floor (the same shell with a ~3 KB book) is what separates the renderer's
fixed cost from the payload's:

|                                | App RSS | per MB of book | WebContent RSS | per MB of book |
| ------------------------------ | ------- | -------------- | -------------- | -------------- |
| PDF, 14.66 MB (run 2 − run 1)  | +127 MB | **8.66×**      | +107 MB        | **7.30×**      |
| EPUB, 19.98 MB (run 4 − run 3) | +173 MB | **8.66×**      | +224 MB        | **11.21×**     |

### H1 — confirmed, to three significant figures

**8.66× for both formats.** The app-side cost per byte of book is identical, which is exactly what
"everything up to `injectJavaScript` is format-agnostic" predicts — same `getBookBase64`, same chain
of full-size copies, all of them Encryption's. `decrypt` and `encode` scale with size and not with
format (85/18 ms at 14.66 MB against 107/21 ms at 19.98 MB), so nothing format-specific has leaked
into the app half.

### H2 — confirmed. The PDF path is materially cheaper in the WebView

**7.30× against EPUB's 11.21× per MB — the PDF path holds ~35% less per byte.** That is the
zero-copy transfer plus one-page-at-a-time rasterisation, against JSZip inflating 388 entries and
epub.js laying out 364 image blobs. It holds despite the PDF shell being 4× larger, and despite this
fixture being image-heavy — the case most likely to have gone the other way.

Extrapolating the PDF path to the EPUB's size at the measured rates: **~626 MB app / ~330 MB
WebContent at 20 MB**, against EPUB's 626/384. Same app peak (as H1 requires), ~54 MB less in the
WebView.

### H4 — confirmed in direction, wrong in magnitude, and only measurable as memory

The shell floors are **453 MB app for both** — so the 1.4 MB PDF shell costs nothing measurable on
the app side, which makes sense because it lives in WebContent. In WebContent it is
**184 vs 160 MB: ~24 MB for the extra ~1.08 MB of source**, about 17× its size once parsed, plus the
worker and the canvas. This file predicted "budget ~5–15 MB"; 24 MB is the answer, so the prediction
was the right shape and low by roughly 2×.

**The time half is not measurable with today's probes, and that is an instrumentation gap rather
than a result.** `logEvent` prints `at=<now()>`, and on this runtime `now()` is a boot-relative clock
(~143,132,813 ms), so `ready at=` can only be differenced against other events _inside the same
run_. There is no span from WebView load to `ready`. Adding one is the fix if shell parse time ever
matters.

### H6 — confirmed, and it exposed a defect in this file's own procedure

No separate pdf.js worker process appears: the dedicated worker is a thread inside WebContent, as
predicted. But enumerating every process rather than grepping for one found **four**, not two:

| Process                       | Peak RSS    |
| ----------------------------- | ----------- |
| `TFReader` (app)              | 599 MB      |
| `com.apple.WebKit.WebContent` | 291 MB      |
| `com.apple.WebKit.Networking` | 136 MB      |
| `com.apple.WebKit.GPU`        | 127 MB      |
| **Simulator-only combined**   | **1153 MB** |

**So "app + WebContent" undercounts by ~263 MB.** Canvas rasterisation lands in `WebKit.GPU`, and
neither that process nor `WebKit.Networking` has ever been counted — including in the EPUB baseline
this file compares against. Two caveats before anyone quotes 1153 MB: those two are _shared_ WebKit
service processes, so not all of their footprint is attributable to the reader, and app RSS here
(599 MB) is ~19 MB above run 2's 580 MB, which sets run-to-run variance at roughly ±20 MB.

The practical consequence is that `CLAUDE.md`'s "~1.0 GB combined would be a likely foreground kill
on a 2 GB device" is, if anything, **optimistic** — the real figure is higher and the conclusion is
unchanged in direction. The two-column procedure above has been left as the comparable-to-baseline
measurement and should be read as a **lower bound**.

### Not tested, and why — so nobody reads silence as a pass

- **H3 (the base64 string's WebView-side cost)** — not isolated. It needs either a heap snapshot or a
  probe inside the WebView; the process-level numbers cannot separate a 20 MB string from a 20 MB
  buffer.
- **H5 (peak does not grow with page count)** — **not tested.** There is no page-turn automation
  available here, so every measurement above is the peak of an _open_ with page 1 displayed. The
  reasoning stands (one canvas, sized by the device) but it is untested, and this fixture's 50 pages
  are exactly what would test it.
- **H7 (outline stall)** — not tested at scale. This fixture has **no outline** (`items=0`), and the
  bundled sample's 4 entries resolve inside a 50 ms `open -> toc`. The mechanism works; a
  several-hundred-entry outline remains unmeasured, and a fixture with one is what it needs.

### What this settles for the ~20 MB budget

The PDF path is **the cheaper of the two renderers per byte**, and it is not the constraint. Peak is
still dominated by the app-side copies, which are format-blind and Encryption's — `8.66×` the book's
size before the WebView sees a byte. At 14.66 MB that is already 580 MB app RSS; at the 25 MB cap it
extrapolates to roughly 670 MB app on its own. **So `MAX_DECRYPTED_BYTES = 25 MB` is close to the
real ceiling on this device class, for the same reason it already was for EPUB, and removing copies
is still the only lever that moves it.** Nothing here argues for changing the PDF renderer.

### Item 1 verified with real bytes, not just by reading the code

After the 14.66 MB open, the app container holds **no plaintext PDF at all** — every file over 100 KB
was checked for a `%PDF` header and none matched. What is persisted is
`dev-fixture-pdf.content.bin` at **15,368,340 bytes = 15,368,312 + 28**, i.e. the payload plus
`nonce(12) || tag(16)` exactly as `EncryptedPackage.encryption.layout` specifies. The only other
large files are the two generated reader shells in `Library/Caches`, which are the app's own assets.

## Deliberately not measured

**`wholeBookBudget.test.ts` is not parameterised over format, and should not be.** Every hop it times
is byte-oriented and format-blind; its "plaintext" is `Buffer.alloc(size)` with a seed string copied
in, which is not a PDF at all; and pdf.js is never loaded — there is no WebView, no worker, no canvas.
A `format: 'PDF'` row would be a _rename_ of the EPUB row that later reads as if the renderer had been
covered. The file's own header is careful to call itself "a LOWER BOUND, NOT A MEASUREMENT"; a PDF row
would quietly undo that.

## Standing confounders

Both are open items in `CLAUDE.md`, both Abhinav's call, and both affect any peak recorded here:

- **`close()` retains the ciphertext.** It zeroes the plaintext but never touches `packageCache`, so
  20 MB stays resident after `closeBook`.
- **The post-`closeBook` drop is unmeasurable** until `RootNavigator` exists to unmount
  `ReaderScreen`.
