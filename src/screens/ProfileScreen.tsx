import { useCallback } from 'react';
import { useNavigation, type NavigationProp, type CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet } from 'react-native';

import { ListRow } from '@components/ListRow';
import { useInstitutionStore } from '@store/institutionStore';
import type { RootStackParamList, RootTabParamList } from '@navigation/types';
import { color, space, type } from '@theme/tokens';

// CompositeNavigationProp lets this screen navigate to both the root stack
// (Gallery) and to nested screens in sibling tabs (InstitutionList in Catalogue).
type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<RootTabParamList, 'Profile'>,
  NavigationProp<RootStackParamList>
>;

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();

  const selectedInstitution = useInstitutionStore((s) => s.selectedInstitution);
  const clearSelectedInstitution = useInstitutionStore((s) => s.clearSelectedInstitution);

  const handleChangeInstitution = useCallback(() => {
    // InstitutionList lives in the Catalogue stack. React Navigation resolves
    // cross-tab routes by switching to the owning tab first, then pushing the screen.
    navigation.navigate('Catalogue', { screen: 'InstitutionList' });
  }, [navigation]);

  const handleSignOut = useCallback(() => {
    clearSelectedInstitution();
  }, [clearSelectedInstitution]);

  return (
    <View style={styles.container}>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Institution</Text>
        {selectedInstitution !== null ? (
          <>
            <ListRow
              title="Selected institution"
              variant="value"
              valueText={selectedInstitution.name}
              onPress={handleChangeInstitution}
            />
            <ListRow
              title="Change institution"
              variant="chevron"
              onPress={handleChangeInstitution}
            />
            <ListRow
              title="Sign out"
              variant="destructive"
              onPress={handleSignOut}
            />
          </>
        ) : (
          <ListRow
            title="Select institution"
            subtitle="Required to access your library"
            variant="chevron"
            onPress={handleChangeInstitution}
          />
        )}
      </View>

      {/* THE ONLY WAY INTO THE GALLERY, and deliberately the only one.

          `GalleryScreen` has been registered in RootNavigator since P0-6 with
          nothing linking to it, so the review surface was code that ran nowhere.
          This is the entry point.

          WHY `__DEV__` AND NOT A CONFIG FLAG: CONVENTIONS §9 requires that
          "nothing in the UI may navigate to it in a release build", and its own
          open questions list "what keeps GalleryScreen out of a release build"
          as unresolved. `__DEV__` is false in a production bundle and Metro's
          minifier drops the whole branch, so the answer is enforced by the
          bundler rather than by remembering. A runtime flag would ship the
          button and hide it, which is a weaker guarantee.

          The route itself stays registered — removing it would mean editing
          Keshav's navigator, and an unreachable route ships no UI. */}
      {__DEV__ && (
        <View style={styles.dev}>
          <Text style={styles.devLabel}>Developer</Text>
          <ListRow
            title="State Gallery"
            subtitle="Every component, variant and state — dev builds only"
            variant="chevron"
            onPress={() => navigation.navigate('Gallery')}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.surface,
  },
  section: {
    marginTop: space.lg,
  },
  sectionLabel: {
    fontWeight: type.smallLabel.weight,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.textSecondary,
    paddingHorizontal: space.md,
    paddingBottom: space.xs,
  },
  dev: {
    marginTop: space.xl,
  },
  devLabel: {
    fontWeight: type.smallLabel.weight,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.textSecondary,
    paddingHorizontal: space.md,
    paddingBottom: space.xs,
  },
});
