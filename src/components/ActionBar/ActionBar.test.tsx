import { fireEvent, render } from '@testing-library/react-native';

import ActionBar from './ActionBar';

// `render` is ASYNC in @testing-library/react-native v14 — await it.

describe('ActionBar', () => {
  describe('the three states must be distinguishable', () => {
    it('loading draws placeholders and no labels', async () => {
      const { getByTestId, queryByText } = await render(
        <ActionBar actions={['read', 'download']} state="loading" onAction={jest.fn()} />,
      );
      expect(getByTestId('action-bar-loading')).toBeTruthy();
      expect(queryByText('Read')).toBeNull();
      expect(queryByText('Download')).toBeNull();
    });

    it('error draws a retry', async () => {
      const onRetry = jest.fn();
      const { getByTestId } = await render(
        <ActionBar actions={[]} state="error" onAction={jest.fn()} onRetry={onRetry} />,
      );
      fireEvent.press(getByTestId('action-bar-retry'));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('resolving to nothing draws nothing at all', async () => {
      const { toJSON, queryByTestId } = await render(
        <ActionBar actions={[]} onAction={jest.fn()} />,
      );
      // Not an empty View: null, so the bar contributes no height and no gap.
      expect(toJSON()).toBeNull();
      expect(queryByTestId('action-bar')).toBeNull();
    });

    it('loading and error render different trees, so they cannot be confused', async () => {
      const loading = await render(
        <ActionBar actions={['read']} state="loading" onAction={jest.fn()} />,
      );
      const failed = await render(
        <ActionBar actions={['read']} state="error" onAction={jest.fn()} onRetry={jest.fn()} />,
      );
      expect(loading.queryByTestId('action-bar-retry')).toBeNull();
      expect(failed.queryByTestId('action-button-skeleton')).toBeNull();
    });
  });

  // THE ASSERTION THIS FILE EXISTS FOR. index.html §Access: on a failed resolve,
  // "never to Download" — "Guessing towards the more generous button hands an
  // unentitled reader a file." A caller passing download must not be able to
  // make it appear.
  describe('a failed resolve never offers Download', () => {
    it('ignores a download in `actions`', async () => {
      const { queryByText, queryByTestId } = await render(
        <ActionBar
          actions={['read', 'download']}
          state="error"
          onAction={jest.fn()}
          onRetry={jest.fn()}
        />,
      );
      expect(queryByText('Download')).toBeNull();
      expect(queryByTestId('action-button-download')).toBeNull();
    });

    it('offers no action buttons at all, only the retry', async () => {
      const { queryByText, getByTestId } = await render(
        <ActionBar
          actions={['read', 'download', 'subscribe']}
          state="error"
          onAction={jest.fn()}
          onRetry={jest.fn()}
        />,
      );
      expect(queryByText('Read')).toBeNull();
      expect(queryByText('Subscribe')).toBeNull();
      expect(getByTestId('action-bar-retry')).toBeTruthy();
    });
  });

  describe('lays out whatever list it is given', () => {
    it('the unlimited-tier pair', async () => {
      const { getByText } = await render(
        <ActionBar actions={['read', 'download']} onAction={jest.fn()} />,
      );
      expect(getByText('Read')).toBeTruthy();
      expect(getByText('Download')).toBeTruthy();
    });

    it('a single action', async () => {
      const { getByText } = await render(<ActionBar actions={['signIn']} onAction={jest.fn()} />);
      expect(getByText('Sign in')).toBeTruthy();
    });

    it('reports which action was pressed', async () => {
      const onAction = jest.fn();
      const { getByTestId } = await render(
        <ActionBar actions={['read', 'download']} onAction={onAction} />,
      );
      fireEvent.press(getByTestId('action-button-download'));
      expect(onAction).toHaveBeenCalledWith('download');
    });
  });

  // Elite, 13 Aug: no Download at any point, and the queue is the only way in.
  describe("Elite's three steps", () => {
    it('1 — no licence held offers the queue', async () => {
      const { getByText, queryByText } = await render(
        <ActionBar actions={['addToQueue']} onAction={jest.fn()} />,
      );
      expect(getByText('Add me to queue')).toBeTruthy();
      expect(queryByText('Download')).toBeNull();
    });

    it('2 — once queued the same button is spent', async () => {
      const onAction = jest.fn();
      const { getByText, getByTestId } = await render(
        <ActionBar actions={['addToQueue']} done="addToQueue" onAction={onAction} />,
      );
      expect(getByText('Added to queue')).toBeTruthy();
      fireEvent.press(getByTestId('action-button-addToQueue'));
      expect(onAction).not.toHaveBeenCalled();
    });

    it('3 — licence held offers read and revoke, and no download', async () => {
      const { getByText, queryByText } = await render(
        <ActionBar actions={['read', 'revokeLicence']} onAction={jest.fn()} />,
      );
      expect(getByText('Read')).toBeTruthy();
      expect(getByText('Revoke licence')).toBeTruthy();
      expect(queryByText('Download')).toBeNull();
    });
  });

  describe('pending', () => {
    it('marks only the tapped action as busy', async () => {
      const { getByTestId } = await render(
        <ActionBar actions={['read', 'download']} pending="read" onAction={jest.fn()} />,
      );
      expect(getByTestId('action-button-read').props.accessibilityState.busy).toBe(true);
      expect(getByTestId('action-button-download').props.accessibilityState.busy).toBe(false);
    });

    it('does not fire again while in flight', async () => {
      const onAction = jest.fn();
      const { getByTestId } = await render(
        <ActionBar actions={['read']} pending="read" onAction={onAction} />,
      );
      fireEvent.press(getByTestId('action-button-read'));
      expect(onAction).not.toHaveBeenCalled();
    });
  });
});
