import { fireEvent, render, screen } from '@testing-library/react-native';
import TopAppBar from './TopAppBar';

describe('TopAppBar variants', () => {
  it('renders the title', async () => {
    await render(<TopAppBar title="Taylor & Francis" />);
    expect(screen.getByText('Taylor & Francis')).toBeTruthy();
  });

  it('renders a back button when onBack is provided', async () => {
    await render(<TopAppBar title="Detail" onBack={() => {}} />);
    expect(screen.getByRole('button', { name: 'Go back' })).toBeTruthy();
  });

  it('renders a search button when onSearch is provided', async () => {
    await render(<TopAppBar title="Home" onSearch={() => {}} />);
    expect(screen.getByRole('button', { name: 'Open search' })).toBeTruthy();
  });

  it('does not render a back button when onBack is absent', async () => {
    await render(<TopAppBar title="Home" />);
    expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();
  });

  it('does not render a search button when onSearch is absent', async () => {
    await render(<TopAppBar title="Detail" onBack={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
  });
});

describe('TopAppBar interactions', () => {
  it('calls onBack when back button is pressed', async () => {
    const onBack = jest.fn();
    await render(<TopAppBar title="Detail" onBack={onBack} />);
    fireEvent.press(screen.getByRole('button', { name: 'Go back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('calls onSearch when search button is pressed', async () => {
    const onSearch = jest.fn();
    await render(<TopAppBar title="Home" onSearch={onSearch} />);
    fireEvent.press(screen.getByRole('button', { name: 'Open search' }));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });
});
