import { useEffect, useRef } from 'react';

import { syncEngine } from './syncEngine';
import { useConnectivity } from './useConnectivity';

/**
 * Fires `syncEngine.run()` the moment the device has a route again - covers
 * both "was offline, Wi-Fi/data came back" and "app opened already connected",
 * without ever calling it while offline, where it can only fail fast against
 * no route. `run()` itself does the push half and the pull half in one call
 * (see syncEngine.ts), so one trigger here drives both directions.
 *
 * Edge-triggered on the offline -> online transition, not level-triggered on
 * "online", so staying online does not re-run on every unrelated re-render -
 * `useConnectivity` only changes value on an actual NetInfo event.
 */
export function useAutoSync(): void {
  const online = useConnectivity();
  const wasOnline = useRef(false);

  useEffect(() => {
    if (online && !wasOnline.current) {
      syncEngine.run();
    }
    wasOnline.current = online;
  }, [online]);
}
