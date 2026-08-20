// The CatalogueHome route picks between the two catalogues. Both children are
// mocked out: what is under test is the CHOICE, not either screen's own
// behaviour — those have their own suites.
import { render, screen } from '@testing-library/react-native';

import type { Institution } from '@model/institution';
import { useInstitutionStore } from '@store/institutionStore';

import CatalogueHomeScreen from './CatalogueHomeScreen';

jest.mock('./CatalogueScreen', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  return { __esModule: true, default: () => <RNText>institution catalogue</RNText> };
});

jest.mock('./PublicCatalogueScreen', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  return { __esModule: true, default: () => <RNText>public catalogue</RNText> };
});

const INSTITUTION: Institution = {
  id: 'inst_a21',
  name: 'Test Institution',
  country: 'GB',
  code: 'TST',
  city: 'London',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_a21/catalogue',
};

afterEach(() => {
  useInstitutionStore.setState({ selectedInstitution: null });
});

describe('CatalogueHomeScreen', () => {
  // A1: a reader who has chosen no institution gets the open access feed rather
  // than some default institution's catalogue.
  it('shows the public catalogue when no institution is selected', async () => {
    useInstitutionStore.setState({ selectedInstitution: null });

    await render(<CatalogueHomeScreen />);

    expect(screen.getByText('public catalogue')).toBeTruthy();
    expect(screen.queryByText('institution catalogue')).toBeNull();
  });

  it('shows the institution catalogue once one is selected', async () => {
    useInstitutionStore.setState({ selectedInstitution: INSTITUTION });

    await render(<CatalogueHomeScreen />);

    expect(screen.getByText('institution catalogue')).toBeTruthy();
    expect(screen.queryByText('public catalogue')).toBeNull();
  });
});
