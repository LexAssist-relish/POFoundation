import { useMemo, useState } from 'react';
import { useData } from './App';
import { supabase } from './supabase';
import { has, money, effAmount } from './util';
import { Field, Sheet, Empty } from './ui';

const UPI_RE = /^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9.]{1,63}$/;

export function PayeeForm({ initial, onSaved, me }) {
  const { categories, toast, reload } = useData();
  const [v, setV] = useState({
    name: initial?.name || '', upi_id: initial?.upi_id || '', phone: initial?.phone || '',
    bank_note: initial?.bank_note || '', category: initial?.category || '', notes: initial?.notes || '',
    verified: initial?.verified ?? false,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const canVerify = has(me, 'admin') || has(me, 'approver');

  const save = async (e) => {
    e.preventDefault(); e.stopPropagation();
    const upi = v.upi_id.trim();
    if (upi && !UPI_RE.test(upi)) return toast('That UPI ID doesn’t look right (name@bank)', 'err');
    setBusy(true);
    const row = {
      name: v.name.trim(), upi_id: upi || null, phone: v.phone.replace(/[^\d+]/g, '') || null,
      bank_note: v.bank_note.trim() || null, category: v.category || null, notes: v.notes.trim() || null,
      verified: canVerify ? v.verified : (initial?.verified ?? false) && upi === (initial?.upi_id || ''),
      updated_at: new Date().toISOString(),
    };
    const q = initial
      ? supabase.from('payees').update(row).eq('id', initial.id).select().single()
      : supabase.from('payees').insert({ ...row, created_by: me.id }).select().single();
    const { data, error } = await q;
    setBusy(false);
    if (error) return toast(error.message, 'err');
    await reload(); toast(initial ? 'Payee updated' : 'Payee added');
    onSaved?.(data);
  };

  return (
    <form className="form" onSubmit={save}>
      <Field label="Name"><input required value={v.name} onChange={set('name')} placeholder="e.g. Kumarakom Caterers" /></Field>
      <Field label="UPI ID" hint="From their GPay/PhonePe, e.g. 98xxxxxxxx@okicici. Leave blank for cash/bank-only payees.">
        <input value={v.upi_id} onChange={set('upi_id')} autoCapitalize="none" placeholder="name@bank" />
      </Field>
      <div className="grid2 tight">
        <Field label="Phone"><input inputMode="tel" value={v.phone} onChange={set('phone')} /></Field>
        <Field label="Category">
          <select value={v.category} onChange={set('category')}>
            <option value="">—</option>{categories.map((c) => <option key={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Bank details (if no UPI)"><input value={v.bank_note} onChange={set('bank_note')} placeholder="A/c no, IFSC, name" /></Field>
      <Field label="Notes"><input value={v.notes} onChange={set('notes')} /></Field>
      {canVerify && (
        <label className="check"><input type="checkbox" checked={v.verified} onChange={set('verified')} /> UPI ID verified (confirmed with the payee)</label>
      )}
      <button className="btn primary block" disabled={busy}>{busy ? 'Saving…' : 'Save payee'}</button>
    </form>
  );
}

export default function Payees() {
  const { payees, expenses, me, toast, reload } = useData();
  const [edit, setEdit] = useState(null); // payee | 'new'
  const [q, setQ] = useState('');
  const canEdit = has(me, 'admin') || has(me, 'approver');

  const stats = useMemo(() => {
    const m = {};
    expenses.forEach((e) => {
      if (!e.payee_id || e.status === 'rejected') return;
      const s = (m[e.payee_id] ||= { n: 0, paid: 0, total: 0 });
      s.n++; s.total += effAmount(e); if (e.status === 'paid') s.paid += effAmount(e);
    });
    return m;
  }, [expenses]);

  const list = payees.filter((p) => !q || (p.name + ' ' + (p.upi_id || '') + ' ' + (p.category || '')).toLowerCase().includes(q.toLowerCase()));

  const del = async (p) => {
    if (stats[p.id]) return toast('This payee has expenses — edit instead of deleting', 'err');
    if (!confirm(`Delete ${p.name}?`)) return;
    const { error } = await supabase.from('payees').delete().eq('id', p.id);
    if (error) return toast(error.message, 'err');
    await reload(); setEdit(null); toast('Payee deleted');
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Payees</h1>
        <button className="btn primary small" onClick={() => setEdit('new')}>+ Add payee</button>
      </div>
      <input type="search" placeholder="Search payees" value={q} onChange={(e) => setQ(e.target.value)} className="search" />
      {list.length === 0 ? <Empty icon="🏪" title="No payees yet">Add caterers, decorators, the hall, etc. with their UPI IDs.</Empty> : (
        <div className="card flush">
          {list.map((p) => {
            const s = stats[p.id];
            return (
              <button key={p.id} className="row-item" onClick={() => setEdit(p)}>
                <div className="ri-main">
                  <div className="ri-title">{p.name} {p.verified ? <span className="tick" title="UPI verified">✓</span> : p.upi_id ? <span className="chip amber tiny">unverified</span> : null}</div>
                  <div className="ri-sub mono">{p.upi_id || p.bank_note || 'No UPI — cash/bank'}</div>
                  <div className="ri-meta">{p.category && <span>{p.category}</span>}{p.phone && <span>☎ {p.phone}</span>}</div>
                </div>
                <div className="ri-side">
                  {s ? <><div className="ri-amt">{money(s.total)}</div><div className="small muted">{s.n} bill{s.n > 1 ? 's' : ''} · paid {money(s.paid)}</div></> : <span className="small muted">—</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {edit && (
        <Sheet title={edit === 'new' ? 'New payee' : edit.name} onClose={() => setEdit(null)}>
          {edit !== 'new' && !canEdit
            ? <p className="muted">Only approvers and admins can edit payees.</p>
            : <PayeeForm initial={edit === 'new' ? null : edit} me={me} onSaved={() => setEdit(null)} />}
          {edit !== 'new' && has(me, 'admin') && (
            <button className="btn danger block" style={{ marginTop: 12 }} onClick={() => del(edit)}>Delete payee</button>
          )}
        </Sheet>
      )}
    </div>
  );
}
