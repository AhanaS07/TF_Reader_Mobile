// src/store/secureStorage.ts
// Secure storage for the refresh token — the only credential that survives app restarts.
//
// WHY NOT AsyncStorage: the refresh token is a long-lived credential. AsyncStorage
// is unencrypted on both platforms; expo-secure-store backs Keychain (iOS) and
// Keystore-backed encrypted storage (Android). The flambeau auth design (§5) is
// explicit about this split: access token in memory, refresh token in secure storage.
//
// ONE KEY, ONE TOKEN. This file does not store the access token (that is the
// sessionStore's job) or anything else. If a second secure value is needed, add a
// named constant here rather than spreading key strings across the codebase.
import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'session.refreshToken';

/** Persists the refresh token to Keychain / Keystore. */
export async function saveRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
}

/** Reads the refresh token. Returns null if none is stored. */
export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

/** Removes the refresh token — called on sign-out and on refresh failure. */
export async function deleteRefreshToken(): Promise<void> {
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}
