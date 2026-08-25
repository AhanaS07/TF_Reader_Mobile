// Owner: Reader (Ahana).
//
// The acquisition path (downloadBook, contentStore's "open access / audio: already plaintext"
// branch) exposes exactly one way to reach a book's bytes: `ContentProvider.getBook(bookId):
// Promise<Bytes>` — whole-book bytes in RAM, never a path, never a URL. A native audio player
// needs a URI. This file is the seam that produces one: getBook() -> write a reader-owned scratch
// file -> hand back its `file://` URI.
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
// GUARDS THIS FILE HOLDS ITSELF TO:
//  - CORRECTION, 2026-08-25: "audio is never encrypted" (tf_reader_backend_temp's shared.md) was
//    overridden by Abhinav/Encryption for one dev fixture (dev-sample-audio-encrypted) so encrypted
//    audio exercises the same whole-file decrypt as EPUB/PDF, under the same MAX_DECRYPTED_BYTES
//    cap. This does NOT change anything below: this file still never imports aesGcm, deviceKeypair
//    or keyStorage, and still never will — getBook()/decryptBook() already handle decrypt
//    generically for ANY `pkg.encryption` value, encrypted or not, so there was nothing here to
//    change, only this claim to stop overstating. See content-provider.ts's EncryptedPackage.encryption
//    comment for the corrected contract-level statement.
//  - No reconstructing contentStore's private storage layout by convention. This file does not
//    know, and must never guess, the path `contentStore.ts`'s `contentFile()` writes to
//    (`<bookId>.content.bin` under its own directory). The only way this file reaches the bytes is
//    the frozen, public `getBook()` call below. This guard is why the copy exists, and it is the
//    reason the copy is worth its cost rather than an accident of sequencing.
//  - A real audio extension on the returned URI, not `.bin`/octet-stream. See AUDIO_EXTENSION's
//    own comment — it is hardcoded, that is a real limitation, and it is the one open item here.

import { Directory, File, Paths } from 'expo-file-system';

import { closeBook, getBook } from '@/features/encryption/contentProvider';
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
// Every audio package this serves today is WAV: devContentSeed.ts seeds `sample-plaintext.wav`,
// and nothing else supplies audio. `ContentProvider` exposes no mimeType/container accessor
// alongside `getBook`, so there is no source of truth this function can read a container from —
// and sniffing magic bytes, or guessing contentStore's private layout, are both things this file
// deliberately does not do. So the extension is asserted rather than derived.
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
 * Deletes every scratch file EXCEPT `keep`, so the directory holds at most the book being resolved.
 *
 * Without this the directory was append-only: each book wrote `<bookId>.wav` and nothing ever
 * removed it, so N books played meant N full-size copies on disk forever (the same-book rewrite
 * below only ever replaced one book's own file). Bounded by the 20 MB audio cap that is still
 * ~80 MB after four audiobooks, for files that serve no purpose once playback has started.
 *
 * WHY HERE, AND NOT ON `closeBook()` OR SCREEN UNMOUNT — both are wrong, and not subtly:
 *  - `closeBook()` is called by this very function, immediately after the write. It closes the
 *    ContentStore session, not the player. Deleting the scratch file there would delete it BEFORE
 *    the player ever opens it.
 *  - Screen unmount is worse. `AudioPlayerScreen` deliberately does NOT release its player when it
 *    unmounts (see its "NO clearLockScreenControls()/remove() ON UNMOUNT" note and
 *    audioPlayerInstance.ts): navigating back to the book list while a book is still playing is a
 *    SUPPORTED, intended state. Deleting on unmount would pull the file out from under a live
 *    player in the one case background playback exists to serve.
 *
 * Resolve time is the moment that is actually safe, and it is safe by construction rather than by
 * luck: `AudioPlayerScreen` calls `getAudioPlayerFor(bookId)` during RENDER, which releases the
 * outgoing book's player, and only then does its effect call this function. So by the time a
 * different book's file is deleted here, the player that was holding it is already gone.
 *
 * Self-healing, which the unmount approach could not be: a crash or force-quit leaves one stale
 * file, and the next resolve removes it. Nothing else sweeps this directory.
 */
function deleteOtherScratchFiles(keep: File): void {
  if (!SCRATCH_DIR.exists) return;
  for (const entry of SCRATCH_DIR.list()) {
    if (entry.uri !== keep.uri) {
      entry.delete();
    }
  }
}

/**
 * Calls the frozen `ContentProvider.getBook(bookId)`, which for AUDIO returns a plain copy of the
 * plaintext bytes already sitting on disk (contentStore.ts's "open access / audio" branch), and
 * writes those bytes into a SECOND, reader-owned scratch file so there is a URI a native player
 * can be handed.
 *
 * WHAT THIS COSTS, kept explicit because the copy looks redundant until you know why it is here:
 *  1. A DUPLICATE FILE. `contentStore.ts` already wrote these exact bytes to disk
 *     (`<bookId>.content.bin`, in its own directory). This writes a second copy into
 *     `tf-reader-audio-scratch/`. The duplicate is the price of NOT reaching into contentStore's
 *     private layout (see the header's guards); that boundary is worth more than the disk.
 *     BOUNDED, since 2026-08-25: `deleteOtherScratchFiles` keeps the scratch directory to at most
 *     the book being resolved, so the cost is one book-sized file (<=20 MB), not one per book ever
 *     played. It used to be append-only.
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
  const bytes = await getBook(bookId);

  const file = scratchFileFor(bookId);
  if (!SCRATCH_DIR.exists) {
    SCRATCH_DIR.create({ intermediates: true });
  }
  deleteOtherScratchFiles(file);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(bytes);

  await closeBook(bookId);

  return file.uri;
}

export const audioAssetResolver: AudioAssetResolver = {
  resolveAudioAssetUri,
};
