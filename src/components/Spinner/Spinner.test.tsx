// src/components/Spinner/Spinner.test.tsx
// Spinner's only real behaviour: it renders a progressbar and keeps spinning
// without erroring for as long as it stays mounted. The actual rotation
// degrees are an implementation detail of the ring's transform, not asserted
// here — same reasoning BootSplash.test.tsx gives for its own shimmer loop.
import { act, render, screen } from '@testing-library/react-native';

import Spinner from './Spinner';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Spinner', () => {
  it('renders', async () => {
    await render(<Spinner testID="my-spinner" />);

    expect(screen.getByTestId('my-spinner')).toBeTruthy();
  });

  it('keeps looping across several spin cycles without throwing', async () => {
    await render(<Spinner testID="my-spinner" />);

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(screen.getByTestId('my-spinner')).toBeTruthy();
  });

  it('unmounts cleanly mid-spin', async () => {
    const { unmount } = await render(<Spinner testID="my-spinner" />);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(() => unmount()).not.toThrow();
  });
});
