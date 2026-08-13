// jest.assetStub.js — stands in for binary assets Jest cannot parse.
//
// Mapped from `.epub` by the `moduleNameMapper` entry in package.json → jest.
//
// WHY THIS EXISTS: Metro classifies `.epub` as an asset (see metro.config.js),
// so `require('....epub')` in readerAssets.ts returns an asset handle at runtime.
// Jest has no Metro. jest-expo's preset transforms the asset extensions Metro
// ships by DEFAULT — the same list metro.config.js had to extend — so `.epub` is
// missing there for exactly the same reason, and Jest tries to parse the zip as
// JavaScript. That fails at import time with `SyntaxError: Invalid or unexpected
// token` on the file's "PK" magic bytes, which reads like a corrupt file rather
// than a missing mapping.
//
// `.html` needs no entry: it IS in Metro's default list, so jest-expo already
// transforms it.
//
// A number, because that is what a Metro asset handle is — keeping the stub the
// same shape as the real thing means readerAssets.ts's `as number` cast is not
// lying under test.
module.exports = 1;
