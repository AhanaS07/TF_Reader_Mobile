// Credential checks for the personal-account form, as pure functions.
//
// DELIBERATELY LENIENT. These catch a typo before a request is spent; the server
// stays the authority on whether an account exists or a password is good enough.
// A rule here that the server does not share would lock a reader out of an account
// that is actually valid.
//
// Each returns `undefined` when the value is fine, so the result drops straight
// into TextField's optional `error` prop.

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Not an RFC 5322 regex, on purpose. Those reject addresses that really work, and
 * nobody can read them. This catches a missing @ or a domain with no dot, which is
 * the mistake people actually make.
 */
export function emailError(email: string): string | undefined {
  const trimmed = email.trim();
  if (trimmed.length === 0) return 'Enter your email address.';

  const at = trimmed.indexOf('@');
  // `<= 0` covers both no @ at all (-1) and an address starting with one (0).
  if (at <= 0) return 'Enter a valid email address.';

  const domain = trimmed.slice(at + 1);
  if (!domain.includes('.')) return 'Enter a valid email address.';
  if (domain.startsWith('.') || domain.endsWith('.')) return 'Enter a valid email address.';

  return undefined;
}

/** Signing in: any password the reader already has is acceptable length. */
export function passwordError(password: string): string | undefined {
  if (password.length === 0) return 'Enter your password.';
  return undefined;
}

/** Signing up: the one strength rule worth enforcing before a round trip. */
export function newPasswordError(password: string): string | undefined {
  if (password.length === 0) return 'Choose a password.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return undefined;
}

export function confirmPasswordError(password: string, confirm: string): string | undefined {
  if (confirm.length === 0) return 'Re-enter your password.';
  if (confirm !== password) return 'Passwords do not match.';
  return undefined;
}
