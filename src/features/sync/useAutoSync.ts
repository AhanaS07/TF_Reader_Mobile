import { AppState, type AppStateStatus } from 'react-native';
import { useEffect, useRef } from 'react';

import { syncEngine } from './syncEngine';
import { useConnectivity } from './useConnectivity';

/**
 * Fires `syncEngine.run()` on two events:
 *   1. The moment the device has a route again - covers both "was offline, Wi-Fi/data came back"
 *      and "app opened already connected", without ever calling it while offline.
 *   2. The app transitions from background to foreground - covers backgrounding without a
 *      connection drop, so a book left open on this device while another device wrote to it
 *      will sync and detect cross-device changes.
 *
 * `run()` itself does the push half and the pull half in one call (see syncEngine.ts), so one
 * trigger here drives both directions.
 *
 * Edge-triggered on the offline -> online transition and background -> foreground transition,
 * not level-triggered, so staying online or staying in foreground does not re-run on every
 * unrelated re-render - `useConnectivity` only changes value on an actual NetInfo event, and
 * AppState only fires on actual state changes.
 */
export function useAutoSync(): void {
  const online = useConnectivity();
  const wasOnline = useRef(false);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    // Trigger on connectivity change
    if (online && !wasOnline.current) {
      syncEngine.run()?.catch(() => {
        // Transient failures are expected; log and continue
      });
    }
    wasOnline.current = online;
  }, [online]);

  useEffect(() => {
    // Trigger on app foreground
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (appState.current !== 'active' && nextAppState === 'active') {
        syncEngine.run()?.catch(() => {
          // Transient failures are expected; log and continue
        });
      }
      appState.current = nextAppState;
    });

    return () => subscription.remove();
  }, []);
}
