import { useState } from 'react';
import { useData } from './App';
import { adminUsers } from './supabase';
import { ROLE_LABELS } from './util';
import { Field, Sheet } from './ui';

const ROLE_HELP = {
  admin: 'Manages users, payees, budgets',
  approver: 'Approves / alters / rejects bills, picks the payer',
  payer: 'Receives pay links and pays',
  inputter: 'Adds bills with invoice photos',
  viewer: 'Can see everything, change nothing',
};

export default function Users() {
  const { users, me } = useData();
  const [edit, setEdit] = useState(null);
  const active = users.filter((u) => u.active);
  const inactive = users.filter((u) => !u.active);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Users</h1>
        <button className="btn primary small" onClick={() => setEdit('new')}>+ Onboard user</button>
      </div>
      <div className="card flush">
        {active.map((u) => <UserRow key={u.id} u={u} me={me} onClick={() => setEdit(u)} />)}
      </div>
      {inactive.length > 0 && <>
        <h3 className="muted" style={{ marginTop: 20 }}>Deactivated</h3>
        <div className="card flush">{inactive.map((u) => <UserRow key={u.id} u={u} me={me} onClick={() => setEdit(u)} />)}</div>
      </>}
      {edit && <UserSheet u={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

const UserRow = ({ u, me, onClick }) => (
  <button className="row-item" onClick={onClick}>
    <span className="avatar">{u.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
    <div className="ri-main">
      <div className="ri-title">{u.full_name}{u.id === me.id && <span className="muted small"> (you)</span>}</div>
      <div className="ri-sub">@{u.username}{u.relation ? ` · ${u.relation}` : ''}{u.phone ? ` · ${u.phone}` : ''}</div>
    </div>
    <div className="ri-side roles">{u.roles.map((r) => <span key={r} className={`chip role-${r}`}>{ROLE_LABELS[r]}</span>)}</div>
  </button>
);

function UserSheet({ u, onClose }) {
  const { reload, toast, me } = useData();
  const [v, setV] = useState({
    username: u?.username || '', full_name: u?.full_name || '', relation: u?.relation || '',
    phone: u?.phone || '', roles: u?.roles || ['viewer'], pin: '', active: u?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const toggle = (r) => setV((x) => ({ ...x, roles: x.roles.includes(r) ? x.roles.filter((y) => y !== r) : [...x.roles, r] }));

  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      if (u) {
        await adminUsers('PATCH', { id: u.id, full_name: v.full_name, relation: v.relation, phone: v.phone, roles: v.roles, active: v.active, ...(v.pin ? { pin: v.pin } : {}) });
        toast(v.pin ? 'Saved — new PIN set' : 'Saved');
      } else {
        await adminUsers('POST', v);
        toast(`${v.full_name} onboarded — login @${v.username.toLowerCase()}`);
      }
      await reload(); onClose();
    } catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm(`Remove ${u.full_name}? Users with history are deactivated instead of deleted.`)) return;
    try { const r = await adminUsers('DELETE', { id: u.id }); toast(r.deactivated ? 'Deactivated (has history)' : 'Deleted'); await reload(); onClose(); }
    catch (err) { toast(err.message, 'err'); }
  };
  const share = () => {
    const text = `P O Foundation – Bejoy John Marriage expenses app\n${location.origin}\nUsername: ${v.username.toLowerCase()}\nPIN: ${v.pin || '(as told to you)'}\nOn Android open the link in Chrome → ⋮ → Add to Home screen.`;
    const p = v.phone.replace(/\D/g, ''); const num = p.length === 10 ? '91' + p : p;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <Sheet title={u ? u.full_name : 'Onboard user'} onClose={onClose}
      footer={<>
        {u && u.id !== me.id && <button className="btn danger" onClick={remove} style={{ marginRight: 'auto' }}>Remove</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" form="user-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <form id="user-form" className="form" onSubmit={save}>
        <div className="grid2 tight">
          <Field label="Full name"><input required value={v.full_name} onChange={set('full_name')} /></Field>
          <Field label="Relation / note"><input value={v.relation} onChange={set('relation')} placeholder="e.g. Uncle, Groom" /></Field>
        </div>
        <div className="grid2 tight">
          <Field label="Username (login)" hint={u ? 'Usernames cannot be changed' : 'lowercase, no spaces'}>
            <input required disabled={!!u} autoCapitalize="none" value={v.username} onChange={(e) => setV((x) => ({ ...x, username: e.target.value.toLowerCase().replace(/\s/g, '') }))} />
          </Field>
          <Field label="WhatsApp number"><input inputMode="tel" value={v.phone} onChange={set('phone')} placeholder="10-digit mobile" /></Field>
        </div>
        <Field label={u ? 'Reset PIN (leave blank to keep)' : '6-digit PIN'}>
          <div className="row gap">
            <input inputMode="numeric" maxLength={6} pattern="\d{6}" required={!u} value={v.pin} onChange={(e) => setV((x) => ({ ...x, pin: e.target.value.replace(/\D/g, '') }))} className="mono" style={{ flex: 1 }} />
            <button type="button" className="btn ghost" onClick={() => setV((x) => ({ ...x, pin: String(Math.floor(100000 + Math.random() * 900000)) }))}>Generate</button>
          </div>
        </Field>
        <div className="field">
          <span className="field-label">Roles</span>
          <div className="role-grid">
            {Object.keys(ROLE_LABELS).map((r) => (
              <label key={r} className={'role-opt' + (v.roles.includes(r) ? ' on' : '')}>
                <input type="checkbox" checked={v.roles.includes(r)} onChange={() => toggle(r)} />
                <div><b>{ROLE_LABELS[r]}</b><span>{ROLE_HELP[r]}</span></div>
              </label>
            ))}
          </div>
        </div>
        {u && <label className="check"><input type="checkbox" checked={v.active} onChange={(e) => setV((x) => ({ ...x, active: e.target.checked }))} /> Active (can sign in)</label>}
        {v.phone && v.username && <button type="button" className="btn wa small" onClick={share}>💬 Send login details on WhatsApp</button>}
      </form>
    </Sheet>
  );
}
