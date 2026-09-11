// Gallery entry — every state of OfflineBanner from hardcoded props.
// Each demo box is position: relative so the absolute banner pins to the box
// rather than the scroll view, and carries content to show it is not displaced.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '@theme/tokens';

import OfflineBanner from './OfflineBanner';

export default function OfflineBannerGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>OfflineBanner</Text>

      <Text style={styles.label}>visible — default message, overlays without displacing</Text>
      <View style={styles.demo}>
        <Text style={styles.demoLine}>Institution list stays usable behind the banner.</Text>
        <Text style={styles.demoLine}>Second row, still readable and still tappable.</Text>
        <OfflineBanner visible />
      </View>

      <Text style={styles.label}>visible — custom message</Text>
      <View style={styles.demo}>
        <Text style={styles.demoLine}>Downloaded titles remain available.</Text>
        <Text style={styles.demoLine}>Second row.</Text>
        <OfflineBanner visible message="No connection — showing saved titles" />
      </View>

      <Text style={styles.label}>visible — long message wraps rather than clipping</Text>
      <View style={styles.demo}>
        <Text style={styles.demoLine}>Content behind a two-line banner.</Text>
        <Text style={styles.demoLine}>Second row.</Text>
        <OfflineBanner
          visible
          message="You appear to be offline. Your library and institution list keep working, and anything already downloaded stays available."
        />
      </View>

      <Text style={styles.label}>visible — with a top inset, as under a notch</Text>
      <View style={styles.demo}>
        <Text style={styles.demoLine}>Inset pushes the copy clear of the status bar.</Text>
        <Text style={styles.demoLine}>Second row.</Text>
        <OfflineBanner visible topInset={space.lg} />
      </View>

      <Text style={styles.label}>hidden — renders nothing, content sits at the top</Text>
      <View style={styles.demo}>
        <Text style={styles.demoLine}>No banner above this line.</Text>
        <Text style={styles.demoLine}>Second row.</Text>
        <OfflineBanner visible={false} />
      </View>

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.white },
  content: { paddingBottom: space.xl },
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
  demo: {
    position: 'relative',
    marginHorizontal: space.md,
    padding: space.xl,
    gap: space.sm,
    backgroundColor: color.white,
    borderWidth: 1,
    borderColor: color.border,
  },
  demoLine: {
    fontWeight: type.body.weight,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
  },
  spacer: { height: space.xl },
});
