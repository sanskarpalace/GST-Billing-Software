import { useState } from 'react';
import { login } from '../store';

// Pre-auth login screen. Shown by App when whoami reports no session and a
// password is required. Password-only: the password decides the role (admin
// vs manager). On success the server has set the session cookie; the parent
// reloads so every data effect re-runs authenticated.
export default function LoginScreen({ onLoggedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username || !password || busy) return;
    setBusy(true); setError('');
    try {
      const { role } = await login(username.trim(), password);
      onLoggedIn(role);
    } catch (err) {
      setError(err && (err.status === 401 || err.status === 400)
        ? 'Incorrect username or password. Please try again.'
        : 'Could not reach the server. Check your connection and retry.');
      setBusy(false);
    }
  };

  return (
    <div style={S.wrap}>
      <form style={S.card} onSubmit={submit}>
        <img src="/icons/icon-512.png" alt="Sanskar Palace Hotel & Resort" style={S.logo} />
        <div style={S.sub}>Billing &amp; Front Desk</div>
        <label style={S.label} htmlFor="sp-user">Username</label>
        <input id="sp-user" type="text" autoFocus value={username} autoComplete="username"
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(e) => { setUsername(e.target.value); setError(''); }}
          placeholder="Your username" style={{ ...S.input, marginBottom: 14 }} />
        <label style={S.label} htmlFor="sp-pass">Password</label>
        <input id="sp-pass" type="password" value={password} autoComplete="current-password"
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          placeholder="Your password" style={S.input} />
        {error && <div style={S.error}>{error}</div>}
        <button type="submit" disabled={busy || !username || !password}
          style={{ ...S.btn, opacity: (busy || !username || !password) ? 0.6 : 1, cursor: (busy || !username || !password) ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>
        <div style={S.hint}>Use the username and password your administrator gave you.</div>
      </form>
    </div>
  );
}

const GOLD = '#d4af37';
const S = {
  wrap: { position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '1.5rem', background: 'radial-gradient(circle at 50% 28%, #1c1c1c 0%, #0b0b0b 72%)', zIndex: 10000 },
  card: { width: '100%', maxWidth: 380, background: '#111', border: '1px solid #262626', borderRadius: 16,
    padding: '2rem 1.75rem', boxShadow: '0 20px 60px rgba(0,0,0,0.55)', textAlign: 'center' },
  logo: { width: '100%', maxWidth: 240, height: 'auto', margin: '0 auto 0.25rem', display: 'block' },
  sub: { color: '#a3a3a3', fontSize: '0.78rem', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: '1.75rem' },
  label: { display: 'block', textAlign: 'left', color: '#d4d4d4', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 },
  input: { width: '100%', padding: '0.8rem 0.9rem', borderRadius: 10, border: '1px solid #333', background: '#0b0b0b',
    color: '#f5f5f5', fontSize: '0.95rem', outline: 'none', boxSizing: 'border-box' },
  error: { color: '#f87171', fontSize: '0.82rem', textAlign: 'left', marginTop: 8 },
  btn: { width: '100%', marginTop: '1.1rem', padding: '0.85rem', borderRadius: 10, border: 'none',
    background: `linear-gradient(180deg, ${GOLD}, #b8912f)`, color: '#1a1400', fontWeight: 700, fontSize: '0.95rem' },
  hint: { color: '#737373', fontSize: '0.72rem', marginTop: '1.25rem', lineHeight: 1.5 },
};
