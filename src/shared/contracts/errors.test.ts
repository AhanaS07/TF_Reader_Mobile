// Owner: Ahana (`src/shared/` per CLAUDE.md's ownership table).
//
// `formatDiagnosticErrorMessage` shipped with no tests, and the gap had a user-visible cost: passed
// a structured `{ code, message }` object (the reader bridge's `ReaderError`) it matched none of its
// branches and fell through to `String(error)`, so ReaderScreen's error banner rendered
// "[object Object]" instead of the message. These pin every input shape the four call sites actually
// pass — a caught `Error`, a `DownloadFailure`-style error with a `cause`, a structured object, and
// the junk values `unknown` allows.

import { formatDiagnosticErrorMessage } from './errors';

describe('formatDiagnosticErrorMessage', () => {
  it('returns a caught Error’s own message', () => {
    expect(formatDiagnosticErrorMessage(new Error('network unreachable'))).toBe(
      'network unreachable',
    );
  });

  it('prefers the cause’s detail, composed with both codes, when there is one', () => {
    // The shape this function exists for: the outer code names the stage that failed, the cause
    // carries what the server or the fetch actually said.
    const failure = Object.assign(new Error('download failed'), {
      code: 'DOWNLOAD_FAILED',
      cause: { code: 'HTTP_403', message: 'entitlement expired' },
    });

    expect(formatDiagnosticErrorMessage(failure)).toBe(
      'DOWNLOAD_FAILED (HTTP_403): entitlement expired',
    );
  });

  it('omits the cause code when the cause is a bare Error', () => {
    const failure = Object.assign(new Error('store failed'), {
      code: 'STORE_FAILED',
      cause: new Error('disk full'),
    });

    expect(formatDiagnosticErrorMessage(failure)).toBe('STORE_FAILED: disk full');
  });

  it('reads a structured {code, message} object rather than stringifying it', () => {
    // THE REGRESSION THIS FILE EXISTS FOR. `ReaderError` is parsed off the bridge, so it has a
    // message but no `cause` and is not an Error instance.
    expect(
      formatDiagnosticErrorMessage({
        code: 'BRIDGE_PARSE_FAILED',
        message: 'could not parse message',
      }),
    ).toBe('BRIDGE_PARSE_FAILED: could not parse message');
  });

  it('reads a message-only object, with no code to compose', () => {
    expect(formatDiagnosticErrorMessage({ message: 'something went wrong' })).toBe(
      'something went wrong',
    );
  });

  it('never returns "[object Object]" for an object carrying a message', () => {
    // The property that matters more than any exact string above: whatever shape arrives, a user
    // must not be shown a stringified object.
    for (const input of [
      { code: 'A', message: 'm' },
      { message: 'm' },
      Object.assign(new Error('m'), { code: 'A' }),
    ]) {
      expect(formatDiagnosticErrorMessage(input)).not.toContain('[object Object]');
    }
  });

  it('falls back for values that carry no message at all', () => {
    expect(formatDiagnosticErrorMessage(null)).toBe('Unknown error');
    expect(formatDiagnosticErrorMessage(undefined)).toBe('Unknown error');
    expect(formatDiagnosticErrorMessage('a bare string')).toBe('a bare string');
    // An empty message is not a message — better the raw value than a blank banner.
    expect(formatDiagnosticErrorMessage({ message: '' })).toBe('[object Object]');
  });
});
