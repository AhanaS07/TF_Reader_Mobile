// src/auth/openSamlBrowser.ts
// Opens the SAML authorization URL in a system browser and waits for the
// redirect back into the app.
//
// SELF-CONTAINED, NO SEPARATE DEEP-LINK LISTENER NEEDED. openAuthSessionAsync
// is built for exactly this: it opens the browser, and resolves with the final
// URL once the browser is sent to something matching `REDIRECT_URL`. No
// NavigationContainer `linking` prop, no Linking.addEventListener.
import { openAuthSessionAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { color } from '@theme/tokens';

// Matches the deep link the contract documents the ACS redirecting to:
// tfreader://auth/callback?code=... — 'tfreader' is app.json's existing scheme.
const REDIRECT_URL = 'tfreader://auth/callback';

// Without these, the popup falls back to OS defaults: a plain white toolbar on
// Android and a full-screen cover on iOS. PAGE_SHEET makes the iOS popup slide
// up like a card, matching the bottom-sheet SignInScreen it was launched from,
// instead of cutting to a jarring full-screen browser.
const BROWSER_OPTIONS = {
  toolbarColor: color.navy,
  controlsColor: color.white,
  secondaryToolbarColor: color.navy,
  showTitle: false,
  enableBarCollapsing: false,
  presentationStyle: WebBrowserPresentationStyle.PAGE_SHEET,
  dismissButtonStyle: 'close' as const,
};

// Hand-parsed rather than via URLSearchParams — see FixtureSearchPipeline.ts's
// paramsOf for why: RN's polyfill is partial enough to behave differently
// under Jest and on a device.
function extractParam(url: string, name: string): string | null {
  const match = url.match(new RegExp(`[?&]${name}=([^&]+)`));
  return match === null ? null : decodeURIComponent(match[1]);
}

/** Opens the browser and returns the one-time code from the callback. */
export async function openSamlBrowser(authorizationUrl: string): Promise<string> {
  const result = await openAuthSessionAsync(authorizationUrl, REDIRECT_URL, BROWSER_OPTIONS);
  if (result.type !== 'success') {
    throw new Error(`SAML sign-in was ${result.type}`);
  }

  // The ACS reports its own failure this way — a rejected assertion, a
  // signature it didn't trust, an expired one. Surfaced by name rather than
  // as a generic "no code", because this is the IdP/relying-party handshake
  // itself refusing, not a shape our redirect parsing got wrong.
  const errorCode = extractParam(result.url, 'error');
  if (errorCode !== null) {
    throw new Error(`SAML sign-in was refused: ${errorCode}`);
  }

  const code = extractParam(result.url, 'code');
  if (code === null) {
    throw new Error(`SAML redirect carried no code: ${result.url}`);
  }
  return code;
}
