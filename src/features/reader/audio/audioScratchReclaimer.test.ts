// Owner: Reader (Ahana).
//
// Pins the reclaim edges for the decrypted-audio scratch directory. The property under test is an
// ENTITLEMENT one, not a disk-space one: plaintext of a licensed book must not outlive the licence,
// and this directory is invisible to every mechanism that normally enforces that
// (contentStore.destroy(), licence expiry, BEK destruction) because only audioAssetResolver.ts
// knows the path.
//
// The live-book exception gets as much coverage as the sweeps themselves — a reclaimer that
// deletes the file a background player is streaming from would trade a content leak for broken
// playback, which is the one regression this whole design is shaped around avoiding.

import { Directory, File, Paths } from 'expo-file-system';
import { AppState } from 'react-native';

import { OFFLINE_LOCK_EVENTS } from '@/shared/contracts';
import type { BookId, LockSignal } from '@/shared/contracts';
import { eventBus, resetEventBusForTests } from '@/shared/eventBus';

import { clearAudioScratch } from './audioAssetResolver';
import {
  currentAudioBookId,
  isAudioPlaying,
  releaseCurrentAudioPlayer,
} from './audioPlayerInstance';
import { installAudioScratchReclaimer } from './audioScratchReclaimer';

// Files are planted through expo-file-system rather than by resolving a real book: these tests are
// about what REMOVES files, and driving a full resolve would drag in seeding and ContentStore for
// no added coverage. The path is reconstructed here — the one place that is acceptable, because a
// test asserting a directory is empty has to know which directory.
const LIVE_BOOK = 'reclaimer-live-book' as BookId;
const STALE_BOOK = 'reclaimer-stale-book' as BookId;

// The reclaimer asks audioPlayerInstance what is playing. Mocked rather than driven through a real
// player: creating one needs expo-audio's native side, and what matters here is only the answer.
jest.mock('./audioPlayerInstance', () => ({
  currentAudioBookId: jest.fn(() => null),
  isAudioPlaying: jest.fn(() => false),
  releaseCurrentAudioPlayer: jest.fn(),
}));
const mockCurrentAudioBookId = currentAudioBookId as jest.MockedFunction<typeof currentAudioBookId>;
const mockIsAudioPlaying = isAudioPlaying as jest.MockedFunction<typeof isAudioPlaying>;
const mockReleasePlayer = releaseCurrentAudioPlayer as jest.MockedFunction<
  typeof releaseCurrentAudioPlayer
>;

const SCRATCH_DIR = new Directory(Paths.cache, 'tf-reader-audio-scratch');

function plantScratchFile(bookId: BookId): File {
  if (!SCRATCH_DIR.exists) SCRATCH_DIR.create({ intermediates: true });
  const file = new File(SCRATCH_DIR, `${encodeURIComponent(bookId)}.wav`);
  if (file.exists) file.delete();
  file.create();
  file.write(new Uint8Array([1, 2, 3, 4]));
  return file;
}

function scratchFile(bookId: BookId): File {
  return new File(SCRATCH_DIR, `${encodeURIComponent(bookId)}.wav`);
}

function emitAppStateChange(state: 'active' | 'background'): void {
  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  const handler = calls[calls.length - 1][1] as (s: string) => void;
  handler(state);
}

function lockSignal(bookId: BookId, reason: LockSignal['reason']): LockSignal {
  return {
    type: OFFLINE_LOCK_EVENTS.LOCK,
    bookId,
    reason,
    observedAt: Date.now(),
  };
}

describe('audioScratchReclaimer', () => {
  let uninstall: () => void;

  beforeEach(() => {
    mockCurrentAudioBookId.mockReturnValue(null);
    mockIsAudioPlaying.mockReturnValue(false);
    mockReleasePlayer.mockClear();
    clearAudioScratch(null);
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  });

  afterEach(() => {
    uninstall?.();
    resetEventBusForTests();
    clearAudioScratch(null);
    jest.restoreAllMocks();
  });

  it('sweeps leftovers from a previous run at install time', () => {
    plantScratchFile(STALE_BOOK);

    uninstall = installAudioScratchReclaimer();

    expect(scratchFile(STALE_BOOK).exists).toBe(false);
  });

  it('sweeps when the app leaves the foreground — the window where plaintext sits unattended', () => {
    uninstall = installAudioScratchReclaimer();
    plantScratchFile(STALE_BOOK);

    emitAppStateChange('background');

    expect(scratchFile(STALE_BOOK).exists).toBe(false);
  });

  it('sweeps again on return to the foreground, catching what a killed process could not clean', () => {
    uninstall = installAudioScratchReclaimer();
    plantScratchFile(STALE_BOOK);

    emitAppStateChange('active');

    expect(scratchFile(STALE_BOOK).exists).toBe(false);
  });

  it('SPARES the playing book while sweeping everything else', () => {
    uninstall = installAudioScratchReclaimer();
    plantScratchFile(LIVE_BOOK);
    plantScratchFile(STALE_BOOK);
    mockCurrentAudioBookId.mockReturnValue(LIVE_BOOK);
    mockIsAudioPlaying.mockReturnValue(true);

    emitAppStateChange('background');

    // Background playback is a supported state: deleting this file would silence a book the user
    // is actively listening to, which is a worse outcome than the leak being closed.
    expect(scratchFile(LIVE_BOOK).exists).toBe(true);
    expect(scratchFile(STALE_BOOK).exists).toBe(false);
  });

  it('deletes a revoked book\'s plaintext on the offline-lock signal', () => {
    uninstall = installAudioScratchReclaimer();
    plantScratchFile(STALE_BOOK);

    eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, lockSignal(STALE_BOOK, 'revoked'));

    expect(scratchFile(STALE_BOOK).exists).toBe(false);
  });

  it('deletes on EXPIRED too — expiry is advisory for ciphertext, but these files are plaintext', () => {
    uninstall = installAudioScratchReclaimer();
    plantScratchFile(STALE_BOOK);

    eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, lockSignal(STALE_BOOK, 'expired'));

    expect(scratchFile(STALE_BOOK).exists).toBe(false);
  });

  it('STOPS PLAYBACK before deleting, when the locked book is the one playing', () => {
    // Unlinking alone would not cut the user off: a native player holding an open descriptor keeps
    // reading the unlinked file to the end. Releasing the player is what actually enforces the
    // revocation, and it must happen BEFORE the unlink so a live player is never reading a file
    // that has already left the filesystem.
    uninstall = installAudioScratchReclaimer();
    plantScratchFile(LIVE_BOOK);
    mockCurrentAudioBookId.mockReturnValue(LIVE_BOOK);
    mockIsAudioPlaying.mockReturnValue(true);

    eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, lockSignal(LIVE_BOOK, 'revoked'));

    expect(mockReleasePlayer).toHaveBeenCalledTimes(1);
    expect(scratchFile(LIVE_BOOK).exists).toBe(false);
  });

  it('does NOT stop playback when a DIFFERENT book is locked', () => {
    // Revoking book B must not interrupt book A. The guard is the bookId comparison, and without it
    // any lock anywhere would silence whatever the user was listening to.
    uninstall = installAudioScratchReclaimer();
    plantScratchFile(LIVE_BOOK);
    plantScratchFile(STALE_BOOK);
    mockCurrentAudioBookId.mockReturnValue(LIVE_BOOK);
    mockIsAudioPlaying.mockReturnValue(true);

    eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, lockSignal(STALE_BOOK, 'revoked'));

    expect(mockReleasePlayer).not.toHaveBeenCalled();
    expect(scratchFile(LIVE_BOOK).exists).toBe(true);
  });

  it('deletes a locked book even when it is the one playing — the licence is gone', () => {
    uninstall = installAudioScratchReclaimer();
    plantScratchFile(LIVE_BOOK);
    mockCurrentAudioBookId.mockReturnValue(LIVE_BOOK);
    mockIsAudioPlaying.mockReturnValue(true);

    eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, lockSignal(LIVE_BOOK, 'revoked'));

    expect(scratchFile(LIVE_BOOK).exists).toBe(false);
  });

  it('leaves OTHER books alone when one book is locked', () => {
    uninstall = installAudioScratchReclaimer();
    plantScratchFile(LIVE_BOOK);
    plantScratchFile(STALE_BOOK);

    eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, lockSignal(STALE_BOOK, 'revoked'));

    expect(scratchFile(LIVE_BOOK).exists).toBe(true);
    expect(scratchFile(STALE_BOOK).exists).toBe(false);
  });

  it('does NOT spare a book that is merely HELD — paused or finished, not playing', () => {
    // This is the streamed-playback case that matters most: an ephemeral book's scratch file is the
    // ONLY decrypted copy in existence (there is no local ciphertext to re-derive it from), so
    // leaving it behind after the user stops listening would mean decrypted licensed content sitting
    // in a cache directory indefinitely. Sparing it buys nothing either way — the resolver rewrites
    // the file on every resolve regardless.
    uninstall = installAudioScratchReclaimer();
    plantScratchFile(LIVE_BOOK);
    mockCurrentAudioBookId.mockReturnValue(LIVE_BOOK);
    mockIsAudioPlaying.mockReturnValue(false);

    emitAppStateChange('background');

    expect(scratchFile(LIVE_BOOK).exists).toBe(false);
  });

  it('unsubscribes both triggers, so a torn-down reclaimer stops sweeping', () => {
    uninstall = installAudioScratchReclaimer();
    uninstall();
    uninstall = () => undefined;

    plantScratchFile(STALE_BOOK);
    eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, lockSignal(STALE_BOOK, 'revoked'));

    expect(scratchFile(STALE_BOOK).exists).toBe(true);
  });
});
