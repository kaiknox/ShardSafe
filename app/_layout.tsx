import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-get-random-values';
import 'react-native-reanimated';


import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

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

/*
import { encryptAndShard, reconstructAndDecrypt } from '@/lib/cryptoEngine';

// Xifrar
const result = encryptAndShard(fileBase64, 5, 3);
// result.encryptedPayload → guardar al servidor / P2P
// result.shards           → distribuir als 5 participants

// Desxifrar (amb 3 o més shards)
const originalBase64 = reconstructAndDecrypt(
  result.encryptedPayload,
  [result.shards[0], result.shards[2], result.shards[4]]
);

*/