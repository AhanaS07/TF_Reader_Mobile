// src/shared/contracts/index.ts
// Barrel — CAP-7 Reader & Offline (Team t4targaryen)
//
// One import surface:
//   import { ContentProvider, SharedPrefs, Bookmark } from '@/shared/contracts';
//
// RUNTIME vs TYPE — read before importing:
// This layer is type-only EXCEPT these real runtime members that emit JS:
//   • ContentError          (enum, errors.ts)
//   • ContentFailure        (class, errors.ts)
//   • DEFAULT_PREFS         (const, prefs.ts)
//   • OFFLINE_LOCK_EVENTS   (const, offline-lock.ts)
//   • EVENT_CHANNELS        (const, event-bus.ts)
// …and everything in accessibility.ts except its types:
//   • DEFAULT_ACCESSIBILITY_PREFS, TTS_RATE_MIN / _MAX,
//     REDUCE_MOTION_VALUES, TTS_HIGHLIGHT_MODE_VALUES   (consts)
//   • createDefaultAccessibilityPrefs, isValidTtsRate,
//     isValidReduceMotion, isValidTtsHighlightMode,
//     resolveReduceMotion, migrateReduceMotion, resolveFontScale   (fns)
// Import those as VALUES:      import { ContentError, ContentFailure } from '@/shared/contracts';
// A `import type { ContentError }` compiles but gives you NOTHING at runtime —
// you can't `throw new ContentFailure(...)` or switch on the enum. Everything
// else erases, so `import type { ContentProvider, SharedPrefs }` is correct.
//
// Requires the `@/shared/*` path alias in tsconfig.json (paths). Without the TS
// config wired into CI, none of these freezes are enforceable — see tsconfig.

// Base primitives (incl. ContentFormat).
export * from '../types/primitives';

// New contracts (this task).
export * from './errors';
export * from './content-provider';
export * from './sync-record';

// Offline lock + its carrier. Previously deferred pending the joint Sync (Karthik) +
// Encryption (Abhinav) sign-off; that is now agreed, so both are live. The
// `content.lock` / `content.unlock` signals live in offline-lock.ts and travel over the bus
// declared in event-bus.ts — the instance is src/shared/eventBus.ts.
export * from './offline-lock';
export * from './event-bus';

// Existing teammate contracts.
export * from './prefs'; // layout diagram names this "shared-prefs.ts"
export * from './accessibility'; // composed into SharedPrefs.accessibility
export * from './annotations';
export * from './progress';
export * from './search';

// Download + Encryption (Abhinav). Type-only — nothing here emits runtime JS,
// so `import type { AccessTier, ContentLicenceResponse } from '@/shared/contracts'`
// is the correct form.
//
// content-licence.ts and device-key.ts are marked DRAFT in their own headers:
// both are written against a mock backend, not a confirmed wire contract. They
// are exported anyway so consumers import them through the one surface rather
// than deep-importing a path that will move — but treat their field names as
// unfrozen until the real endpoints are published.
export * from './tier';
export * from './device-key';
export * from './content-licence';

// reading-session.ts (2026-08-14): the REAL flambeau contract (Loans + Reading sessions),
// replacing content-licence.ts as the primary flow. FROZEN on flambeau's side (every endpoint
// modeled here carries `x-stability: FROZEN`) — unlike content-licence.ts/device-key.ts above,
// this one's field names are not a guess.
export * from './reading-session';
