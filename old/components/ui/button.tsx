import React, { useRef } from 'react';
import {
    Animated,
    StyleSheet,
    Text,
    TouchableOpacity
} from 'react-native';


type ButtonProps = {
  type?: 'primary' | 'secondary';
  label: string;
  onPress: () => void;
};

export default function Button({ type = 'primary', label, onPress }: ButtonProps) {
  if (type === 'primary') {
    return (
      <PrimaryButton label={label} onPress={onPress}></PrimaryButton>
    );
  }
  else {
    return (
      <SecondaryButton label={label} onPress={onPress}></SecondaryButton>
    );
  }
}

// ─── Shared button ────────────────────────────────────────────────────────────
function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const press = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1,    duration: 80, useNativeDriver: true }),
    ]).start(onPress);
  };
  return (
    <Animated.View style={{ transform: [{ scale }], width: '100%' }}>
      <TouchableOpacity style={styles.primaryBtn} onPress={press} activeOpacity={0.9}>
        <Text style={styles.primaryBtnText}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.secondaryBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  primaryBtn: {
    backgroundColor: '#ffffff',
    borderRadius: 50,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
  },
  primaryBtnText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  secondaryBtn: {
    backgroundColor: '#222222',
    borderRadius: 50,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
  },
  secondaryBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.3,
  }
});