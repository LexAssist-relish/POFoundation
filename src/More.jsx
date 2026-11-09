import { useEffect, useState } from 'react';
import { useData } from './App';
import { supabase } from './supabase';
import { has, money, ROLE_LABELS, fmtDateTime, fmtPhone } from './util';
import { Field } from './ui';

export default function More() {
  const { me } = useData();
  return (
    <div className="page narrow">
      <h1>More</h1>
      <section className="card">
        <h2>{me.full_name}</h2>
        <p className="muted small">@{me.username} · {me.roles.map((r) => ROLE_LABELS[r]).join(', ')}</p>
        <ChangePin />
      </section>
      {has(me, 'admin') && <Budgets />}
      {has(me, 'admin') && <ProjectSettings />}
      {has(me, 'admin') && <WhatsAppLog />}
      <section className="card">
        <h2>Install on your phone</h2>
        <p className="small">Android: open in Chrome → ⋮ menu → <b>Add to Home screen</b>. Once installed, <b>P O Foundation</b> appears in GPay’s Share menu so receipts attach in one tap.<br />iPhone: Safari → Share → <b>Add to Home Screen</b> (receipt sharing isn’t supported on iPhone — use “Upload file” instead).</p>
      </section>
      <button className="btn block" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  );
}

function ChangePin() {
  const { toast } = useData();
  const [pin, setPin] = useState('');
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>Change my PIN</button>;
  return (
    <form className="row gap" onSubmit={async (e) => {
      e.preventDefault();
      const { error } = await supabase.auth.updateUser({ password: pin });
      if (error) return toast(error.message, 'err');
      toast('PIN changed'); setPin(''); setOpen(false);
    }}>
      <input inputMode="numeric" maxLength={6} pattern="\d{6}" required placeholder="New 6-digit PIN" value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="mono" style={{ flex: 1 }} />
      <button className="btn primary">Save</button>
    </form>
  );
}

function Budgets() {
  const { categories, project, expenses, reload, toast } = useData();
  const [draft, setDraft] = useState(() => Object.fromEntries(categories.map((c) => [c.id, String(c.budget ?? 0)])));
  const [name, setName] = useState('');
  const used = new Set(expenses.map((e) => e.category));
  const total = Object.values(draft).reduce((t, v) => t + Number(v || 0), 0);

  const saveAll = async () => {
    const changed = categories.filter((c) => Number(draft[c.id] || 0) !== Number(c.budget || 0));
    for (const c of changed) {
      const { error } = await supabase.from('categories').update({ budget: Number(draft[c.id] || 0) }).eq('id', c.id);
      if (error) return toast(error.message, 'err');
    }
    await reload(); toast(changed.length ? 'Budgets saved' : 'No changes');
  };
  const add = async (e) => {
    e.preventDefault();
    const { data, error } = await supabase.from('categories').insert({ project_id: project.id, name: name.trim(), sort: 50 }).select().single();
    if (error) return toast(error.message, 'err');
    setDraft((d) => ({ ...d, [data.id]: '0' })); setName(''); await reload();
  };
  const del = async (c) => {
    if (used.has(c.name)) return toast('Category is in use', 'err');
    const { error } = await supabase.from('categories').delete().eq('id', c.id);
    if (error) return toast(error.message, 'err');
    await reload();
  };

  return (
    <section className="card">
      <h2>Budget by category</h2>
      <div className="budget-list">
        {categories.map((c) => (
          <div key={c.id} className="budget-row">
            <span>{c.name}</span>
            <input type="number" min="0" inputMode="numeric" value={draft[c.id] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))} />
            <button className="icon-btn" title="Remove" disabled={used.has(c.name)} onClick={() => del(c)}>✕</button>
          </div>
        ))}
        <div className="budget-row total"><span>Total budget</span><b>{money(total)}</b><span /></div>
      </div>
      <form className="row gap" onSubmit={add} style={{ marginTop: 10 }}>
        <input required placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
        <button className="btn">Add</button>
      </form>
      <button className="btn primary block" style={{ marginTop: 10 }} onClick={saveAll}>Save budgets</button>
    </section>
  );
}

function ProjectSettings() {
  const { project, reload, toast } = useData();
  const [v, setV] = useState({ subtitle: project.subtitle || '', event_date: project.event_date || '', status: project.status });
  return (
    <section className="card">
      <h2>Event</h2>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const { error } = await supabase.from('projects').update({ subtitle: v.subtitle, event_date: v.event_date || null, status: v.status }).eq('id', project.id);
        if (error) return toast(error.message, 'err');
        await reload(); toast('Saved');
      }}>
        <Field label="Subtitle"><input value={v.subtitle} onChange={(e) => setV({ ...v, subtitle: e.target.value })} /></Field>
        <div className="grid2 tight">
          <Field label="Event date"><input type="date" value={v.event_date} onChange={(e) => setV({ ...v, event_date: e.target.value })} /></Field>
          <Field label="Status">
            <select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
              <option value="active">Active</option><option value="closed">Closed (accounts settled)</option>
            </select>
          </Field>
        </div>
        <button className="btn">Save</button>
      </form>
    </section>
  );
}

const EVENT_LABEL = { submitted: 'Approval request', approved: 'Payment request', query: 'Query', rejected: 'Rejected', paid: 'Payment made' };

function WhatsAppLog() {
  const { userById, expenses } = useData();
  const [rows, setRows] = useState(null);
  const load = () => supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(25)
    .then(({ data, error }) => setRows(error ? { error: error.message } : data || []));
  useEffect(() => { load(); }, []);
  const serial = (id) => expenses.find((e) => e.id === id)?.serial || '';
  return (
    <section className="card">
      <div className="page-head"><h2>WhatsApp alerts</h2><button className="btn ghost small" onClick={load}>Refresh</button></div>
      {rows === null ? <p className="muted small">Loading…</p>
        : rows.error ? <p className="muted small">Not set up yet — run supabase/002_whatsapp.sql. ({rows.error})</p>
        : rows.length === 0 ? <p className="muted small">No payment messages sent yet. They start once MSG91 is connected in Vercel and a payment is made.</p>
        : (
          <div className="wa-log">
            {rows.map((r) => (
              <div key={r.id} className="wa-row">
                <span className={`chip ${r.status === 'sent' ? 'green' : r.status === 'failed' ? 'orange' : 'grey'}`}>{r.status}</span>
                <div className="ri-main">
                  <div className="small"><b>{userById[r.recipient]?.full_name || fmtPhone(r.phone)}</b> · {EVENT_LABEL[r.event] || r.event} · {serial(r.expense_id)}</div>
                  {r.error && <div className="small neg">{r.error}</div>}
                </div>
                <span className="small muted">{fmtDateTime(r.created_at)}</span>
              </div>
            ))}
          </div>
        )}
    </section>
  );
}
