import { fireEvent, render, screen } from '@testing-library/react-native';

import EliteActiveAccessCard from './EliteActiveAccessCard';

describe('EliteActiveAccessCard', () => {
  it('renders the title verbatim', async () => {
    await render(<EliteActiveAccessCard title="A Title" onPress={() => {}} />);

    expect(screen.getByTestId('elite-active-access-title').props.children).toBe('A Title');
  });

  it('shows a placeholder well when no cover is supplied', async () => {
    await render(<EliteActiveAccessCard title="A Title" onPress={() => {}} />);

    expect(screen.getByTestId('elite-active-access-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('elite-active-access-image')).toBeNull();
  });

  it('renders the cover image when a URL is supplied', async () => {
    await render(
      <EliteActiveAccessCard title="A Title" imageUrl="https://example.com/cover.jpg" onPress={() => {}} />,
    );

    expect(screen.getByTestId('elite-active-access-image').props.source.uri).toBe(
      'https://example.com/cover.jpg',
    );
  });

  it('shows the format chip only when a format is supplied', async () => {
    await render(<EliteActiveAccessCard title="A Title" onPress={() => {}} />);

    expect(screen.queryByText('PDF')).toBeNull();
  });

  it('renders the supplied format verbatim', async () => {
    await render(<EliteActiveAccessCard title="A Title" format="PDF" onPress={() => {}} />);

    expect(screen.getByText('PDF')).toBeTruthy();
  });

  it('shows the expiry line only when one is supplied', async () => {
    await render(<EliteActiveAccessCard title="A Title" onPress={() => {}} />);

    expect(screen.queryByTestId('elite-active-access-expiry')).toBeNull();
  });

  it('renders the expiry label verbatim when supplied, inventing no duration', async () => {
    await render(
      <EliteActiveAccessCard title="A Title" expiresLabel="Due in 3 days" onPress={() => {}} />,
    );

    expect(screen.getByTestId('elite-active-access-expiry').props.children).toEqual([
      'Access expires: ',
      'Due in 3 days',
    ]);
  });

  it('always shows the Elite tier badge', async () => {
    await render(<EliteActiveAccessCard title="A Title" onPress={() => {}} />);

    expect(screen.getByText('Elite')).toBeTruthy();
  });

  it('goes to the item’s detail page when tapped', async () => {
    const onPress = jest.fn();
    await render(<EliteActiveAccessCard title="A Title" onPress={onPress} />);

    fireEvent.press(screen.getByTestId('elite-active-access-card'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
