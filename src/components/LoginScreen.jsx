import { useState } from 'react';
import { login } from '../store';

// Pre-auth login screen. Shown by App when whoami reports no session and a
// password is required. Password-only per account: the username + password
// decide the role. On success the server has set the session cookie; the
// parent reloads so every data effect re-runs authenticated.
//
// Styling is a self-contained gold-on-black theme injected via a scoped <style>
// (prefix `sl-`) so it owns focus/hover/autofill and never inherits the app's
// emerald accent.
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

  const disabled = busy || !username || !password;

  return (
    <div className="sl-wrap">
      <style>{CSS}</style>
      <form className="sl-card" onSubmit={submit} noValidate>
        <div className="sl-logo-wrap">
          <img className="sl-logo" src="/login-logo.png" alt="Sanskar Palace Hotel & Resort" />
        </div>
        <div className="sl-sub">Billing &amp; Front Desk</div>
        <div className="sl-rule" />

        <div className="sl-field">
          <label className="sl-label" htmlFor="sl-user">Username</label>
          <input id="sl-user" className="sl-input" type="text" autoFocus value={username}
            autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => { setUsername(e.target.value); setError(''); }}
            placeholder="Your username" />
        </div>

        <div className="sl-field">
          <label className="sl-label" htmlFor="sl-pass">Password</label>
          <input id="sl-pass" className="sl-input" type="password" value={password}
            autoComplete="current-password"
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            placeholder="Your password" />
        </div>

        {error && <div className="sl-err">{error}</div>}

        <button type="submit" className="sl-btn" disabled={disabled}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>

        <div className="sl-hint">Use the username and password your administrator gave you.</div>
        <div className="sl-foot">Garoth · Shamgarh · Madhya Pradesh</div>
      </form>
    </div>
  );
}

// Minimal, modern, theme-aware. Colors come from the app's own CSS tokens
// (--bg, --bg-secondary, --text, --border-color…) so the screen follows the
// user's light/dark choice automatically; gold (#c9a227) is the only accent.
const GOLD = '#c9a227';
const CSS = `
.sl-wrap {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  padding: 1.5rem; overflow: auto;
  background:
    radial-gradient(1100px 520px at 50% -5%, rgba(201,162,39,0.06), transparent 62%),
    var(--bg, #0b0b0b);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
}
.sl-card {
  width: 100%; max-width: 384px; text-align: center;
  background: var(--bg-secondary, #141414);
  border: 1px solid var(--border-color, #262626);
  border-radius: 16px;
  padding: 2.4rem 2rem 1.8rem;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 14px 40px rgba(0,0,0,0.08);
  animation: sl-in 0.45s cubic-bezier(.2,.7,.2,1) both;
}
[data-theme="dark"] .sl-card { box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
@keyframes sl-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
.sl-logo-wrap { display: flex; justify-content: center; }
.sl-logo { width: 100%; max-width: 244px; height: auto; display: block; }
.sl-sub { color: ${GOLD}; font-size: 0.68rem; font-weight: 600;
  letter-spacing: 0.26em; text-transform: uppercase; margin: 0.35rem 0 1rem; }
.sl-rule { height: 1px; width: 56px; margin: 0 auto 1.6rem;
  background: linear-gradient(90deg, transparent, rgba(201,162,39,0.45), transparent); }
.sl-field { text-align: left; margin-bottom: 0.95rem; }
.sl-label { display: block; color: var(--text-secondary, #9aa0a6); font-size: 0.7rem; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
.sl-input {
  width: 100%; box-sizing: border-box; padding: 0.8rem 0.95rem;
  border-radius: 10px; background: var(--bg, #0c0c0c); border: 1px solid var(--border-color, #2b2b2b);
  color: var(--text, #f3f3f3); font-size: 0.95rem; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.sl-input::placeholder { color: var(--text-muted, #6b7280); }
.sl-input:hover { border-color: rgba(201,162,39,0.4); }
/* Gold focus ring — the !important outline beats the app's global emerald
   input:focus-visible rule. */
.sl-input:focus, .sl-input:focus-visible {
  border-color: ${GOLD};
  outline: 2px solid rgba(201,162,39,0.45) !important; outline-offset: 2px !important;
  box-shadow: none;
}
.sl-input:-webkit-autofill, .sl-input:-webkit-autofill:hover, .sl-input:-webkit-autofill:focus {
  -webkit-text-fill-color: var(--text, #f3f3f3); caret-color: var(--text, #f3f3f3);
  -webkit-box-shadow: 0 0 0 1000px var(--bg, #0c0c0c) inset; transition: background-color 9999s ease-in-out 0s;
}
.sl-err { color: #ef4444; font-size: 0.82rem; text-align: left; margin: 2px 0 0; }
.sl-btn {
  width: 100%; margin-top: 1.1rem; padding: 0.85rem; cursor: pointer;
  border: none; border-radius: 10px; font-size: 0.95rem; font-weight: 700; letter-spacing: 0.01em;
  color: #231a00; background: linear-gradient(180deg, #e3c14f 0%, #c49a2a 100%);
  transition: filter .15s ease, transform .05s ease, opacity .15s ease;
}
.sl-btn:hover:not(:disabled) { filter: brightness(1.05); }
.sl-btn:active:not(:disabled) { transform: translateY(1px); }
.sl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.sl-btn:focus-visible { outline: 2px solid rgba(201,162,39,0.6) !important; outline-offset: 2px !important; }
.sl-hint { color: var(--text-muted, #7c7c7c); font-size: 0.74rem; line-height: 1.5; margin-top: 1.2rem; }
.sl-foot { color: var(--text-muted, #585858); font-size: 0.64rem; letter-spacing: 0.12em;
  text-transform: uppercase; margin-top: 0.7rem; opacity: 0.8; }
@media (max-width: 420px) { .sl-card { padding: 2rem 1.4rem 1.5rem; } }
`;
