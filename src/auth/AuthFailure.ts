// src/auth/AuthFailure.ts
// Typed reasons ApiAuthClient can fail, so a screen can branch on `code`
// rather than parsing an HTTP status or a message string.
export enum AuthError {
  NETWORK_UNAVAILABLE = 'NETWORK_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  REFUSED = 'REFUSED',
  MALFORMED_RESPONSE = 'MALFORMED_RESPONSE',
}

export interface AuthFailureOptions {
  cause?: unknown;
  // Only set on REFUSED, when the response body carried a machine-readable
  // code (e.g. `USER_NOT_PROVISIONED`) worth showing something other than
  // the generic refusal copy for.
  errorCode?: string;
}

export class AuthFailure extends Error {
  readonly code: AuthError;
  readonly errorCode?: string;

  constructor(code: AuthError, options: AuthFailureOptions = {}) {
    super(`Auth request failed: ${code}`, { cause: options.cause });
    this.name = 'AuthFailure';
    this.code = code;
    this.errorCode = options.errorCode;
  }
}
