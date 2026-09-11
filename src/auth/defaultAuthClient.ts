// src/auth/defaultAuthClient.ts
// The one ApiAuthClient instance shared by every caller that needs to talk
// to flambeau's auth endpoints without building its own client —
// institutionSignIn.ts and tokenRefresh.ts both use this.
//
// Built lazily, on first real call, not at import time — so Jest never
// needs EXPO_PUBLIC_FLAMBEAU_BASE_URL set. Tests inject their own client via
// a `deps` parameter and never reach this function.
import { ApiAuthClient } from './ApiAuthClient';

let cachedClient: ApiAuthClient | undefined;

export function getDefaultAuthClient(): ApiAuthClient {
  if (cachedClient !== undefined) return cachedClient;

  const baseUrl = process.env.EXPO_PUBLIC_FLAMBEAU_BASE_URL;
  if (baseUrl === undefined || baseUrl.trim() === '') {
    throw new Error('EXPO_PUBLIC_FLAMBEAU_BASE_URL must be set.');
  }

  cachedClient = new ApiAuthClient({ baseUrl: baseUrl.trim() });
  return cachedClient;
}
