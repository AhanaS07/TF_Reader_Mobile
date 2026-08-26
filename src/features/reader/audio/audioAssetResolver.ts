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
//  - A real audio extension on the returned URI, not `.bin`/octet-stream — derived from the stored
//    MIME type via `ContentProvider.getMimeType()`, no longer hardcoded. See MIME_TO_EXTENSION.

import { Directory, File, Paths } from 'expo-file-system';

import { openBook } from '@/features/download/openBook';
import { closeBook, getMimeType } from '@/features/encryption/contentProvider';
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

// DERIVED FROM THE STORED MIME TYPE, not hardcoded — closed 2026-08-25 by Abhinav's
// `ContentProvider.getMimeType()`, which reads `PersistedMeta.mimeType` (set at store() time by the
// download pass). This file used to assert `wav` because no accessor existed and the alternatives
// were sniffing magic bytes or guessing contentStore's private layout, both of which it refuses to
// do. There is now a real source of truth, so it asks.
//
// Audio callers need a real extension for OS-level media handling (share sheets, file pickers,
// debug tools) — expo-audio's own decoders sniff the container header, but those tools trust the
// extension. Falls back to 'bin' for an unmapped type rather than guessing.
//
// WORTH KNOWING WHICH VALUE ARRIVES: the backend's catalogue asset for the audio fixture says
// `audio/wav`, but its grant's `mimeTypeFor()` hardcodes `audio/mpeg` for AUDIO — so a downloaded
// book may be stored with either, and the same bytes can land as `.wav` or `.mp3`. That mismatch is
// the backend's (tracked in AUDIO_ENCRYPTION_RECON.md); this table maps both to something sane, and
// nothing here depends on which one wins, because the sweep matches on bookId rather than filename.
const MIME_TO_EXTENSION: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'm4a',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/webm': 'weba',
  'application/octet-stream': 'bin',
};

function extensionForMimeType(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] ?? 'bin';
}

/**
 * The filename prefix every scratch file for `bookId` shares, whatever its extension.
 *
 * THE EXTENSION IS NO LONGER KNOWABLE WITHOUT AN ASYNC LOOKUP, which is what makes this necessary:
 * the sweep and the targeted delete below both have to identify "this book's file" and neither can
 * await `getMimeType()` — one runs from a synchronous app-state handler, and both must keep working
 * for a book whose stored package has already been destroyed (the case the delete exists for).
 * Matching on the bookId prefix answers the question without needing the mime type at all, and it
 * cleans up correctly if a book is ever re-stored under a different type — the stale `.wav` beside a
 * new `.mp3` is still that book's file.
 */
function scratchNamePrefix(bookId: BookId): string {
  return `${encodeURIComponent(bookId)}.`;
}

/** Last path segment of a file:// URI — the filename, for prefix matching against the above. */
function fileNameOf(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1);
}

function scratchFileFor(bookId: BookId, extension: string): File {
  return new File(SCRATCH_DIR, `${scratchNamePrefix(bookId)}${extension}`);
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
  const keepPrefix = exceptBookId === null ? null : scratchNamePrefix(exceptBookId);
  deleteScratchEntries((name) => keepPrefix !== null && name.startsWith(keepPrefix));
}

/**
 * Deletes everything in the scratch directory except the entries `keep` approves, by filename.
 *
 * The three callers want three different notions of "this book's file", which is why the predicate
 * is a parameter rather than a bookId: the app-state sweep keeps a whole book's prefix (it cannot
 * know the extension without an async lookup), the targeted delete removes a whole prefix, and the
 * resolve path keeps exactly ONE filename — sparing the prefix there would leave a stale `.wav`
 * beside a newly-written `.mp3` for the same book.
 */
function deleteScratchEntries(keep: (fileName: string) => boolean): void {
  if (!SCRATCH_DIR.exists) return;
  for (const entry of SCRATCH_DIR.list()) {
    if (!keep(fileNameOf(entry.uri))) {
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
  const prefix = scratchNamePrefix(bookId);
  deleteScratchEntries((name) => !name.startsWith(prefix));
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
 *
 * CLOSES THE SESSION IMMEDIATELY AFTER WRITING, deliberately, rather than leaving it open for
 * some later caller to close: once the scratch file exists, this function has no further use for
 * the decrypted-in-RAM copy `getBook` produced, and `contentProvider.ts`'s own doc says skipping
 * `closeBook` "leaves the decrypted book sitting in RAM indefinitely." Closing here turns that
 * indefinite lifetime into a strictly transient one, which is what keeps cost 2 transient.
 */
async function acquireAudioAsset(bookId: BookId): Promise<string> {
  // RE-ACQUIRED ON EVERY RESOLVE, not cached, and that is what makes re-entry work.
  //
  // The `closeBook()` at the bottom of this function frees the decrypted copy from RAM as soon as
  // the file exists, for both tiers: a DOWNLOADED book re-reads its ciphertext from disk on the
  // next open, and a STREAMED (ephemeral, canPersist:false) one keeps its in-memory package until
  // `destroy()`. Calling `openBook()` here rather than `getBook()` is what makes re-entry work
  // regardless: every resolve re-runs the licence gate, so nothing has to detect that the session
  // was closed, because nothing assumes it is still open.
  //
  // The alternative — keeping the session open across the screen's lifetime — was rejected: it
  // would hold the whole decrypted book in RAM for as long as the player exists (background
  // playback means that outlives the screen), which is the cost `closeBook()` is here to avoid,
  // and it would still need a re-acquire path for the case where the process was killed and
  // relaunched.
  //
  // CONCURRENT resolves of the same book must NOT reach this function twice — see `inFlight`
  // below for what breaks. This function assumes it owns the session for `bookId` outright.
  const bytes = await openBook(bookId, 'AUDIO');

  // AFTER openBook(), not alongside it. `getMimeType()` reads the stored package — the in-memory
  // one for a STREAMED book (Elite writes no meta.json at all), the persisted meta.json for a
  // downloaded one — and neither exists until openBook() has stored it, so issuing both together
  // (as the accessor's first call site did, with Promise.all) would race, and lose, on the online
  // path. Sequential is also nearly free here: this is a small metadata read next to
  // a whole-book decrypt.
  const extension = extensionForMimeType(await getMimeType(bookId));

  const file = scratchFileFor(bookId, extension);
  if (!SCRATCH_DIR.exists) {
    SCRATCH_DIR.create({ intermediates: true });
  }
  // Sparing THIS book is what keeps the returned URI valid; every other book's leftover goes.
  // Safe against a still-playing outgoing book by construction, not by luck: AudioPlayerScreen
  // calls getAudioPlayerFor() during RENDER, which releases the previous book's player, and only
  // then does its effect call this function.
  // Spares exactly THIS file, not the whole bookId prefix: a book re-stored under a different MIME
  // type writes a new extension, and sparing the prefix would leave the old one behind.
  deleteScratchEntries((name) => name === fileNameOf(file.uri));
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(bytes);

  // Frees the decrypted copy openBook() just produced; the scratch file is now the only thing the
  // player needs. Zeroes `bytes` in place as it goes — that buffer must not be handed to anyone
  // else, which is the other half of why `inFlight` below exists.
  await closeBook(bookId);

  return file.uri;
}

/**
 * One in-flight acquire per bookId. NOT a URI cache — the entry is dropped the moment the acquire
 * settles, so a later resolve re-runs the licence gate and rewrites the scratch file (the sweep
 * may have deleted it in between). Only genuinely OVERLAPPING calls share a result.
 *
 * WITHOUT THIS, TWO CONCURRENT RESOLVES OF THE SAME BOOK CORRUPT EACH OTHER, because
 * `contentStore` sessions are keyed by bookId with no reference counting — there is one session
 * for a book, not one per caller, so the FIRST resolve to finish tears down the session the second
 * is still using. Both halves of that were reproduced, not theorised:
 *
 *  - `closeBook()` zeroes `session.plaintext`, and `decryptBook()` hands both callers the SAME
 *    buffer (that sharing is deliberate — see `OpenSession.pending` — so `close()` can guarantee it
 *    zeroed the only copy). The second resolve's bytes went 0xab -> 0x00 mid-flight and it wrote a
 *    scratch file of pure zeros. Silent: a valid file, unplayable audio.
 *  - `closeBook()` also drops the package, so the second resolve's `getMimeType()` threw
 *    `DECRYPTION_FAILED`. `contentStore.close()` no longer drops it for Elite, which fixes that
 *    half at the source — but the zeroed buffer above is a session-lifetime problem, not a cache
 *    one, and would survive that fix.
 *
 * `AudioPlayerScreen`'s load effect is the caller that overlaps: its `cancelled` flag suppresses a
 * stale `setUri`, but nothing aborts the in-flight promise, so leaving the screen mid-load and
 * re-entering leaves two acquires running against one session. Deduping here rather than there is
 * deliberate — the hazard belongs to whoever owns the session lifecycle, and any other caller of
 * this resolver would hit it identically.
 */
const inFlight = new Map<BookId, Promise<string>>();

function resolveAudioAssetUri(bookId: BookId): Promise<string> {
  const existing = inFlight.get(bookId);
  if (existing) return existing;

  // `.finally()` returns a NEW promise, and it is that one which gets stored and handed to every
  // caller — so the map entry is cleared before any caller resumes, and a resolve issued from a
  // continuation of this one correctly starts a fresh acquire instead of joining a settled entry.
  const pending = acquireAudioAsset(bookId).finally(() => {
    inFlight.delete(bookId);
  });
  inFlight.set(bookId, pending);
  return pending;
}

export const audioAssetResolver: AudioAssetResolver = {
  resolveAudioAssetUri,
};
