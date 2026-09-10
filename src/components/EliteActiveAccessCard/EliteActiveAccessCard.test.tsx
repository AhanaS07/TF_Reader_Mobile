import { fireEvent, render, screen } from '@testing-library/react-native';

import EliteActiveAccessCard from './EliteActiveAccessCard';

describe('EliteActiveAccessCard', () => {
  it('renders the title verbatim', async () => {
    await render(<EliteActiveAccessCard title="A Title" onRead={() => {}} />);

    expect(screen.getByTestId('elite-active-access-title').props.children).toBe('A Title');
  });

  it('shows a placeholder well when no cover is supplied', async () => {
    await render(<EliteActiveAccessCard title="A Title" onRead={() => {}} />);

    expect(screen.getByTestId('elite-active-access-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('elite-active-access-image')).toBeNull();
  });

  it('renders the cover image when a URL is supplied', async () => {
    await render(
      <EliteActiveAccessCard title="A Title" imageUrl="https://example.com/cover.jpg" onRead={() => {}} />,
    );

    expect(screen.getByTestId('elite-active-access-image').props.source.uri).toBe(
      'https://example.com/cover.jpg',
    );
  });

  it('shows the format chip only when a format is supplied', async () => {
    await render(<EliteActiveAccessCard title="A Title" onRead={() => {}} />);

    expect(screen.queryByText('PDF')).toBeNull();
  });

  it('renders the supplied format verbatim', async () => {
    await render(<EliteActiveAccessCard title="A Title" format="PDF" onRead={() => {}} />);

    expect(screen.getByText('PDF')).toBeTruthy();
  });

  it('shows the expiry line only when one is supplied', async () => {
    await render(<EliteActiveAccessCard title="A Title" onRead={() => {}} />);

    expect(screen.queryByTestId('elite-active-access-expiry')).toBeNull();
  });

  it('renders the expiry label verbatim when supplied, inventing no duration', async () => {
    await render(
      <EliteActiveAccessCard title="A Title" expiresLabel="Due in 3 days" onRead={() => {}} />,
    );

    expect(screen.getByTestId('elite-active-access-expiry').props.children).toEqual([
      'Access expires: ',
      'Due in 3 days',
    ]);
  });

  it('always shows the Elite tier badge', async () => {
    await render(<EliteActiveAccessCard title="A Title" onRead={() => {}} />);

    expect(screen.getByText('Elite')).toBeTruthy();
  });

  it('reports Read through the handed callback', async () => {
    const onRead = jest.fn();
    await render(<EliteActiveAccessCard title="A Title" onRead={onRead} />);

    fireEvent.press(screen.getByTestId('action-button-read'));

    expect(onRead).toHaveBeenCalledTimes(1);
  });
});
