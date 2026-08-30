// src/auth/personalAccount.test.ts
//
// The bodies are stubs, so these tests pin the parts that must survive the real
// implementation landing: the result shape, and the fact that a personal session
// carries NO institutionId. The second one is load-bearing — an institutionId here
// would scope the catalogue to an institution the reader has no entitlement to.
import { signInWithPassword, signUpWithPassword } from './personalAccount';

const CREDENTIALS = { email: 'reader@tf.com', password: 'hunter2000' };

describe.each([
  ['signInWithPassword', signInWithPassword],
  ['signUpWithPassword', signUpWithPassword],
])('%s', (_name, call) => {
  it('resolves to a successful result', async () => {
    const result = await call(CREDENTIALS);

    expect(result.ok).toBe(true);
  });

  it('omits institutionId, because a personal subscriber belongs to no institution', async () => {
    const result = await call(CREDENTIALS);

    if (!result.ok) throw new Error('expected the stub to succeed');
    // Absent, not null — sessionStore reads an absent institutionId as "individual".
    expect(result.session.institutionId).toBeUndefined();
  });

  it('carries the email as the userId, since the contract has no display name', async () => {
    const result = await call(CREDENTIALS);

    if (!result.ok) throw new Error('expected the stub to succeed');
    expect(result.session.userId).toBe('reader@tf.com');
  });

  it('returns a session with an expiry and empty entitlements', async () => {
    const result = await call(CREDENTIALS);

    if (!result.ok) throw new Error('expected the stub to succeed');
    expect(result.session.expiresIn).toBeGreaterThan(0);
    expect(result.session.roles).toEqual([]);
    expect(result.session.collections).toEqual([]);
  });

  it('marks the token as a stub, so a real one is never mistaken for it', async () => {
    const result = await call(CREDENTIALS);

    if (!result.ok) throw new Error('expected the stub to succeed');
    expect(result.session.accessToken).toContain('stub-personal:');
  });
});
