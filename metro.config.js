// metro.config.js
// Exists for ONE reason: teach Metro that `.epub` is a bundle-able asset.
//
// Metro splits every extension into `sourceExts` (parsed as JS/TS modules) or
// `assetExts` (copied into the app bundle, `require()` returns a numeric asset
// handle you resolve with expo-asset). Expo's SDK 57 defaults already include
// `html`, `pdf` and `zip` — so `require('.../reader-epub.html')` and the bundled
// sample PDF both work with no config
// at all — but NOT `epub`. Without the line below, requiring the sample book
// fails with "Unable to resolve module ./sample-plaintext.epub".
//
// WHY NOT just rename the sample to `.zip` (which IS a default assetExt): an
// EPUB is a zip, so it would technically work, and it would also lie about what
// the file is to every human and tool that looks at it. One line of config is
// cheaper than that confusion.
//
// DELIBERATELY NOT ADDED: `js`. The reader's WebView payload (epub.js + JSZip)
// is INLINED into `assets/reader/reader-epub.html` by
// `src/features/reader/scripts/buildReaderHtml.ts`, precisely so we never need
// to ship a `.js` file as an asset. Moving `js` from sourceExts to assetExts
// would break the entire app bundle — don't.
//
// After editing this file, restart Metro with `--clear`. The resolver caches
// extension lists, so a plain restart can still report the old "unable to
// resolve" error and send you hunting for a bug that is already fixed.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('epub');

module.exports = config;
