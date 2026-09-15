// src/auth/credentialRules.test.ts
//
// These rules exist to catch a typo before a request is spent, so the tests care
// about two things in equal measure: that an obvious mistake is caught, and that a
// valid-but-unusual address is NOT rejected. The second is the one that locks a
// reader out of their own account if it regresses.
import {
  MIN_PASSWORD_LENGTH,
  confirmPasswordError,
  emailError,
  newPasswordError,
  passwordError,
} from './credentialRules';

describe('emailError', () => {
  it('asks for an address when the field is empty', () => {
    expect(emailError('')).toBe('Enter your email address.');
  });

  it('treats whitespace as empty', () => {
    expect(emailError('   ')).toBe('Enter your email address.');
  });

  it('rejects an address with no @', () => {
    expect(emailError('reader.tf.com')).toBe('Enter a valid email address.');
  });

  it('rejects an address that starts with @', () => {
    expect(emailError('@tf.com')).toBe('Enter a valid email address.');
  });

  it('rejects a domain with no dot', () => {
    expect(emailError('reader@localhost')).toBe('Enter a valid email address.');
  });

  it('rejects a domain that starts or ends with a dot', () => {
    expect(emailError('reader@.tf.com')).toBe('Enter a valid email address.');
    expect(emailError('reader@tf.com.')).toBe('Enter a valid email address.');
  });

  it('accepts an ordinary address', () => {
    expect(emailError('reader@tf.com')).toBeUndefined();
  });

  it('accepts a surrounding-whitespace address, because the form trims it', () => {
    expect(emailError('  reader@tf.com  ')).toBeUndefined();
  });

  // Deliberately lenient — the server is the authority. These are all valid
  // addresses that a stricter regex would wrongly throw out.
  it('accepts addresses a stricter rule would wrongly reject', () => {
    expect(emailError('reader+alerts@tf.co.uk')).toBeUndefined();
    expect(emailError("o'brien@tf.ie")).toBeUndefined();
    expect(emailError('reader_1@sub.department.tf.ac.uk')).toBeUndefined();
  });
});

describe('passwordError — signing in', () => {
  it('asks for a password when the field is empty', () => {
    expect(passwordError('')).toBe('Enter your password.');
  });

  // No length rule on sign-in: whatever the reader already has is correct by
  // definition, including a password shorter than today's minimum.
  it('accepts a short existing password', () => {
    expect(passwordError('abc')).toBeUndefined();
  });
});

describe('newPasswordError — signing up', () => {
  it('asks for a password when the field is empty', () => {
    expect(newPasswordError('')).toBe('Choose a password.');
  });

  it('rejects a password under the minimum', () => {
    const tooShort = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    expect(newPasswordError(tooShort)).toBe(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  });

  it('accepts a password at exactly the minimum', () => {
    expect(newPasswordError('a'.repeat(MIN_PASSWORD_LENGTH))).toBeUndefined();
  });
});

describe('confirmPasswordError', () => {
  it('asks for the confirmation when it is empty', () => {
    expect(confirmPasswordError('hunter2000', '')).toBe('Re-enter your password.');
  });

  it('reports a mismatch', () => {
    expect(confirmPasswordError('hunter2000', 'hunter2001')).toBe('Passwords do not match.');
  });

  it('is satisfied by an exact match', () => {
    expect(confirmPasswordError('hunter2000', 'hunter2000')).toBeUndefined();
  });

  // Case and whitespace are part of a password, so neither is normalised away.
  it('treats case and trailing space as a mismatch', () => {
    expect(confirmPasswordError('Hunter2000', 'hunter2000')).toBe('Passwords do not match.');
    expect(confirmPasswordError('hunter2000', 'hunter2000 ')).toBe('Passwords do not match.');
  });
});
