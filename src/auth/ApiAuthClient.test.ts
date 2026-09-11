// src/auth/ApiAuthClient.test.ts
//
// Coverage here is scoped to the OIDC methods (startOidcSignIn, exchangeOidcTxn),
// signUpWithPassword and login — the rest of this class has no prior test file, and
// adding full coverage for the SAML methods is out of scope for this change.
import { ApiAuthClient, type AuthFetch, type AuthResponse } from './ApiAuthClient';
import { AuthError, AuthFailure } from './AuthFailure';

function fakeResponse(status: number, body: unknown): AuthResponse {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function clientWith(fetchImpl: AuthFetch): ApiAuthClient {
  return new ApiAuthClient({ baseUrl: 'https://api.test', fetch: fetchImpl });
}

describe('ApiAuthClient.startOidcSignIn', () => {
  it('POSTs the credentials as a JSON body and parses the response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse(200, {
        oidcTxnId: 'authCode_1',
        expiresAt: '2026-09-07T12:00:00Z',
        serverTime: '2026-09-07T11:55:00Z',
      }),
    );
    const client = clientWith(fetchImpl);

    const result = await client.startOidcSignIn({ username: 'reader@tf.com', password: 'hunter2000' });

    expect(result).toEqual({
      oidcTxnId: 'authCode_1',
      expiresAt: '2026-09-07T12:00:00Z',
      serverTime: '2026-09-07T11:55:00Z',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/api/v1/auth/oidc/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'reader@tf.com', password: 'hunter2000' }),
      }),
    );
  });

  it('throws MALFORMED_RESPONSE when oidcTxnId is missing', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse(200, { expiresAt: 'x', serverTime: 'y' }));
    const client = clientWith(fetchImpl);

    await expect(
      client.startOidcSignIn({ username: 'reader@tf.com', password: 'hunter2000' }),
    ).rejects.toMatchObject({ code: AuthError.MALFORMED_RESPONSE });
  });

  it('surfaces a refusal as AuthFailure(REFUSED) carrying the response errorCode', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse(401, { code: 'OIDC_AUTHENTICATION_FAILED', message: 'bad credentials' }),
    );
    const client = clientWith(fetchImpl);

    await expect(
      client.startOidcSignIn({ username: 'reader@tf.com', password: 'wrong' }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: AuthError.REFUSED,
        errorCode: 'OIDC_AUTHENTICATION_FAILED',
      }),
    );
  });
});

describe('ApiAuthClient.exchangeOidcTxn', () => {
  it('POSTs the oidcTxnId and parses the returned token pair', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse(200, { accessToken: 'access_1', refreshToken: 'refresh_1', expiresIn: 3600 }),
    );
    const client = clientWith(fetchImpl);

    const result = await client.exchangeOidcTxn('authCode_1');

    expect(result).toEqual({ accessToken: 'access_1', refreshToken: 'refresh_1', expiresIn: 3600 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/api/v1/auth/oidc/token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ oidcTxnId: 'authCode_1' }),
      }),
    );
  });

  it('surfaces TOKEN_INVALID as AuthFailure(REFUSED) on a reused or expired oidcTxnId', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse(401, { code: 'TOKEN_INVALID', message: 'This id is unknown, already used, or expired.' }),
    );
    const client = clientWith(fetchImpl);

    await expect(client.exchangeOidcTxn('authCode_1')).rejects.toEqual(
      expect.objectContaining({ code: AuthError.REFUSED, errorCode: 'TOKEN_INVALID' }),
    );
  });
});

describe('ApiAuthClient.signUpWithPassword', () => {
  it('POSTs the credentials as a JSON body and parses the returned token pair', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse(200, { accessToken: 'access_1', refreshToken: 'refresh_1', expiresIn: 3600 }),
    );
    const client = clientWith(fetchImpl);

    const result = await client.signUpWithPassword({ email: 'reader@tf.com', password: 'hunter2000' });

    expect(result).toEqual({ accessToken: 'access_1', refreshToken: 'refresh_1', expiresIn: 3600 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/api/v1/auth/signup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'reader@tf.com', password: 'hunter2000' }),
      }),
    );
  });

  it('surfaces EMAIL_TAKEN as AuthFailure(REFUSED) on a duplicate email', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse(409, { code: 'EMAIL_TAKEN', message: 'An individual reader is already registered.' }),
    );
    const client = clientWith(fetchImpl);

    await expect(
      client.signUpWithPassword({ email: 'reader@tf.com', password: 'hunter2000' }),
    ).rejects.toEqual(expect.objectContaining({ code: AuthError.REFUSED, errorCode: 'EMAIL_TAKEN' }));
  });

  it('throws MALFORMED_RESPONSE when the token pair is missing fields', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse(200, { accessToken: 'access_1' }));
    const client = clientWith(fetchImpl);

    await expect(
      client.signUpWithPassword({ email: 'reader@tf.com', password: 'hunter2000' }),
    ).rejects.toMatchObject({ code: AuthError.MALFORMED_RESPONSE });
  });
});

describe('ApiAuthClient.login', () => {
  it('POSTs the credentials as a JSON body and parses the returned token pair', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse(200, { accessToken: 'access_1', refreshToken: 'refresh_1', expiresIn: 3600 }),
    );
    const client = clientWith(fetchImpl);

    const result = await client.login({ email: 'reader@tf.com', password: 'hunter2000' });

    expect(result).toEqual({ accessToken: 'access_1', refreshToken: 'refresh_1', expiresIn: 3600 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'reader@tf.com', password: 'hunter2000' }),
      }),
    );
  });

  it('surfaces UNAUTHENTICATED as AuthFailure(REFUSED) on a wrong password or unknown email', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse(401, { code: 'UNAUTHENTICATED', message: 'Email or password is not valid.' }),
    );
    const client = clientWith(fetchImpl);

    await expect(
      client.login({ email: 'reader@tf.com', password: 'wrong' }),
    ).rejects.toEqual(expect.objectContaining({ code: AuthError.REFUSED, errorCode: 'UNAUTHENTICATED' }));
  });

  it('throws MALFORMED_RESPONSE when the token pair is missing fields', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse(200, { accessToken: 'access_1' }));
    const client = clientWith(fetchImpl);

    await expect(
      client.login({ email: 'reader@tf.com', password: 'hunter2000' }),
    ).rejects.toMatchObject({ code: AuthError.MALFORMED_RESPONSE });
  });
});

describe('ApiAuthClient — AuthFailure export sanity', () => {
  it('is the error type these rejections use', () => {
    expect(new AuthFailure(AuthError.REFUSED)).toBeInstanceOf(Error);
  });
});
