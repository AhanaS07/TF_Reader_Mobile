// Owner: Reader (Ahana & Team).
//
// Unit tests for MiniAudioPlayer component.

import { fireEvent, render } from '@testing-library/react-native';

import type { BookId } from '@/shared/contracts';
import { MiniAudioPlayer } from './MiniAudioPlayer';
import { useAudioQueueStore } from './audioQueueStore';
import * as coordinator from './audioQueueCoordinator';

jest.mock('./audioQueueCoordinator', () => ({
  skipToNextTrack: jest.fn(),
  skipToPreviousTrack: jest.fn(),
  toggleAudioPlayback: jest.fn(),
}));

describe('MiniAudioPlayer', () => {
  const item1 = { bookId: 'book-1' as BookId, title: 'Audiobook One' };
  const item2 = { bookId: 'book-2' as BookId, title: 'Audiobook Two' };

  beforeEach(() => {
    jest.clearAllMocks();
    useAudioQueueStore.getState().clearQueue();
  });

  it('renders null when there is no active queue item', async () => {
    const { toJSON } = await render(<MiniAudioPlayer />);
    expect(toJSON()).toBeNull();
  });

  it('renders track title, paused status, and transport buttons', async () => {
    useAudioQueueStore.getState().setQueue([item1, item2], 0);
    useAudioQueueStore.getState().setIsPlaying(false);

    const { getByText, getByLabelText } = await render(<MiniAudioPlayer />);

    expect(getByText('Audiobook One')).toBeTruthy();
    expect(getByText('Paused')).toBeTruthy();
    expect(getByLabelText('Play')).toBeTruthy();
    expect(getByLabelText('Next track')).toBeTruthy();
    expect(getByLabelText('Previous track')).toBeTruthy();
  });

  it('shows Playing status and Pause button when isPlaying is true', async () => {
    useAudioQueueStore.getState().setQueue([item1], 0);
    useAudioQueueStore.getState().setIsPlaying(true);

    const { getByText, getByLabelText } = await render(<MiniAudioPlayer />);

    expect(getByText('Playing')).toBeTruthy();
    expect(getByLabelText('Pause')).toBeTruthy();
  });

  it('calls toggleAudioPlayback when play/pause button is pressed', async () => {
    useAudioQueueStore.getState().setQueue([item1], 0);
    const { getByLabelText } = await render(<MiniAudioPlayer />);

    await fireEvent.press(getByLabelText('Play'));
    expect(coordinator.toggleAudioPlayback).toHaveBeenCalledTimes(1);
  });

  it('calls skipToNextTrack and skipToPreviousTrack on transport press', async () => {
    useAudioQueueStore.getState().setQueue([item1, item2], 0);
    useAudioQueueStore.getState().setPlaybackProgress({ positionSeconds: 10, durationSeconds: 100 });

    const { getByLabelText } = await render(<MiniAudioPlayer />);

    await fireEvent.press(getByLabelText('Next track'));
    expect(coordinator.skipToNextTrack).toHaveBeenCalledTimes(1);

    await fireEvent.press(getByLabelText('Previous track'));
    expect(coordinator.skipToPreviousTrack).toHaveBeenCalledWith(10);
  });

  it('calls onExpand with current item when player row is pressed', async () => {
    useAudioQueueStore.getState().setQueue([item1], 0);
    const onExpand = jest.fn();

    const { getByLabelText } = await render(<MiniAudioPlayer onExpand={onExpand} />);

    await fireEvent.press(getByLabelText('Open audio player: Audiobook One'));
    expect(onExpand).toHaveBeenCalledWith(item1);
  });
});
