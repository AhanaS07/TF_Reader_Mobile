// Owner: Reader (Ahana & Team).
//
// Unit tests for AudioQueueModal.

import { fireEvent, render } from '@testing-library/react-native';

import type { BookId } from '@/shared/contracts';
import { useAudioQueueStore } from './audioQueueStore';
import { AudioQueueModal } from './AudioQueueModal';

describe('AudioQueueModal', () => {
  const item1 = { bookId: 'book-1' as BookId, title: 'Chapter 1' };
  const item2 = { bookId: 'book-2' as BookId, title: 'Chapter 2' };
  const item3 = { bookId: 'book-3' as BookId, title: 'Chapter 3' };

  beforeEach(() => {
    useAudioQueueStore.getState().clearQueue();
    useAudioQueueStore.getState().setRepeatMode('off');
  });

  it('renders empty queue state when items is empty', async () => {
    const onClose = jest.fn();
    const { getByText } = await render(<AudioQueueModal visible onClose={onClose} />);

    expect(getByText('Queue')).toBeTruthy();
    expect(getByText('Queue is empty')).toBeTruthy();
    expect(getByText('0 tracks')).toBeTruthy();
  });

  it('renders track items and highlights current track', async () => {
    useAudioQueueStore.getState().setQueue([item1, item2], 0);

    const onClose = jest.fn();
    const { getByText } = await render(<AudioQueueModal visible onClose={onClose} />);

    expect(getByText('Chapter 1')).toBeTruthy();
    expect(getByText('Chapter 2')).toBeTruthy();
    expect(getByText('Now Playing')).toBeTruthy();
  });

  it('calls onSelectTrack and onClose when a track row is pressed', async () => {
    useAudioQueueStore.getState().setQueue([item1, item2], 0);

    const onClose = jest.fn();
    const onSelectTrack = jest.fn();
    const { getByLabelText } = await render(
      <AudioQueueModal visible onClose={onClose} onSelectTrack={onSelectTrack} />,
    );

    await fireEvent.press(getByLabelText('Play Chapter 2'));

    expect(onSelectTrack).toHaveBeenCalledWith(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('toggles repeat mode when repeat button is pressed', async () => {
    useAudioQueueStore.getState().setQueue([item1], 0);

    const onClose = jest.fn();
    const { getByLabelText } = await render(<AudioQueueModal visible onClose={onClose} />);

    const repeatBtn = getByLabelText('Repeat: Off');
    await fireEvent.press(repeatBtn);

    expect(useAudioQueueStore.getState().repeatMode).toBe('all');
  });

  it('removes an item from queue when remove button is pressed', async () => {
    useAudioQueueStore.getState().setQueue([item1, item2], 0);

    const onClose = jest.fn();
    const { getByLabelText } = await render(<AudioQueueModal visible onClose={onClose} />);

    await fireEvent.press(getByLabelText('Remove Chapter 2 from queue'));

    expect(useAudioQueueStore.getState().items).toEqual([item1]);
  });

  it('reorders items when up/down buttons are pressed', async () => {
    useAudioQueueStore.getState().setQueue([item1, item2, item3], 0);

    const onClose = jest.fn();
    const { getByLabelText } = await render(<AudioQueueModal visible onClose={onClose} />);

    // Move Chapter 2 up to index 0
    await fireEvent.press(getByLabelText('Move Chapter 2 up'));

    expect(useAudioQueueStore.getState().items[0]).toEqual(item2);
    expect(useAudioQueueStore.getState().items[1]).toEqual(item1);
  });

  it('clears queue when Clear Queue button is pressed', async () => {
    useAudioQueueStore.getState().setQueue([item1, item2], 0);

    const onClose = jest.fn();
    const { getByLabelText } = await render(<AudioQueueModal visible onClose={onClose} />);

    await fireEvent.press(getByLabelText('Clear queue'));

    expect(useAudioQueueStore.getState().items).toEqual([]);
  });
});
