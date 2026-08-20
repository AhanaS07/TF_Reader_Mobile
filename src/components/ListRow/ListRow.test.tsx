import { fireEvent, render, screen } from '@testing-library/react-native';
import ListRow from './ListRow';

describe('ListRow content', () => {
  it('renders the title', async () => {
    await render(<ListRow title="Language" variant="chevron" onPress={() => {}} />);
    expect(screen.getByText('Language')).toBeTruthy();
  });

  it('renders the subtitle when provided', async () => {
    await render(
      <ListRow title="Account" subtitle="Manage your account" variant="chevron" onPress={() => {}} />,
    );
    expect(screen.getByText('Manage your account')).toBeTruthy();
  });

  it('renders the value text for value variant', async () => {
    await render(
      <ListRow title="Language" variant="value" valueText="English" onPress={() => {}} />,
    );
    expect(screen.getByText('English')).toBeTruthy();
  });
});

describe('ListRow variants', () => {
  it('has button role for chevron variant', async () => {
    await render(<ListRow title="Language" variant="chevron" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Language' })).toBeTruthy();
  });

  it('has switch role for toggle variant', async () => {
    await render(
      <ListRow title="Wi-Fi only" variant="toggle" toggleValue={false} onToggleChange={() => {}} />,
    );
    expect(screen.getByRole('switch', { name: 'Wi-Fi only' })).toBeTruthy();
  });

  it('has button role for destructive variant', async () => {
    await render(<ListRow title="Sign Out" variant="destructive" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeTruthy();
  });
});

describe('ListRow interactions', () => {
  it('calls onPress when chevron row is tapped', async () => {
    const onPress = jest.fn();
    await render(<ListRow title="Language" variant="chevron" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Language' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleChange when toggle row is pressed', async () => {
    const onToggleChange = jest.fn();
    await render(
      <ListRow title="Wi-Fi only" variant="toggle" toggleValue={false} onToggleChange={onToggleChange} />,
    );
    fireEvent.press(screen.getByRole('switch', { name: 'Wi-Fi only' }));
    expect(onToggleChange).toHaveBeenCalledWith(true);
  });

  it('calls onPress when destructive row is tapped', async () => {
    const onPress = jest.fn();
    await render(<ListRow title="Sign Out" variant="destructive" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Sign Out' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('ListRow disabled', () => {
  it('announces a disabled chevron row as disabled', async () => {
    await render(<ListRow title="Privacy & Security" variant="chevron" disabled />);
    expect(
      screen.getByRole('button', { name: 'Privacy & Security' }).props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('announces an enabled row as not disabled', async () => {
    await render(<ListRow title="Language" variant="chevron" onPress={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Language' }).props.accessibilityState.disabled,
    ).toBe(false);
  });

  it('does not call onPress when a disabled row is tapped', async () => {
    const onPress = jest.fn();
    await render(
      <ListRow title="Privacy & Security" variant="chevron" disabled onPress={onPress} />,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Privacy & Security' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  // The Switch is its own touch target inside the row, so the Pressable's
  // `disabled` does not reach it. This is the branch that regressed first.
  it('does not toggle when a disabled toggle row is tapped', async () => {
    const onToggleChange = jest.fn();
    await render(
      <ListRow
        title="Notifications"
        variant="toggle"
        toggleValue={false}
        disabled
        onToggleChange={onToggleChange}
      />,
    );
    fireEvent.press(screen.getByRole('switch', { name: 'Notifications' }));
    expect(onToggleChange).not.toHaveBeenCalled();
  });

  it('keeps the checked state alongside disabled on a toggle row', async () => {
    await render(
      <ListRow title="Notifications" variant="toggle" toggleValue={true} disabled />,
    );
    const row = screen.getByRole('switch', { name: 'Notifications' });
    expect(row.props.accessibilityState).toEqual({ checked: true, disabled: true });
  });

  it('does not call onPress when a disabled destructive row is tapped', async () => {
    const onPress = jest.fn();
    await render(<ListRow title="Sign Out" variant="destructive" disabled onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Sign Out' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});
