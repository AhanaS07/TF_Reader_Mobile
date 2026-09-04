// src/shared/contracts/index.ts
// Barrel — CAP-7 Reader & Offline (Team t4targaryen)
//
// One import surface:
//   import { ContentProvider, SharedPrefs, Bookmark } from '@/shared/contracts';
//
// RUNTIME vs TYPE — read before importing:
// This layer is type-only EXCEPT two real runtime members that emit JS:
//   • ContentError   (enum, errors.ts)
//   • ContentFailure (class, errors.ts)
//   • DEFAULT_PREFS  (const, prefs.ts)
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
// export * from './offline-lock'; // DEFERRED — offline-lock.ts is finalised
// jointly with Sync (Karthik) + Encryption (Abhinav). Restore this line when the
// file lands; the `content.lock` / `content.unlock` signals live there.

// Existing teammate contracts.
export * from './accessibility'; // AccessibilityPrefs + ReduceMotion (Hruthik)
export * from './prefs'; // layout diagram names this "shared-prefs.ts"
export * from './annotations';
export * from './progress';
export * from './search';
