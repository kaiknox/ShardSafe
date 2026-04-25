// app/_layout.tsx
//
// IMPORTANT: react-native-get-random-values MUST be the very first import.
// It polyfills crypto.getRandomValues for Hermes (the JS engine Expo uses).
import 'react-native-get-random-values';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { hasIdentity } from '@/lib/identityEngine';
import OnboardingScreen from './onboarding';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();

  // null = still checking, true = has identity, false = needs onboarding
  const [identityStatus, setIdentityStatus] = useState<boolean | null>(null);

  useEffect(() => {
    hasIdentity()
      .then(setIdentityStatus)
      .catch(() => setIdentityStatus(false)); // if check fails, show onboarding
  }, []);

  // ── Still checking secure store ───────────────────────────────────────────
  if (identityStatus === null) {
    return (
      <View style={{ flex: 1, backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#ffffff" />
      </View>
    );
  }

  // ── No identity found → show onboarding ──────────────────────────────────
  if (identityStatus === false) {
    return (
      <>
        <StatusBar style="light" />
        <OnboardingScreen
          onComplete={() => {
            // Identity is now saved — switch to the main app
            setIdentityStatus(true);
          }}
        />
      </>
    );
  }

  Alert.alert('Identity status', identityStatus.toString());
  // ── Identity exists → normal app ─────────────────────────────────────────
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}