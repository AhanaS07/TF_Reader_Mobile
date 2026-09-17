// src/screens/PrivacySecurityScreen.test.tsx
import { render, screen } from '@testing-library/react-native';

import PrivacySecurityScreen from './PrivacySecurityScreen';

describe('PrivacySecurityScreen', () => {
  it('shows the page title and subtitle', async () => {
    await render(<PrivacySecurityScreen />);
    expect(screen.getByText('Privacy & Security')).toBeTruthy();
    expect(screen.getByText('How Nexus handles your data, and keeps it safe.')).toBeTruthy();
  });

  it('renders every section heading', async () => {
    await render(<PrivacySecurityScreen />);
    for (const title of [
      'Data we collect',
      'How we use it',
      'How it’s protected',
      'Your choices',
      'Third parties',
      'Contact',
    ]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('flags the copy as an unreviewed draft', async () => {
    await render(<PrivacySecurityScreen />);
    expect(screen.getByText(/has not yet been reviewed by legal/)).toBeTruthy();
  });
});
