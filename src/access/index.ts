// src/access/index.ts
// The access spine's public surface. Screens import from here rather than
// reaching into the file.
//
// ONE EXPORT THAT MATTERS, and that is the design rather than an early state of
// it. `resolveAccess` is the only way to obtain an `AccessResult`, so there is no
// second path to a set of buttons and no helper a screen could assemble one from.
// The two types beside it exist so a caller can name its own inputs; neither is a
// way in.
//
// WHAT IS DELIBERATELY NOT HERE: nothing that performs an action. Deciding which
// button to draw and carrying out what the button does are separate jobs — the
// four flambeau calls (borrow, open a reading session, return, place a hold) are
// keyed by `LicenceRef` and live behind the screens. If a caller could reach a
// borrow through this barrel, the resolve would stop being pure and a list of
// forty cards would stop being free.
export {
  resolveAccess,
  type ResolvableItem,
  type ResolveAccessInput,
} from './resolveAccess';
