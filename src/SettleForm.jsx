import { useEffect, useState } from 'react';
import { useData } from './App';
import { supabase, readReceipt, notifyPayment } from './supabase';
import { money, todayISO, uploadAttachment, advanceBalance } from './util';
import { Sheet, Field, FilePicker, PendingFiles } from './ui';
import { PayeeForm } from './Payees';
import ReceiptReadout from './ReceiptReadout';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9@.]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * "I paid a bill" — the person paid a vendor themselves, from an advance (Pending Settlement)
 * or from money given to them. The bill is recorded as PAID straight away.
 */
export default function SettleForm({ onClose, defaultAdvance, initialReceipt }) {
  const { me, advances = [], expenses, funds = [], payees, categories, project, reload, toast } = useData();
  const openAdv = advances.filter((a) => a.status === 'paid' && a.requested_by === me.id);
  const myFunds = funds.filter((f) => f.holder === me.id);
  const sources = [
    ...openAdv.map((a) => ({ key: 'a:' + a.id, label: `${a.serial} — ${money(advanceBalance(a, expenses).pending)} pending`, advance_id: a.id })),
    ...myFunds.map((f) => ({ key: 'f:' + f.id, label: f.name, prepaid_fund: f.id })),
  ];
  const [src, setSrc] = useState(defaultAdvance ? 'a:' + defaultAdvance.id : sources[0]?.key || '');
  const [v, setV] = useState({ payee_id: '', amount: '', description: '', category: '', expense_date: todayISO(), ref: '', mode: 'upi' });
  const [receipts, setReceipts] = useState(initialReceipt ? [initialReceipt] : []);
  const [bills, setBills] = useState([]);
  const [reading, setReading] = useState(null);
  const [newPayee, setNewPayee] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));

  const read = async (file) => {
    setReading({ loading: true });
    const r = await readReceipt(file);
    setReading({ ...r, warnings: (r.warnings || []).filter((w) => /FAILED|PENDING|doesn’t look|already recorded/.test(w)) });
    const x = r.extracted;
    if (!x) return;
    // find the payee from the receipt (UPI ID first, then name)
    const byUpi = x.beneficiary_upi && payees.find((p) => p.upi_id && norm(p.upi_id) === norm(x.beneficiary_upi));
    const words = new Set(norm(x.beneficiary_name).split(' ').filter((w) => w.length > 2));
    const byName = !byUpi && words.size && payees.find((p) => norm(p.name).split(' ').some((w) => words.has(w)));
    setV((cur) => ({
      ...cur,
      amount: cur.amount || x.amount || '',
      ref: cur.ref || x.utr || '',
      expense_date: x.transaction_date || cur.expense_date,
      mode: x.mode || cur.mode,
      payee_id: cur.payee_id || (byUpi || byName)?.id || '',
    }));
  };
  useEffect(() => { if (initialReceipt) read(initialReceipt); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const source = sources.find((s) => s.key === src);
  const adv = source?.advance_id && advances.find((a) => a.id === source.advance_id);
  const pending = adv ? advanceBalance(adv, expenses).pending : null;
  const failed = reading?.extracted?.status === 'failed';

  const save = async (e) => {
    e.preventDefault();
    if (!source) return toast('Nothing to pay from — request an advance first', 'err');
    if (!v.payee_id) return toast('Choose who you paid', 'err');
    if (!receipts.length && !v.ref.trim() && v.mode !== 'cash') return toast('Add the transaction receipt or the UTR', 'err');
    setBusy(true);
    try {
      const { data, error } = await supabase.from('expenses').insert({
        project_id: project.id, expense_date: v.expense_date, payee_id: v.payee_id, category: v.category || null,
        description: v.description.trim(), amount: Number(v.amount),
        payment_mode: v.mode, payment_ref: v.ref.trim() || null,
        ...(source.advance_id ? { advance_id: source.advance_id } : { prepaid_fund: source.prepaid_fund }),
      }).select('id, serial').single();
      if (error) throw new Error(error.message);
      let failedUp = 0;
      for (const f of bills) { try { await uploadAttachment(data.id, f, 'bill'); } catch { failedUp++; } }
      for (const f of receipts) { try { await uploadAttachment(data.id, f, 'receipt'); } catch { failedUp++; } }
      notifyPayment(data.id);
      await reload();
      const left = pending != null ? pending - Number(v.amount) : null;
      toast(failedUp ? `${data.serial} saved, but ${failedUp} file(s) didn't upload — add them from the bill`
        : `${data.serial} recorded as paid ✓${left != null ? ` · ${money(left)} still pending` : ''}`, failedUp ? 'err' : 'ok');
      onClose(data.id);
    } catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };

  if (!sources.length) {
    return (
      <Sheet title="I paid a bill" onClose={() => onClose()}>
        <p>You don’t have an advance to settle yet. Request an advance first — once it’s paid to you, record each bill you pay here.</p>
        <p className="small muted">If someone else should pay the vendor, use <b>Request payment</b> instead.</p>
      </Sheet>
    );
  }

  return (
    <Sheet title="I paid a bill" onClose={() => onClose()}
      footer={<><button className="btn" onClick={() => onClose()}>Cancel</button>
        <button className="btn primary" form="settle-form" disabled={busy || reading?.loading || failed}>{busy ? 'Saving…' : failed ? 'Receipt shows failed' : 'Save — mark as paid'}</button></>}>
      <form id="settle-form" className="form" onSubmit={save}>
        <Field label="1. Transaction receipt" hint="Screenshot from GPay / your bank — amount, UTR and payee are filled in for you.">
          <FilePicker label="receipt" onFiles={(fs) => { const first = !receipts.length; setReceipts((x) => [...x, ...fs]); if (first) read(fs[0]); }} />
          <PendingFiles files={receipts} onRemove={(i) => { setReceipts((x) => x.filter((_, j) => j !== i)); if (i === 0) setReading(null); }} />
          <ReceiptReadout reading={reading} />
        </Field>

        <Field label="2. Bill / invoice">
          <FilePicker label="bill" onFiles={(fs) => setBills((x) => [...x, ...fs])} />
          <PendingFiles files={bills} onRemove={(i) => setBills((x) => x.filter((_, j) => j !== i))} />
        </Field>

        <div className="grid2 tight">
          <Field label="Amount paid (₹)"><input required type="number" min="0.01" step="0.01" inputMode="decimal" className="amount-input" value={v.amount} onChange={set('amount')} /></Field>
          <Field label="Date paid"><input type="date" required value={v.expense_date} onChange={set('expense_date')} /></Field>
        </div>
        <Field label="Paid to">
          <div className="row gap">
            <select required value={v.payee_id} onChange={set('payee_id')} style={{ flex: 1 }}>
              <option value="">Select…</option>{payees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="button" className="btn ghost" onClick={() => setNewPayee(true)}>+ New</button>
          </div>
        </Field>
        <Field label="What was it for?"><input required value={v.description} onChange={set('description')} placeholder="e.g. Jasmine garlands for the church" maxLength={200} /></Field>
        <div className="grid2 tight">
          <Field label="Category">
            <select value={v.category} onChange={set('category')}><option value="">—</option>{categories.map((c) => <option key={c.id}>{c.name}</option>)}</select>
          </Field>
          <Field label="UTR / reference"><input className="mono" value={v.ref} onChange={set('ref')} placeholder={v.mode === 'cash' ? 'not needed for cash' : ''} /></Field>
        </div>
        <div className="seg">{[['upi', 'UPI'], ['bank', 'Bank'], ['cash', 'Cash']].map(([k, l]) => <button type="button" key={k} className={v.mode === k ? 'on' : ''} onClick={() => setV({ ...v, mode: k })}>{l}</button>)}</div>

        <Field label="Paid from">
          <select value={src} onChange={(e) => setSrc(e.target.value)}>{sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        </Field>
        {pending != null && Number(v.amount) > 0 && (
          <p className={'small ' + (pending - Number(v.amount) < 0 ? 'neg' : 'muted')}>
            After this bill: {pending - Number(v.amount) < 0 ? `${money(Number(v.amount) - pending)} more than the advance` : `${money(pending - Number(v.amount))} left pending on ${adv.serial}`}
          </p>
        )}
      </form>
      {newPayee && (
        <Sheet title="New payee" onClose={() => setNewPayee(false)}>
          <PayeeForm me={me} onSaved={(p) => { setNewPayee(false); setV((x) => ({ ...x, payee_id: p.id })); }} />
        </Sheet>
      )}
    </Sheet>
  );
}
