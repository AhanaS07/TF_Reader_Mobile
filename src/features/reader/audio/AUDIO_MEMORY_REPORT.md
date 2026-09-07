# Audio memory measurement — the resolver's JS-heap spike

**Run: 2026-08-25. Owner: Reader (Ahana). AUDIO PHASE 5.**

**Classification: 🟢 GREEN for memory — but only because the dangerous case is unreachable, and what
makes it unreachable is a hard size ceiling this phase found instead.** Read both halves; the second
is the one that matters.

**That ceiling was filed as a 🔴 functional blocker on the day of this run. It is now a 🟡 accepted
product bound** — full-length audiobooks were scoped out of the prototype rather than enabled (see
update 3 below). The distinction matters to anyone reading this to find out whether audio is
finished: it is, for every book the catalogue will serve.

> **THREE UPDATES, LATER THE SAME DAY. None invalidates a number below; all three change what the
> numbers are about.**
>
> 1. **The write/read asymmetry this phase found is FIXED** (Abhinav, `9c821e3`). `store()` now
>    enforces the budget too, so the "downloads to completion, then never plays" case in *The
>    enforced ceiling, and a defect at it* is gone. That table is kept as the measurement that
>    prompted the fix — read it as history, not as current behaviour. What replaces it: an
>    over-budget audiobook is refused at download and at `store()`, loudly, before anything reaches
>    disk.
> 2. **The audio cap is 20 MB, not 25.** `MAX_AUDIO_DECRYPTED_BYTES` (`contentStore.ts`) bounds AUDIO
>    specifically; EPUB/PDF keep 25 MB. The number is the **OPDS team's prototype storage limit** —
>    a catalogue agreement, not a RAM measurement — so this phase's ceiling row (+50 MB at 25 MB) is
>    now an over-estimate of the worst reachable case rather than the case itself. Every conclusion
>    holds a fortiori at a lower cap.
> 3. **The fix this report recommends was WITHDRAWN, and the ceiling was accepted instead.** The
>    plaintext-path accessor (a Gate ask on `content-provider.ts`/`errors.ts`) is not being pursued:
>    the catalogue stores prototype audio at 20 MB or under, so the ceiling it lifted is one nothing
>    can reach. `AUDIO_PLAYER_DECISION.md` Part 2 holds that decision, what would reopen it, and how
>    to recover the withdrawn document. **Read that before treating anything below as an open action
>    item.**
>
> The ceiling below is **unchanged by all three**, and that is the point: 20 MB is ~21 minutes of
> audio where 25 MB was ~26. Moving the cap in either direction does not reach a real audiobook —
> which is exactly why the answer was to bound the content rather than to raise the number.

## The headline, before the numbers

This phase set out to measure the resolver (`audioAssetResolver.ts`) against a realistic
150–300 MB audiobook. **That measurement cannot be taken, because that book cannot be opened.**

The whole-book cap is hard, enforced, and applies to audio. It is checked at `store()` time, on the
cold-read path, and both before and after the copy `decryptBook` makes — the last of these sitting
*before* the `if (!pkg.encryption)` audio branch, so audio pays it despite never being encrypted.
Audio is not exempt from any of them. So the worst spike the resolver can ever produce is bounded by
a cap-sized input, and the spike the phase was worried about is structurally impossible.

That is a reassuring answer to the question asked and an alarming answer to the question underneath
it: **no real audiobook fits.** 25 MB is roughly **26 minutes** at 128 kbps, or ~52 minutes at 64 kbps
mono — and the audio cap is now 20 MB, roughly **21 minutes**. A typical audiobook is 8–15 hours —
one to two orders of magnitude over either number.

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

### The enforced ceiling, and a defect at it — ✅ THE DEFECT IS FIXED

**As measured, 2026-08-25 (history — see the note at the top of this file):**

| Step, with a 150 MB audio package | Result |
| --- | --- |
| `contentStore.store()` | **ACCEPTED** — writes all 150 MB to disk |
| `contentStore.isAvailableOffline()` | **`true`** |
| `contentProvider.getBook()` | `DECRYPTION_FAILED` — *"book is 157286400 bytes, exceeds the 26214400-byte RAM budget"* |
| `audioAssetResolver.resolveAudioAssetUri()` | same failure, propagated |

**This asymmetry was a defect, and it was Abhinav's (Encryption's) call, not Reader's.** The write
path accepted a book the read path would always refuse. The user-visible result was an audiobook that
downloaded to completion, consumed 150 MB of disk, reported itself available offline — and then
failed to play, permanently, with a decryption error that was not about decryption. Failing at
`store()` would cost the same amount of nothing and would tell the truth at the moment the truth is
knowable.

**Fixed the same day, by Abhinav, in exactly that shape** (`9c821e3`): `assertWithinRamBudget()` runs
inside `store()`, before any `writeFile`, so the package above is now rejected at write time and
`isAvailableOffline()` stays `false`. `contentStore.test.ts` and `wholeBookBudget.test.ts` both pin
the fixed behaviour rather than the defect. The download path refuses it earlier still —
`downloadBook`/`openBook` size the chunked fetch from the budget, so an over-cap book fails before
its body is pulled.

**What this does and does not buy audio.** It converts a silent, permanent, mislabelled failure into
a loud one at the right moment — genuinely worth having, and it is the whole of what this phase asked
for. It does **not** make any audiobook playable that was not playable before. The ceiling is still
the ceiling; the app is now honest about hitting it.

### The resolve spike, at sizes that are actually reachable

| Book size | Baseline | Peak | Spike | Ratio | Retained after GC |
| --- | --- | --- | --- | --- | --- |
| 8 MB | 1.7 MB | 25.7 MB | **+24.0 MB** | 3.00× | **+0.0 MB** |
| 16 MB | 1.7 MB | 33.7 MB | **+32.0 MB** | 2.00× | **+0.0 MB** |
| 25 MB (the ceiling **as measured**) | 1.7 MB | 51.7 MB | **+50.0 MB** | 2.00× | **+0.0 MB** |

The ceiling row was taken at 25 MB, which was the audio cap on the day of the run. It is **20 MB**
now (see the top of this file), and the 2.00× ratio is what carries: the worst reachable audio spike
is ~+40 MB, not +50. The rows are left at their measured values rather than rescaled — a
back-calculated number in a measurement table is indistinguishable from a measured one six months
later, and every conclusion here is safe at the lower figure anyway.

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
design. Audio's footprint is app-process only, and the resolver contributes at most a transient
+50 MB to it.

| | Figure |
| --- | --- |
| Peak during resolve (25 MB, the ceiling as measured; ~+40 MB at today's 20 MB audio cap) | **+50 MB, transient** |
| Peak during sustained playback (JS heap) | **+0.0 MB** |
| Delta | **50 MB** |
| Headroom vs a ~1.0 GB practical ceiling | **~95%** unused by this path |

**Stacking with a reader open, the one case worth naming:** the reader path already measures
~1153 MB on the simulator. Adding audio's +50 MB transient on top would be genuinely dangerous —
but it requires resolving an audiobook while an EPUB/PDF is open, which no current flow does
(`BookListScreen` routes AUDIO away from the reader entirely, and there is one player at a time). Not
a present risk; worth remembering if a "continue listening while reading" feature is ever proposed.

## Recommendation

**Ship the resolver as-is. Its memory cost is not a reason to prioritize anything.** 50 MB transient,
fully reclaimed, on a path with no WebView, is immaterial.

That was this phase's recommendation and it stands. What has since changed is the *second* half of
what this section originally argued — recorded honestly rather than quietly rewritten, because the
reversal is the useful part:

> **What this section said, and what happened to it.** It argued that memory was the weak case for a
> plaintext-path accessor and that the strong case was the size ceiling — "the resolver's design is
> why this app cannot play an audiobook longer than about 21 minutes" — making the contract change a
> gating dependency for shipping audiobooks at all.
>
> **That reasoning was correct and the conclusion was still dropped.** The proposal was withdrawn on
> 2026-08-25, because the ceiling is one nothing can reach: the catalogue stores prototype audio at
> 20 MB or under. A gating dependency for a case that cannot arrive is not gating. **Full-length
> audiobooks were scoped out; they were not enabled.** See `AUDIO_PLAYER_DECISION.md` Part 2 for the
> decision and the condition that reopens it.
>
> The measurement itself is unaffected — every number above was taken against the real code and none
> of it depended on the proposal landing.

Two things followed from this run, neither of them Reader's to do alone. **Both are resolved:**

1. ~~**The proposal should be re-argued on functional grounds** before Contracts-Gate — its current §1
   undersells it by leading with efficiency.~~ **Overtaken by events** — it was re-argued on exactly
   those grounds, and then withdrawn on scope rather than on the merits of the argument.
2. ~~**The `store()`/`getBook()` asymmetry above needs Abhinav's decision** independently — even after
   a path accessor lands, `store()` accepting books the byte path refuses is a trap for every other
   format too.~~ **Decided and fixed** by Abhinav the same day, for every format — see the struck
   table above. Note this one was flagged as needing to be decided *independently of* the proposal,
   and that judgment paid off: the proposal was dropped and the fix survives it.

**The one thing still outstanding is the ask itself.** The path accessor has not landed and is not
Abhinav's to land unilaterally: it changes two frozen files (`content-provider.ts`, `errors.ts`) and
is a Gate conversation. Everything else this phase surfaced is closed.

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
