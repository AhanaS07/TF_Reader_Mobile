// src/navigation/RootNavigator.test.tsx
//
// T3 — the wiring nobody owns. RootNavigator was built all-hands and sat at
// 64% statements / ~50% branches with no test asserting that a given route
// resolves to the right screen. The uncovered branches are:
//
//   1. The hydration gate — splash while _hasHydrated=false, full navigator
//      after. A stuck flag means a permanent white screen with no way out.
//   2. AppHeader's back-button branch — back ? goBack : undefined.
//   3. AppTabBar's activeKey fallback — routes[index]?.name ?? 'Catalogue'.
//
// All child screens are stubbed so this file tests the navigator wiring, not
// individual screen behaviour — that belongs in each screen's own test file.
//
// Note: jest.mock() factories are hoisted above imports by Babel, so they
// cannot reference imported variables. `require` inside each factory is the
// standard pattern for returning React components from a mock factory.
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useInstitutionStore } from '@store/institutionStore';
import RootNavigator from './RootNavigator';

// ─── Screen stubs ─────────────────────────────────────────────────────────────

jest.mock('../screens/CatalogueHomeScreen', () => ({
  __esModule: true,
  default: () => {
    const { Text } = require('react-native');
    return <Text testID="screen-catalogue-home">CatalogueHome</Text>;
  },
}));
jest.mock('../screens/SearchScreen', () => ({
  __esModule: true,
  default: () => {
    const { Text } = require('react-native');
    return <Text testID="screen-search-home">SearchHome</Text>;
  },
}));
jest.mock('../screens/LibraryScreen', () => ({
  __esModule: true,
  default: () => {
    const { Text } = require('react-native');
    return <Text testID="screen-library-home">LibraryHome</Text>;
  },
}));
jest.mock('../screens/ProfileScreen', () => ({
  __esModule: true,
  default: () => {
    const { Text } = require('react-native');
    return <Text testID="screen-profile-home">ProfileHome</Text>;
  },
}));
jest.mock('../screens/ItemDetailScreen', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../screens/ShelfScreen', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../screens/SignInScreen', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../screens/AccessGateScreen', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../screens/InstitutionListScreen', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../screens/InstitutionDetailScreen', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../screens/ReaderPreferencesScreen', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../screens/GalleryScreen', () => ({
  __esModule: true,
  default: () => null,
}));

// QueueNotificationHost renders the D16 offer banner above every screen.
jest.mock('../features/queue/QueueNotificationHost', () => ({
  __esModule: true,
  default: () => {
    const { Text } = require('react-native');
    return <Text testID="queue-notification-host">QueueHost</Text>;
  },
}));

jest.mock('@hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => true,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderNavigator() {
  return render(
    <NavigationContainer>
      <RootNavigator />
    </NavigationContainer>,
  );
}

afterEach(() => {
  useInstitutionStore.setState({ _hasHydrated: false });
});

// ─── Hydration gate ───────────────────────────────────────────────────────────

describe('RootNavigator — hydration gate', () => {
  // FL-5: the splash keeps the user on a white screen rather than flashing an
  // empty state or replaying a stale intent before the store has loaded.
  it('shows a blank splash while the store has not hydrated', async () => {
    await act(async () => {
      useInstitutionStore.setState({ _hasHydrated: false });
      renderNavigator();
    });

    expect(screen.queryByTestId('screen-catalogue-home')).toBeNull();
    expect(screen.queryByText('Catalogue')).toBeNull();
  });

  it('renders the full navigator once the store has hydrated', async () => {
    await act(async () => {
      useInstitutionStore.setState({ _hasHydrated: true });
      renderNavigator();
    });

    expect(screen.getByTestId('screen-catalogue-home')).toBeTruthy();
  });
});

// ─── Tab wiring ───────────────────────────────────────────────────────────────

describe('RootNavigator — tab wiring', () => {
  it('renders all four bottom tabs', async () => {
    await act(async () => {
      useInstitutionStore.setState({ _hasHydrated: true });
      renderNavigator();
    });

    expect(screen.getByText('Catalogue')).toBeTruthy();
    expect(screen.getByText('Search')).toBeTruthy();
    expect(screen.getByText('Library')).toBeTruthy();
    expect(screen.getByText('Profile')).toBeTruthy();
  });

  it('starts on the Catalogue tab with CatalogueHome as the initial screen', async () => {
    await act(async () => {
      useInstitutionStore.setState({ _hasHydrated: true });
      renderNavigator();
    });

    expect(screen.getByTestId('screen-catalogue-home')).toBeTruthy();
  });

  it('switches to Search when the Search tab is pressed', async () => {
    await act(async () => {
      useInstitutionStore.setState({ _hasHydrated: true });
      renderNavigator();
    });

    await act(async () => {
      fireEvent.press(screen.getByText('Search'));
    });

    expect(screen.getByTestId('screen-search-home')).toBeTruthy();
  });

  it('switches to Profile when the Profile tab is pressed', async () => {
    await act(async () => {
      useInstitutionStore.setState({ _hasHydrated: true });
      renderNavigator();
    });

    await act(async () => {
      fireEvent.press(screen.getByText('Profile'));
    });

    expect(screen.getByTestId('screen-profile-home')).toBeTruthy();
  });
});

// ─── D16 — QueueNotificationHost ─────────────────────────────────────────────

describe('RootNavigator — QueueNotificationHost', () => {
  // D16: the offer banner must sit above every screen, mounted at the root so
  // it is answerable from wherever the reader is — not only from ItemDetail.
  it('mounts QueueNotificationHost above the tab navigator', async () => {
    await act(async () => {
      useInstitutionStore.setState({ _hasHydrated: true });
      renderNavigator();
    });

    expect(screen.getByTestId('queue-notification-host')).toBeTruthy();
  });
});
