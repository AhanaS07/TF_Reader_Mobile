// prefsStore.test.ts — the settings-facing prefs wrapper over Sync's persisted store.

// Run: npm test    (or: npx jest src/features/personalization)
//
// This replaces the old InMemoryPrefsStore tests: the wrapper no longer holds state,
// it delegates to the real SQLite-backed layer behind features/sync/sharedPrefs.ts.
//
// Deliberately imports ONLY the wrapper — never sync/stores/* or sync/localDb/*.
// Those are Sync's snake_case internals (the boundary Karthik drew: sharedPrefs.ts is
// the seam, everything under it is not). So the baseline reset and every assertion go
// through the public wrapper. Proves the three things week-2 day-1 cares about:
//   1. getPrefs returns DEFAULT_PREFS values when nothing has been customized.
//   2. savePrefs persists and ROUND-TRIPS: write -> reload -> same values.
//   3. resetPrefs restores defaults as a write (not a tombstone).
//
// The old stub's cross-user aliasing tests are gone by design: every read here
// reconstructs fresh nested objects from SQLite rows, so there is nothing to alias.
// First-run "no row at all -> defaults" is Sync's mergeSharedPrefs fallback, covered
// on its side (contractConformance) — not re-proven here through its internals.
//
// The old-flat-accessibility-shape migration this file used to cover (Zustand's own
// `persist.merge`) no longer applies — this store holds no client-side persisted shape of
// its own to migrate. That concern now lives in Sync's SQLite-backed merge logic; see
// `personalizationStore.fieldMerge.test.ts` / `accessibilityStore.fieldMerge.test.ts`.

import { prefsStore } from '@/features/personalization/prefsStore';
import { DEFAULT_PREFS } from '@/shared/contracts';

// Known baseline via the public seam only — resetPrefs writes defaults to storage.
beforeEach(async () => {
  await prefsStore.resetPrefs();
});

describe('prefsStore (settings-facing wrapper over the persisted store)', () => {
  it('returns DEFAULT_PREFS values when nothing has been customized', async () => {
    const prefs = await prefsStore.getPrefs();

    expect(prefs.theme).toBe('system');
    expect(prefs.font.family).toBe('system');
    expect(prefs.typography.size).toBe(16);
    expect(prefs.layout.flow).toBe('paginated');
    expect(prefs.zoom.level).toBe(1.0);
    // One object carries accessibility too (Ahana applies a single object).
    expect(prefs.accessibility.text.dyslexiaFont).toBe(false);
    expect(prefs.accessibility.display.reduceMotion).toBe('system');
    expect(prefs.isDeleted).toBe(false);
  });

  it('savePrefs persists a change and round-trips through a fresh read', async () => {
    const saved = await prefsStore.savePrefs({ theme: 'dark' });
    expect(saved.theme).toBe('dark');

    // Re-read from storage: the change survived and untouched fields are intact.
    const reloaded = await prefsStore.getPrefs();
    expect(reloaded.theme).toBe('dark');
    expect(reloaded.typography.size).toBe(16);
  });

  it('round-trips a full customization without losing anything', async () => {
    await prefsStore.savePrefs({
      theme: 'sepia',
      typography: { size: 18, lineHeight: 1.6, spacing: 1, margins: 20 },
      layout: { flow: 'scrolled-doc', spread: 'double' },
    });

    const read = await prefsStore.getPrefs();
    expect(read.theme).toBe('sepia');
    expect(read.typography).toEqual({ size: 18, lineHeight: 1.6, spacing: 1, margins: 20 });
    expect(read.layout).toEqual({ flow: 'scrolled-doc', spread: 'double' });
  });

  it('resetPrefs restores defaults as a write, not a tombstone', async () => {
    await prefsStore.savePrefs({ theme: 'dark' });

    const reset = await prefsStore.resetPrefs();
    expect(reset.theme).toBe('system');
    expect(reset.isDeleted).toBe(false);

    // Persisted, not just returned.
    expect((await prefsStore.getPrefs()).theme).toBe('system');
  });
});

// The AccessibilityScreen boundary, through the real SQLite-backed store — not the fake
// `PrefsSource` the hook/screen tests inject. Those prove the hook builds the right patch;
// these prove the patch actually lands on, and survives, the persisted accessibility row.
describe('prefsStore accessibility persistence', () => {
  it('persists a nested accessibility field and survives a fresh read', async () => {
    const A11Y = DEFAULT_PREFS.accessibility;

    await prefsStore.savePrefs({
      accessibility: { ...A11Y, display: { ...A11Y.display, boldText: true } },
    });

    const reloaded = await prefsStore.getPrefs();
    expect(reloaded.accessibility.display.boldText).toBe(true);
  });

  it('a partial accessibility write does not disturb sibling fields or TTS', async () => {
    const A11Y = DEFAULT_PREFS.accessibility;
    await prefsStore.savePrefs({
      accessibility: {
        ...A11Y,
        tts: { ...A11Y.tts, enabled: true, rate: 1.75 },
      },
    });

    await prefsStore.savePrefs({
      accessibility: { ...A11Y, tts: { ...A11Y.tts, enabled: true, rate: 1.75 }, display: { ...A11Y.display, highContrast: true } },
    });

    const reloaded = await prefsStore.getPrefs();
    expect(reloaded.accessibility.display.highContrast).toBe(true);
    expect(reloaded.accessibility.tts.enabled).toBe(true);
    expect(reloaded.accessibility.tts.rate).toBe(1.75);
    expect(reloaded.accessibility.display.boldText).toBe(false);
  });

  it('does not disturb personalization fields', async () => {
    await prefsStore.savePrefs({ theme: 'sepia' });
    const A11Y = DEFAULT_PREFS.accessibility;

    await prefsStore.savePrefs({
      accessibility: { ...A11Y, screenReaderHints: true },
    });

    const reloaded = await prefsStore.getPrefs();
    expect(reloaded.theme).toBe('sepia');
    expect(reloaded.accessibility.screenReaderHints).toBe(true);
  });

  it.each(['system', 'on', 'off'] as const)(
    "persists reduceMotion %p as the raw tri-state string",
    async (reduceMotion) => {
      const A11Y = DEFAULT_PREFS.accessibility;
      await prefsStore.savePrefs({
        accessibility: { ...A11Y, display: { ...A11Y.display, reduceMotion } },
      });

      const reloaded = await prefsStore.getPrefs();
      expect(reloaded.accessibility.display.reduceMotion).toBe(reduceMotion);
    },
  );

  it('persists fontScaleMultiplier at any value within its contract range', async () => {
    const A11Y = DEFAULT_PREFS.accessibility;
    await prefsStore.savePrefs({
      accessibility: { ...A11Y, text: { ...A11Y.text, fontScaleMultiplier: 1.3 } },
    });

    const reloaded = await prefsStore.getPrefs();
    expect(reloaded.accessibility.text.fontScaleMultiplier).toBe(1.3);
  });

  it('restoring accessibility defaults leaves personalization untouched', async () => {
    await prefsStore.savePrefs({ theme: 'dark' });
    const A11Y = DEFAULT_PREFS.accessibility;
    await prefsStore.savePrefs({
      accessibility: { ...A11Y, display: { ...A11Y.display, boldText: true } },
    });

    await prefsStore.savePrefs({ accessibility: DEFAULT_PREFS.accessibility });

    const reloaded = await prefsStore.getPrefs();
    expect(reloaded.accessibility).toEqual(DEFAULT_PREFS.accessibility);
    expect(reloaded.theme).toBe('dark');
  });
});

// The live re-apply channel: the Reader subscribes here and re-applies on change, with no
// event bus (Ahana's decision, 2026-08-18). Listeners are module-level, so every test
// unsubscribes what it adds — a leaked listener would fire on the next test's beforeEach.
describe('prefsStore.subscribe (live re-apply channel)', () => {
  it('notifies with the fresh record after savePrefs', async () => {
    const seen: string[] = [];
    const off = prefsStore.subscribe((p) => seen.push(p.theme));
    try {
      await prefsStore.savePrefs({ theme: 'dark' });
      expect(seen).toEqual(['dark']);
    } finally {
      off();
    }
  });

  it('notifies with defaults after resetPrefs', async () => {
    await prefsStore.savePrefs({ theme: 'dark' });
    const seen: string[] = [];
    const off = prefsStore.subscribe((p) => seen.push(p.theme));
    try {
      await prefsStore.resetPrefs();
      expect(seen).toEqual(['system']);
    } finally {
      off();
    }
  });

  it('stops notifying after unsubscribe', async () => {
    const seen: string[] = [];
    const off = prefsStore.subscribe((p) => seen.push(p.theme));
    await prefsStore.savePrefs({ theme: 'dark' });
    off();
    await prefsStore.savePrefs({ theme: 'sepia' });
    expect(seen).toEqual(['dark']); // only the write before unsubscribe
  });

  it('a throwing subscriber neither fails the write nor starves the others', async () => {
    const seen: string[] = [];
    const offThrow = prefsStore.subscribe(() => {
      throw new Error('boom');
    });
    const offGood = prefsStore.subscribe((p) => seen.push(p.theme));
    try {
      const saved = await prefsStore.savePrefs({ theme: 'dark' });
      expect(saved.theme).toBe('dark'); // write still settled and returned
      expect(seen).toEqual(['dark']); // sibling subscriber still ran
    } finally {
      offThrow();
      offGood();
    }
  });
});
