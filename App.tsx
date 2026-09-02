// App.tsx — Expo entry component.
// Grows to exactly this shape and nothing more (per the original comment).
// NavigationContainer + SafeAreaProvider are the two required wrappers.
//
// Fonts load here, once, before anything renders. Nothing downstream ever
// touches expo-font directly — by the time RootNavigator mounts, every
// fontFamily name in tokens.ts is guaranteed to be registered.
import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { OpenSans_300Light, OpenSans_400Regular, OpenSans_700Bold } from '@expo-google-fonts/open-sans';
import { Aleo_300Light, Aleo_400Regular, Aleo_700Bold } from '@expo-google-fonts/aleo';
import { NotoSans_300Light, NotoSans_400Regular, NotoSans_700Bold } from '@expo-google-fonts/noto-sans';
import RootNavigator from './src/navigation/RootNavigator';
import { bootstrapAuth } from './src/auth/tokenRefresh';

SplashScreen.preventAutoHideAsync();

export default function App() {
  const [fontsLoaded] = useFonts({
    OpenSans_300Light,
    OpenSans_400Regular,
    OpenSans_700Bold,
    Aleo_300Light,
    Aleo_400Regular,
    Aleo_700Bold,
    NotoSans_300Light,
    NotoSans_400Regular,
    NotoSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // Fire-and-forget: bootstrapAuth flips sessionStore._authReady itself, on
  // both success and failure, which is what RootNavigator actually gates on.
  useEffect(() => {
    bootstrapAuth();
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
