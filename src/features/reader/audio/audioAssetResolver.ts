// Owner: Reader (Ahana).
//
// AUDIO PHASE 1 (see /AUDIO_PHASE0_FINDINGS.md, one directory above this repo — Phase 0's recon,
// and this phase's plan). Phase 0 established the blocker: the acquisition path (downloadBook,
// contentStore's "open access / audio: already plaintext" branch) already works and is tested,
// but the ONLY thing it exposes is `ContentProvider.getBook(bookId): Promise<Bytes>` — whole-book
// bytes in RAM, never a path, never a URL. A native audio player needs a URI. This file is the
// seam that produces one.
//
// EVERYTHING DOWNSTREAM (Phase 2's player, and beyond) SHOULD DEPEND ON THE INTERFACE BELOW, NOT
// ON resolveAudioAssetUriStopgap. That is the entire point of naming it a "stopgap" rather than
// just writing the function: when the Contracts-Gate proposal in this file's sibling doc lands
// (a real path accessor on ContentProvider), only the `audioAssetResolver` object's wiring changes
// — no call site does.
//
// GUARDS THIS FILE HOLDS ITSELF TO (see AUDIO_PHASE0_FINDINGS.md's Phase 1 section):
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
//    (`<bookId>.content.bin` under its own directory) — that is exactly the hidden coupling
//    AUDIO_PHASE0_FINDINGS.md's Phase 1 plan calls out as the wrong move. The only way this file
//    reaches the bytes is the frozen, public `getBook()` call below.
//  - A real audio extension on the returned URI, not `.bin`/octet-stream. See
//    STOPGAP_AUDIO_EXTENSION's own comment for why this is hardcoded rather than derived, and what
//    would need to change for that to stop being true.

import { Directory, File, Paths } from 'expo-file-system';

import { closeBook, getBook } from '@/features/encryption/contentProvider';
import type { BookId } from '@/shared/contracts';

/**
 * Reader-owned. A native audio player needs a URI, not a byte array — this is the seam that
 * produces one. Phase 2 (the player) and beyond should take this interface as a dependency
 * (constructor/prop-injected), not import `resolveAudioAssetUriStopgap` or `audioAssetResolver`
 * by name, so swapping the implementation later is a wiring change, not a call-site rewrite.
 */
export interface AudioAssetResolver {
  /** Resolves to a `file://` URI pointing at playable, decoded-container audio bytes for
   * `bookId`. Rejects with whatever `getBook` rejects with (a `ContentFailure`) if the book has
   * never been stored. */
  resolveAudioAssetUri(bookId: BookId): Promise<string>;
}

const SCRATCH_DIR = new Directory(Paths.cache, 'tf-reader-audio-scratch');

// TEMPORARY, see this file's header (point 3) and the Contracts-Gate proposal doc. Every fixture
// this stopgap has to serve today is the one devContentSeed.ts seeds (sample-plaintext.wav), and
// that fixture is always WAV — hardcoding the extension is honest about that limit rather than
// guessing a codec from bytes this file has no business sniffing. `ContentProvider` exposes no
// mimeType/container accessor alongside `getBook`, so there is no OTHER source of truth this
// function could read from short of the private-layout guess this file explicitly refuses to make.
// A second audio fixture in a different container WILL be written out under the WRONG extension
// until the real accessor (1c) — or some other way of learning the container — exists.
const STOPGAP_AUDIO_EXTENSION = 'wav';

function scratchFileFor(bookId: BookId): File {
  return new File(SCRATCH_DIR, `${encodeURIComponent(bookId)}.${STOPGAP_AUDIO_EXTENSION}`);
}

/**
 * STOPGAP — see this file's header. Calls the existing, frozen `ContentProvider.getBook(bookId)`,
 * which for AUDIO already returns a plain copy of the plaintext bytes already sitting on disk
 * (contentStore.ts's "open access / audio" branch), and writes those bytes into a SECOND,
 * reader-owned scratch file so there is a URI a native player can be handed.
 *
 * WHY THIS IS NOT THE DESIGN, spelled out rather than left implicit:
 *  1. DUPLICATE FILE. `contentStore.ts` already wrote these exact bytes to disk
 *     (`<bookId>.content.bin`, in its own directory) when the book was downloaded/seeded. This
 *     writes a SECOND copy into `tf-reader-audio-scratch/`. Two copies of the same audio file
 *     exist on disk simultaneously until this cache is cleared — nothing clears it yet.
 *  2. RAM SPIKE. `getBook()` returns the WHOLE file as a `Uint8Array` before this function can
 *     write a single byte of it — a one-time, whole-file spike into the JS heap for a format that
 *     structurally never needed decryption in the first place, and so never needed to pay for
 *     one. `closeBook()` right after the write is what keeps this spike ONE-TIME rather than
 *     indefinite (see below) — it does not remove the spike itself. Fine for a 1MB fixture; needs
 *     measuring against a real-sized audiobook before this stopgap survives past a dev build (a
 *     Phase 5 concern, flagged here rather than silently inherited).
 *  3. HARDCODED EXTENSION — see STOPGAP_AUDIO_EXTENSION's own comment.
 *
 * CLOSES THE SESSION IMMEDIATELY AFTER WRITING, deliberately, rather than leaving it open for
 * some later caller to close: once the scratch file exists, this function has no further use for
 * the decrypted-in-RAM copy `getBook` produced, and `contentProvider.ts`'s own doc says skipping
 * `closeBook` "leaves the decrypted book sitting in RAM indefinitely." Closing here turns that
 * indefinite lifetime into a strictly transient one, which is the one part of the RAM-spike
 * caveat above this function CAN fix outright rather than just flag.
 */
async function resolveAudioAssetUriStopgap(bookId: BookId): Promise<string> {
  const bytes = await getBook(bookId);

  const file = scratchFileFor(bookId);
  if (!file.parentDirectory.exists) {
    file.parentDirectory.create({ intermediates: true });
  }
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(bytes);

  await closeBook(bookId);

  return file.uri;
}

export const audioAssetResolver: AudioAssetResolver = {
  resolveAudioAssetUri: resolveAudioAssetUriStopgap,
};
