// Owner: Reader (Ahana).
//
// A native audio player needs a URI, not a byte array. This file is the seam that produces one:
// acquire the whole book into RAM -> write a reader-owned scratch file -> hand back its `file://`
// URI.
//
// THAT ROUND TRIP IS THE DESIGN, not a placeholder for one. A contracts change was drafted that
// would have returned contentStore's own on-disk path directly and skipped the copy; it was
// WITHDRAWN on 2026-08-25 because the problem it solved does not arise at the sizes this app
// serves. See AUDIO_PLAYER_DECISION.md Part 2 ("why the resolver copies bytes instead of returning
// a path") for that decision and the one condition that would reopen it. Do not go looking for a
// "real" version of this file — this is it.
//
// EVERYTHING DOWNSTREAM STILL DEPENDS ON THE INTERFACE BELOW, NOT ON THE FUNCTION. That was
// originally about swapping in the withdrawn accessor, and it survives the withdrawal on its own
// merits: it is what let the player library be replaced (RNTP -> expo-audio, AUDIO_PLAYER_DECISION.md)
// without touching a call site, and it is what keeps AudioPlayerScreen from knowing that a scratch
// file exists at all.
//
// ─── HOW THE BYTES ARE ACQUIRED: openBook(), NOT getBook() ───────────────────────────────────
// `openBook()` (Download's — CALLED here, never edited) is the unified STREAM-intent licence gate,
// and it already collapses both playback paths into one call, which is why this file needs no
// branch of its own for "downloaded" versus "streaming":
//
//   DOWNLOADED  -> checkLicense falls back to the persisted licence when the network is unreachable,
//                  then openSession + decryptBook read the LOCAL encrypted package. Fully offline.
//   NOT YET     -> checkLicense runs live, the ciphertext is fetched, stored as an EPHEMERAL
//                  (canPersist:false) package, and decrypted. Nothing persists.
//
// This file used to call `getBook()`, which does neither: it assumes something else already stored
// the package, which in practice meant `devContentSeed.ts`. That seed is gone, so `getBook()` here
// would now fail for any book not separately downloaded first — and would skip the licence check
// for the ones that were.
//
// GUARDS THIS FILE HOLDS ITSELF TO:
//  - AUDIO IS ENCRYPTED, the same AES-256-GCM as EPUB/PDF. "Audio is never encrypted" was true of
//    this codebase through the build phases and is REVOKED as of 2026-08-25 — confirmed against the
//    backend (`ContentAccessGrantImpl`, commit `31d3d25`), which keys encryption off the RESOLVED
//    FIXTURE rather than the format. Do not reintroduce an "audio skips encryption" branch here or
//    anywhere else.
//  - NO CRYPTO IN THIS FILE, which that change strengthens rather than threatens. It never imports
//    aesGcm, deviceKeypair or keyStorage and never will: decrypt belongs behind
//    `openBook`/`decryptBook`, which handle every format identically, so audio joining the
//    encrypted formats is precisely why this file still needs to know nothing about keys.
//  - No reconstructing contentStore's private storage layout by convention. This file does not
//    know, and must never guess, the path `contentStore.ts`'s `contentFile()` writes to
//    (`<bookId>.content.bin` under its own directory). The only way this file reaches the bytes is
//    the public `openBook()` call below. This guard is why the copy exists, and it is the reason
//    the copy is worth its cost rather than an accident of sequencing.
//  - A real audio extension on the returned URI, not `.bin`/octet-stream. See AUDIO_EXTENSION's
//    own comment — it is hardcoded, that is a real limitation, and it is the one open item here.

import { Directory, File, Paths } from 'expo-file-system';

import { openBook } from '@/features/download/openBook';
import { closeBook } from '@/features/encryption/contentProvider';
import type { BookId } from '@/shared/contracts';

/**
 * Reader-owned. A native audio player needs a URI, not a byte array — this is the seam that
 * produces one. Consumers should take this interface as a dependency (constructor/prop-injected)
 * rather than importing `audioAssetResolver` by name, so how a URI gets produced stays swappable
 * without a call-site rewrite. `AudioPlayerScreen` is written this way and is the reason the
 * player library could be replaced without touching it.
 */
export interface AudioAssetResolver {
  /** Resolves to a `file://` URI pointing at playable, decoded-container audio bytes for
   * `bookId`. Rejects with whatever `getBook` rejects with (a `ContentFailure`) if the book has
   * never been stored. */
  resolveAudioAssetUri(bookId: BookId): Promise<string>;
}

const SCRATCH_DIR = new Directory(Paths.cache, 'tf-reader-audio-scratch');

// HARDCODED, AND THIS IS THE OPEN ITEM IN THIS FILE — not a placeholder waiting on a contracts
// change (that change was withdrawn; see this file's header), but a limitation with no owner yet.
//
// Every audio package this serves today is WAV: the backend's `dev-sample-audio-encrypted` carries
// `mimeType: "audio/wav"` on its asset and resolves to `sample-small.wav.enc`, and nothing else
// supplies audio. Neither `openBook()` nor `ContentProvider` hands back a mimeType alongside the
// bytes, so there is no source of truth this function can read a container from — and sniffing
// magic bytes, or guessing contentStore's private layout, are both things this file deliberately
// does not do. So the extension is asserted rather than derived.
//
// A teammate is adding a mimeType accessor; this is deliberately NOT worked around here in the
// meantime. Note the backend has its own inconsistency waiting on the other side of it: the
// catalogue asset says `audio/wav` while the grant's `mimeTypeFor()` hardcodes `audio/mpeg` for
// AUDIO, so whoever wires the accessor must decide which one is authoritative
// (AUDIO_ENCRYPTION_RECON.md tracks it).
//
// WHAT BREAKS, CONCRETELY: the first mp3 or AAC audiobook to reach this function is written out as
// `.wav`. expo-audio's decoders sniff the container and are expected to play it anyway, so this is
// likely cosmetic — but "likely" is doing real work in that sentence and nothing has tested it.
// The fix is a mimeType accessor on ContentProvider (`PersistedMeta` already carries `mimeType`,
// so the data exists and is one small additive method away — Encryption's call, not Reader's).
// Worth doing before any non-WAV audio ships; not worth doing before then.
const AUDIO_EXTENSION = 'wav';

function scratchFileFor(bookId: BookId): File {
  return new File(SCRATCH_DIR, `${encodeURIComponent(bookId)}.${AUDIO_EXTENSION}`);
}

/**
 * Removes scratch files, optionally sparing one book's.
 *
 * THIS DIRECTORY IS PLAINTEXT LICENSED CONTENT, and nothing else in the app knows it exists.
 * `SCRATCH_DIR` is private to this file, so `contentStore.destroy()`, licence expiry and
 * revocation all wipe Encryption's copy and leave this one untouched. That was a smaller problem
 * while every audiobook was open-access plaintext; it is a real one now that a SUBSCRIPTION-tier
 * audio fixture exists, because the decrypted bytes of a licensed book would otherwise outlive the
 * licence that permitted them. `audioScratchReclaimer.ts` is what calls this on those edges — this
 * function is deliberately just the file operation, with no knowledge of what triggered it.
 *
 * `exceptBookId` EXISTS FOR ONE REASON: a book can be playing while this runs. Background playback
 * is a supported state — `AudioPlayerScreen` deliberately does not release its player on unmount
 * (see its own "NO clearLockScreenControls()/remove() ON UNMOUNT" note, and
 * audioPlayerInstance.ts), so the app can be backgrounded, or the screen left, with audio still
 * going. Deleting the live player's source out from under it is the one thing a sweep here must
 * never do casually, so every caller that might run mid-playback passes the live book.
 *
 * Callers that pass `null` are asserting nothing is playing, or that the content must go
 * regardless (revocation). See each call site.
 */
export function clearAudioScratch(exceptBookId: BookId | null): void {
  if (!SCRATCH_DIR.exists) return;
  const keepUri = exceptBookId === null ? null : scratchFileFor(exceptBookId).uri;
  for (const entry of SCRATCH_DIR.list()) {
    if (entry.uri !== keepUri) {
      entry.delete();
    }
  }
}

/**
 * Removes one book's scratch file, if it has one. For the case where a specific book lost its
 * entitlement (revoked or expired) rather than a general clean-up.
 *
 * NOT guarded on whether that book is currently playing, deliberately: if the licence is gone the
 * plaintext must go, and a caller reaching for this has already decided that. What this canNOT do
 * is stop playback already in flight — a native player holding an open handle keeps reading the
 * unlinked file until it is released. Cutting off a revoked book mid-sentence is a real gap, and it
 * belongs to the player, not to a file sweep; see audioScratchReclaimer.ts's note on it.
 */
export function deleteAudioScratchFor(bookId: BookId): void {
  const file = scratchFileFor(bookId);
  if (file.exists) {
    file.delete();
  }
}

/**
 * Acquires the whole book through `openBook()` — the licence gate that serves both the downloaded
 * and the streaming path (see this file's header) — and writes the decrypted bytes into a
 * reader-owned scratch file so there is a URI a native player can be handed.
 *
 * WHAT THIS COSTS, kept explicit because the copy looks redundant until you know why it is here:
 *  1. A DUPLICATE FILE, on the downloaded path. `contentStore.ts` holds the CIPHERTEXT
 *     (`<bookId>.content.bin`, in its own directory); this writes the PLAINTEXT into
 *     `tf-reader-audio-scratch/`. The duplicate is the price of NOT reaching into contentStore's
 *     private layout (see the header's guards); that boundary is worth more than the disk.
 *     BOUNDED, since 2026-08-25: `clearAudioScratch` keeps the scratch directory to at most the
 *     book being resolved, so the cost is one book-sized file (<=20 MB), not one per book ever
 *     played. It used to be append-only. That file is PLAINTEXT LICENSED CONTENT, so bounding its
 *     size was only half the fix — `audioScratchReclaimer.ts` is what stops it outliving the
 *     licence, on app-state edges and on Sync's lock signal.
 *  2. A TRANSIENT RAM SPIKE. `getBook()` returns the whole file as a `Uint8Array` before a single
 *     byte can be written. MEASURED (AUDIO_MEMORY_REPORT.md, 2026-08-25): exactly 2 full-size
 *     copies, ~2× the book transient, ~+40 MB at the 20 MB audio cap, fully reclaimed, and
 *     +0.0 MB retained during playback — the player holds a URI string, not bytes. Immaterial on
 *     a path with no WebView.
 *  3. A SIZE CEILING. Whatever `getBook()` is asked for must fit the whole-book budget (20 MB for
 *     AUDIO, `maxDecryptedBytesFor`), because building that `Uint8Array` is the exact operation
 *     the budget bounds — so this design cannot play an audiobook longer than about 21 minutes.
 *     That is a deliberate, accepted product bound, not an oversight: the catalogue stores
 *     prototype audio at 20 MB or under, so nothing longer can arrive. It is ALSO the one thing
 *     that would have to change first if full-length audiobooks ever come into scope — see
 *     AUDIO_PLAYER_DECISION.md Part 2, which records why the alternative was withdrawn and what
 *     would have to be true to revive it.
 *  4. A HARDCODED EXTENSION — see AUDIO_EXTENSION's own comment.
 *
 * CLOSES THE SESSION IMMEDIATELY AFTER WRITING, deliberately, rather than leaving it open for
 * some later caller to close: once the scratch file exists, this function has no further use for
 * the decrypted-in-RAM copy `getBook` produced, and `contentProvider.ts`'s own doc says skipping
 * `closeBook` "leaves the decrypted book sitting in RAM indefinitely." Closing here turns that
 * indefinite lifetime into a strictly transient one, which is what keeps cost 2 transient.
 */
async function resolveAudioAssetUri(bookId: BookId): Promise<string> {
  // RE-ACQUIRED ON EVERY RESOLVE, not cached, and that is what makes re-entry work.
  //
  // The `closeBook()` at the bottom of this function frees the decrypted copy from RAM as soon as
  // the file exists. For a DOWNLOADED book that is reversible — the ciphertext is still on disk and
  // the next open re-reads it. For a STREAMED (ephemeral, canPersist:false) book it is TERMINAL:
  // `close()` drops the packageCache entry, which is the only copy that ever existed, so a second
  // `getBook()` for that book would fail DECRYPTION_FAILED ("no stored package") forever after.
  //
  // Calling `openBook()` here rather than `getBook()` is what makes that a non-issue instead of a
  // bug: every resolve re-runs the gate, so a re-entered streaming book is simply fetched again,
  // and a re-entered downloaded book is re-read from disk. Nothing has to detect that the session
  // was closed, because nothing assumes it is still open. The alternative — keeping the session
  // open across the screen's lifetime — was rejected: it would hold the whole decrypted book in RAM
  // for as long as the player exists (background playback means that outlives the screen), which is
  // the cost `closeBook()` is here to avoid, and it would still need a re-acquire path for the case
  // where the process was killed and relaunched.
  const bytes = await openBook(bookId, 'AUDIO');

  const file = scratchFileFor(bookId);
  if (!SCRATCH_DIR.exists) {
    SCRATCH_DIR.create({ intermediates: true });
  }
  // Sparing THIS book is what keeps the returned URI valid; every other book's leftover goes.
  // Safe against a still-playing outgoing book by construction, not by luck: AudioPlayerScreen
  // calls getAudioPlayerFor() during RENDER, which releases the previous book's player, and only
  // then does its effect call this function.
  clearAudioScratch(bookId);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(bytes);

  // Frees the decrypted copy openBook() just produced; the scratch file is now the only thing the
  // player needs. Terminal for a streamed book by design — see the note at the top of this
  // function for why that is safe here and would not be if the bytes were acquired with getBook().
  await closeBook(bookId);

  return file.uri;
}

export const audioAssetResolver: AudioAssetResolver = {
  resolveAudioAssetUri,
};
