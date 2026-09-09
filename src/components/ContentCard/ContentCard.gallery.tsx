// Gallery entry — every state of ContentCard from hardcoded props.
// No providers, no navigation, no stores. Pure rendering only.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import ContentCard from './ContentCard';
import { AccessTierBadge } from '@components/AccessTierBadge';
import { color, space, type } from '@theme/tokens';

export default function ContentCardGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>ContentCard</Text>

      <Text style={styles.label}>default — title, publisher, image, badge, pressable</Text>
      <View style={styles.row}>
        <ContentCard
          title="Environmental Policy in Contemporary China"
          publisher="Routledge"
          imageUrl="https://picsum.photos/200"
          badge={<AccessTierBadge tier="OPEN_ACCESS" size="sm" />}
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>with file format — all four A3 fields at once</Text>
      <View style={styles.row}>
        <ContentCard
          title="Rights for Robots"
          publisher="Routledge"
          imageUrl="https://picsum.photos/204"
          format="PDF"
          badge={<AccessTierBadge tier="SUBSCRIPTION" size="sm" />}
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>AUDIO format, no cover</Text>
      <View style={styles.row}>
        <ContentCard
          title="Jazz Perspectives"
          publisher="Taylor &amp; Francis"
          format="AUDIO"
          badge={<AccessTierBadge tier="ELITE" size="sm" />}
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>no format — a subscribe title, which has no file</Text>
      <View style={styles.row}>
        <ContentCard
          title="Listening to Cities"
          publisher="Routledge"
          imageUrl="https://picsum.photos/205"
          badge={<AccessTierBadge tier="ELITE" size="sm" />}
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>no imageUrl — placeholder well</Text>
      <View style={styles.row}>
        <ContentCard
          title="Introduction to Sociology"
          publisher="Routledge"
          badge={<AccessTierBadge tier="SUBSCRIPTION" size="sm" />}
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>no publisher</Text>
      <View style={styles.row}>
        <ContentCard
          title="Advanced Materials Science"
          imageUrl="https://picsum.photos/201"
          badge={<AccessTierBadge tier="ELITE" size="sm" />}
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>no badge</Text>
      <View style={styles.row}>
        <ContentCard
          title="Modern Political Thought"
          publisher="Routledge"
          imageUrl="https://picsum.photos/202"
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>no onPress — not a button, no chevron</Text>
      <View style={styles.row}>
        <ContentCard
          title="Journal of Applied Ethics"
          publisher="Taylor & Francis"
          imageUrl="https://picsum.photos/203"
          badge={<AccessTierBadge tier="OPEN_ACCESS" size="sm" />}
        />
      </View>

      <Text style={styles.label}>{`state="loading" — skeleton, not pressable even with onPress`}</Text>
      <View style={styles.row}>
        <ContentCard title="" state="loading" onPress={() => {}} />
      </View>

      <Text style={styles.label}>long title — wraps to two lines, chevron holds position</Text>
      <View style={styles.row}>
        <ContentCard
          title="Environmental Policy, Air Pollution and Sustainable Development in Contemporary China"
          publisher="Routledge"
          imageUrl="https://picsum.photos/204"
          badge={<AccessTierBadge tier="SUBSCRIPTION" size="sm" />}
          onPress={() => {}}
        />
      </View>

      <Text style={styles.heading}>{'variant="cover" — CatalogueScreen\'s first-shelf carousel tile'}</Text>

      <Text style={styles.label}>cover, with image and badge</Text>
      <View style={styles.coverBox}>
        <ContentCard
          variant="cover"
          title="Rights for Robots"
          publisher="Routledge"
          imageUrl="https://picsum.photos/206"
          badge={<AccessTierBadge tier="OPEN_ACCESS" size="sm" />}
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>cover, no imageUrl — placeholder well</Text>
      <View style={styles.coverBox}>
        <ContentCard
          variant="cover"
          title="Introduction to Sociology"
          publisher="Routledge"
          badge={<AccessTierBadge tier="SUBSCRIPTION" size="sm" />}
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>cover, no badge, no publisher</Text>
      <View style={styles.coverBox}>
        <ContentCard
          variant="cover"
          title="Advanced Materials Science"
          imageUrl="https://picsum.photos/207"
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>{'cover, state="loading"'}</Text>
      <View style={styles.coverBox}>
        <ContentCard variant="cover" title="" state="loading" onPress={() => {}} />
      </View>

      <Text style={styles.label}>cover, long title — clamps to two lines</Text>
      <View style={styles.coverBox}>
        <ContentCard
          variant="cover"
          title="Environmental Policy, Air Pollution and Sustainable Development in Contemporary China"
          publisher="Routledge"
          imageUrl="https://picsum.photos/208"
          badge={<AccessTierBadge tier="ELITE" size="sm" />}
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>{"the real carousel — CatalogueScreen's first shelf, horizontal"}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.carousel}>
        <View style={styles.carouselCard}>
          <ContentCard
            variant="cover"
            title="Rights for Robots"
            publisher="Routledge"
            imageUrl="https://picsum.photos/206"
            badge={<AccessTierBadge tier="OPEN_ACCESS" size="sm" />}
            onPress={() => {}}
          />
        </View>
        <View style={styles.carouselCard}>
          <ContentCard
            variant="cover"
            title="Introduction to Sociology"
            publisher="Routledge"
            badge={<AccessTierBadge tier="SUBSCRIPTION" size="sm" />}
            onPress={() => {}}
          />
        </View>
      </ScrollView>

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const COVER_WIDTH = space.xl * 4;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.white },
  content: { paddingBottom: space.xl },
  // Mirrors CatalogueScreen: the caller owns each tile's width, not ContentCard
  // itself (CONVENTIONS §8).
  coverBox: { width: COVER_WIDTH, marginHorizontal: space.md },
  carousel: { marginHorizontal: space.md },
  carouselCard: { width: COVER_WIDTH, marginRight: space.md },
  heading: {
    fontWeight: type.pageTitle.weight,
    fontFamily: type.pageTitle.fontFamily,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    margin: space.md,
  },
  label: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginHorizontal: space.md,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  row: { marginHorizontal: space.md },
  spacer: { height: space.xl },
});
