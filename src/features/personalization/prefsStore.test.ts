// prefsStore.test.ts — scratch/behaviour check for the Day-2 personalization stub.
// Run: npm test    (or: npx jest src/features/personalization)
//
// Proves three things the standup cares about:
//   1. getPrefs seeds DEFAULT_PREFS on first access (and isn't "dirty" yet).
//   2. savePrefs marks the record synced:false ("marked for sync") + bumps updatedAt.
//   3. One SharedPrefs object carries BOTH personalization AND accessibility
//      (the single object Ahana applies to the reader).

import { InMemoryPrefsStore } from '@/features/personalization/prefsStore';

describe('InMemoryPrefsStore (Day-2 stub)', () => {
  it('seeds DEFAULT_PREFS on first access, not marked dirty', () => {
    const store = new InMemoryPrefsStore();
    const prefs = store.getPrefs('u1');

    expect(prefs.theme).toBe('system'); // default
    expect(prefs.userId).toBe('u1');
    expect(prefs.synced).toBe(true); // seeded defaults aren't a user edit
    expect(prefs.isDeleted).toBe(false); // no delete op — pinned false
  });

  it('savePrefs merges, marks synced:false, bumps updatedAt', () => {
    // Fixed clock so the timestamp assertion is deterministic.
    let t = 1000;
    const store = new InMemoryPrefsStore(() => 'id-1', () => (t += 1));

    const before = store.getPrefs('u1');
    const after = store.savePrefs('u1', { theme: 'dark' });

    expect(after.theme).toBe('dark'); // change applied
    expect(after.synced).toBe(false); // marked for sync → Karthik's outbox
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt); // LWW stamp bumped
    // untouched fields survive the merge:
    expect(after.typography.size).toBe(16);
  });

  it('returns ONE object with personalization + accessibility (Ahana s single object)', () => {
    const store = new InMemoryPrefsStore();
    const prefs = store.getPrefs('u1');

    // personalization
    expect(prefs.font.family).toBe('system');
    expect(prefs.layout.flow).toBe('paginated');
    expect(prefs.zoom.level).toBe(1.0);
    // accessibility — same object, no second call.
    // Nested under text / display since the a11y contract moved off flat fields,
    // and reduceMotion is now the tri-state 'system' | 'on' | 'off', not a
    // boolean — 'system' means "follow the OS" (resolve via resolveReduceMotion).
    expect(prefs.accessibility.text.dyslexiaFont).toBe(false);
    expect(prefs.accessibility.display.reduceMotion).toBe('system');
  });

  it('resetPrefs restores defaults as a write (not a tombstone)', () => {
    const store = new InMemoryPrefsStore();
    store.savePrefs('u1', { theme: 'dark' });

    const reset = store.resetPrefs('u1');
    expect(reset.theme).toBe('system'); // back to default
    expect(reset.synced).toBe(false); // still a real write
    expect(reset.isDeleted).toBe(false); // reset is NOT a delete
  });
});
