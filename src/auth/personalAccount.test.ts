// src/auth/personalAccount.test.ts
//
// signInWithPassword is REAL, end to end (see the file header for the flow — it calls
// /auth/login, NOT the OIDC endpoints, so it checks the same store signup writes to).
// Covered here:
//   - success: login -> getCurrentSession -> saveRefreshToken, session has no
//     institutionId (a personal subscriber belongs to no institution)
//   - UNAUTHENTICATED from /auth/login -> INVALID_CREDENTIALS
//   - network/timeout failures -> NETWORK
//   - a malformed response -> UNKNOWN
//   - a non-AuthFailure throw -> UNKNOWN, never rejects
//   - a failure on login means getCurrentSession/saveRefreshToken never run
//
// signUpWithPassword is also REAL now (see the file header for the flow). Covered here:
//   - success: signup -> getCurrentSession -> saveRefreshToken, session has no institutionId
//   - EMAIL_TAKEN from /signup -> EMAIL_ALREADY_REGISTERED
//   - network/timeout failures -> NETWORK
//   - a malformed response -> UNKNOWN
//   - a non-AuthFailure throw -> UNKNOWN, never rejects
//   - a failure on signup means getCurrentSession/saveRefreshToken never run
import { signInWithPassword, signUpWithPassword } from './personalAccount';
import { AuthError, AuthFailure } from './AuthFailure';
import { saveRefreshToken } from '@store/secureStorage';
import type { ApiAuthClient } from './ApiAuthClient';

jest.mock('@store/secureStorage', () => ({
  saveRefreshToken: jest.fn(),
}));

const mockSaveRefreshToken = saveRefreshToken as jest.Mock;

const CREDENTIALS = { email: 'reader@tf.com', password: 'hunter2000' };

function fakeAuthClient(overrides: Partial<ApiAuthClient> = {}): ApiAuthClient {
  const base = {
    login: jest.fn(),
    signUpWithPassword: jest.fn(),
    getCurrentSession: jest.fn(),
  };
  return { ...base, ...overrides } as unknown as ApiAuthClient;
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('signInWithPassword — success', () => {
  it('logs in and returns a session with no institutionId', async () => {
    const authClient = fakeAuthClient({
      login: jest.fn().mockResolvedValue({
        accessToken: 'access_1',
        refreshToken: 'refresh_1',
        expiresIn: 3600,
      }),
      getCurrentSession: jest.fn().mockResolvedValue({
        userId: 'reader@tf.com',
        type: 'INDIVIDUAL',
        roles: ['read'],
        collections: ['col_1'],
      }),
    });

    const result = await signInWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({
      ok: true,
      session: {
        accessToken: 'access_1',
        expiresIn: 3600,
        userId: 'reader@tf.com',
        institutionId: undefined,
        roles: ['read'],
        collections: ['col_1'],
      },
    });
    expect(authClient.login).toHaveBeenCalledWith({
      email: 'reader@tf.com',
      password: 'hunter2000',
    });
    expect(authClient.getCurrentSession).toHaveBeenCalledWith('access_1');
    expect(mockSaveRefreshToken).toHaveBeenCalledWith('refresh_1');
  });
});

describe('signInWithPassword — failures', () => {
  it('maps UNAUTHENTICATED to INVALID_CREDENTIALS', async () => {
    const authClient = fakeAuthClient({
      login: jest.fn().mockRejectedValue(new AuthFailure(AuthError.REFUSED, { errorCode: 'UNAUTHENTICATED' })),
    });

    const result = await signInWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' });
    expect(authClient.getCurrentSession).not.toHaveBeenCalled();
    expect(mockSaveRefreshToken).not.toHaveBeenCalled();
  });

  it('maps a network failure to NETWORK', async () => {
    const authClient = fakeAuthClient({
      login: jest.fn().mockRejectedValue(new AuthFailure(AuthError.NETWORK_UNAVAILABLE)),
    });

    const result = await signInWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({ ok: false, code: 'NETWORK' });
  });

  it('maps a timeout to NETWORK', async () => {
    const authClient = fakeAuthClient({
      login: jest.fn().mockRejectedValue(new AuthFailure(AuthError.TIMEOUT)),
    });

    const result = await signInWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({ ok: false, code: 'NETWORK' });
  });

  it('maps a refusal with no recognised errorCode to UNKNOWN', async () => {
    const authClient = fakeAuthClient({
      login: jest.fn().mockRejectedValue(new AuthFailure(AuthError.REFUSED)),
    });

    const result = await signInWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({ ok: false, code: 'UNKNOWN' });
  });

  it('maps a malformed response to UNKNOWN', async () => {
    const authClient = fakeAuthClient({
      login: jest.fn().mockRejectedValue(new AuthFailure(AuthError.MALFORMED_RESPONSE)),
    });

    const result = await signInWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({ ok: false, code: 'UNKNOWN' });
  });

  it('never rejects, even on a non-AuthFailure throw', async () => {
    const authClient = fakeAuthClient({
      login: jest.fn().mockRejectedValue(new Error('unexpected')),
    });

    const result = await signInWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({ ok: false, code: 'UNKNOWN' });
  });
});

describe('signUpWithPassword — success', () => {
  it('creates an account and returns a session with no institutionId', async () => {
    const authClient = fakeAuthClient({
      signUpWithPassword: jest.fn().mockResolvedValue({
        accessToken: 'access_1',
        refreshToken: 'refresh_1',
        expiresIn: 3600,
      }),
      getCurrentSession: jest.fn().mockResolvedValue({
        userId: 'usr_abc123',
        type: 'INDIVIDUAL',
        roles: ['read'],
        collections: [],
      }),
    });

    const result = await signUpWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({
      ok: true,
      session: {
        accessToken: 'access_1',
        expiresIn: 3600,
        userId: 'usr_abc123',
        institutionId: undefined,
        roles: ['read'],
        collections: [],
      },
    });
    expect(authClient.signUpWithPassword).toHaveBeenCalledWith({
      email: 'reader@tf.com',
      password: 'hunter2000',
    });
    expect(authClient.getCurrentSession).toHaveBeenCalledWith('access_1');
    expect(mockSaveRefreshToken).toHaveBeenCalledWith('refresh_1');
  });
});

describe('signUpWithPassword — failures', () => {
  it('maps EMAIL_TAKEN to EMAIL_ALREADY_REGISTERED', async () => {
    const authClient = fakeAuthClient({
      signUpWithPassword: jest
        .fn()
        .mockRejectedValue(new AuthFailure(AuthError.REFUSED, { errorCode: 'EMAIL_TAKEN' })),
    });

    const result = await signUpWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({ ok: false, code: 'EMAIL_ALREADY_REGISTERED' });
    expect(authClient.getCurrentSession).not.toHaveBeenCalled();
    expect(mockSaveRefreshToken).not.toHaveBeenCalled();
  });

  it('maps a network failure to NETWORK', async () => {
    const authClient = fakeAuthClient({
      signUpWithPassword: jest.fn().mockRejectedValue(new AuthFailure(AuthError.NETWORK_UNAVAILABLE)),
    });

    const result = await signUpWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({ ok: false, code: 'NETWORK' });
  });

  it('maps a timeout to NETWORK', async () => {
    const authClient = fakeAuthClient({
      signUpWithPassword: jest.fn().mockRejectedValue(new AuthFailure(AuthError.TIMEOUT)),
    });

    const result = await signUpWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({ ok: false, code: 'NETWORK' });
  });

  it('maps a refusal with no recognised errorCode to UNKNOWN', async () => {
    const authClient = fakeAuthClient({
      signUpWithPassword: jest.fn().mockRejectedValue(new AuthFailure(AuthError.REFUSED)),
    });

    const result = await signUpWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({ ok: false, code: 'UNKNOWN' });
  });

  it('maps a malformed response to UNKNOWN', async () => {
    const authClient = fakeAuthClient({
      signUpWithPassword: jest.fn().mockRejectedValue(new AuthFailure(AuthError.MALFORMED_RESPONSE)),
    });

    const result = await signUpWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({ ok: false, code: 'UNKNOWN' });
  });

  it('never rejects, even on a non-AuthFailure throw', async () => {
    const authClient = fakeAuthClient({
      signUpWithPassword: jest.fn().mockRejectedValue(new Error('unexpected')),
    });

    const result = await signUpWithPassword(CREDENTIALS, { authClient });

    expect(result).toEqual({ ok: false, code: 'UNKNOWN' });
  });
});
