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
// The inline colours below are the ONE exception to the no-raw-values rule and
// exist only until src/theme/ lands (P0). Replace them with tokens then.
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function App() {
  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <Text style={styles.title}>TF Reader</Text>
        <Text style={styles.subtitle}>Toolchain up. Screens land with the CAP work.</Text>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    padding: 24,
  },
  title: { fontSize: 24, fontWeight: '600', color: '#111111' },
  subtitle: { marginTop: 8, fontSize: 14, color: '#555555', textAlign: 'center' },
});
