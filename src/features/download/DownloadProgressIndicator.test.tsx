// Owner: Download (Abhinav).
//
// Pure presentational component — pins what renders for each DownloadProgressState.status,
// independent of useDownloadProgress.ts.

import { render, screen } from '@testing-library/react-native';

import { DownloadProgressIndicator } from './DownloadProgressIndicator';
import type { DownloadProgressState } from './useDownloadProgress';

function stateFor(overrides: Partial<DownloadProgressState>): DownloadProgressState {
  return {
    status: 'idle',
    bytesReceived: 0,
    expectedLength: null,
    errorMessage: null,
    ...overrides,
  };
}

describe('DownloadProgressIndicator', () => {
  it('renders nothing while idle', async () => {
    const { toJSON } = await render(<DownloadProgressIndicator {...stateFor({ status: 'idle' })} />);
    expect(toJSON()).toBeNull();
  });

  it('shows byte count and percent while downloading', async () => {
    await render(
      <DownloadProgressIndicator
        {...stateFor({ status: 'downloading', bytesReceived: 512, expectedLength: 2048 })}
      />,
    );
    expect(screen.getByText('512 / 2048 bytes (25%)')).toBeTruthy();
  });

  it('shows a placeholder percent before the total is known', async () => {
    await render(
      <DownloadProgressIndicator
        {...stateFor({ status: 'downloading', bytesReceived: 512, expectedLength: null })}
      />,
    );
    expect(screen.getByText('512 / ? bytes (…%)')).toBeTruthy();
  });

  it('clamps to 100% rather than showing over-100 on a malformed over-length response', async () => {
    await render(
      <DownloadProgressIndicator
        {...stateFor({ status: 'downloading', bytesReceived: 3000, expectedLength: 2048 })}
      />,
    );
    expect(screen.getByText('3000 / 2048 bytes (100%)')).toBeTruthy();
  });

  it('shows 0% (not NaN%) for a degenerate zero-length asset, not the "unknown total" placeholder', async () => {
    await render(
      <DownloadProgressIndicator
        {...stateFor({ status: 'downloading', bytesReceived: 0, expectedLength: 0 })}
      />,
    );
    expect(screen.getByText('0 / 0 bytes (100%)')).toBeTruthy();
  });

  it('shows a completion message once done', async () => {
    await render(<DownloadProgressIndicator {...stateFor({ status: 'completed' })} />);
    expect(screen.getByText('Download complete')).toBeTruthy();
  });

  it('shows the error message on failure', async () => {
    await render(
      <DownloadProgressIndicator
        {...stateFor({ status: 'error', errorMessage: 'ASSET_FETCH_FAILED' })}
      />,
    );
    expect(screen.getByText('ASSET_FETCH_FAILED')).toBeTruthy();
  });
});
