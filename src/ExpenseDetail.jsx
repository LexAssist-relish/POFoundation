import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useData } from './App';
import { supabase, rpc, BUCKET } from './supabase';
import { money, fmtDate, fmtDateTime, has, upiLink, waLink, appLink, uploadAttachment, effAmount } from './util';
import { Sheet, Chip, Field, FilePicker, PendingFiles, Attachments } from './ui';
import ExpenseForm from './ExpenseForm';

export default function ExpenseDetail({ id, onClose }) {
  const { expenses, me, userById, payeeById, attByExp, reload, toast } = useData();
  const e = expenses.find((x) => x.id === id);
  const [log, setLog] = useState([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    supabase.from('activity').select('*').eq('expense_id', id).order('created_at')
      .then(({ data }) => setLog(data || []));
  }, [id, e?.updated_at, (attByExp[id] || []).length]);

  if (!e) return <Sheet title="Expense" onClose={onClose}><p className="muted">Not found (it may have been deleted).</p></Sheet>;

  const payee = payeeById[e.payee_id];
  const atts = attByExp[e.id] || [];
  const isApprover = has(me, 'approver');
  const isAdmin = has(me, 'admin');
  const isMine = e.submitted_by === me.id;
  const canPay = e.status === 'approved' && (e.payer_id === me.id || isAdmin);
  const canEdit = (isMine && ['submitted', 'query'].includes(e.status)) || (isAdmin && e.status !== 'paid');
  const canDeleteExp = isAdmin ? e.status !== 'paid' : (isMine && ['submitted', 'query'].includes(e.status));
  const altered = e.approved_amount !== null && Number(e.approved_amount) !== Number(e.amount);

  const delExpense = async () => {
    if (!confirm(`Delete ${e.serial}? This cannot be undone.`)) return;
    if (atts.length) await supabase.storage.from(BUCKET).remove(atts.map((a) => a.path));
    const { error } = await supabase.from('expenses').delete().eq('id', e.id);
    if (error) return toast(error.message, 'err');
    await reload(); toast('Deleted'); onClose();
  };
  const delAtt = async (a) => {
    await supabase.storage.from(BUCKET).remove([a.path]);
    const { error } = await supabase.from('attachments').delete().eq('id', a.id);
    if (error) return toast(error.message, 'err');
    await reload();
  };

  return (
    <Sheet title={e.serial} onClose={onClose} wide>
      <div className="detail-head">
        <div>
          <div className="detail-payee">{payee?.name || '—'}</div>
          <div className="muted">{e.description}</div>
        </div>
        <div className="r">
          <div className="detail-amt">{money(effAmount(e))}</div>
          {altered && <div className="ri-was">submitted {money(e.amount)}</div>}
          <Chip status={e.status} />
        </div>
      </div>

      <dl className="facts">
        <div><dt>Bill date</dt><dd>{fmtDate(e.expense_date)}</dd></div>
        <div><dt>Category</dt><dd>{e.category || '—'}</dd></div>
        <div><dt>Entered by</dt><dd>{userById[e.submitted_by]?.full_name}</dd></div>
        {payee?.upi_id && <div><dt>Payee UPI</dt><dd className="mono">{payee.upi_id} {payee.verified ? <span className="tick">✓</span> : <span className="chip amber tiny">unverified</span>}</dd></div>}
        {e.approved_by && <div><dt>{e.status === 'rejected' ? 'Rejected by' : e.status === 'query' ? 'Query by' : 'Approved by'}</dt><dd>{userById[e.approved_by]?.full_name}</dd></div>}
        {e.payer_id && <div><dt>Payer</dt><dd>{userById[e.payer_id]?.full_name}</dd></div>}
        {e.status === 'paid' && <>
          <div><dt>Paid</dt><dd>{money(e.paid_amount)} · {e.payment_mode?.toUpperCase()} · {fmtDateTime(e.paid_at)}</dd></div>
          <div><dt>UTR / Ref</dt><dd className="mono">{e.payment_ref || '—'}</dd></div>
        </>}
      </dl>
      {e.approver_note && <div className={`note ${e.status === 'query' ? 'orange' : e.status === 'rejected' ? 'grey' : ''}`}><b>Approver:</b> {e.approver_note}</div>}

      {isApprover && ['submitted', 'query', 'approved'].includes(e.status) && <ApprovePanel e={e} />}
      {canPay && <PayPanel e={e} payee={payee} />}
      {e.status === 'paid' && (e.paid_by === me.id || e.payer_id === me.id || isAdmin) && <RevertPanel e={e} />}

      <Nudges e={e} payee={payee} />

      <section className="detail-section">
        <h4>Attachments</h4>
        <Attachments items={atts} canDelete={(a) => isAdmin || a.uploaded_by === me.id} onDelete={delAtt} />
        {!has(me, 'viewer') || me.roles.length > 1 ? <AddFiles e={e} me={me} /> : null}
      </section>

      <section className="detail-section">
        <h4>History</h4>
        <ol className="timeline">
          {log.map((l) => <li key={l.id}><span className="tl-when">{fmtDateTime(l.created_at)}</span> <b>{userById[l.actor]?.full_name || 'System'}</b> {describe(l)}</li>)}
        </ol>
      </section>

      {(canEdit || canDeleteExp) && (
        <div className="row gap wrap" style={{ marginTop: 16 }}>
          {canEdit && <button className="btn" onClick={() => setEditing(true)}>✎ Edit{e.status === 'query' ? ' & resubmit' : ''}</button>}
          {canDeleteExp && <button className="btn danger" onClick={delExpense}>Delete</button>}
        </div>
      )}
      {editing && <ExpenseForm initial={e} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />}
    </Sheet>
  );
}

function describe(l) {
  const d = l.details || {};
  switch (l.action) {
    case 'submitted': return <>submitted {money(d.amount)}</>;
    case 'edited': return <>edited{d.from?.amount !== d.to?.amount ? <> — amount {money(d.from?.amount)} → {money(d.to?.amount)}</> : ''}</>;
    case 'approved': case 're-approved':
      return <>{l.action} {money(d.approved_amount)}{d.altered ? <> (submitted {money(d.submitted_amount)})</> : ''} · payer {d.payer}{d.note ? <> · “{d.note}”</> : ''}</>;
    case 'query': return <>raised a query: “{d.note}”</>;
    case 'rejected': return <>rejected{d.note ? <>: “{d.note}”</> : ''}</>;
    case 'paid': return <>paid {money(d.amount)} by {String(d.mode).toUpperCase()}{d.ref ? <> · {d.ref}</> : ''}</>;
    case 'payment_reverted': return <>marked the payment as failed{d.note ? <>: “{d.note}”</> : ''}</>;
    default: return l.action;
  }
}

function ApprovePanel({ e }) {
  const { users, categories, reload, toast, me } = useData();
  const payers = users.filter((u) => u.active && u.roles.includes('payer'));
  const lastPayer = (() => { try { return localStorage.getItem('pof-last-payer'); } catch { return null; } })();
  const [open, setOpen] = useState(e.status !== 'approved');
  const [amount, setAmount] = useState(e.approved_amount ?? e.amount);
  const [payer, setPayer] = useState(e.payer_id || (payers.some((p) => p.id === lastPayer) ? lastPayer : payers.find((p) => p.id === me.id)?.id) || '');
  const [category, setCategory] = useState(e.category || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); await reload(); toast(okMsg); } catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };
  const approve = () => {
    if (!payer) return toast('Choose who will pay', 'err');
    try { localStorage.setItem('pof-last-payer', payer); } catch {}
    run(() => rpc('approve_expense', { p_id: e.id, p_amount: Number(amount), p_payer: payer, p_category: category || null, p_payee: null, p_note: note.trim() || null }),
      e.status === 'approved' ? 'Approval updated' : 'Approved — payer can pay now');
  };
  const send = (action) => {
    if (!note.trim()) return toast(action === 'query' ? 'Write the question for Bejoy' : 'Give a reason', 'err');
    run(() => rpc('return_expense', { p_id: e.id, p_action: action, p_note: note.trim() }), action === 'query' ? 'Query sent' : 'Rejected');
  };

  if (!open) return <button className="btn ghost block" onClick={() => setOpen(true)}>Change amount / payer</button>;
  return (
    <section className="panel approve">
      <h4>{e.status === 'approved' ? 'Update approval' : 'Approve'}</h4>
      <div className="grid2 tight">
        <Field label="Approved amount (₹)" hint={Number(amount) !== Number(e.amount) ? `Bejoy entered ${money(e.amount)}` : null}>
          <input type="number" step="0.01" min="0.01" inputMode="decimal" value={amount} onChange={(x) => setAmount(x.target.value)} className="amount-input" />
        </Field>
        <Field label="Who pays?">
          <select value={payer} onChange={(x) => setPayer(x.target.value)}>
            <option value="">Select payer…</option>
            {payers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Category">
        <select value={category} onChange={(x) => setCategory(x.target.value)}>
          <option value="">—</option>{categories.map((c) => <option key={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Note (needed for query / reject)">
        <input value={note} onChange={(x) => setNote(x.target.value)} placeholder="Optional for approval" />
      </Field>
      <div className="row gap wrap">
        <button className="btn primary" disabled={busy} onClick={approve}>✓ {e.status === 'approved' ? 'Save' : 'Approve'}</button>
        <button className="btn" disabled={busy} onClick={() => send('query')}>? Query</button>
        <button className="btn danger" disabled={busy} onClick={() => send('rejected')}>Reject</button>
      </div>
    </section>
  );
}

function PayPanel({ e, payee }) {
  const { reload, toast } = useData();
  const amount = Number(e.approved_amount ?? e.amount);
  const note = `${e.serial} ${e.description}`.slice(0, 60);
  const link = payee?.upi_id ? upiLink({ vpa: payee.upi_id, name: payee.name, amount, note }) : null;
  const [qr, setQr] = useState(null);
  const [mode, setMode] = useState(payee?.upi_id ? 'upi' : 'bank');
  const [ref, setRef] = useState('');
  const [paidAmt, setPaidAmt] = useState(amount);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (link) QRCode.toDataURL(link, { margin: 1, width: 560, color: { dark: '#1f4f4c' } }).then(setQr);
  }, [link]);

  const copy = async (t, m) => { try { await navigator.clipboard.writeText(t); toast(m); } catch { prompt('Copy:', t); } };

  const record = async () => {
    if (mode !== 'cash' && !ref.trim() && files.length === 0) return toast('Add the UTR / transaction ID or the receipt', 'err');
    if (Number(paidAmt) !== amount && !confirm(`You paid ${money(paidAmt)} but ${money(amount)} was approved. Continue?`)) return;
    setBusy(true);
    try {
      // upload first, so a failed upload doesn't leave a "paid" entry without its receipt
      for (const f of files) await uploadAttachment(e.id, f, 'receipt');
      await rpc('mark_paid', { p_id: e.id, p_mode: mode, p_ref: ref.trim() || null, p_amount: Number(paidAmt), p_paid_at: null });
      await reload(); toast('Payment recorded ✓');
    } catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };

  return (
    <section className="panel pay">
      <h4>Pay {money(amount)} to {payee?.name}</h4>
      {link ? (
        <div className="pay-grid">
          {qr && <a href={qr} download={`${e.serial}-upi.png`} className="qr" title="Save QR image"><img src={qr} alt="UPI QR code" /></a>}
          <div className="pay-actions">
            <a className="btn primary block big" href={link}>Pay with GPay / UPI app</a>
            <button className="btn ghost block" onClick={() => copy(payee.upi_id, 'UPI ID copied')}>Copy UPI ID <span className="mono small">{payee.upi_id}</span></button>
            <button className="btn ghost block" onClick={() => copy(String(amount), 'Amount copied')}>Copy amount {money(amount)}</button>
            <p className="small muted">On a laptop, scan the QR with your phone. If GPay blocks the link for a large amount, save the QR (tap it) and scan it from your gallery in GPay, or pay to the UPI ID directly. Narration: <i>{note}</i></p>
          </div>
        </div>
      ) : (
        <p className="note orange">This payee has no UPI ID. Pay by bank transfer or cash{payee?.bank_note ? <> — <span className="mono">{payee.bank_note}</span></> : ''}, then record it below.</p>
      )}

      <div className="divider">After paying, share the receipt here</div>
      <p className="small muted">Tip: in GPay tap <b>Share</b> on the payment screen and choose <b>P O Foundation</b> — it attaches automatically. Or add it below.</p>
      <div className="seg">
        {[['upi', 'UPI'], ['bank', 'Bank transfer'], ['cash', 'Cash']].map(([k, l]) => (
          <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>
        ))}
      </div>
      <div className="grid2 tight">
        <Field label={mode === 'cash' ? 'Reference (optional)' : 'UTR / UPI transaction ID'}>
          <input value={ref} onChange={(x) => setRef(x.target.value.trim())} className="mono" placeholder={mode === 'upi' ? '12-digit UPI ref' : ''} />
        </Field>
        <Field label="Amount paid (₹)">
          <input type="number" step="0.01" inputMode="decimal" value={paidAmt} onChange={(x) => setPaidAmt(x.target.value)} />
        </Field>
      </div>
      <FilePicker label="receipt" onFiles={(fs) => setFiles((x) => [...x, ...fs])} />
      <PendingFiles files={files} onRemove={(i) => setFiles((x) => x.filter((_, j) => j !== i))} />
      <button className="btn primary block" disabled={busy} onClick={record} style={{ marginTop: 10 }}>{busy ? 'Saving…' : 'Mark as paid'}</button>
    </section>
  );
}

function RevertPanel({ e }) {
  const { reload, toast } = useData();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>Payment failed or returned?</button>;
  return (
    <section className="panel">
      <p className="small">This puts {e.serial} back to <b>Awaiting payment</b> so it can be paid again. The receipt stays attached for the record.</p>
      <Field label="What happened?"><input value={note} onChange={(x) => setNote(x.target.value)} placeholder="e.g. UPI failed, money returned" /></Field>
      <div className="row gap">
        <button className="btn danger" onClick={async () => {
          try { await rpc('revert_payment', { p_id: e.id, p_note: note.trim() || null }); await reload(); toast('Back to awaiting payment'); }
          catch (err) { toast(err.message, 'err'); }
        }}>Mark payment failed</button>
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </section>
  );
}

function Nudges({ e, payee }) {
  const { users, userById, me } = useData();
  const amt = money(effAmount(e));
  const msgs = [];
  if (e.status === 'submitted') {
    users.filter((u) => u.active && u.roles.includes('approver') && u.id !== me.id && u.phone).forEach((u) =>
      msgs.push([`Ask ${u.full_name.split(' ')[0]} to approve`, waLink(u.phone,
        `P O Foundation · Bejoy's wedding\n${e.serial}: ${amt} to ${payee?.name} for ${e.description} is waiting for your approval.\n${appLink(e.id)}`)]));
  }
  if (e.status === 'approved') {
    const p = userById[e.payer_id];
    if (p?.phone && p.id !== me.id) msgs.push([`Send pay link to ${p.full_name.split(' ')[0]}`, waLink(p.phone,
      `P O Foundation · Bejoy's wedding\nPlease pay ${amt} to ${payee?.name} (${e.serial} – ${e.description}).\nOpen to pay with GPay and share the receipt: ${appLink(e.id)}`)]);
  }
  if (e.status === 'query') {
    const s = userById[e.submitted_by];
    if (s?.phone && s.id !== me.id) msgs.push([`Tell ${s.full_name.split(' ')[0]} about the query`, waLink(s.phone,
      `P O Foundation: query on ${e.serial} (${payee?.name}, ${amt}): ${e.approver_note}\n${appLink(e.id)}`)]);
  }
  if (!msgs.length) return null;
  return (
    <div className="row gap wrap nudges">
      {msgs.map(([l, h]) => <a key={l} className="btn wa small" href={h} target="_blank" rel="noreferrer">💬 {l}</a>)}
    </div>
  );
}

function AddFiles({ e, me }) {
  const { reload, toast } = useData();
  const [files, setFiles] = useState([]);
  const [kind, setKind] = useState(e.status === 'paid' || e.status === 'approved' ? 'receipt' : 'bill');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>+ Add attachment</button>;
  const save = async () => {
    setBusy(true);
    try { for (const f of files) await uploadAttachment(e.id, f, kind); setFiles([]); setOpen(false); await reload(); toast('Attached'); }
    catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };
  return (
    <div className="panel">
      <div className="seg">
        {[['bill', 'Bill / invoice'], ['receipt', 'Payment receipt'], ['other', 'Other']].map(([k, l]) => (
          <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>
        ))}
      </div>
      <FilePicker label="it" onFiles={(fs) => setFiles((x) => [...x, ...fs])} />
      <PendingFiles files={files} onRemove={(i) => setFiles((x) => x.filter((_, j) => j !== i))} />
      <div className="row gap" style={{ marginTop: 8 }}>
        <button className="btn primary" disabled={busy || !files.length} onClick={save}>{busy ? 'Uploading…' : 'Upload'}</button>
        <button className="btn" onClick={() => { setFiles([]); setOpen(false); }}>Cancel</button>
      </div>
    </div>
  );
}
