// src/hooks/useNetworkStatus.ts
// Tells a screen whether the device is online right now.
// This is the only file that talks to NetInfo directly — everything else just
// gets a boolean, same as it would get any other prop.
import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export function useNetworkStatus() {
  // Start closed (false) so the sign-in guard never passes before we have a
  // real reading. NetInfo.fetch() resolves immediately from the OS cache on
  // both platforms, so the window is sub-100 ms on a connected device.
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    NetInfo.fetch().then((s) => setIsOnline(s.isConnected === true));
    const unsubscribe = NetInfo.addEventListener((s) => {
      setIsOnline(s.isConnected === true);
    });
    return unsubscribe;
  }, []);

  return isOnline;
}
