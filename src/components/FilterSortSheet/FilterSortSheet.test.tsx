import { act, fireEvent, render, screen } from '@testing-library/react-native';

import FilterSortSheet from './FilterSortSheet';

// Same fake-timer dance BottomSheet.test.tsx uses: the sheet's children only
// mount once Modal's visible flips true, which happens inside a
// setTimeout(fn, 0) in BottomSheet's slideIn().
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function renderOpen(overrides: Partial<React.ComponentProps<typeof FilterSortSheet>> = {}) {
  const result = await render(
    <FilterSortSheet
      visible
      onDismiss={() => {}}
      onSelectContentType={() => {}}
      onSelectAccessTier={() => {}}
      onSelectSort={() => {}}
      onApply={() => {}}
      onClearAll={() => {}}
      {...overrides}
    />,
  );
  await act(async () => {
    jest.runAllTimers();
  });
  return result;
}

describe('FilterSortSheet content', () => {
  it('renders a chip for every real content type, plus the disabled Video row', async () => {
    await renderOpen();

    expect(screen.getByLabelText('eBooks')).toBeTruthy();
    expect(screen.getByLabelText('PDF')).toBeTruthy();
    expect(screen.getByLabelText('Audiobooks')).toBeTruthy();
    expect(screen.getByLabelText('Video').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('renders a chip for every access tier', async () => {
    await renderOpen();

    expect(screen.getByLabelText('Open access')).toBeTruthy();
    expect(screen.getByLabelText('Subscription')).toBeTruthy();
    expect(screen.getByLabelText('Elite')).toBeTruthy();
  });

  it('shows the four real sort options plus disabled Relevance and Most cited', async () => {
    await renderOpen();

    for (const label of ['Newest', 'Oldest', 'A–Z', 'Z–A']) {
      expect(screen.getByLabelText(label).props.accessibilityState).toMatchObject({
        disabled: false,
      });
    }
    expect(screen.getByLabelText('Relevance').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(screen.getByLabelText('Most cited').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('shows Date range and Subject as disabled, not removed', async () => {
    await renderOpen();

    expect(screen.getByLabelText('Date range').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(screen.getByLabelText('Subject').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});

describe('FilterSortSheet selection', () => {
  it('reflects the selected content type, access tier and sort', async () => {
    await renderOpen({ contentType: 'AUDIO', accessTier: 'ELITE', sort: 'title.asc' });

    expect(screen.getByLabelText('Audiobooks').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByLabelText('Elite').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByLabelText('A–Z').props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('reports a content type press', async () => {
    const onSelectContentType = jest.fn();
    await renderOpen({ onSelectContentType });

    fireEvent.press(screen.getByLabelText('PDF'));

    expect(onSelectContentType).toHaveBeenCalledWith('PDF');
  });
});

describe('FilterSortSheet sort disabled on a curated shelf', () => {
  it('greys every sort chip and shows the explanatory note', async () => {
    await renderOpen({ sortDisabled: true, sort: 'title.asc' });

    expect(screen.getByTestId('filter-sort-sheet-sort-note')).toBeTruthy();
    for (const label of ['Newest', 'Oldest', 'A–Z', 'Z–A']) {
      expect(screen.getByLabelText(label).props.accessibilityState).toMatchObject({
        disabled: true,
        selected: false,
      });
    }
  });
});

describe('FilterSortSheet footer', () => {
  it('reports Apply Filters', async () => {
    const onApply = jest.fn();
    await renderOpen({ onApply });

    fireEvent.press(screen.getByTestId('filter-sort-sheet-apply'));

    expect(onApply).toHaveBeenCalled();
  });

  it('reports Clear All', async () => {
    const onClearAll = jest.fn();
    await renderOpen({ onClearAll });

    fireEvent.press(screen.getByTestId('filter-sort-sheet-clear'));

    expect(onClearAll).toHaveBeenCalled();
  });
});
