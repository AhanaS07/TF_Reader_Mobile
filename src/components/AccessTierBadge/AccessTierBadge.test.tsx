import { render } from '@testing-library/react-native';

import { ACCESS_TIERS } from '@model/types';

import AccessTierBadge from './AccessTierBadge';

// `render` is ASYNC in @testing-library/react-native v14 — forget the await and
// you get "getByText is not a function". Same note as App.test.tsx.

// Labels are written out rather than imported from the component, so a wrong
// label fails the test instead of agreeing with itself.
const LABELS = {
  OPEN_ACCESS: 'Open Access',
  SUBSCRIPTION: 'Subscription',
  ELITE: 'Elite',
};

describe('AccessTierBadge', () => {
  ACCESS_TIERS.forEach((tier) => {
    it(`renders the ${tier} label`, async () => {
      const { getByText } = await render(<AccessTierBadge tier={tier} />);
      expect(getByText(LABELS[tier])).toBeTruthy();
    });
  });

  (['sm', 'md'] as const).forEach((size) => {
    it(`renders at size ${size}`, async () => {
      const { getByText } = await render(<AccessTierBadge tier="ELITE" size={size} />);
      expect(getByText('Elite')).toBeTruthy();
    });
  });
});
