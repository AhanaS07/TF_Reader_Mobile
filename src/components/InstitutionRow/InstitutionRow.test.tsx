import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import InstitutionRow from './InstitutionRow';
import type { Institution } from '@model/institution';

const WITH_CREST: Institution = {
  id: 'inst_7f3',
  name: 'Imperial College London',
  country: 'United Kingdom',
  code: 'ICL',
  city: 'London',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_7f3/catalogue',
  branding: { logoUrl: 'https://cdn.tf/crests/inst_7f3.png' },
};

const NO_CREST: Institution = {
  id: 'inst_c88',
  name: 'Kwame Nkrumah University of Science and Technology',
  country: 'Ghana',
  code: 'KNUST',
  city: 'Kumasi',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_c88/catalogue',
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

  // A failed fetch (a broken URL, a rate-limited backend) used to leave a
  // blank, backgroundColor-only box — the image simply never painted, with
  // no signal that anything was even meant to be there. This is the same
  // "a failure is not the same as absence" fallback ContentCard already
  // makes for its own cover art.
  it('falls back to initials when the crest image fails to load, not a blank box', async () => {
    await render(<InstitutionRow institution={WITH_CREST} onPress={() => {}} />);
    expect(screen.getByLabelText('Imperial College London logo')).toBeTruthy();
    expect(screen.queryByText('IC')).toBeNull();

    fireEvent(screen.getByLabelText('Imperial College London logo'), 'onError', {
      nativeEvent: { error: 'load failed' },
    });

    await waitFor(() =>
      expect(screen.queryByLabelText('Imperial College London logo')).toBeNull(),
    );
    expect(screen.getByText('IC')).toBeTruthy();
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
