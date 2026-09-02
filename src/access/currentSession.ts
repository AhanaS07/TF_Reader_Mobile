// src/access/currentSession.ts
// The real Session resolveAccess needs, read from sessionStore now that real
// sign-in exists. Replaces handToggledSession — see that file's own note:
// "DELETE THIS FILE once flambeau ships real sign-in, and pass the real
// Session through instead." A reader who has only selected an institution but
// never signed in gets `null` here, unlike the old placeholder.
//
// A HOOK, NOT A PLAIN FUNCTION. Every call site uses this inside a `useMemo`
// that resolves access for a render — reading `useSessionStore.getState()`
// directly there would not re-run the memo when a sign-in or sign-out changes
// the session, since none of its fields would appear in the memo's dependency
// array. Subscribing via the hook makes the component re-render (and the memo
// re-run, once the session fields are added to its deps) on every change.
import { useSessionStore } from '@store/sessionStore';
import type { Session } from '@model/types';

export function useCurrentSession(): Session | null {
  const isAuthenticated = useSessionStore((s) => s.isAuthenticated);
  const userId = useSessionStore((s) => s.userId);
  const institutionId = useSessionStore((s) => s.institutionId);
  const roles = useSessionStore((s) => s.roles);
  const collections = useSessionStore((s) => s.collections);
  const expiresAt = useSessionStore((s) => s.expiresAt);

  if (!isAuthenticated || userId === null) return null;

  return {
    userId,
    ...(institutionId !== null ? { institutionId } : {}),
    roles,
    collections,
    // Session.exp is seconds, matching a JWT `exp` claim; sessionStore's
    // expiresAt is milliseconds, matching Date.now().
    exp: expiresAt !== null ? Math.floor(expiresAt / 1000) : 0,
  };
}
