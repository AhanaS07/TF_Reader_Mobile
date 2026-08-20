// P0-6 — App shell and navigation (Keshav, paired with Khushi on BottomTabBar)
import { StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import type { BottomTabBarProps as RNBottomTabBarProps } from '@react-navigation/bottom-tabs';

import { useInstitutionStore } from '@store/institutionStore';
import { color } from '@theme/tokens';

import { TopAppBar } from '../components/TopAppBar';
import { BottomTabBar } from '../components/BottomTabBar';
import type { TabItem } from '../components/BottomTabBar';

// Picks between the institution catalogue and the public one — see the file.
import CatalogueHomeScreen from '../screens/CatalogueHomeScreen';
import SearchScreen from '../screens/SearchScreen';
import LibraryScreen from '../screens/LibraryScreen';
import ProfileScreen from '../screens/ProfileScreen';
import GalleryScreen from '../screens/GalleryScreen';
import InstitutionDetailScreen from '../screens/InstitutionDetailScreen';
import InstitutionListScreen from '../screens/InstitutionListScreen';
import ItemDetailScreen from '../screens/ItemDetailScreen';
import ShelfScreen from '../screens/ShelfScreen';
import SignInScreen from '../screens/SignInScreen';
import AccessGateScreen from '../screens/AccessGateScreen';

import type {
  RootStackParamList,
  RootTabParamList,
  CatalogueStackParamList,
  SearchStackParamList,
  LibraryStackParamList,
  ProfileStackParamList,
} from './types';

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: color.surface },
});

// ─── Navigator instances ──────────────────────────────────────────────────────

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<RootTabParamList>();
const CatalogueStack = createNativeStackNavigator<CatalogueStackParamList>();
const SearchStack = createNativeStackNavigator<SearchStackParamList>();
const LibraryStack = createNativeStackNavigator<LibraryStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

// ─── Tab config — drives both the navigator and BottomTabBar ─────────────────

const TAB_CONFIG: TabItem[] = [
  { key: 'Catalogue', label: 'Catalogue', iconActive: 'book', iconInactive: 'book-outline' },
  { key: 'Search', label: 'Search', iconActive: 'search', iconInactive: 'search-outline' },
  { key: 'Library', label: 'Library', iconActive: 'library', iconInactive: 'library-outline' },
  { key: 'Profile', label: 'Profile', iconActive: 'person', iconInactive: 'person-outline' },
];

// ─── Header wrapper — reads safe-area inset and passes it to TopAppBar ───────

function AppHeader({ route, options, back, navigation }: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <TopAppBar
      title={options.title ?? route.name}
      onBack={back ? navigation.goBack : undefined}
      topInset={insets.top}
    />
  );
}

// ─── Tab bar wrapper — bridges React Navigation props to BottomTabBar ─────────

function AppTabBar({ state, navigation, insets }: RNBottomTabBarProps) {
  const activeKey = state.routes[state.index]?.name ?? 'Catalogue';
  return (
    <BottomTabBar
      tabs={TAB_CONFIG}
      activeKey={activeKey}
      onTabPress={(key) => navigation.navigate(key)}
      bottomInset={insets.bottom}
    />
  );
}

// ─── Nested stack navigators ─────────────────────────────────────────────────

function CatalogueNavigator() {
  return (
    <CatalogueStack.Navigator screenOptions={{ header: (props) => <AppHeader {...props} /> }}>
      <CatalogueStack.Screen
        name="CatalogueHome"
        component={CatalogueHomeScreen}
        options={{ title: 'Taylor & Francis' }}
      />
      <CatalogueStack.Screen
        name="InstitutionDetail"
        component={InstitutionDetailScreen}
        options={{ title: 'Institution' }}
      />
      <CatalogueStack.Screen
        name="ItemDetail"
        component={ItemDetailScreen}
        options={{ title: 'Item Detail' }}
      />
      <CatalogueStack.Screen
        name="InstitutionList"
        component={InstitutionListScreen}
        options={{ title: 'Select Institution' }}
      />
      <CatalogueStack.Screen
        name="Shelf"
        component={ShelfScreen}
        options={({ route }) => ({ title: route.params.title })}
      />
      <CatalogueStack.Screen
        name="SignIn"
        component={SignInScreen}
        options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', headerShown: false }}
      />
      <CatalogueStack.Screen
        name="AccessGate"
        component={AccessGateScreen}
        options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', headerShown: false }}
      />
    </CatalogueStack.Navigator>
  );
}

function SearchNavigator() {
  return (
    <SearchStack.Navigator screenOptions={{ header: (props) => <AppHeader {...props} /> }}>
      <SearchStack.Screen
        name="SearchHome"
        component={SearchScreen}
        options={{ title: 'Search' }}
      />
      <SearchStack.Screen
        name="ItemDetail"
        component={ItemDetailScreen}
        options={{ title: 'Item Detail' }}
      />
      <SearchStack.Screen
        name="AccessGate"
        component={AccessGateScreen}
        options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', headerShown: false }}
      />
    </SearchStack.Navigator>
  );
}

function LibraryNavigator() {
  return (
    <LibraryStack.Navigator screenOptions={{ header: (props) => <AppHeader {...props} /> }}>
      <LibraryStack.Screen
        name="LibraryHome"
        component={LibraryScreen}
        options={{ title: 'Library' }}
      />
      
    </LibraryStack.Navigator>
  );
}

function ProfileNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={{ header: (props) => <AppHeader {...props} /> }}>
      <ProfileStack.Screen
        name="ProfileHome"
        component={ProfileScreen}
        options={{ title: 'Profile' }}
      />
    </ProfileStack.Navigator>
  );
}

// ─── Bottom tab navigator ─────────────────────────────────────────────────────

function TabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Catalogue" component={CatalogueNavigator} />
      <Tab.Screen name="Search" component={SearchNavigator} />
      <Tab.Screen name="Library" component={LibraryNavigator} />
      <Tab.Screen name="Profile" component={ProfileNavigator} />
    </Tab.Navigator>
  );
}

// ─── Root navigator (wraps tabs + Gallery modal) ──────────────────────────────

export default function RootNavigator() {
  const hasHydrated = useInstitutionStore((s) => s._hasHydrated);

  if (!hasHydrated) {
    return <View style={styles.splash} />;
  }

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      <RootStack.Screen name="Main" component={TabNavigator} />
      <RootStack.Screen
        name="Gallery"
        component={GalleryScreen}
        options={{
          headerShown: true,
          header: (props) => <AppHeader {...props} />,
          title: 'State Gallery',
        }}
      />
    </RootStack.Navigator>
  );
}
