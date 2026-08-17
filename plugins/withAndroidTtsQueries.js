const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Android 11+ package visibility: an app cannot see other packages unless it
 * declares intent to. Without a TTS_SERVICE <queries> entry, engine and voice
 * enumeration come back empty and it looks like @iternio/react-native-tts is
 * broken rather than the manifest being incomplete.
 *
 * This has to be a config plugin rather than a hand edit, because
 * `expo prebuild` regenerates AndroidManifest.xml and silently reverts
 * anything typed into it directly (see the .gitignore note on android/ and ios/).
 */
module.exports = function withAndroidTtsQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    manifest.queries = manifest.queries || [];
    const alreadyDeclared = manifest.queries.some((q) =>
      (q.intent || []).some((i) =>
        (i.action || []).some(
          (a) => a.$['android:name'] === 'android.intent.action.TTS_SERVICE',
        ),
      ),
    );

    if (!alreadyDeclared) {
      manifest.queries.push({
        intent: [
          {
            action: [{ $: { 'android:name': 'android.intent.action.TTS_SERVICE' } }],
          },
        ],
      });
    }

    return cfg;
  });
};
