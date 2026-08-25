# Audio memory measurement — the resolver stopgap's JS-heap spike

**Run: 2026-08-25. Owner: Reader (Ahana). AUDIO PHASE 5.**

**Classification: 🟢 GREEN for memory — but only because the dangerous case is unreachable, and what
makes it unreachable is a 🔴 functional blocker this phase found instead.** Read both halves; the
second is the one that matters.

## The headline, before the numbers

This phase set out to measure the stopgap resolver (`audioAssetResolver.ts`) against a realistic
150–300 MB audiobook. **That measurement cannot be taken, because that book cannot be opened.**

`MAX_DECRYPTED_BYTES = 25 MB` (`contentStore.ts:41`) is a hard, enforced, **format-blind** cap. It is
checked at `contentStore.ts:409` — *before* the `if (!pkg.encryption)` audio branch at `:418` — and
again on the cold-read path at `:275`. Audio is not exempt from it. So the worst spike the stopgap
can ever produce is bounded by a 25 MB input, and the spike the phase was worried about is
structurally impossible.

That is a reassuring answer to the question asked and an alarming answer to the question underneath
it: **no real audiobook fits.** 25 MB is roughly **26 minutes** at 128 kbps, or ~52 minutes at 64 kbps
mono. A typical audiobook is 8–15 hours — one to two orders of magnitude over the cap.

## Method, and how it differs from the documented one

`READER_MEASUREMENTS.md`'s procedure (Xcode memory gauge, four-process `ps` polling, manual taps
through `BookListScreen`) is a **device/simulator, GUI, human-in-the-loop** procedure. It was not used
here and could not be: this run had no interactive simulator session.

Instead: the real `contentStore` / `contentProvider` / `audioAssetResolver` were driven under Jest
(Node 20 / V8), with `--expose-gc`, measuring `process.memoryUsage().arrayBuffers` — the metric that
actually tracks `Uint8Array` backing stores, which is where whole-book bytes live. Peak was sampled
by patching `File.prototype.write` so the sample lands at the instant both copies are simultaneously
live. A throwaway harness, deleted after the run; nothing was committed.

**What that costs, stated plainly.** V8 is not Hermes. Absolute process RSS does **not** transfer, and
neither does GC timing. What *does* transfer is the thing being measured: the **number and size of
full-size buffers the path allocates** is a property of the JavaScript, identical on any runtime. So
the multiplier below is trustworthy and the absolute MB figures should be read as "this many
book-sized copies", not as a Hermes RSS prediction.

Every number below reproduced **byte-identically across three consecutive runs**.

## Numbers

### The enforced ceiling, and a defect at it

| Step, with a 150 MB audio package | Result |
| --- | --- |
| `contentStore.store()` | **ACCEPTED** — writes all 150 MB to disk |
| `contentStore.isAvailableOffline()` | **`true`** |
| `contentProvider.getBook()` | `DECRYPTION_FAILED` — *"book is 157286400 bytes, exceeds the 26214400-byte RAM budget"* |
| `audioAssetResolver.resolveAudioAssetUri()` | same failure, propagated |

**This asymmetry is a defect, and it is Abhinav's (Encryption's) call, not Reader's.** The write path
accepts a book the read path will always refuse. The user-visible result is an audiobook that
downloads to completion, consumes 150 MB of disk, reports itself available offline — and then fails
to play, permanently, with a decryption error that is not about decryption. Failing at `store()`
would cost the same amount of nothing and would tell the truth at the moment the truth is knowable.
Flagged, not fixed: `contentStore.ts` is outside Reader's ownership.

### The resolve spike, at sizes that are actually reachable

| Book size | Baseline | Peak | Spike | Ratio | Retained after GC |
| --- | --- | --- | --- | --- | --- |
| 8 MB | 1.7 MB | 25.7 MB | **+24.0 MB** | 3.00× | **+0.0 MB** |
| 16 MB | 1.7 MB | 33.7 MB | **+32.0 MB** | 2.00× | **+0.0 MB** |
| 25 MB (the ceiling) | 1.7 MB | 51.7 MB | **+50.0 MB** | 2.00× | **+0.0 MB** |

Independently, instrumenting `Uint8Array` construction: **exactly 2 full-size allocations** occur
during a resolve — `pkg.content` (read from disk by `loadPersisted`) and the plaintext copy
`decryptBook` makes at `contentStore.ts:424` (`new Uint8Array(pkg.content)`, which audio pays despite
never being encrypted).

The 8 MB row reading 3.00× rather than 2.00× is reproducible but is a **GC-timing artifact, not a
third copy**: the allocation probe finds two allocations at every size. `arrayBuffers` counts
unreclaimed garbage, and at 8 MB V8 had not yet collected the store-phase buffer. Read the deterministic
allocation count (2) as the truth and the ratio as an upper bound.

**Worst case at the enforced ceiling: +50 MB, transient, fully reclaimed.**

### Sustained playback

**+0.0 MB.** Measured as retention: after `resolveAudioAssetUri` returns and its result is still
referenced, `arrayBuffers` is back to baseline. What the player screen holds is a **126-byte string**
— a `file://` URI — not bytes.

This is the expected result and it confirms the phase's premise: `expo-audio` streams from the URI
through AVPlayer/ExoPlayer, so the rolling buffer is native and never enters the JS heap.
`AudioPlayerScreen` retains `uri`, plus per-tick status numbers.

**Caveat, so nobody reads more into this than it says:** this is the *JS-heap* half, measured under
Node. Sustained-playback **native** RSS on a device was not measured, and the flatness of the JS heap
says nothing about it. The reason to believe it is small is architectural (a streaming native player
holds a rolling buffer, not a file) — an argument, not a measurement. A device run would close this,
and it is the one gap worth closing later.

## Against budget

First, a correction to the framing this phase was given: **1153 MB is not a budget.** It is
`READER_MEASUREMENTS.md`'s *measured four-process peak* for the EPUB/PDF reader path — app +
WebContent + WebKit.GPU + WebKit.Networking, on the simulator. The actual budget is device RAM, with
`CLAUDE.md`'s standing note that ~1.0 GB combined is a likely foreground jetsam kill on a 2 GB device.

**Audio does not pay that 1153 MB at all.** There is no WebView on the audio path — by contract
design. Audio's footprint is app-process only, and the stopgap contributes at most a transient
+50 MB to it.

| | Figure |
| --- | --- |
| Peak during resolve (25 MB, the ceiling) | **+50 MB, transient** |
| Peak during sustained playback (JS heap) | **+0.0 MB** |
| Delta | **50 MB** |
| Headroom vs a ~1.0 GB practical ceiling | **~95%** unused by this path |

**Stacking with a reader open, the one case worth naming:** the reader path already measures
~1153 MB on the simulator. Adding audio's +50 MB transient on top would be genuinely dangerous —
but it requires resolving an audiobook while an EPUB/PDF is open, which no current flow does
(`BookListScreen` routes AUDIO away from the reader entirely, and there is one player at a time). Not
a present risk; worth remembering if a "continue listening while reading" feature is ever proposed.

## Recommendation

**Ship the stopgap as-is. Its memory cost is not a reason to prioritize anything.** 50 MB transient,
fully reclaimed, on a path with no WebView, is immaterial. If the plaintext-path accessor were
justified *only* by memory, this measurement would argue for deprioritizing it.

**But it is not, and this run changes the argument for it rather than weakening it.**

`CONTRACTS_GATE_PROPOSAL_PLAINTEXT_PATH.md` proposes returning the existing on-disk path instead of
copying bytes through RAM. Its stated benefits were "removes a duplicate file and a whole-file RAM
copy" — efficiency claims, which this measurement has now largely deflated.

The real value is different and much larger: **an accessor that returns a path never loads the book
into RAM, so it is not subject to `MAX_DECRYPTED_BYTES` at all.** That cap exists to bound a
whole-book-into-a-`Uint8Array` operation. A path accessor does not perform that operation, so a
2 GB audiobook is as cheap as a 2 MB one.

So the priority argument shifts from *"the stopgap is inefficient"* to **"the stopgap's design is why
this app cannot play an audiobook longer than about 26 minutes."** That is a feature blocker, not an
optimization — and it makes the contract change the gating dependency for shipping audiobooks at all,
rather than a cleanup to schedule when convenient.

Two things follow, neither of them Reader's to do alone:

1. **The proposal should be re-argued on functional grounds** before Contracts-Gate — its current §1
   undersells it by leading with efficiency. Not done here: this phase was scoped to measurement,
   and rewriting the ask is a separate decision.
2. **The `store()`/`getBook()` asymmetry above needs Abhinav's decision** independently — even after
   a path accessor lands, `store()` accepting books the byte path refuses is a trap for every other
   format too.

## Reusable beyond audio?

**Yes, and it fills a real gap.** `READER_MEASUREMENTS.md` records that the JS-heap half of the EPUB/PDF
work was never isolated (its "H3 — not isolated. It needs either a heap snapshot or a probe inside the
WebView"). The technique used here — driving the real store/provider under Jest with `--expose-gc`,
sampling `arrayBuffers`, and counting full-size `Uint8Array` constructions — isolates exactly that,
needs no device, no Xcode, and no human, and is reproducible to the byte.

It cannot replace the device procedure: it sees no native allocation, no WebView, and no RSS. But for
the specific question *"how many book-sized copies does this path make, and does it release them?"* it
is both cheaper and more precise than the memory gauge, and it answers the question `CLAUDE.md`'s open
item 2 is actually about — *"peak tracks the NUMBER of full-size copies"* — by counting them directly
rather than inferring them from a peak.
