// src/access/handToggledSession.ts
// A7 — real sign-in is blocked on flambeau answering the token question, and
// week 2's plan says not to wait for it: "the re-scoping logic is ours either
// way, and a hand-toggled session proves it." Selecting an institution is that
// toggle — the same one subtask 1 already uses via ProfileScreen's Sign
// out/Select institution — so this derives a Session from it rather than
// adding a second one.
//
// TAKES THE ID, NOT THE `Institution` — every call site already computes
// `institutionId: string | null` for resolveAccess's own first argument
// (CatalogueScreen from its prop, ItemDetailScreen and ShelfScreen from the
// store or the route), and ShelfScreen in particular only ever has the id, not
// the full object. One shape for both arguments removes a lookup at each site
// rather than adding one.
//
// EVERY FIELD BELOW IS A PLACEHOLDER. `resolveAccess` reads nothing off a
// Session but whether it is null (grep the app: nothing else touches
// `session.userId`/`.roles`/`.collections`/`.exp`), so only that null-ness has
// to be right. DELETE THIS FILE once flambeau ships real sign-in, and pass
// the real Session through instead.
import type { Session } from '@model/types';

export function handToggledSession(institutionId: string | null): Session | null {
  if (institutionId === null) return null;

  return {
    userId: `hand-toggled:${institutionId}`,
    institutionId,
    roles: [],
    collections: [],
    exp: 0,
  };
}
