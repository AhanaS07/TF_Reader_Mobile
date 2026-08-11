// App.tsx — the Expo entry component.
//
// `package.json` main = node_modules/expo/AppEntry.js, which does
// `import App from '../../App'` and hands it to registerRootComponent. That
// resolves to THIS file, so the name and root location are load-bearing.
//
// Deliberately near-empty. RootNavigator (src/navigation/) is CAP work owned by
// the feature teams — this file only proves the toolchain boots and should grow
// to `<SafeAreaProvider><RootNavigator /></SafeAreaProvider>` and nothing more.
//
// TEMPORARY: the `Preview` below renders the two cards so they can be looked at
// on a device while there is no navigator to reach a real screen. It is
// scaffolding, not a screen — delete it (and the stubs) the moment RootNavigator
// lands. Nothing outside this file imports it.
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryCard } from '@components/CategoryCard';
import { ContentCard } from '@components/ContentCard';
import { color, radius, space, type } from '@theme/tokens';

export default function App() {
  return (
    <SafeAreaProvider>
      <Preview />
    </SafeAreaProvider>
  );
}

// Stands in for Akriti's AccessTierBadge, which fills ContentCard's `badge` slot.
// A placeholder here rather than a component in src/components/, which would
// duplicate her work (CONVENTIONS §7).
function BadgeStub({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <View style={styles.badgeDot} />
      <Text style={styles.badgeLabel}>{label}</Text>
    </View>
  );
}

function Preview() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xl },
      ]}
    >
      <Text style={styles.title}>TF Reader</Text>

      {/* The carousel owns tile width, since a card sets none (§8). */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        <View style={styles.cardWidth}>
          <CategoryCard title="eBooks" count={128} accent="primary" onPress={() => {}} />
        </View>
        <View style={styles.cardWidth}>
          <CategoryCard title="Audiobooks" count={34} accent="navy" onPress={() => {}} />
        </View>
        <View style={styles.cardWidth}>
          <CategoryCard title="Open access" count={512} accent="success" onPress={() => {}} />
        </View>
      </ScrollView>

      <View style={styles.stack}>
        <ContentCard
          title="A review of renewable energy integration in smart grids"
          publisher="Renewable Energy"
          imageUrl="https://picsum.photos/seed/renewable/200/200"
          badge={<BadgeStub label="Open Access" />}
          onPress={() => {}}
        />
        <ContentCard
          title="CRISPR-Cas9 technologies: Advances and clinical applications"
          publisher="Expert Review of Molecular Diagnostics"
          imageUrl="https://picsum.photos/seed/crispr/200/200"
          badge={<BadgeStub label="Open Access" />}
          onPress={() => {}}
        />
        {/* No cover: the case every fixture publication actually hits today. */}
        <ContentCard
          title="An Introduction to Statistics"
          publisher="CRC Press"
          badge={<BadgeStub label="Subscription" />}
          onPress={() => {}}
        />
      </View>
    </ScrollView>
  );
}

const CARD_WIDTH = space.xl * 5;

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.md,
    gap: space.lg,
  },
  title: {
    fontWeight: type.pageTitle.weight,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
  },
  strip: {
    gap: space.md,
    paddingVertical: space.xs,
  },
  cardWidth: {
    width: CARD_WIDTH,
  },
  stack: {
    gap: space.sm,
  },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  badgeDot: {
    width: space.sm,
    height: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.success,
  },
  badgeLabel: {
    fontWeight: type.smallLabel.weight,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.success,
  },
});
