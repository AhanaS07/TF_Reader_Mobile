// prefsStore.noLiveSync.test.ts — pins the decision (Ahana, 2026-09-07) that a sync-pulled
// prefs/accessibility change does NOT live-notify an already-mounted screen, unlike bookmarks,
// reading progress and highlights, which do. See prefsStore.ts's own "SCOPED TO LOCAL WRITES ON
// PURPOSE" note for the reasoning: a prefs change is a rendering/behavioural change to the page
// the user is looking at right now, and live-applying one driven by another device's edit is a
// surprise a re-render can't announce.
//
// Run: npm test    (or: npx jest src/features/personalization/prefsStore.noLiveSync)
//
// prefsStore.test.ts deliberately imports ONLY the wrapper (see its own header) — this file is
// the documented exception, same precedent as prefsFieldMerge.integration.test.ts: proving the
// ABSENCE of a live bridge requires driving a change into the underlying tables directly, the
// way Sync's own `applyServerRecord` (a pull) would, WITHOUT going through
// `prefsStore.savePrefs`/`resetPrefs`.

import { prefsStore } from '@/features/personalization/prefsStore';
import { personalizationStore } from '@/features/sync/stores/personalizationStore';
import { accessibilityStore } from '@/features/sync/stores/accessibilityStore';
import { renderHook, waitFor } from '@testing-library/react-native';

import { useTtsEnabled } from '@/features/accessibility/tts/useTtsEnabled';

/** Real setTimeout, not fake timers — runs after the microtask queue is fully drained. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  await prefsStore.resetPrefs();
});

describe('a table changing without going through savePrefs/resetPrefs (i.e. a sync pull)', () => {
  it('does NOT notify prefsStore subscribers while the screen stays mounted', async () => {
    const listener = jest.fn();
    const off = prefsStore.subscribe(listener);
    try {
      // Bypasses prefsStore entirely — the same shape of write `applyServerRecord` (a pull)
      // performs, just without needing to fabricate a server-wire-shaped record.
      await personalizationStore.update({ theme: 'dark' });
      await accessibilityStore.update({ tts_enabled: 1 });
      await flushMicrotasks();

      expect(listener).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });

  it('IS correctly reflected the next time the record is read (the "reopen" path)', async () => {
    await personalizationStore.update({ theme: 'dark' });

    // No subscription in play here at all — this is exactly what a remount's mount-time
    // `getPrefs()` does. Sync's field-level LWW merge already resolved the record correctly on
    // the pull itself; nothing about "not notifying live" makes this read stale or wrong.
    const fresh = await prefsStore.getPrefs();
    expect(fresh.theme).toBe('dark');
  });

  it('a real local edit still notifies normally — only the pulled path is silent', async () => {
    const listener = jest.fn();
    const off = prefsStore.subscribe(listener);
    try {
      await prefsStore.savePrefs({ theme: 'sepia' });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].theme).toBe('sepia');
    } finally {
      off();
    }
  });
});

describe('a real consumer stays put while mounted, and only picks up the change on remount', () => {
  it('useTtsEnabled does not flip when tts_enabled changes on another device while mounted', async () => {
    const { result } = await renderHook(() => useTtsEnabled());
    await waitFor(() => expect(result.current).toBe(false));

    await accessibilityStore.update({ tts_enabled: 1 });
    await flushMicrotasks();

    // Still false: the change is real and stored, but this mounted instance has no live channel
    // to it by design.
    expect(result.current).toBe(false);
  });

  it('a fresh mount (the "reopen") picks up the change the live instance did not see', async () => {
    await accessibilityStore.update({ tts_enabled: 1 });

    const { result } = await renderHook(() => useTtsEnabled());
    await waitFor(() => expect(result.current).toBe(true));
  });
});
