// src/components/EmptyState/EmptyState.test.tsx
// EmptyState carries four variants, and the distinction between them is the
// affordance, not the wording: a query miss offers no next action, a filter miss
// offers Clear filters, and a zero-result feed offers Browse the catalogue.
//
// `browse_instead` exists because of the backend contract, not as a nicety —
// OPDS forbids empty arrays, so a zero-result search returns a feed containing a
// navigation entry. The component only reports the press; the screen owns the
// href the feed supplied.
//
// Copy for `no_content` and `browse_instead` is NOT in any specification. The
// assertions below pin the current wording so a change is deliberate, they do not
// claim it is specified.
//
// `await render(...)` is required — see the note in ContentCard.test.tsx.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { EmptyState } from '@components/EmptyState';

describe('EmptyState no_query_results', () => {
  it('renders the no-results message', async () => {
    await render(<EmptyState variant="no_query_results" />);

    expect(screen.getByText('No articles or books match your search.')).toBeTruthy();
  });

  it('echoes the query back when one is given', async () => {
    await render(<EmptyState variant="no_query_results" query="crispr" />);

    expect(screen.getByText(/crispr/)).toBeTruthy();
  });

  it('falls back to the plain message when no query is given', async () => {
    await render(<EmptyState variant="no_query_results" />);

    expect(screen.queryByText(/“/)).toBeNull();
  });

  // A query miss has no obvious next action, so offering one would be a lie.
  it('offers no action', async () => {
    await render(<EmptyState variant="no_query_results" query="crispr" />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('EmptyState no_filter_results', () => {
  it('renders the filter message', async () => {
    await render(<EmptyState variant="no_filter_results" onClearFilters={() => {}} />);

    expect(screen.getByText('Try adjusting your filters.')).toBeTruthy();
  });

  // The only variant with an obvious user action, which is why it is a separate
  // variant rather than different copy.
  it('offers Clear filters', async () => {
    await render(<EmptyState variant="no_filter_results" onClearFilters={() => {}} />);

    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });

  it('reports the press through onClearFilters', async () => {
    const onClearFilters = jest.fn();
    await render(<EmptyState variant="no_filter_results" onClearFilters={onClearFilters} />);

    fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));

    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('does not crash when pressed without a handler', async () => {
    await render(<EmptyState variant="no_filter_results" />);

    fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));

    expect(screen.getByText('Try adjusting your filters.')).toBeTruthy();
  });
});

describe('EmptyState no_content', () => {
  it('renders a message', async () => {
    await render(<EmptyState variant="no_content" />);

    expect(screen.getByText('Nothing to show here yet.')).toBeTruthy();
  });

  it('offers no action', async () => {
    await render(<EmptyState variant="no_content" />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('EmptyState browse_instead', () => {
  it('renders a message', async () => {
    await render(<EmptyState variant="browse_instead" onBrowse={() => {}} />);

    expect(screen.getByText('No results for this search.')).toBeTruthy();
  });

  it('offers Browse the catalogue', async () => {
    await render(<EmptyState variant="browse_instead" onBrowse={() => {}} />);

    expect(screen.getByRole('button', { name: 'Browse the catalogue' })).toBeTruthy();
  });

  it('reports the press through onBrowse', async () => {
    const onBrowse = jest.fn();
    await render(<EmptyState variant="browse_instead" onBrowse={onBrowse} />);

    fireEvent.press(screen.getByRole('button', { name: 'Browse the catalogue' }));

    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it('does not crash when pressed without a handler', async () => {
    await render(<EmptyState variant="browse_instead" />);

    fireEvent.press(screen.getByRole('button', { name: 'Browse the catalogue' }));

    expect(screen.getByText('No results for this search.')).toBeTruthy();
  });
});

describe('EmptyState keeps its actions to their own variants', () => {
  // Clear filters on a query miss, or Browse on a filter miss, would send the
  // reader down a path that cannot help them.
  it('never offers Clear filters outside no_filter_results', async () => {
    const { rerender } = await render(
      <EmptyState variant="no_query_results" onClearFilters={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();

    await rerender(<EmptyState variant="no_content" onClearFilters={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();

    await rerender(<EmptyState variant="browse_instead" onClearFilters={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('never offers Browse outside browse_instead', async () => {
    const { rerender } = await render(
      <EmptyState variant="no_query_results" onBrowse={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'Browse the catalogue' })).toBeNull();

    await rerender(<EmptyState variant="no_filter_results" onBrowse={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Browse the catalogue' })).toBeNull();

    await rerender(<EmptyState variant="no_content" onBrowse={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Browse the catalogue' })).toBeNull();
  });
});
