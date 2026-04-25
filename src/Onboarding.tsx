// components/Onboarding.tsx
//
// Desktop onboarding flow. Stores the 12-word mnemonic in localStorage.
// No crypto derivation here — just store the raw mnemonic.
// The Node.js p2p process reads it separately when it needs keys.

import { useCallback, useEffect, useRef, useState } from 'react';

// ─── BIP-39 wordlist subset for mnemonic generation ──────────────────────────
// In production replace this with the full `bip39` npm package:
//   npm install bip39
//   import { generateMnemonic } from 'bip39'
//
// For now we use a small inline generator that produces valid-looking mnemonics.
const WORDS = [
  'witch','collapse','practice','feed','shame','open','despair','creek',
  'road','again','ice','least','able','about','above','absent','absorb',
  'abstract','absurd','abuse','access','accident','account','accuse','achieve',
  'acid','acoustic','acquire','across','act','action','actor','actress','actual',
  'adapt','add','addict','address','adjust','admit','adult','advance','advice',
  'aerobic','afford','afraid','again','agent','agree','ahead','aim','air',
  'airport','aisle','alarm','album','alcohol','alert','alien','alley','allow',
  'almost','alone','alpha','already','also','alter','always','amateur','amazing',
  'among','amount','amused','analyst','anchor','ancient','anger','angle','angry',
  'animal','ankle','announce','annual','another','answer','antenna','antique',
  'anxiety','apart','apology','appear','apple','approve','april','arch','arctic',
];

function generateMnemonic(): string {
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map(n => WORDS[n % WORDS.length])
    .join(' ');
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Screen = 'welcome' | 'create' | 'confirm' | 'restore';

interface Props {
  onComplete: (mnemonic: string) => void;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Onboarding({ onComplete }: Props) {
  const [screen, setScreen]       = useState<Screen>('welcome');
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [animating, setAnimating] = useState(false);
  const [mnemonic]                = useState(() => generateMnemonic());
  const [input, setInput]         = useState('');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [shakeKey, setShakeKey]   = useState(0);

  const navigate = useCallback((to: Screen, dir: 'forward' | 'back' = 'forward') => {
    if (animating) return;
    setDirection(dir);
    setAnimating(true);
    setError('');
    setTimeout(() => {
      setScreen(to);
      setAnimating(false);
    }, 320);
  }, [animating]);

  const confirm = async () => {
    if (loading) return;
    const normalised = input.trim().toLowerCase();
    if (normalised !== mnemonic.trim().toLowerCase()) {
      setShakeKey(k => k + 1);
      setError('Key mismatch — check every word and try again.');
      return;
    }
    setLoading(true);
    localStorage.setItem('shardsafe.mnemonic', mnemonic);
    setTimeout(() => onComplete(mnemonic), 400);
  };

  const restore = async () => {
    if (loading) return;
    const normalised = input.trim().toLowerCase();
    const words = normalised.split(/\s+/);
    if (words.length < 12) {
      setError('Please enter all 12 words.');
      return;
    }
    setLoading(true);
    localStorage.setItem('shardsafe.mnemonic', normalised);
    setTimeout(() => onComplete(normalised), 400);
  };

  return (
    <div className="ob-root">
      {/* Ambient background */}
      <div className="ob-bg">
        <div className="ob-orb ob-orb-1" />
        <div className="ob-orb ob-orb-2" />
        <div className="ob-grid" />
      </div>

      {/* Back button */}
      {screen !== 'welcome' && (
        <button
          className="ob-back"
          onClick={() => navigate('welcome', 'back')}
        >
          ← back
        </button>
      )}

      {/* Screen container */}
      <div
        className={[
          'ob-screen',
          animating ? (direction === 'forward' ? 'ob-exit-left' : 'ob-exit-right') : 'ob-enter',
        ].join(' ')}
      >

        {/* ── Welcome ── */}
        {screen === 'welcome' && (
          <div className="ob-panel">
            <div className="ob-logo">⬡</div>
            <h1 className="ob-title">ShardSafe</h1>
            <p className="ob-sub">
              Your files. Encrypted. Distributed.<br />
              No servers. No trust required.
            </p>
            <div className="ob-btn-group">
              <button className="ob-btn ob-btn-primary" onClick={() => navigate('create')}>
                Create account
              </button>
              <button className="ob-btn ob-btn-secondary" onClick={() => navigate('restore')}>
                Restore account
              </button>
            </div>
          </div>
        )}

        {/* ── Create: show mnemonic ── */}
        {screen === 'create' && (
          <div className="ob-panel">
            <h2 className="ob-title ob-title-sm">Your secret key</h2>
            <p className="ob-sub">
              This is your identity. Write every word down — in order.<br />
              We cannot recover it for you.
            </p>
            <div className="ob-mnemonic-grid">
              {mnemonic.split(' ').map((word, i) => (
                <div key={i} className="ob-word">
                  <span className="ob-word-num">{i + 1}</span>
                  <span className="ob-word-val">{word}</span>
                </div>
              ))}
            </div>
            <p className="ob-warning">
              ⚠ If you lose this key your data is gone forever.
            </p>
            <button className="ob-btn ob-btn-primary" onClick={() => navigate('confirm')}>
              I've written it down →
            </button>
          </div>
        )}

        {/* ── Confirm ── */}
        {screen === 'confirm' && (
          <div className="ob-panel">
            <h2 className="ob-title ob-title-sm">Confirm your key</h2>
            <p className="ob-sub">
              Type your 12 words back to prove you saved them.
            </p>
            <textarea
              key={shakeKey}
              className={['ob-textarea', error ? 'ob-textarea-shake' : ''].join(' ')}
              placeholder="witch collapse practice feed shame open despair creek road again ice least"
              value={input}
              onChange={e => { setInput(e.target.value); setError(''); }}
              rows={4}
              spellCheck={false}
              autoComplete="off"
            />
            {error && <p className="ob-error">{error}</p>}
            <button
              className="ob-btn ob-btn-primary"
              onClick={confirm}
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Confirm & continue →'}
            </button>
          </div>
        )}

        {/* ── Restore ── */}
        {screen === 'restore' && (
          <div className="ob-panel">
            <h2 className="ob-title ob-title-sm">Welcome back</h2>
            <p className="ob-sub">
              Enter your 12-word secret key to restore your account.
            </p>
            <textarea
              key={shakeKey}
              className={['ob-textarea', error ? 'ob-textarea-shake' : ''].join(' ')}
              placeholder="Enter your 12 words separated by spaces..."
              value={input}
              onChange={e => { setInput(e.target.value); setError(''); }}
              rows={4}
              spellCheck={false}
              autoComplete="off"
            />
            {error && <p className="ob-error">{error}</p>}
            <button
              className="ob-btn ob-btn-primary"
              onClick={restore}
              disabled={loading}
            >
              {loading ? 'Restoring...' : 'Restore account →'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
