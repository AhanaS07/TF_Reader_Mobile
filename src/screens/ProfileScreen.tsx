import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { View, Text, StyleSheet } from 'react-native';

import { ListRow } from '@components/ListRow';
import type { RootStackParamList } from '@navigation/types';
import { color, space, type } from '@theme/tokens';

export default function ProfileScreen() {
  // Typed against the ROOT stack, not the Profile stack: 'Gallery' is a sibling
  // of the whole tab navigator, and React Navigation resolves an unknown route
  // name by walking up the tree.
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>

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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  title: {
    fontWeight: type.sectionHeader.weight,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textSecondary,
  },
  dev: {
    // Spans the screen so the row reads as a settings row rather than as a
    // floating button in the middle of a centred stub.
    alignSelf: 'stretch',
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
