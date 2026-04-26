// App.tsx

import { useEffect, useRef, useState } from 'react';
import Onboarding from './Onboarding';
import HomeScreen from './HomeScreen';
import './App.css';

function loadMnemonic(): string | null {
  return localStorage.getItem('shardsafe.mnemonic');
}

function App() {
  const [mnemonic, setMnemonic]   = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [error, setError]           = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  // ── 1. Read localStorage on mount ─────────────────────────────────────────
  useEffect(() => {
    setMnemonic(loadMnemonic() ?? '');
  }, []);

  // ── 2. Once we have a mnemonic, open WebSocket and register ───────────────
  // This runs both after onboarding AND on startup when key already exists.
  useEffect(() => {
    if (!mnemonic) return; // empty string or null — skip

    const ws = new WebSocket('ws://localhost:8080');
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket open — registering...');

      // Send the register action with the mnemonic
      // The server calls registrarUsuario(mnemonic) and replies ok
      ws.send(JSON.stringify({
        id:      'register',        // fixed id — this is the only call before HomeScreen takes over
        action:  'register',
        payload: { mnemonic },
      }));
    };

    ws.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.id === 'register') {
        if (msg.ok) {
          console.log('Registered:', msg.result?.message);
          setRegistered(true);
        } else {
          setError(msg.error ?? 'Registration failed');
        }
      }

      // All other messages after this are handled by HomeScreen / useP2P
    };

    ws.onerror = () => setError('Could not connect to server — is it running?');
    ws.onclose = () => {
      if (!registered) setError('Server disconnected before registration completed');
    };

    // Cleanup if mnemonic changes (shouldn't happen but be safe)
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [mnemonic]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Still reading localStorage ─────────────────────────────────────────────
  if (mnemonic === null) {
    return <div style={{ background: '#0a0a0a', height: '100vh' }} />;
  }

  // ── No mnemonic → show onboarding ─────────────────────────────────────────
  if (mnemonic === '') {
    return (
      <Onboarding
        onComplete={(m) => {
          // Onboarding already saved to localStorage
          setMnemonic(m); // triggers the useEffect above
        }}
      />
    );
  }

  // ── Server error ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{
        background: '#0a0a0a', height: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 16, color: '#c0392b', fontFamily: 'monospace', fontSize: 13,
      }}>
        <span>⚠ {error}</span>
        <button
          onClick={() => { setError(''); setRegistered(false); setMnemonic(m => m); }}
          style={{ background: '#1a1a1a', border: '1px solid #333', color: '#fff',
                   padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Waiting for register reply ─────────────────────────────────────────────
  if (!registered) {
    return (
      <div style={{
        background: '#0a0a0a', height: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#333', fontFamily: 'monospace', fontSize: 13,
      }}>
        Connecting to P2P network...
      </div>
    );
  }

  // ── All good — show main app, pass the shared ws down ─────────────────────
  // HomeScreen / useP2P will reuse this same WebSocket connection
  return <HomeScreen mnemonic={mnemonic} ws={wsRef.current!} />;
}

export default App;