// src/screens/AboutNexusScreen.test.tsx
import { fireEvent, render, screen } from '@testing-library/react-native';

import AboutNexusScreen from './AboutNexusScreen';

// Must be prefixed `mock` — Jest's module-factory scope guard only allows
// referencing out-of-scope variables whose name starts with "mock". Same
// shape as ProfileScreen.test.tsx.
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

describe('AboutNexusScreen', () => {
  it('shows the app mark and T&F attribution', async () => {
    await render(<AboutNexusScreen />);
    expect(screen.getByText('Nexus')).toBeTruthy();
    expect(screen.getByText('Powered by Taylor & Francis')).toBeTruthy();
  });

  it('draws no version number', async () => {
    // No version source without adding expo-constants — see the file
    // header. Nothing on screen should read like a version string.
    await render(<AboutNexusScreen />);
    expect(screen.queryByText(/^v\d/i)).toBeNull();
  });

  it('pushes PrivacySecurity when the Privacy & Security row is tapped', async () => {
    await render(<AboutNexusScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Privacy & Security' }));
    expect(mockNavigate).toHaveBeenCalledWith('PrivacySecurity');
  });

  it('shows Terms of Service copy', async () => {
    await render(<AboutNexusScreen />);
    expect(screen.getByText('Terms of Service')).toBeTruthy();
  });
});
