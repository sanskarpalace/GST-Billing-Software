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

const CSS = `
.sl-wrap {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  padding: 1.5rem; overflow: auto;
  background:
    radial-gradient(900px 520px at 50% -10%, rgba(212,175,55,0.12), transparent 60%),
    radial-gradient(760px 520px at 50% 115%, rgba(212,175,55,0.07), transparent 60%),
    #080808;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
}
.sl-card {
  width: 100%; max-width: 400px; text-align: center;
  background: linear-gradient(180deg, #171717 0%, #0f0f0f 100%);
  border: 1px solid rgba(212,175,55,0.22);
  border-radius: 20px;
  padding: 2.4rem 2rem 1.9rem;
  box-shadow: 0 30px 80px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.04);
  animation: sl-in 0.5s cubic-bezier(.2,.7,.2,1) both;
}
@keyframes sl-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.sl-logo-wrap { display: flex; justify-content: center; }
.sl-logo { width: 100%; max-width: 282px; height: auto; display: block;
  filter: drop-shadow(0 6px 20px rgba(212,175,55,0.16)); }
.sl-sub { color: #c9a94a; font-size: 0.72rem; font-weight: 600;
  letter-spacing: 0.28em; text-transform: uppercase; margin: 0.2rem 0 1.1rem; }
.sl-rule { height: 1px; width: 72px; margin: 0 auto 1.5rem;
  background: linear-gradient(90deg, transparent, rgba(212,175,55,0.55), transparent); }
.sl-field { text-align: left; margin-bottom: 1rem; }
.sl-label { display: block; color: #d0d0d0; font-size: 0.72rem; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 7px; }
.sl-input {
  width: 100%; box-sizing: border-box; padding: 0.85rem 1rem;
  border-radius: 11px; background: #0c0c0c; border: 1px solid #2b2b2b;
  color: #f3f3f3; font-size: 0.95rem; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
}
.sl-input::placeholder { color: #666; }
.sl-input:hover { border-color: #3a3a3a; }
/* Gold focus ring. The outline override (with !important) beats the app's
   global emerald input:focus-visible rule; offset 2px gives a clean halo. */
.sl-input:focus, .sl-input:focus-visible {
  border-color: #d4af37; background: #0f0d07;
  outline: 2px solid rgba(212,175,55,0.85) !important;
  outline-offset: 2px !important; box-shadow: none;
}
.sl-input:-webkit-autofill, .sl-input:-webkit-autofill:hover, .sl-input:-webkit-autofill:focus {
  -webkit-text-fill-color: #f3f3f3; caret-color: #f3f3f3;
  -webkit-box-shadow: 0 0 0 1000px #0c0c0c inset; transition: background-color 9999s ease-in-out 0s;
}
.sl-err { color: #f87171; font-size: 0.82rem; text-align: left; margin: 2px 0 0; }
.sl-btn {
  width: 100%; margin-top: 1.15rem; padding: 0.9rem; cursor: pointer;
  border: none; border-radius: 11px; font-size: 0.96rem; font-weight: 700; letter-spacing: 0.02em;
  color: #241a00; background: linear-gradient(180deg, #e8c85e 0%, #c9a12f 100%);
  box-shadow: 0 10px 26px rgba(201,161,47,0.26);
  transition: filter .15s ease, box-shadow .15s ease, transform .05s ease, opacity .15s ease;
}
.sl-btn:hover:not(:disabled) { filter: brightness(1.07); box-shadow: 0 12px 30px rgba(201,161,47,0.34); }
.sl-btn:active:not(:disabled) { transform: translateY(1px); }
.sl-btn:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
.sl-btn:focus-visible { outline: 2px solid rgba(212,175,55,0.85) !important; outline-offset: 2px !important; }
.sl-hint { color: #7c7c7c; font-size: 0.74rem; line-height: 1.5; margin-top: 1.3rem; }
.sl-foot { color: #585858; font-size: 0.66rem; letter-spacing: 0.14em; text-transform: uppercase; margin-top: 0.85rem; }
@media (max-width: 420px) { .sl-card { padding: 2rem 1.4rem 1.6rem; } }
`;
