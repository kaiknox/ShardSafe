import { Image } from 'expo-image';
import { Alert, Platform, StyleSheet } from 'react-native';

import { HelloWave } from '@/components/hello-wave';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Link } from 'expo-router';

import Button from '@/components/ui/button';
import { exportPublicKey, loadIdentity } from '@/lib/identityEngine';
import { initP2P, listFiles, uploadFile } from '@/lib/p2pEngine';
import { useEffect, useState } from 'react';

export default function HomeScreen() {
  const [identity, setIdentity] = useState<null | any>(null);

  useEffect(() => {
    loadIdentity().then(setIdentity);
  }, []);


/*
// Reload any friends who were granted access previously
await reloadWriters()


// Add a friend as a writer
// Friend sends you their writer key (from their myCore.key)
await addWriter('d4e82f...', exportPublicKey(identity.publicKey))

*/

  if (!identity) {
    return (
      <ThemedView style={{ flex: 1, backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' }}>
      </ThemedView>
    );
  }
  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }>
      <Button label="Test identity" onPress={() => Alert.alert('P2P Identity', JSON.stringify(identity))} />
      <Button label="Init P2P" onPress={async () => {
        Alert.alert('P2P initialized', JSON.stringify(identity));
          // On app startup
        const { base, view, myCore } = await initP2P(identity)
        }
      } />
      <Button label="Upload file" onPress={async () => {
        Alert.alert('P2P file uploaded', JSON.stringify(identity));
          // Upload a file
          const encryptedPayload = 'Hello world'  // read file as base64
          //const { encryptedPayload, shards } = encryptAndShard(fileBase64, 5, 3)

          await uploadFile(
            '/photos/cat.jpg',
            encryptedPayload,
            exportPublicKey(identity.publicKey),
            0
          )
        }
      } />
          <Button label="List files" onPress={async () => {
            Alert.alert('P2P files listed', JSON.stringify(identity));
            // List files (works on all devices, shows merged result)
            const files = await listFiles()
            console.log(files)
            // → [{ path: '/photos/cat.jpg', author: '9d4e2f...', ... }]
        }
      } />
        
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Welcome!</ThemedText>
        <HelloWave />
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Step 1: Try it</ThemedText>
        <ThemedText>
          Edit <ThemedText type="defaultSemiBold">app/(tabs)/index.tsx</ThemedText> to see changes.
          Press{' '}
          <ThemedText type="defaultSemiBold">
            {Platform.select({
              ios: 'cmd + d',
              android: 'cmd + m',
              web: 'F12',
            })}
          </ThemedText>{' '}
          to open developer tools.
        </ThemedText>
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <Link href="/modal">
          <Link.Trigger>
            <ThemedText type="subtitle">Step 2: Explore</ThemedText>
          </Link.Trigger>
          <Link.Preview />
          <Link.Menu>
            <Link.MenuAction title="Action" icon="cube" onPress={() => alert('Action pressed')} />
            <Link.MenuAction
              title="Share"
              icon="square.and.arrow.up"
              onPress={() => alert('Share pressed')}
            />
            <Link.Menu title="More" icon="ellipsis">
              <Link.MenuAction
                title="Delete"
                icon="trash"
                destructive
                onPress={() => alert('Delete pressed')}
              />
            </Link.Menu>
          </Link.Menu>
        </Link>

        <ThemedText>
          {`Tap the Explore tab to learn more about what's included in this starter app.`}
        </ThemedText>
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Step 3: Get a fresh start</ThemedText>
        <ThemedText>
          {`When you're ready, run `}
          <ThemedText type="defaultSemiBold">npm run reset-project</ThemedText> to get a fresh{' '}
          <ThemedText type="defaultSemiBold">app</ThemedText> directory. This will move the current{' '}
          <ThemedText type="defaultSemiBold">app</ThemedText> to{' '}
          <ThemedText type="defaultSemiBold">app-example</ThemedText>.
        </ThemedText>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
});
