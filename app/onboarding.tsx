// components/onboarding-screen.tsx

import Button from '@/components/ui/button';
import {
  deriveIdentityFromMnemonic,
  generateMnemonic,
  saveIdentity,
  validateMnemonic,
} from '@/lib/identityEngine';
import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const { width, height } = Dimensions.get('window');

type ScreenName = 'welcome' | 'create' | 'confirm-key' | 'restore';

interface ScreenState {
  name: ScreenName;
  data?: { mnemonic?: string };
}

// ─── Sliding Navigator ────────────────────────────────────────────────────────
function useSlideNav(initial: ScreenName) {
  const [stack, setStack] = useState<ScreenState[]>([{ name: initial }]);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const push = useCallback(
    (name: ScreenName, data?: ScreenState['data']) => {
      slideAnim.setValue(width);
      setStack(prev => [...prev, { name, data }]);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 68,
        friction: 12,
      }).start();
    },
    [slideAnim],
  );

  const pop = useCallback(() => {
    if (stack.length <= 1) return;
    Animated.timing(slideAnim, {
      toValue: width,
      duration: 280,
      useNativeDriver: true,
    }).start(() => {
      slideAnim.setValue(0);
      setStack(prev => prev.slice(0, -1));
    });
  }, [stack.length, slideAnim]);

  const current = stack[stack.length - 1];
  const canGoBack = stack.length > 1;

  return { current, push, pop, canGoBack, slideAnim };
}

// ─── Back Button ──────────────────────────────────────────────────────────────
function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.backBtn}
      onPress={onPress}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
    >
      <Text style={styles.backBtnText}>←</Text>
    </TouchableOpacity>
  );
}

// ─── 1. Welcome ───────────────────────────────────────────────────────────────
function WelcomeScreen({ push }: { push: (s: ScreenName) => void }) {
  return (
    <View style={styles.screen}>
      <View style={styles.orb} />
      <View style={styles.content}>
        <Text style={styles.welcomeTitle}>Welcome{'\n'}to X</Text>
        <View style={styles.btnStack}>
          <Button type="primary" label="Create account" onPress={() => push('create')} />
          <Button type="secondary" label="Restore account" onPress={() => push('restore')} />
        </View>
      </View>
    </View>
  );
}

// ─── 2. Create — generate and display mnemonic ────────────────────────────────
function CreateScreen({
  push,
}: {
  push: (s: ScreenName, data?: ScreenState['data']) => void;
}) {
  // useRef so mnemonic doesn't regenerate on re-renders
  const mnemonic = useRef(generateMnemonic()).current;

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.screenTitle}>Your secret key</Text>
        <Text style={styles.subtitle}>
          This key is your identity. Write it down — we cannot recover it for you.
        </Text>

        <View style={styles.mnemonicBox}>
          <Text style={styles.mnemonicText}>{mnemonic}</Text>
        </View>

        <Text style={styles.warning}>
          ⚠️  You must NOT lose this key. You will not be able to recover your data.
        </Text>

        <View style={{ marginTop: 32, width: '100%' }}>
          <Button
            type="primary"
            label="I've written it down"
            onPress={() => push('confirm-key', { mnemonic })}
          />
        </View>
      </View>
    </View>
  );
}

// ─── 3. Confirm key ───────────────────────────────────────────────────────────
function ConfirmKeyScreen({
  mnemonic,
  onSuccess,
}: {
  mnemonic: string;
  onSuccess: () => void;
}) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shake, { toValue: 10,  duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 6,   duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0,   duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const confirm = async () => {
    if (loading) return;

    const inputNormalised = input.trim().toLowerCase();
    const mnemonicNormalised = mnemonic.trim().toLowerCase();

    if (inputNormalised !== mnemonicNormalised) {
      triggerShake();
      Alert.alert('Key mismatch', 'The key you entered does not match. Please try again.');
      return;
    }

    try {
      setLoading(true);
      const identity = await deriveIdentityFromMnemonic(mnemonic);
      await saveIdentity(identity);
      Alert.alert('Success', 'Your account has been created successfully!');
      Alert.alert('Success', identity.privateKey.toString());
      onSuccess();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.screenTitle}>Confirm your{'\n'}secret key</Text>
        <Text style={styles.subtitle}>Type your key to confirm you saved it correctly.</Text>

        <Animated.View style={{ width: '100%', transform: [{ translateX: shake }] }}>
          <TextInput
            style={styles.input}
            placeholder="Enter secret key"
            placeholderTextColor="#555"
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            value={input}
            onChangeText={setInput}
            editable={!loading}
          />
        </Animated.View>

        <View style={{ marginTop: 24, width: '100%' }}>
          <Button
            type="primary"
            label={loading ? 'Saving...' : 'Confirm'}
            onPress={confirm}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── 4. Restore ───────────────────────────────────────────────────────────────
function RestoreScreen({ onSuccess }: { onSuccess: () => void }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const restore = async () => {
    if (loading) return;

    const normalised = input.trim().toLowerCase();

    // Quick word count check before hitting the crypto
    if (normalised.split(/\s+/).length < 12) {
      Alert.alert('Invalid key', 'Please enter your full 12-word secret key.');
      return;
    }

    // Validate BIP-39 wordlist
    if (!validateMnemonic(normalised)) {
      Alert.alert(
        'Invalid key',
        'One or more words are not valid. Check your key and try again.',
      );
      return;
    }

    try {
      setLoading(true);
      const identity = await deriveIdentityFromMnemonic(normalised);
      await saveIdentity(identity);
      onSuccess();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.screenTitle}>Welcome{'\n'}back</Text>
        <Text style={styles.subtitle}>Enter your 12-word secret key to restore your account.</Text>

        <TextInput
          style={[styles.input, { marginTop: 32 }]}
          placeholder="Enter secret key"
          placeholderTextColor="#555"
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          value={input}
          onChangeText={setInput}
          editable={!loading}
        />

        <View style={{ marginTop: 24, width: '100%' }}>
          <Button
            type="primary"
            label={loading ? 'Restoring...' : 'Restore account'}
            onPress={restore}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const { current, push, pop, canGoBack, slideAnim } = useSlideNav('welcome');

  const renderScreen = () => {
    switch (current.name) {
      case 'welcome':
        return <WelcomeScreen push={push} />;
      case 'create':
        return <CreateScreen push={push} />;
      case 'confirm-key':
        return (
          <ConfirmKeyScreen
            mnemonic={current.data?.mnemonic ?? ''}
            onSuccess={onComplete}
          />
        );
      case 'restore':
        return <RestoreScreen onSuccess={onComplete} />;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#111111' }}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { transform: [{ translateX: slideAnim }] }]}
      >
        {renderScreen()}
      </Animated.View>

      {canGoBack && <BackButton onPress={pop} />}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  orb: {
    position: 'absolute',
    width: width * 1.1,
    height: width * 1.1,
    borderRadius: width,
    backgroundColor: 'transparent',
    borderWidth: 80,
    borderColor: '#1a3a1a',
    top: height * 0.12,
    alignSelf: 'center',
    opacity: 0.7,
  },
  content: {
    width: '100%',
    paddingHorizontal: 28,
    paddingBottom: 52,
    alignItems: 'flex-start',
  },
  welcomeTitle: {
    fontSize: 48,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: -1.5,
    marginBottom: 48,
    lineHeight: 54,
  },
  screenTitle: {
    fontSize: 36,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: -1,
    marginBottom: 12,
    lineHeight: 42,
  },
  subtitle: {
    fontSize: 14,
    color: '#888888',
    lineHeight: 20,
    marginBottom: 8,
  },
  btnStack: {
    width: '100%',
    gap: 12,
  },
  mnemonicBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 20,
    marginTop: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  mnemonicText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 30,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  warning: {
    marginTop: 16,
    color: '#888888',
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    width: '100%',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#ffffff',
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
    marginTop: 24,
  },
  backBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 24,
    left: 24,
    zIndex: 100,
  },
  backBtnText: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '300',
  },
});