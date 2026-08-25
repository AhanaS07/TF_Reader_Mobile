// Owner: Reader (Ahana).
//
// AUDIO PHASE 4, TASK A. Durable, LOCAL, UNSYNCED playback position for audio.
//
// THIS IS A BRIDGE: the thing it stands in for is a frozen-contract change that is not Reader's to
// make. See CONTRACTS_GATE_PROPOSAL_AUDIO_PROGRESS.md (this directory) for the proposal that retires
// it — still live, and now the ONLY audio item on the Contracts-Gate agenda.
//
// It used to cite audioAssetResolver.ts as a fellow stand-in. That comparison is gone on purpose:
// the resolver's proposal was withdrawn and its round trip is now simply the design
// (AUDIO_PLAYER_DECISION.md Part 2), so pointing at it would suggest this file is equally settled.
// It is not. The difference is that a *cross-device* audio position cannot be expressed at all
// today, whereas the resolver's ceiling only bounds content the catalogue will never serve.
//
// WHY THIS FILE EXISTS RATHER THAN A progress.ts ROW: `Progress` addresses position through
// `Locator`, a union of `{type:'EPUB'; cfi}` and `{type:'PDF'; page}` (contracts/annotations.ts).
// Audio position is a third addressing scheme — time within a track — and there is no member for
// it. Writing seconds into `Progress.offset` (the PDF page field) would be the exact anti-pattern
// the union exists to prevent: two different addressing schemes sharing one integer, told apart by
// nothing. So audio position lives here, outside the synced model, until the union gains a member.
//
// DELIBERATELY LOCAL AND UNSYNCED — THIS IS NOT AN OVERSIGHT.
// Nothing here reaches sync's database (`reader-offline.db`, src/features/sync/localDb/) or its
// outbox, so an audio position never leaves the device. Cross-device audio resume requires BOTH
// the contract change proposed in Task B AND Karthik's sync integration behind it, and is
// explicitly out of scope until that lands. What this file buys in the meantime is single-device
// resume across relaunch, which is what makes the contract conversation unblocking-work rather
// than blocking-it.
//
// NOT B15. `CONTRACT_ALIGNMENT.md`'s B15 is about audio CONTENT persisting with no expiry — a
// licence/retention question about the book bytes. This file stores one number per book and no
// content whatsoever; it adds no content-persistence behaviour and does not bear on B15 either way.
//
// STORAGE CHOICE, and the option deliberately NOT taken: `expo-file-system` is the local
// persistence Reader already uses (audioAssetResolver.ts, devContentSeed.ts). Reader does NOT use
// `expo-sqlite` — the only SQLite database in this repo is sync-owned, and every table in it is a
// SYNCABLE entity routed through an outbox. Putting an unsynced, reader-owned number in there would
// mean both editing another capability's storage layer and filing a deliberately-local value in the
// one place whose entire machinery exists to make things non-local. A plain JSON file is the honest
// shape for "one number per book, this device only".
//
// `Paths.document`, NOT `Paths.cache`: the OS may evict the cache directory whenever it likes, and
// a resume position that silently disappears is worse than one that was never offered.
//
// THE NAMES ARE UNCHANGED ON PURPOSE. `getAudioSessionPosition`/`setAudioSessionPosition` kept
// their signatures across the swap from an in-memory Map to this, so AudioPlayerRouteScreen's call
// sites did not move and the change is confined to this file — the same property that made the
// player-library swap a one-file change (AUDIO_PLAYER_DECISION.md). The interface stayed
// SYNCHRONOUS for the same reason: `AudioPlayerRouteScreen` reads a position during render, and
// `textSync()`/`write()` are genuinely synchronous native calls (FileSystemModule.swift:149), so
// durability cost the call sites nothing.

import { File, Paths } from 'expo-file-system';

import type { BookId } from '@/shared/contracts';

const STORE_FILE = new File(Paths.document, 'tf-reader-audio-progress.json');

// Ticks arrive every 250ms (audioPlayerInstance.ts's updateInterval). Writing the file on each one
// would be ~4 filesystem writes a second for a value nobody reads until the next launch. The
// in-memory map stays authoritative and current; the disk copy is allowed to lag by this much,
// because the only reader of the disk copy is the NEXT process. Every edge that actually matters
// (pause, seek, leaving the screen, backgrounding) calls flushAudioSessionPosition() and does not
// wait for the throttle — see AudioPlayerRouteScreen.tsx and useAudioPlayerSetup.ts.
const WRITE_THROTTLE_MS = 5_000;

// `null` = not yet hydrated from disk. Distinct from an empty Map ("hydrated, nothing stored"),
// which is why this is not just `new Map()` — otherwise the first read would report "no position"
// for every book and then persist that emptiness over a real stored position.
let positions: Map<BookId, number> | null = null;
let hasUnwrittenChange = false;
let lastWriteAtMs = 0;

/**
 * The in-memory map, hydrating it from disk on first use.
 *
 * EVERY failure mode here resolves to "start empty", never to a throw: a missing file (first ever
 * launch), unparseable JSON, a value of the wrong type. A corrupt progress file must cost the user
 * their resume position, not their ability to open the audiobook at all — this is called from
 * render.
 */
function hydrated(): Map<BookId, number> {
  if (positions) return positions;

  const map = new Map<BookId, number>();
  positions = map;

  try {
    if (STORE_FILE.exists) {
      const parsed: unknown = JSON.parse(STORE_FILE.textSync());
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        for (const [bookId, seconds] of Object.entries(parsed)) {
          // Validated rather than trusted: this file survives app upgrades, so a value written by
          // an older build (or a hand-edited file) must not put a NaN into the seek path.
          if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
            map.set(bookId as BookId, seconds);
          }
        }
      }
    }
  } catch {
    // Intentionally swallowed — see this function's doc.
  }

  return map;
}

function writeNow(): void {
  if (!positions) return;

  try {
    if (!STORE_FILE.exists) {
      STORE_FILE.create();
    }
    STORE_FILE.write(JSON.stringify(Object.fromEntries(positions)));
    hasUnwrittenChange = false;
    lastWriteAtMs = Date.now();
  } catch {
    // Leaves hasUnwrittenChange true on purpose, so the next flush retries rather than assuming
    // this one landed. A device that cannot write here still plays audio fine; it just cannot
    // resume next launch.
  }
}

/** The stored position for `bookId` in seconds, or undefined for "start from the top". */
export function getAudioSessionPosition(bookId: BookId): number | undefined {
  return hydrated().get(bookId);
}

/**
 * Records `positionSeconds` for `bookId`. Safe to call on every status tick — the in-memory update
 * is unconditional, the disk write is throttled (see WRITE_THROTTLE_MS).
 */
export function setAudioSessionPosition(bookId: BookId, positionSeconds: number): void {
  hydrated().set(bookId, positionSeconds);
  hasUnwrittenChange = true;

  if (Date.now() - lastWriteAtMs >= WRITE_THROTTLE_MS) {
    writeNow();
  }
}

/**
 * Writes any throttled-away change to disk immediately.
 *
 * Call this at the edges where the next tick may never come: pause, seek, leaving the player
 * screen, and the app going to background. A no-op when nothing is pending, so callers do not need
 * to track whether anything changed.
 */
export function flushAudioSessionPosition(): void {
  if (hasUnwrittenChange) {
    writeNow();
  }
}
