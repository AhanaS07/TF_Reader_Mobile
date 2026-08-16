// src/store/pendingIntentStore.ts
// What the reader was trying to do before sign-in interrupted them.
//
// WHY THIS HAS TO SURVIVE A RESTART. Institutional sign-in is SAML, which is a
// browser redirect protocol: the app is backgrounded while an identity provider
// takes over, and on a tight device it may be killed outright before the reader
// gets back. An intent held in memory is therefore an intent lost at precisely the
// moment it is needed. index.html §State lists it as Zustand, persisted, survives
// restart — and that row is the only reason this file is not a `useRef`.
//
// TWO CALL SITES, and they are less alike than they look:
//
//   1. The reader taps something that needs an identity we do not have. They only
//      ever saw one button (`signIn`), so the intent is the app's judgement about
//      what to resume — "take them back to this title and open it" — rather than a
//      button they pressed.
//   2. The reader taps Read or Download while apparently signed in, and the call
//      comes back unauthenticated because the token lapsed. Here the intent IS the
//      action they pressed, and replaying it is the whole point.
//
// ONE SLOT, AND A SECOND INTENT REPLACES THE FIRST. Deliberately unlike the queue
// offer store (D15), which is also one slot but must NOT silently overwrite: an
// offer is a copy already reassigned, so losing one costs the reader something
// real. An intent is just a note about what they were doing, and the most recent
// tap is by definition the one they still want.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import storage from '@storage/storage';
import type { ActionId } from '@model/types';
import type { BookId, Timestamp } from '@/shared/types/primitives';

// How long an intent stands before it is treated as abandoned.
//
// A GUESS, AND FLAGGED AS ONE — worth a review rather than trust. It has to cover
// a slow SAML round trip on a bad connection, including a reader who has to reset
// a password on the way through. It must not be so long that signing in tomorrow
// for an unrelated reason silently opens a book they have forgotten about, or
// worse, spends their data on a download they no longer want.
export const INTENT_MAX_AGE_MS = 60 * 60 * 1000;

export interface PendingIntent {
  // NEVER `signIn`. Replaying a sign-in after signing in would bounce the reader
  // straight back out to the identity provider, and the loop would look like a
  // broken app rather than a bug. Excluded in the TYPE rather than guarded at
  // runtime, so the mistake cannot be written in the first place.
  action: Exclude<ActionId, 'signIn'>;
  itemId: BookId;
  // The same title resolves differently per institution, so resuming in the wrong
  // one would replay the intent against different access rules. `null` is the
  // public open-access path — a real value, not missing data, exactly as on
  // `AccessResult`.
  institutionId: string | null;
  createdAt: Timestamp;
}

// What a caller supplies. `createdAt` is stamped by the store rather than passed
// in, so there is one clock reading per intent and no call site can forget it or
// invent one.
export type PendingIntentRequest = Omit<PendingIntent, 'createdAt'>;

interface PendingIntentState {
  pending: PendingIntent | null;
  // True once storage has finished loading. The navigator reads this before
  // deciding whether to replay, or a cold start would resolve "nothing pending"
  // against a store that simply had not arrived yet — the same trap as FL-5 on the
  // institution store.
  _hasHydrated: boolean;

  // Replaces whatever was there. `now` is injectable for tests; app code omits it.
  remember: (intent: PendingIntentRequest, now?: Timestamp) => void;

  /**
   * Returns the intent and clears it in one step, or null if there is none or it
   * has gone stale.
   *
   * CONSUME-ONCE ON PURPOSE. A plain getter invites reading it, replaying it, and
   * forgetting to clear — which on `download` means fetching the same file twice
   * and on a licence call means two writes for one tap. Taking and clearing
   * together makes the safe order the only order.
   */
  take: (now?: Timestamp) => PendingIntent | null;

  clear: () => void;
  // Called by onRehydrateStorage — not for screens to call directly.
  setHasHydrated: (value: boolean) => void;
}

export const usePendingIntentStore = create<PendingIntentState>()(
  persist(
    (set, get) => ({
      pending: null,
      _hasHydrated: false,

      remember: (intent, now = Date.now()) =>
        set({ pending: { ...intent, createdAt: now } }),

      take: (now = Date.now()) => {
        const { pending } = get();
        if (pending === null) return null;

        // Cleared either way. A stale intent that stayed put would be re-examined
        // and re-rejected on every launch forever.
        set({ pending: null });

        return now - pending.createdAt > INTENT_MAX_AGE_MS ? null : pending;
      },

      clear: () => set({ pending: null }),

      setHasHydrated: (value) => set({ _hasHydrated: value }),
    }),
    {
      name: 'pending-intent',
      storage: createJSONStorage(() => storage),
      // Only data crosses the storage boundary — _hasHydrated resets to false on
      // every cold start (by design), and actions are never serialisable.
      partialize: (state) => ({ pending: state.pending }),
      // If rehydration fails, state is undefined and _hasHydrated stays false,
      // which is the safe fallback: nothing is replayed.
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      version: 1,
    },
  ),
);
