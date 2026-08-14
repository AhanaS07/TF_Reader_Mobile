import { fireEvent, render, screen } from '@testing-library/react-native';
import InstitutionRow from './InstitutionRow';
import type { Institution } from '@model/institution';

const WITH_CREST: Institution = {
  id: 'inst_7f3',
  name: 'Imperial College London',
  country: 'United Kingdom',
  crestUrl: 'https://cdn.tf/crests/inst_7f3.png',
  authType: 'saml',
};

const NO_CREST: Institution = {
  id: 'inst_c88',
  name: 'Kwame Nkrumah University of Science and Technology',
  country: 'Ghana',
  authType: 'oidc',
};

describe('InstitutionRow content', () => {
  it('renders the institution name and country', async () => {
    await render(<InstitutionRow institution={WITH_CREST} onPress={() => {}} />);
    expect(screen.getByText('Imperial College London')).toBeTruthy();
    expect(screen.getByText('United Kingdom')).toBeTruthy();
  });

  it('renders the crest image when crestUrl is present', async () => {
    await render(<InstitutionRow institution={WITH_CREST} onPress={() => {}} />);
    expect(screen.getByLabelText('Imperial College London logo')).toBeTruthy();
  });

  it('renders initials fallback when crestUrl is absent', async () => {
    await render(<InstitutionRow institution={NO_CREST} onPress={() => {}} />);
    // "Kwame Nkrumah..." → "KN"
    expect(screen.getByText('KN')).toBeTruthy();
  });
});

describe('InstitutionRow variants', () => {
  it('shows checkmark when isSelected is true', async () => {
    await render(<InstitutionRow institution={WITH_CREST} isSelected onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Imperial College London' }).props.accessibilityState?.selected).toBe(true);
  });

  it('shows "Recently used" label when isPinned is true', async () => {
    await render(<InstitutionRow institution={WITH_CREST} isPinned onPress={() => {}} />);
    expect(screen.getByText('Recently used')).toBeTruthy();
  });

  it('does not show "Recently used" label by default', async () => {
    await render(<InstitutionRow institution={WITH_CREST} onPress={() => {}} />);
    expect(screen.queryByText('Recently used')).toBeNull();
  });
});

describe('InstitutionRow interaction', () => {
  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    await render(<InstitutionRow institution={WITH_CREST} onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Imperial College London' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
