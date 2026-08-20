// src/licence/index.ts
// The licence layer's public surface. Screens import from here, never from a client.
//
// WHAT IS DELIBERATELY NOT HERE: `MockLicenceClient.promoteHold`. It is reachable only
// by importing the class directly, which the gallery does and the app must not. A fake
// promotion is the demo's lever, and a screen that could pull it would be a screen that
// stops working the moment the real client is switched in.
export {
  LicenceError,
  LicenceFailure,
  isLicenceFailure,
  type Library,
  type LicenceSource,
} from './LicenceSource';

export { normalizeHold, normalizeLibrary, normalizeLoan } from './normalizeLicence';

export { ApiLicenceClient, type ApiLicenceClientOptions } from './ApiLicenceClient';
export { MockLicenceClient, type MockLicenceOptions } from './MockLicenceClient';
