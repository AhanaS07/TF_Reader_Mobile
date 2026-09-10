import { render, screen } from '@testing-library/react-native';

import EliteQueueCard from './EliteQueueCard';

describe('EliteQueueCard', () => {
  it('renders the title verbatim', async () => {
    await render(<EliteQueueCard title="A Title" />);

    expect(screen.getByTestId('elite-queue-title').props.children).toBe('A Title');
  });

  it('shows a placeholder well when no cover is supplied', async () => {
    await render(<EliteQueueCard title="A Title" />);

    expect(screen.getByTestId('elite-queue-placeholder')).toBeTruthy();
  });

  it('shows the queue position only when one is supplied', async () => {
    await render(<EliteQueueCard title="A Title" />);

    expect(screen.queryByTestId('elite-queue-position')).toBeNull();
  });

  it('renders the queue label verbatim, inventing no position', async () => {
    await render(<EliteQueueCard title="A Title" queueLabel="3rd of 7" />);

    expect(screen.getByTestId('elite-queue-position').props.children).toBe('3rd of 7');
  });

  it('draws the progress bar only when a fraction is supplied', async () => {
    await render(<EliteQueueCard title="A Title" queueLabel="3rd of 7" />);

    expect(screen.queryByTestId('elite-queue-progress')).toBeNull();
  });

  it('fills the progress bar to the supplied fraction', async () => {
    await render(<EliteQueueCard title="A Title" progressFraction={0.5} />);

    const { StyleSheet } = jest.requireActual('react-native');
    const fill = screen.getByTestId('elite-queue-progress').props.children;
    expect(StyleSheet.flatten(fill.props.style).width).toBe('50%');
  });

  it('always shows the Elite tier badge', async () => {
    await render(<EliteQueueCard title="A Title" />);

    expect(screen.getByText('Elite')).toBeTruthy();
  });

  it('renders no chevron and no button — reassurance, not action', async () => {
    await render(<EliteQueueCard title="A Title" queueLabel="1st of 3" />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});
