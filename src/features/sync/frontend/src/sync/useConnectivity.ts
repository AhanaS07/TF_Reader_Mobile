import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * Whether the device has a network attached. Nothing in the app blocks on this
 * - it drives the status badge and decides when to auto-sync.
 *
 * Deliberately `isConnected` and not `isInternetReachable`. The latter probes
 * the public internet, and the backend is on the LAN: on office Wi-Fi, behind a
 * captive portal, or on a laptop hotspot it reports false while the server is
 * perfectly reachable. Gating on it left auto-sync switched off permanently and
 * made the Sync button look like the only thing that worked.
 *
 * Being wrong in this direction is cheap. A sync with no route fails fast, the
 * outbox is untouched, and the next attempt picks it up.
 */
export function useConnectivity(): boolean {
  const [online, setOnline] = useState(false);

  useEffect(() => {
    const apply = (state: { isConnected: boolean | null }) =>
      setOnline(Boolean(state.isConnected));

    const unsubscribe = NetInfo.addEventListener(apply);
    NetInfo.fetch().then(apply);

    return unsubscribe;
  }, []);

  return online;
}
