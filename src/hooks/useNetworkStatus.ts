// src/hooks/useNetworkStatus.ts
// Tells a screen whether the device is online right now.
// This is the only file that talks to NetInfo directly — everything else just
// gets a boolean, same as it would get any other prop.
import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export function useNetworkStatus() {
  // Start assuming online, so nothing flashes an offline state before the
  // first real reading comes in.
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected === true);
    });

    // NetInfo hands back its own unsubscribe function — just return it.
    return unsubscribe;
  }, []);

  return isOnline;
}
