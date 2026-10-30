import { useState, useEffect } from 'react';
import { Users, Plus, Pencil, Trash2, X, KeyRound, ShieldCheck, Check } from 'lucide-react';
import { getUsers, createUser, updateUser, deleteUser } from '../store';
import { toast } from './Toast';

// Admin-only staff accounts screen. Each user has a username, display name,
// role (admin/manager) and active flag. Passwords are set here but never read
// back (the server stores only a salted hash).
export default function UsersManager({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | {} (new) | user (edit)

  const load = async () => {
    setLoading(true);
    try { setUsers(await getUsers()); }
    catch { toast('Could not load staff accounts', 'error'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggleActive = async (u) => {
    try { await updateUser(u.id, { active: !u.active }); toast(`${u.username} ${u.active ? 'deactivated' : 'activated'}`, 'success'); load(); }
    catch (e) { toast(e?.body?.error || 'Update failed', 'error'); }
  };
  const remove = async (u) => {
    if (!window.confirm(`Delete the account "${u.username}"? They will no longer be able to log in.`)) return;
    try { await deleteUser(u.id); toast(`Deleted ${u.username}`, 'success'); load(); }
    catch (e) { toast(e?.body?.error || 'Delete failed', 'error'); }
  };

  return (
    <div className="dashboard-container">
      <div className="flex justify-between items-center mb-4" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Users size={20} /> Staff Accounts</h2>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Give each staff member their own login. Deactivate or delete to revoke access instantly.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({})}><Plus size={18} /> Add user</button>
      </div>

      {loading ? (
        <div className="glass-panel" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
      ) : users.length === 0 ? (
        <div className="glass-panel empty-state"><Users size={48} /><p>No staff accounts yet. Add one so your team can log in with their own username.</p><button className="btn btn-primary" onClick={() => setModal({})}><Plus size={18} /> Add user</button></div>
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {users.map((u) => (
            <div key={u.id} className="glass-panel" style={{ padding: '0.9rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap', opacity: u.active ? 1 : 0.55 }}>
              <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {u.username}
                  {currentUser && currentUser === u.username && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>(you)</span>}
                </div>
                {u.name && <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{u.name}</div>}
              </div>
              <span style={{ ...badge, ...(u.role === 'admin' ? badgeAdmin : badgeMgr) }}>
                {u.role === 'admin' ? <ShieldCheck size={13} /> : <Check size={13} />} {u.role}
              </span>
              <span style={{ fontSize: '0.78rem', color: u.active ? '#059669' : '#dc2626', fontWeight: 600, minWidth: 60 }}>
                {u.active ? 'Active' : 'Disabled'}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="icon-btn" title="Edit" onClick={() => setModal(u)}><Pencil size={16} /></button>
                <button className="icon-btn" title={u.active ? 'Deactivate' : 'Activate'} onClick={() => toggleActive(u)}><KeyRound size={16} /></button>
                <button className="icon-btn" title="Delete" onClick={() => remove(u)} style={{ color: '#dc2626' }}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && <UserModal user={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
    </div>
  );
}

function UserModal({ user, onClose, onSaved }) {
  const editing = !!user;
  const [form, setForm] = useState({ username: user?.username || '', name: user?.name || '', role: user?.role || 'manager', password: '' });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    if (!editing && (!form.username.trim() || !form.password)) { toast('Username and password are required', 'warning'); return; }
    setBusy(true);
    try {
      if (editing) {
        const patch = { name: form.name.trim(), role: form.role };
        if (form.password) patch.password = form.password;
        await updateUser(user.id, patch);
        toast(`Updated ${user.username}`, 'success');
      } else {
        await createUser({ username: form.username.trim(), name: form.name.trim(), role: form.role, password: form.password });
        toast(`Created ${form.username.trim()}`, 'success');
      }
      onSaved();
    } catch (e) {
      toast(e?.body?.error || 'Save failed', 'error');
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="section-title" style={{ margin: 0 }}>{editing ? `Edit ${user.username}` : 'Add staff account'}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ display: 'grid', gap: '0.9rem' }}>
          <div className="form-group">
            <label className="form-label">Username *</label>
            <input className="form-input" value={form.username} disabled={editing}
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="e.g. reception1" style={editing ? { opacity: 0.6 } : undefined} />
            {editing && <small style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>Username can’t be changed.</small>}
          </div>
          <div className="form-group">
            <label className="form-label">Display name</label>
            <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Priya (optional)" />
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="form-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="manager">Manager — front desk only</option>
              <option value="admin">Admin — full access</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{editing ? 'New password (leave blank to keep)' : 'Password *'}</label>
            <input className="form-input" type="password" value={form.password} autoComplete="new-password"
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={editing ? 'Set a new password' : 'At least 6 characters'} />
          </div>
        </div>
        <div className="flex justify-end gap-2" style={{ marginTop: '1.25rem' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create user'}</button>
        </div>
      </div>
    </div>
  );
}

const badge = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, textTransform: 'capitalize' };
const badgeAdmin = { background: 'rgba(124,58,237,0.12)', color: '#7c3aed' };
const badgeMgr = { background: 'rgba(5,150,105,0.12)', color: '#059669' };
