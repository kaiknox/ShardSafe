// App.tsx

import { useEffect, useState } from 'react';
import Onboarding from './Onboarding';
import heroImg from './assets/hero.png';
import './App.css';
import HomeScreen from './HomeScreen';

// ─── Load mnemonic from localStorage ─────────────────────────────────────────
function loadMnemonic(): string | null {
  return localStorage.getItem('shardsafe.mnemonic');
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [mnemonic, setMnemonic] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadMnemonic();
    setMnemonic(stored ?? '');
  }, []);

  // ── Still checking ──────────────────────────────────────────────────────────
  if (mnemonic === null) {
    return <div style={{ background: '#0a0a0a', height: '100vh' }} />;
  }

  // ── No mnemonic → onboarding ────────────────────────────────────────────────
  if (mnemonic === '') {
    return (
      <Onboarding
        onComplete={(m) => setMnemonic(m)}
      />
    );
  }

  // ── Main app ────────────────────────────────────────────────────────────────
  return (
        <HomeScreen mnemonic={mnemonic} />
  );
}

export default App;