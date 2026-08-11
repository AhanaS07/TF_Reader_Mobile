// babel.config.js
// Makes the `@/` alias resolve AT RUNTIME, matching the tsconfig `paths` entry.
// Without this, `@/shared/contracts` typechecks but the app throws
// "Unable to resolve module" when it actually runs.
//
// Preset is `babel-preset-expo`, NOT `module:@react-native/babel-preset` — this
// is an Expo app (see package.json: `expo start`, main = expo/AppEntry.js).
// babel-preset-expo ships with the `expo` package.
//
// THIS MAP MUST MIRROR tsconfig.json `paths` EXACTLY. tsconfig is the source of
// alias truth for type-time; this is the runtime half. Add an alias in one place
// and not the other and you get the classic split failure: it typechecks fine in
// the editor, then throws "Unable to resolve module" at runtime (or vice versa).
// jsconfig.json used to hold these; it was deleted so there is only one source.
module.exports = function (api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./src'],
          alias: {
            '@': './src',
            '@theme': './src/theme',
            '@model': './src/model',
            '@adapters': './src/adapters',
            '@access': './src/access',
            '@components': './src/components',
            '@screens': './src/screens',
            '@search': './src/search',
            '@store': './src/store',
            '@storage': './src/storage',
            '@hooks': './src/hooks',
            '@navigation': './src/navigation',
            '@config': './src/config',
            '@utils': './src/utils',
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
    ],
  };
};
