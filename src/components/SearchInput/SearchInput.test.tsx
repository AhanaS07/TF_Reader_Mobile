// src/components/SearchInput/SearchInput.test.tsx
// SearchInput is consumed by both search pipelines, so most of what is worth
// asserting here is what it REFUSES to do: hold the query, decide when the mic
// appears, or lock the reader out when the network drops.
//
// `await render(...)` is required — @testing-library/react-native v14 returns a
// Promise. See the note in ContentCard.test.tsx.
import { render, screen, fireEvent } from '@testing-library/react-native';

import { SearchInput } from '@components/SearchInput';

describe('SearchInput as a controlled field', () => {
  it('renders the query it is given', async () => {
    await render(<SearchInput value="climate" onChangeText={() => {}} />);

    expect(screen.getByTestId('search-input-field').props.value).toBe('climate');
  });

  it('reports every keystroke through onChangeText', async () => {
    const onChangeText = jest.fn();
    await render(<SearchInput value="" onChangeText={onChangeText} />);

    fireEvent.changeText(screen.getByTestId('search-input-field'), 'clim');

    expect(onChangeText).toHaveBeenCalledWith('clim');
  });

  // The pipeline owns the query. If the component kept its own copy, the two
  // would diverge the first time the pipeline rejected or rewrote an input.
  it('does not update its own text when the caller does not', async () => {
    await render(<SearchInput value="climate" onChangeText={() => {}} />);

    fireEvent.changeText(screen.getByTestId('search-input-field'), 'something else');

    expect(screen.getByTestId('search-input-field').props.value).toBe('climate');
  });

  it('reports the keyboard search key through onSubmit', async () => {
    const onSubmit = jest.fn();
    await render(<SearchInput value="climate" onChangeText={() => {}} onSubmit={onSubmit} />);

    fireEvent(screen.getByTestId('search-input-field'), 'submitEditing');

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('SearchInput clear affordance', () => {
  it('is absent while the field is empty', async () => {
    await render(<SearchInput value="" onChangeText={() => {}} />);

    expect(screen.queryByTestId('search-input-clear')).toBeNull();
  });

  it('appears once the field has text', async () => {
    await render(<SearchInput value="c" onChangeText={() => {}} />);

    expect(screen.getByTestId('search-input-clear')).toBeTruthy();
  });

  // Emptying the field has to travel the same path as typing, or the pipeline
  // sees a cleared box it was never told about.
  it('empties the field through onChangeText', async () => {
    const onChangeText = jest.fn();
    await render(<SearchInput value="climate" onChangeText={onChangeText} />);

    fireEvent.press(screen.getByTestId('search-input-clear'));

    expect(onChangeText).toHaveBeenCalledWith('');
  });

  // Separate from onChangeText so a pipeline can drop its results instead of
  // running a fresh search for the empty string.
  it('also reports the clear itself when the caller listens for it', async () => {
    const onClear = jest.fn();
    await render(<SearchInput value="climate" onChangeText={() => {}} onClear={onClear} />);

    fireEvent.press(screen.getByTestId('search-input-clear'));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('clears without a caller that listens for it', async () => {
    const onChangeText = jest.fn();
    await render(<SearchInput value="climate" onChangeText={onChangeText} />);

    fireEvent.press(screen.getByTestId('search-input-clear'));

    expect(onChangeText).toHaveBeenCalledWith('');
  });
});

describe('SearchInput voice affordance', () => {
  // Voice (B11) is catalogue-scoped. Institution search passes no handler, and
  // that absence is the whole mechanism — there is no boolean to contradict it.
  it('is absent when the caller offers nowhere to send the press', async () => {
    await render(<SearchInput value="" onChangeText={() => {}} />);

    expect(screen.queryByTestId('search-input-voice')).toBeNull();
  });

  it('appears when the caller handles it', async () => {
    await render(<SearchInput value="" onChangeText={() => {}} onVoicePress={() => {}} />);

    expect(screen.getByTestId('search-input-voice')).toBeTruthy();
  });

  it('reports the press', async () => {
    const onVoicePress = jest.fn();
    await render(<SearchInput value="" onChangeText={() => {}} onVoicePress={onVoicePress} />);

    fireEvent.press(screen.getByTestId('search-input-voice'));

    expect(onVoicePress).toHaveBeenCalledTimes(1);
  });

  // Both trailing controls coexist: amending a query by voice stays available.
  it('sits alongside the clear affordance on a filled field', async () => {
    await render(<SearchInput value="climate" onChangeText={() => {}} onVoicePress={() => {}} />);

    expect(screen.getByTestId('search-input-clear')).toBeTruthy();
    expect(screen.getByTestId('search-input-voice')).toBeTruthy();
  });
});

describe('SearchInput disabled', () => {
  it('is not editable', async () => {
    await render(<SearchInput value="" onChangeText={() => {}} disabled />);

    expect(screen.getByTestId('search-input-field').props.editable).toBe(false);
  });

  // A control that cannot be reached should not be offered.
  it('withdraws both trailing controls', async () => {
    await render(
      <SearchInput value="climate" onChangeText={() => {}} onVoicePress={() => {}} disabled />,
    );

    expect(screen.queryByTestId('search-input-clear')).toBeNull();
    expect(screen.queryByTestId('search-input-voice')).toBeNull();
  });
});

describe('SearchInput offline', () => {
  // Design Spec §4.2 — degraded, not blocked. Catalogue search runs over
  // fixtures, so it still works with no network at all.
  it('stays typeable', async () => {
    const onChangeText = jest.fn();
    await render(<SearchInput value="" onChangeText={onChangeText} state="offline" />);

    fireEvent.changeText(screen.getByTestId('search-input-field'), 'clim');

    expect(screen.getByTestId('search-input-field').props.editable).toBe(true);
    expect(onChangeText).toHaveBeenCalledWith('clim');
  });

  it('swaps the leading glyph so the state is visible', async () => {
    await render(<SearchInput value="" onChangeText={() => {}} state="offline" />);

    expect(screen.getByTestId('search-input-offline-icon')).toBeTruthy();
    expect(screen.queryByTestId('search-input-icon')).toBeNull();
  });

  it('shows the ordinary glyph when idle', async () => {
    await render(<SearchInput value="" onChangeText={() => {}} />);

    expect(screen.getByTestId('search-input-icon')).toBeTruthy();
    expect(screen.queryByTestId('search-input-offline-icon')).toBeNull();
  });
});

describe('SearchInput accessibility', () => {
  it('announces itself by its prompt', async () => {
    await render(
      <SearchInput value="" onChangeText={() => {}} placeholder="Search institutions" />,
    );

    expect(screen.getByLabelText('Search institutions')).toBeTruthy();
  });

  it('names both trailing controls', async () => {
    await render(<SearchInput value="climate" onChangeText={() => {}} onVoicePress={() => {}} />);

    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search by voice' })).toBeTruthy();
  });
});
