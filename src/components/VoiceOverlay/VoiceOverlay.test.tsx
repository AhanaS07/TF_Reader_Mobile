// src/components/VoiceOverlay/VoiceOverlay.test.tsx
// The overlay is a pure view over `state` and `transcript`. Most of what matters
// is what it does NOT do: hold a recogniser, invent copy, or offer Search when
// there is nothing to search for.
//
// `await render(...)` is required — see the note in ContentCard.test.tsx.
import { render, screen, fireEvent } from '@testing-library/react-native';

import { VoiceOverlay } from '@components/VoiceOverlay';

describe('VoiceOverlay visibility', () => {
  it('renders nothing while hidden', async () => {
    await render(<VoiceOverlay visible={false} state="listening" onCancel={() => {}} />);

    expect(screen.queryByTestId('voice-overlay')).toBeNull();
  });

  it('renders once visible', async () => {
    await render(<VoiceOverlay visible state="listening" onCancel={() => {}} />);

    expect(screen.getByTestId('voice-overlay')).toBeTruthy();
  });

  it('reports a cancel', async () => {
    const onCancel = jest.fn();
    await render(<VoiceOverlay visible state="listening" onCancel={onCancel} />);

    fireEvent.press(screen.getByTestId('voice-overlay-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceOverlay state copy', () => {
  it('says it is listening', async () => {
    await render(<VoiceOverlay visible state="listening" onCancel={() => {}} />);

    expect(screen.getByText('Listening…')).toBeTruthy();
  });

  it('says it is transcribing', async () => {
    await render(<VoiceOverlay visible state="transcribing" onCancel={() => {}} />);

    expect(screen.getByText('Transcribing…')).toBeTruthy();
  });

  it('says it succeeded', async () => {
    await render(<VoiceOverlay visible state="success" onCancel={() => {}} />);

    expect(screen.getByText('Got it')).toBeTruthy();
  });
});

describe('VoiceOverlay pulse', () => {
  // The ring is decorative and hidden from assistive tech — the title already
  // says "Listening" — so these queries must opt into hidden elements. RNTL v14
  // excludes them by default, which is the behaviour being relied on here rather
  // than worked around.
  const HIDDEN = { includeHiddenElements: true };

  // The ring says the microphone is open. Leaving it running through
  // `transcribing` would claim the mic is still listening when it is not.
  it('pulses only while listening', async () => {
    await render(<VoiceOverlay visible state="listening" onCancel={() => {}} />);

    expect(screen.getByTestId('voice-overlay-pulse', HIDDEN)).toBeTruthy();
  });

  it('is still once the microphone closes', async () => {
    await render(<VoiceOverlay visible state="transcribing" onCancel={() => {}} />);

    expect(screen.queryByTestId('voice-overlay-pulse', HIDDEN)).toBeNull();
  });

  // Decorative, so a screen reader must not stop on it.
  it('keeps the ring out of the accessibility tree', async () => {
    await render(<VoiceOverlay visible state="listening" onCancel={() => {}} />);

    expect(screen.queryByTestId('voice-overlay-pulse')).toBeNull();
  });
});

describe('VoiceOverlay transcript', () => {
  it('renders what has been heard', async () => {
    await render(
      <VoiceOverlay visible state="listening" transcript="machine learning" onCancel={() => {}} />,
    );

    expect(screen.getByText('machine learning')).toBeTruthy();
  });

  it('renders no transcript line before anything is heard', async () => {
    await render(<VoiceOverlay visible state="listening" onCancel={() => {}} />);

    expect(screen.queryByTestId('voice-overlay-transcript')).toBeNull();
  });

  it('treats an empty string as nothing heard', async () => {
    await render(<VoiceOverlay visible state="listening" transcript="" onCancel={() => {}} />);

    expect(screen.queryByTestId('voice-overlay-transcript')).toBeNull();
  });
});

describe('VoiceOverlay error state', () => {
  it('renders the message it is given', async () => {
    await render(
      <VoiceOverlay
        visible
        state="error"
        errorMessage="Microphone access is off."
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText('Microphone access is off.')).toBeTruthy();
  });

  // A blank screen is worse than generic copy, and the caller cannot always say
  // why the recogniser gave up.
  it('falls back to default copy when the caller has no message', async () => {
    await render(<VoiceOverlay visible state="error" onCancel={() => {}} />);

    expect(screen.getByTestId('voice-overlay-error')).toBeTruthy();
  });

  // Failure copy replaces the transcript rather than stacking under it.
  it('shows the failure instead of a stale transcript', async () => {
    await render(
      <VoiceOverlay
        visible
        state="error"
        transcript="machine learning"
        errorMessage="No speech heard."
        onCancel={() => {}}
      />,
    );

    expect(screen.queryByTestId('voice-overlay-transcript')).toBeNull();
    expect(screen.getByText('No speech heard.')).toBeTruthy();
  });
});

describe('VoiceOverlay actions', () => {
  // The spec's bare contract is cancel-only; Search and Clear are opt-in.
  it('offers neither button when the caller handles neither', async () => {
    await render(
      <VoiceOverlay visible state="success" transcript="climate" onCancel={() => {}} />,
    );

    expect(screen.queryByTestId('voice-overlay-submit')).toBeNull();
    expect(screen.queryByTestId('voice-overlay-clear')).toBeNull();
  });

  it('runs the transcript as a query', async () => {
    const onSubmit = jest.fn();
    await render(
      <VoiceOverlay
        visible
        state="success"
        transcript="climate"
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.press(screen.getByTestId('voice-overlay-submit'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  // Nothing heard means nothing to search for.
  it('does not submit an empty transcript', async () => {
    const onSubmit = jest.fn();
    await render(
      <VoiceOverlay visible state="listening" onCancel={() => {}} onSubmit={onSubmit} />,
    );

    fireEvent.press(screen.getByTestId('voice-overlay-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('announces Search as disabled rather than just dimming it', async () => {
    await render(
      <VoiceOverlay visible state="listening" onCancel={() => {}} onSubmit={() => {}} />,
    );

    expect(screen.getByTestId('voice-overlay-submit').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('reports a clear', async () => {
    const onClear = jest.fn();
    await render(
      <VoiceOverlay
        visible
        state="success"
        transcript="climate"
        onCancel={() => {}}
        onClear={onClear}
      />,
    );

    fireEvent.press(screen.getByTestId('voice-overlay-clear'));

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
