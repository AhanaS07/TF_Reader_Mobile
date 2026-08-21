// src/store/offerStore.ts
// D15 — the queue offer store. Holds the one Elite offer a reader is currently
// being asked to answer.
//
// WHY THIS HAS TO SURVIVE A RESTART. An offer is a copy already reassigned to
// this reader, on a countdown. index.html: "it persists because an offer that
// vanishes when the app is backgrounded is worse than no offer at all." A
// reader has to be able to answer it from wherever they are in the app,
// including after being killed and relaunched — which is what puts this in
// Zustand + persist rather than a `useRef` or screen-local state.
//
// ONE SLOT, AND A SECOND OFFER MUST NOT SILENTLY REPLACE THE FIRST. Deliberately
// unlike `pendingIntentStore` (see its own header comment, which names this file
// by contrast): a pending intent is just a note about what the reader was
// doing, so the latest tap winning is correct. An offer is a copy — replacing
// one the reader has not yet answered would make it disappear with no record
// of what was lost. A DEAD offer (already lapsed) is the one exception: it is
// behaviourally the same as never having asked (see `offerLapse.ts` and
// `resolveAccess.ts`'s Elite branch), so it does not block a new one from
// taking the slot.
//
// THE COUNTDOWN IS SERVER TIME, NEVER DEVICE TIME. `Hold.serverTime` is "the
// server's clock as at the response that carried this hold... NOT A CLOCK, AND
// IT GOES STALE" (model/types.ts) — a countdown driven off it has to add the
// elapsed time since the response arrived, and that is this store's job because
// it is the one thing that knows when it fetched. The elapsed-time arithmetic
// below uses the DEVICE clock only to measure an interval between two of its
// own readings, which is safe even if the device's absolute clock is wrong: the
// same offset error is present in both readings and cancels out. What it must
// never do is use the device clock as the reference instant itself.
//
// WEEK 2 SCOPE IS THE STORE, ACCEPT, REJECT — AGAINST A FAKE TRIGGER. Real
// delivery (flambeau's `GET /api/v1/loans/changes` poll) is D16, Week 4. This
// file does not fetch, poll or call flambeau; `receiveOffer` is handed a
// `Hold` by whatever calls it, real or fake, and does not care which.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import storage from '@storage/storage';
import { isOfferLapsed, lapseOffer } from '@access/offerLapse';
import type { Hold } from '@model/types';
import type { Timestamp } from '@/shared/types/primitives';

// True only for a hold this store would still let a reader act on: state
// `'offered'` AND not yet past its server-issued expiry. Checked by STATE
// first and `isOfferLapsed` second, on purpose — `isOfferLapsed` answers
// `false` for every state that is not `'offered'`, INCLUDING `'expired'`, by
// its own design ("a category error" to ask it of a hold already marked). A
// slot left holding a hold this store itself expired (see `consume` below)
// would therefore read as "not lapsed" from `isOfferLapsed` alone, and a
// check that stopped there would leave the slot stuck occupied forever after
// the first lapse anyone ever noticed. Gating on `state` first is what keeps
// this correct regardless of what is sitting in the slot.
function isLiveOffer(hold: Hold | null, receivedAt: Timestamp | null, now: Timestamp): boolean {
  if (hold === null || hold.state !== 'offered') return false;
  return !isOfferLapsed(hold, effectiveNowIso(hold, receivedAt, now));
}

// The instant to check `hold.offerExpiresAt` against, expressed on the
// server's clock. Falls back to the device instant only when the hold carries
// no `serverTime` at all — the contract marks it required on every
// offer-bearing response, so this is a defensive floor, not the expected path.
function effectiveNowIso(hold: Hold, receivedAt: Timestamp | null, now: Timestamp): string {
  if (hold.serverTime === undefined || receivedAt === null) {
    return new Date(now).toISOString();
  }
  const elapsed = now - receivedAt;
  return new Date(Date.parse(hold.serverTime) + elapsed).toISOString();
}

interface OfferState {
  offer: Hold | null;
  // Device `Date.now()` at the moment `offer` was last (re)received — the other
  // half of the serverTime arithmetic above. `null` exactly when `offer` is.
  receivedAt: Timestamp | null;
  // True once storage has finished loading. Same FL-5 shape as
  // `pendingIntentStore._hasHydrated` — nothing here currently gates the app on
  // it the way RootNavigator gates on the institution store, but a caller that
  // reads `offer` before this is true cannot tell "nothing pending" from
  // "storage has not answered yet".
  _hasHydrated: boolean;

  /**
   * Stores an incoming offer. Returns `false` and leaves the slot untouched if
   * a DIFFERENT offer is already live there; a caller gets an explicit signal
   * rather than a silent overwrite.
   *
   * Accepts (returns `true`) when the slot is empty, when the live offer there
   * has since lapsed, or when the incoming hold is the SAME offer being
   * re-delivered (`offerId` matches) — e.g. a refreshed expiry from a later
   * poll. `now` is injectable for tests; app code omits it.
   *
   * PRECONDITION, UNGUARDED: `hold.state` should be `'offered'`. Same stance as
   * `lapseOffer` — the gate belongs at the call site, not here.
   */
  receiveOffer: (hold: Hold, now?: Timestamp) => boolean;

  /**
   * Minutes left to answer, floored. `undefined` when there is nothing live to
   * answer — no offer, or the one in the slot has lapsed. Never negative:
   * `isLiveOffer` already requires a strictly positive remainder before this
   * branch runs, so the last live minute floors to `0` ("Expiring now" in
   * `QueueNotification`) rather than skipping straight to `undefined`.
   */
  minutesRemaining: (now?: Timestamp) => number | undefined;

  /**
   * Consume-once: returns the offer being accepted and clears the slot, or
   * `null` if there was nothing live to accept. A lapsed offer found in the
   * slot is transitioned via `lapseOffer` and the slot freed — same shape as
   * `pendingIntentStore.take()`'s "stale intent is cleared, not left to be
   * re-rejected forever" reasoning.
   */
  acceptOffer: (now?: Timestamp) => Hold | null;
  /** Same contract as `acceptOffer`, for the other answer. */
  rejectOffer: (now?: Timestamp) => Hold | null;

  clear: () => void;
  // Called by onRehydrateStorage — not for screens to call directly.
  setHasHydrated: (value: boolean) => void;
}

// Shared by acceptOffer and rejectOffer: which button was pressed is a fact
// for the caller (and eventually D16's flambeau call) to act on, not one that
// changes what this store does to its own slot.
function consume(
  get: () => OfferState,
  set: (partial: Partial<OfferState>) => void,
  now: Timestamp,
): Hold | null {
  const { offer, receivedAt } = get();
  if (offer === null) return null;

  if (!isLiveOffer(offer, receivedAt, now)) {
    // Dead on arrival: free the slot so the next offer is not refused, but
    // there is nothing left to hand the caller.
    set({ offer: lapseOffer(offer), receivedAt: null });
    return null;
  }

  set({ offer: null, receivedAt: null });
  return offer;
}

export const useOfferStore = create<OfferState>()(
  persist(
    (set, get) => ({
      offer: null,
      receivedAt: null,
      _hasHydrated: false,

      receiveOffer: (hold, now = Date.now()) => {
        const { offer, receivedAt } = get();
        const blocked = isLiveOffer(offer, receivedAt, now) && offer?.offerId !== hold.offerId;
        if (blocked) return false;

        set({ offer: hold, receivedAt: now });
        return true;
      },

      minutesRemaining: (now = Date.now()) => {
        const { offer, receivedAt } = get();
        if (!isLiveOffer(offer, receivedAt, now)) return undefined;

        // isLiveOffer guarantees `offer` is non-null, 'offered', and its
        // expiry has not passed — so `offerExpiresAt` is present and this
        // difference is strictly positive.
        const expires = Date.parse(offer!.offerExpiresAt!);
        const at = Date.parse(effectiveNowIso(offer!, receivedAt, now));
        return Math.floor((expires - at) / 60000);
      },

      acceptOffer: (now = Date.now()) => consume(get, set, now),
      rejectOffer: (now = Date.now()) => consume(get, set, now),

      clear: () => set({ offer: null, receivedAt: null }),

      setHasHydrated: (value) => set({ _hasHydrated: value }),
    }),
    {
      name: 'queue-offer',
      storage: createJSONStorage(() => storage),
      // Only data crosses the storage boundary — _hasHydrated resets to false
      // on every cold start (by design), and actions are never serialisable.
      partialize: (state) => ({ offer: state.offer, receivedAt: state.receivedAt }),
      // FIXED against a latent bug found elsewhere in this codebase
      // (institutionStore.ts): Zustand's callback receives `(state, error)`,
      // and on a rehydration failure `state` is `undefined` — an
      // `state?.setHasHydrated(true)` there silently never flips the flag,
      // which is a permanent "storage has not answered yet" reading. Reaching
      // for the store by its own hook instead of the callback's `state`
      // argument flips the flag on both the success and failure path alike.
      onRehydrateStorage: () => () => {
        useOfferStore.getState().setHasHydrated(true);
      },
      version: 1,
    },
  ),
);
