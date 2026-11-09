import { useState } from 'react';
import { useData } from './App';
import { supabase, rpc } from './supabase';
import { todayISO, uploadAttachment } from './util';
import { Field, FilePicker, PendingFiles, Sheet } from './ui';
import { PayeeForm } from './Payees';

export default function ExpenseForm({ initial, onDone, onCancel }) {
  const { project, payees, categories, toast, reload, me, funds = [] } = useData();
  // accounts this person holds money in (e.g. Bejoy: "With Bejoy") — lets them enter bills they've already paid
  const heldFunds = funds.filter((f) => f.holder === me.id);
  const [prepaid, setPrepaid] = useState(false);
  const [prepaidFund, setPrepaidFund] = useState(heldFunds[0]?.id || '');
  const [prepaidRef, setPrepaidRef] = useState('');
  const [receipts, setReceipts] = useState([]);
  const editing = !!initial;
  const [v, setV] = useState(() => ({
    expense_date: initial?.expense_date || todayISO(),
    payee_id: initial?.payee_id || '',
    category: initial?.category || '',
    description: initial?.description || '',
    amount: initial?.amount ?? '',
  }));
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [newPayee, setNewPayee] = useState(false);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!v.payee_id) return toast('Choose who is being paid', 'err');
    if (!editing && files.length === 0 && !confirm('No bill/invoice attached. Submit anyway?')) return;
    setBusy(true);
    try {
      let id = initial?.id;
      const amount = Number(v.amount);
      if (editing) {
        await rpc('edit_expense', { p_id: id, p_date: v.expense_date, p_payee: v.payee_id, p_category: v.category || null, p_description: v.description.trim(), p_amount: amount });
      } else {
        const already = prepaid && prepaidFund;
        const { data, error } = await supabase.from('expenses').insert({
          project_id: project.id, expense_date: v.expense_date, payee_id: v.payee_id,
          category: v.category || null, description: v.description.trim(), amount,
          ...(already ? { prepaid_fund: prepaidFund, payment_mode: 'upi', payment_ref: prepaidRef.trim() || null } : {}),
        }).select('id').single();
        if (error) throw new Error(error.message);
        id = data.id;
      }
      let failed = 0;
      for (const f of files) { try { await uploadAttachment(id, f, 'bill'); } catch { failed++; } }
      for (const f of receipts) { try { await uploadAttachment(id, f, 'receipt'); } catch { failed++; } }
      await reload();
      toast(failed ? `Saved, but ${failed} file(s) failed to upload — retry from the expense` : editing ? 'Updated'
        : prepaid ? 'Sent for approval — it will be recorded as paid by you' : 'Submitted for approval', failed ? 'err' : 'ok');
      onDone?.(id);
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  const form = (
    <form onSubmit={submit} className="form" id="expense-form">
      <div className="grid2 tight">
        <Field label="Amount (₹)">
          <input type="number" inputMode="decimal" step="0.01" min="0.01" required value={v.amount} onChange={set('amount')} className="amount-input" placeholder="0" />
        </Field>
        <Field label="Bill date">
          <input type="date" required value={v.expense_date} onChange={set('expense_date')} />
        </Field>
      </div>

      <Field label="Pay to">
        <div className="row gap">
          <select required value={v.payee_id} onChange={set('payee_id')} style={{ flex: 1 }}>
            <option value="">Select payee…</option>
            {payees.map((p) => <option key={p.id} value={p.id}>{p.name}{p.upi_id ? '' : ' (no UPI)'}</option>)}
          </select>
          <button type="button" className="btn ghost" onClick={() => setNewPayee(true)}>+ New</button>
        </div>
      </Field>

      <Field label="What is it for?">
        <input required value={v.description} onChange={set('description')} placeholder="e.g. Advance for stage decoration" maxLength={200} />
      </Field>

      <Field label="Category">
        <select value={v.category} onChange={set('category')}>
          <option value="">—</option>
          {categories.map((c) => <option key={c.id}>{c.name}</option>)}
        </select>
      </Field>

      <Field label={editing ? 'Add more bills' : 'Bill / invoice'} hint="Take a clear photo of the full bill, or upload a PDF.">
        <FilePicker onFiles={(fs) => setFiles((x) => [...x, ...fs])} />
        <PendingFiles files={files} onRemove={(i) => setFiles((x) => x.filter((_, j) => j !== i))} />
      </Field>

      {!editing && heldFunds.length > 0 && (
        <div className={'panel' + (prepaid ? ' pay' : '')}>
          <label className="check" style={{ margin: 0 }}>
            <input type="checkbox" checked={prepaid} onChange={(e) => setPrepaid(e.target.checked)} />
            <span><b>I’ve already paid this</b> from money given to me</span>
          </label>
          {prepaid && <>
            {heldFunds.length > 1 && (
              <Field label="Paid from">
                <select value={prepaidFund} onChange={(e) => setPrepaidFund(e.target.value)}>
                  {heldFunds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </Field>
            )}
            <p className="small muted" style={{ margin: '8px 0' }}>It still goes for approval; once approved it’s recorded as paid from <b>{funds.find((f) => f.id === prepaidFund)?.name}</b>.</p>
            <Field label="UTR / reference (optional)"><input className="mono" value={prepaidRef} onChange={(e) => setPrepaidRef(e.target.value.trim())} /></Field>
            <Field label="Payment receipt (optional)">
              <FilePicker label="receipt" onFiles={(fs) => setReceipts((x) => [...x, ...fs])} />
              <PendingFiles files={receipts} onRemove={(i) => setReceipts((x) => x.filter((_, j) => j !== i))} />
            </Field>
          </>}
        </div>
      )}

      {!onCancel && <button className="btn primary block" disabled={busy}>{busy ? 'Saving…' : 'Submit for approval'}</button>}
    </form>
  );

  const payeeSheet = newPayee && (
    <Sheet title="New payee" onClose={() => setNewPayee(false)}>
      <PayeeForm onSaved={(p) => { setNewPayee(false); setV((x) => ({ ...x, payee_id: p.id })); }} me={me} />
    </Sheet>
  );

  if (onCancel) {
    return (
      <Sheet title={`Edit ${initial.serial}`} onClose={onCancel}
        footer={<><button className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" form="expense-form" disabled={busy}>{busy ? 'Saving…' : 'Save & resubmit'}</button></>}>
        {form}{payeeSheet}
      </Sheet>
    );
  }
  return (
    <div className="page narrow">
      <h1>Add expense</h1>
      <div className="card">{form}</div>
      {payeeSheet}
    </div>
  );
}
