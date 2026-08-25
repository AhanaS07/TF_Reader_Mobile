// Owner: Reader (Ahana).
//
// AUDIO PHASE 4, TASK A. Proves the property the phase is actually for: an audio position survives
// an app RELAUNCH, not just a navigation round trip.
//
// WHY THIS FILE MOCKS expo-file-system ITSELF rather than using the root mock
// (__mocks__/expo-file-system.js). "Relaunch" here means `jest.resetModules()` — a fresh module
// registry, which is exactly what a new app process gets. The root mock allocates its backing
// directory with `mkdtempSync` at MODULE LOAD, so resetting the registry gives it a brand-new empty
// directory too: the test would then be proving that a fresh process reads a fresh disk, which is
// not a claim about durability at all and would pass just as happily against the old in-memory Map.
//
// This file's fake keeps its bytes on `globalThis`, which `resetModules()` does NOT clear. That
// models the real pair of lifetimes correctly — module state dies, the disk does not — and is the
// only arrangement in which the assertion below can actually fail if durability regresses.
//
// NO RTL HERE AT ALL: this is a plain module test, so AudioPlayerScreen.test.tsx's rerender()
// instability is not in play.

interface FakeDisk {
  __audioProgressDisk?: Map<string, string>;
}

jest.mock('expo-file-system', () => {
  // Initialised inside the factory, not captured from the module scope above: jest hoists this
  // factory above every const in the file, so anything it closed over would be in the TDZ when the
  // subject-under-test's own import triggers it.
  const global_ = globalThis as FakeDisk;
  global_.__audioProgressDisk ??= new Map<string, string>();
  const disk = global_.__audioProgressDisk;

  class File {
    uri: string;

    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}/${name}`;
    }

    get exists(): boolean {
      return disk.has(this.uri);
    }

    create(): void {
      disk.set(this.uri, '');
    }

    write(content: string): void {
      disk.set(this.uri, content);
    }

    textSync(): string {
      const contents = disk.get(this.uri);
      if (contents === undefined) throw new Error(`ENOENT: ${this.uri}`);
      return contents;
    }
  }

  return { File, Paths: { document: { uri: 'file:///document' } } };
});

function disk(): Map<string, string> {
  const global_ = globalThis as FakeDisk;
  global_.__audioProgressDisk ??= new Map<string, string>();
  return global_.__audioProgressDisk;
}

type ProgressModule = typeof import('./audioSessionProgress');

/** A fresh module registry over the SAME fake disk — i.e. an app relaunch. */
function relaunch(): ProgressModule {
  jest.resetModules();
  // require(), not import: re-evaluating the module AFTER resetModules() is the entire mechanism
  // being tested here, and a static import is bound once at the top of the file — it would hand
  // back the same instance every time and quietly assert nothing.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./audioSessionProgress') as ProgressModule;
}

const BOOK = 'dev-sample-audio';
const OTHER_BOOK = 'dev-fixture-audio';

describe('audioSessionProgress', () => {
  beforeEach(() => {
    disk().clear();
    jest.resetModules();
  });

  it('has no position for a book that was never played', () => {
    const store = relaunch();
    expect(store.getAudioSessionPosition(BOOK)).toBeUndefined();
  });

  it('reads back a position within the same run', () => {
    const store = relaunch();
    store.setAudioSessionPosition(BOOK, 42.5);
    expect(store.getAudioSessionPosition(BOOK)).toBe(42.5);
  });

  // THE ACCEPTANCE CRITERION for Task A. Against the previous in-memory Map this fails outright:
  // the second module instance starts with an empty map and nothing to hydrate from.
  it('resumes a position after an app relaunch', () => {
    const first = relaunch();
    first.setAudioSessionPosition(BOOK, 128.25);
    first.flushAudioSessionPosition();

    const second = relaunch();
    expect(second.getAudioSessionPosition(BOOK)).toBe(128.25);
  });

  it('keeps positions for several books apart across a relaunch', () => {
    const first = relaunch();
    first.setAudioSessionPosition(BOOK, 10);
    first.setAudioSessionPosition(OTHER_BOOK, 900);
    first.flushAudioSessionPosition();

    const second = relaunch();
    expect(second.getAudioSessionPosition(BOOK)).toBe(10);
    expect(second.getAudioSessionPosition(OTHER_BOOK)).toBe(900);
  });

  it('writes the first position straight through, without waiting for the throttle', () => {
    // The throttle must never swallow the FIRST write of a run — a user who opens a book, listens,
    // and force-quits inside the throttle window would otherwise resume at the top.
    const store = relaunch();
    store.setAudioSessionPosition(BOOK, 7);
    expect(disk().size).toBe(1);
  });

  it('does not write to disk on every tick', () => {
    const store = relaunch();
    store.setAudioSessionPosition(BOOK, 1); // writes through (first of the run)
    const afterFirst = disk().get('file:///document/tf-reader-audio-progress.json');

    // Subsequent ticks inside the throttle window update memory only.
    store.setAudioSessionPosition(BOOK, 2);
    store.setAudioSessionPosition(BOOK, 3);
    expect(disk().get('file:///document/tf-reader-audio-progress.json')).toBe(afterFirst);

    // ...and are still readable in-process, so nothing is lost, only deferred.
    expect(store.getAudioSessionPosition(BOOK)).toBe(3);
  });

  it('flush writes the throttled-away position through', () => {
    const first = relaunch();
    first.setAudioSessionPosition(BOOK, 1);
    first.setAudioSessionPosition(BOOK, 2);
    first.setAudioSessionPosition(BOOK, 3);
    first.flushAudioSessionPosition();

    expect(relaunch().getAudioSessionPosition(BOOK)).toBe(3);
  });

  it('survives a corrupt progress file rather than throwing', () => {
    disk().set('file:///document/tf-reader-audio-progress.json', '{ this is not json');

    const store = relaunch();
    expect(() => store.getAudioSessionPosition(BOOK)).not.toThrow();
    expect(store.getAudioSessionPosition(BOOK)).toBeUndefined();

    // And recovers: a corrupt file must not permanently wedge the store.
    store.setAudioSessionPosition(BOOK, 5);
    store.flushAudioSessionPosition();
    expect(relaunch().getAudioSessionPosition(BOOK)).toBe(5);
  });

  it('ignores stored values that are not usable positions', () => {
    // A hand-edited file, or one written by a future/older build. A NaN reaching player.seekTo()
    // is worse than no resume position at all.
    disk().set(
      'file:///document/tf-reader-audio-progress.json',
      JSON.stringify({ [BOOK]: 'not-a-number', [OTHER_BOOK]: -1, good: 12 }),
    );

    const store = relaunch();
    expect(store.getAudioSessionPosition(BOOK)).toBeUndefined();
    expect(store.getAudioSessionPosition(OTHER_BOOK)).toBeUndefined();
    expect(store.getAudioSessionPosition('good')).toBe(12);
  });

  it('flush is a no-op when nothing changed', () => {
    const store = relaunch();
    store.flushAudioSessionPosition();
    expect(disk().size).toBe(0);
  });
});
