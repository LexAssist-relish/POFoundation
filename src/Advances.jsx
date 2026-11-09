import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useData, go } from './App';
import { supabase, rpc, readReceipt, BUCKET } from './supabase';
import { money, fmtDate, fmtDateTime, has, upiLink, waLink, uploadAttachment, advanceBalance, ADV_STATUS } from './util';
import { Sheet, Field, FilePicker, PendingFiles, Attachments } from './ui';
import ReceiptReadout from './ReceiptReadout';
import SettleForm from './SettleForm';

export const AdvChip = ({ status }) => {
  const s = ADV_STATUS[status] || { label: status, tone: 'grey' };
  return <span className={`chip ${s.tone}`}>{s.label}</span>;
};

// ---------- Request (or edit) an advance ----------
export function AdvanceForm({ initial, onClose }) {
  const { project, reload, toast } = useData();
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [purpose, setPurpose] = useState(initial?.purpose || '');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      let id = initial?.id;
      if (initial) await rpc('edit_advance', { p_id: id, p_amount: Number(amount), p_purpose: purpose.trim() });
      else {
        const { data, error } = await supabase.from('advances').insert({ project_id: project.id, amount: Number(amount), purpose: purpose.trim() }).select('id, serial').single();
        if (error) throw new Error(error.message);
        id = data.id;
      }
      await reload(); toast(initial ? 'Advance updated' : 'Advance requested — waiting for approval');
      onClose(); go('#/a/' + id);
    } catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };
  return (
    <Sheet title={initial ? `Edit ${initial.serial}` : 'Request an advance'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="adv-form" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save & resubmit' : 'Request advance'}</button></>}>
      <form id="adv-form" className="form" onSubmit={save}>
        <p className="small muted" style={{ marginTop: 0 }}>Money paid to you in advance, to cover several payments you’ll make yourself. After paying each bill, record it with <b>“I paid a bill”</b> — the advance is settled bill by bill.</p>
        <Field label="Amount needed (₹)"><input required type="number" min="1" step="1" inputMode="numeric" className="amount-input" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="What is it for?" hint="e.g. Cash for flower market, auto charges and church helpers">
          <input required value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={200} />
        </Field>
      </form>
    </Sheet>
  );
}

// ---------- Compact card used in lists ----------
export function AdvanceCard({ a, onSettle }) {
  const { expenses, userById } = useData();
  const b = advanceBalance(a, expenses);
  const live = a.status === 'paid';
  return (
    <div className={'adv-card' + (live ? ' live' : '')}>
      <a href={'#/a/' + a.id} className="adv-top">
        <div className="ri-main">
          <div className="ri-title">{a.serial} <span className="ri-serial">{userById[a.requested_by]?.full_name}</span></div>
          <div className="ri-sub">{a.purpose}</div>
        </div>
        <div className="ri-side"><div className="ri-amt">{money(a.paid_amount ?? a.approved_amount ?? a.amount)}</div><AdvChip status={a.status} /></div>
      </a>
      {(live || a.status === 'closed') && (
        <>
          <div className="bar"><span style={{ width: (b.given ? Math.min(100, ((b.settled + b.returned) / b.given) * 100) : 0) + '%' }} className={b.pending < 0 ? 'over' : ''} /></div>
          <div className="adv-nums">
            <span>Bills {money(b.settled)}{b.returned ? ` · returned ${money(b.returned)}` : ''}</span>
            <b className={b.pending < 0 ? 'neg' : ''}>{b.pending < 0 ? `Over by ${money(-b.pending)}` : `Pending ${money(b.pending)}`}</b>
          </div>
          {live && onSettle && <button className="btn primary block" onClick={() => onSettle(a)}>+ Add a bill I paid from this</button>}
        </>
      )}
    </div>
  );
}

// ---------- Full view ----------
export function AdvanceDetail({ id, onClose }) {
  const { advances, expenses, me, userById, payeeById, attByAdv = {}, reload, toast } = useData();
  const a = advances.find((x) => x.id === id);
  const [log, setLog] = useState([]);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    supabase.from('activity').select('*').eq('advance_id', id).order('created_at').then(({ data }) => setLog(data || []));
  }, [id, a?.updated_at, (attByAdv[id] || []).length]);
  if (!a) return <Sheet title="Advance" onClose={onClose}><p className="muted">Not found.</p></Sheet>;

  const b = advanceBalance(a, expenses);
  const mine = a.requested_by === me.id;
  const isAdmin = has(me, 'admin');
  const canEdit = (mine && ['requested', 'query'].includes(a.status)) || (isAdmin && ['requested', 'query', 'approved'].includes(a.status));
  const canDelete = (mine && ['requested', 'query', 'rejected'].includes(a.status)) || (isAdmin && !['paid', 'closed'].includes(a.status));
  const atts = attByAdv[a.id] || [];

  const del = async () => {
    if (atts.length) await supabase.storage.from(BUCKET).remove(atts.map((x) => x.path));
    const { error } = await supabase.from('advances').delete().eq('id', a.id);
    if (error) return toast(error.message, 'err');
    await reload(); toast('Deleted'); onClose();
  };
  const delAtt = async (x) => {
    await supabase.storage.from(BUCKET).remove([x.path]);
    await supabase.from('attachments').delete().eq('id', x.id); await reload();
  };

  return (
    <Sheet title={`Advance ${a.serial}`} onClose={onClose} wide>
      <div className="detail-head">
        <div>
          <div className="detail-payee">{userById[a.requested_by]?.full_name}</div>
          <div className="muted">{a.purpose}</div>
        </div>
        <div className="r">
          <div className="detail-amt">{money(a.paid_amount ?? a.approved_amount ?? a.amount)}</div>
          {a.approved_amount != null && Number(a.approved_amount) !== Number(a.amount) && <div className="ri-was">asked {money(a.amount)}</div>}
          <AdvChip status={a.status} />
        </div>
      </div>

      {(a.status === 'paid' || a.status === 'closed') && (
        <div className="settle-box">
          <div><span>Given</span><b>{money(b.given)}</b></div>
          <div><span>Bills paid</span><b>{money(b.settled)}</b></div>
          {b.returned > 0 && <div><span>Returned</span><b>{money(b.returned)}</b></div>}
          <div className={'pend' + (b.pending < 0 ? ' neg' : '')}><span>{b.pending < 0 ? 'Spent beyond advance' : 'Pending settlement'}</span><b>{money(Math.abs(b.pending))}</b></div>
        </div>
      )}

      <dl className="facts">
        <div><dt>Requested</dt><dd>{fmtDate(a.created_at)}</dd></div>
        {a.approved_by && <div><dt>{a.status === 'rejected' ? 'Rejected by' : a.status === 'query' ? 'Query by' : 'Approved by'}</dt><dd>{userById[a.approved_by]?.full_name}</dd></div>}
        {a.payer_id && <div><dt>Payer</dt><dd>{userById[a.payer_id]?.full_name}</dd></div>}
        {a.paid_at && <div><dt>Paid</dt><dd>{a.payment_mode?.toUpperCase()} · {fmtDateTime(a.paid_at)}</dd></div>}
        {a.payment_ref && <div><dt>UTR / Ref</dt><dd className="mono">{a.payment_ref}</dd></div>}
      </dl>
      {a.approver_note && <div className={`note ${a.status === 'query' ? 'orange' : ''}`}><b>Approver:</b> {a.approver_note}</div>}

      {has(me, 'approver') && ['requested', 'query', 'approved'].includes(a.status) && <ApproveAdvance a={a} />}
      {a.status === 'approved' && (a.payer_id === me.id || isAdmin) && <PayAdvance a={a} />}
      {a.status === 'approved' && a.payer_id !== me.id && <Nudge a={a} />}

      {(a.status === 'paid' || a.status === 'closed') && (
        <section className="detail-section">
          <h4>Bills settled from this advance</h4>
          {b.bills.length === 0 ? <p className="muted small">None yet.</p> : (
            <div className="card flush">
              {b.bills.map((e) => (
                <a key={e.id} className="row-item" href={'#/e/' + e.id}>
                  <div className="ri-main"><div className="ri-title">{payeeById[e.payee_id]?.name || '—'} <span className="ri-serial">{e.serial}</span></div><div className="ri-sub">{e.description}</div></div>
                  <div className="ri-side"><div className="ri-amt">{money(e.paid_amount ?? e.amount)}</div><span className="chip green">Paid</span></div>
                </a>
              ))}
            </div>
          )}
          {a.status === 'paid' && mine && <button className="btn primary block" style={{ marginTop: 10 }} onClick={() => setSettling(true)}>+ Add a bill I paid from this</button>}
          {a.status === 'paid' && (mine || isAdmin) && <SettleActions a={a} b={b} />}
        </section>
      )}

      <section className="detail-section">
        <h4>Attachments</h4>
        <Attachments items={atts} canDelete={(x) => isAdmin || x.uploaded_by === me.id} onDelete={delAtt} />
      </section>

      <section className="detail-section">
        <h4>History</h4>
        <ol className="timeline">
          {log.map((l) => <li key={l.id}><span className="tl-when">{fmtDateTime(l.created_at)}</span> <b>{userById[l.actor]?.full_name || 'System'}</b> {describe(l)}</li>)}
        </ol>
      </section>

      {(canEdit || canDelete) && (
        <div className="row gap wrap" style={{ marginTop: 16 }}>
          {canEdit && <button className="btn" onClick={() => setEditing(true)}>✎ Edit{a.status === 'query' ? ' & resubmit' : ''}</button>}
          {canDelete && (confirmDel ? <button className="btn danger" onClick={del}>Tap again to delete</button>
            : <button className="btn danger" onClick={() => setConfirmDel(true)}>Delete</button>)}
        </div>
      )}
      {editing && <AdvanceForm initial={a} onClose={() => setEditing(false)} />}
      {settling && <SettleForm defaultAdvance={a} onClose={() => setSettling(false)} />}
    </Sheet>
  );
}

function describe(l) {
  const d = l.details || {};
  switch (l.action) {
    case 'requested': return <>requested {money(d.amount)}</>;
    case 'edited': return <>changed the amount {money(d.from)} → {money(d.to)}</>;
    case 'approved': return <>approved {money(d.approved)}{d.approved !== d.requested ? <> (asked {money(d.requested)})</> : ''} · payer {d.payer}{d.note ? <> · “{d.note}”</> : ''}</>;
    case 'query': return <>raised a query: “{d.note}”</>;
    case 'rejected': return <>rejected{d.note ? <>: “{d.note}”</> : ''}</>;
    case 'paid': return <>paid {money(d.amount)} by {String(d.mode || '').toUpperCase()}{d.ref ? <> · {d.ref}</> : ''}</>;
    case 'payment_reverted': return <>marked the payment as failed{d.note ? <>: “{d.note}”</> : ''}</>;
    case 'returned': return <>returned {money(d.amount)} unspent{d.ref ? <> · {d.ref}</> : ''}</>;
    case 'closed': return <>closed the advance{d.note ? <>: “{d.note}”</> : ''}</>;
    default: return l.action;
  }
}

function ApproveAdvance({ a }) {
  const { users, reload, toast, me } = useData();
  const payers = users.filter((u) => u.active && u.roles.includes('payer'));
  const [open, setOpen] = useState(a.status !== 'approved');
  const [amount, setAmount] = useState(a.approved_amount ?? a.amount);
  const [payer, setPayer] = useState(a.payer_id || payers.find((p) => p.username === 'sherine')?.id || payers.find((p) => p.id === me.id)?.id || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn, msg) => { setBusy(true); try { await fn(); await reload(); toast(msg); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  if (!open) return <button className="btn ghost block" onClick={() => setOpen(true)}>Change amount / payer</button>;
  return (
    <section className="panel approve">
      <h4>{a.status === 'approved' ? 'Update approval' : 'Approve advance'}</h4>
      <div className="grid2 tight">
        <Field label="Approved amount (₹)"><input type="number" min="1" inputMode="decimal" className="amount-input" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Who pays it?">
          <select value={payer} onChange={(e) => setPayer(e.target.value)}>
            <option value="">Select payer…</option>{payers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Note (needed for query / reject)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="row gap wrap">
        <button className="btn primary" disabled={busy} onClick={() => payer ? run(() => rpc('approve_advance', { p_id: a.id, p_amount: Number(amount), p_payer: payer, p_note: note.trim() || null }), 'Advance approved') : toast('Choose who pays', 'err')}>✓ {a.status === 'approved' ? 'Save' : 'Approve'}</button>
        <button className="btn" disabled={busy} onClick={() => note.trim() ? run(() => rpc('return_advance_request', { p_id: a.id, p_action: 'query', p_note: note.trim() }), 'Query sent') : toast('Write the question', 'err')}>? Query</button>
        <button className="btn danger" disabled={busy} onClick={() => note.trim() ? run(() => rpc('return_advance_request', { p_id: a.id, p_action: 'rejected', p_note: note.trim() }), 'Rejected') : toast('Give a reason', 'err')}>Reject</button>
      </div>
    </section>
  );
}

function PayAdvance({ a }) {
  const { userById, funds = [], me, reload, toast } = useData();
  const to = userById[a.requested_by];
  const amount = Number(a.approved_amount ?? a.amount);
  const note = `${a.serial} advance ${a.purpose}`.slice(0, 60);
  const link = to?.upi_id ? upiLink({ vpa: to.upi_id, name: to.full_name, amount, note }) : null;
  const [qr, setQr] = useState(null);
  const [mode, setMode] = useState(to?.upi_id ? 'upi' : 'bank');
  const [ref, setRef] = useState('');
  const [paid, setPaid] = useState(amount);
  const [from, setFrom] = useState(funds.find((f) => f.holder === me.id)?.id || funds.find((f) => f.is_default)?.id || '');
  const [files, setFiles] = useState([]);
  const [reading, setReading] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 560, color: { dark: '#1f4f4c' } }).then(setQr); }, [link]);

  const addFiles = async (fs) => {
    const first = files.length === 0 ? fs[0] : null;
    setFiles((x) => [...x, ...fs]);
    if (!first) return;
    setReading({ loading: true });
    const r = await readReceipt(first);
    const warnings = (r.warnings || []).filter((w) => /FAILED|PENDING|doesn’t look/.test(w));
    if (r.extracted?.amount != null && Math.abs(r.extracted.amount - amount) >= 1) warnings.push(`Receipt shows ${money(r.extracted.amount)}; ${money(amount)} was approved.`);
    setReading({ ...r, warnings });
    if (r.extracted?.utr) setRef((c) => c || r.extracted.utr);
    if (r.extracted?.amount != null) setPaid(r.extracted.amount);
  };
  const record = async () => {
    if (mode !== 'cash' && !ref.trim() && !files.length) return toast('Add the UTR or the receipt', 'err');
    setBusy(true);
    try {
      for (const f of files) await uploadAttachment({ advance_id: a.id }, f, 'receipt');
      await rpc('mark_advance_paid', { p_id: a.id, p_mode: mode, p_ref: ref.trim() || null, p_amount: Number(paid), p_from: from || null });
      await reload(); toast(`${a.serial} paid — now pending settlement`);
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <section className="panel pay">
      <h4>Pay advance {money(amount)} to {to?.full_name}</h4>
      {link ? (
        <div className="pay-grid">
          {qr && <a href={qr} download={`${a.serial}-upi.png`} className="qr"><img src={qr} alt="UPI QR code" /></a>}
          <div className="pay-actions">
            <a className="btn primary block big" href={link}>Pay with GPay / UPI app</a>
            <button className="btn ghost block" onClick={() => navigator.clipboard?.writeText(to.upi_id).then(() => toast('UPI ID copied'))}>Copy UPI ID <span className="mono small">{to.upi_id}</span></button>
          </div>
        </div>
      ) : <p className="note orange">{to?.full_name} has no UPI ID saved — add it under Users, or pay by bank/cash.</p>}
      <div className="divider">After paying</div>
      <div className="seg">{[['upi', 'UPI'], ['bank', 'Bank'], ['cash', 'Cash']].map(([k, l]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}</div>
      <div className="grid2 tight">
        <Field label="UTR / reference"><input className="mono" value={ref} onChange={(e) => setRef(e.target.value.trim())} /></Field>
        <Field label="Amount paid (₹)"><input type="number" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
      </div>
      {funds.length > 0 && (
        <Field label="Paid from">
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {funds.filter((f) => f.holder !== a.requested_by).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            <option value="">My own money (counts as my contribution)</option>
          </select>
        </Field>
      )}
      <FilePicker label="receipt" onFiles={addFiles} />
      <PendingFiles files={files} onRemove={(i) => { setFiles((x) => x.filter((_, j) => j !== i)); if (i === 0) setReading(null); }} />
      <ReceiptReadout reading={reading} />
      <button className="btn primary block" style={{ marginTop: 10 }} disabled={busy || reading?.loading || reading?.extracted?.status === 'failed'} onClick={record}>{busy ? 'Saving…' : 'Mark advance as paid'}</button>
    </section>
  );
}

function Nudge({ a }) {
  const { userById } = useData();
  const p = userById[a.payer_id];
  if (!p?.phone) return null;
  return <a className="btn wa small" target="_blank" rel="noreferrer" href={waLink(p.phone, `P O Foundation: please pay advance ${a.serial} (${money(a.approved_amount)}) to ${userById[a.requested_by]?.full_name}.\n${location.origin}/#/a/${a.id}`)}>💬 Remind {p.full_name.split(' ')[0]} to pay</a>;
}

// Return unspent money / close the advance
function SettleActions({ a, b }) {
  const { reload, toast, userById, funds = [] } = useData();
  const [mode, setMode] = useState(null); // 'return' | 'close'
  const [amt, setAmt] = useState(Math.max(0, b.pending));
  const [ref, setRef] = useState('');
  const [via, setVia] = useState('upi');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const back = funds.find((f) => f.id === a.paid_from);
  const backTo = back?.holder ? userById[back.holder] : userById[a.paid_by];

  const doReturn = async () => {
    setBusy(true);
    try {
      if (file) await uploadAttachment({ advance_id: a.id }, file, 'other');
      await rpc('record_advance_return', { p_id: a.id, p_amount: Number(amt), p_mode: via, p_ref: ref.trim() || null });
      await reload(); toast(`${money(amt)} returned`); setMode(null);
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const doClose = async () => {
    setBusy(true);
    try { await rpc('close_advance', { p_id: a.id, p_note: null }); await reload(); toast(`${a.serial} settled`); }
    catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  return (
    <div className="row gap wrap" style={{ marginTop: 12 }}>
      {b.pending > 0 && !mode && <button className="btn" onClick={() => setMode('return')}>↩ Return unspent {money(b.pending)}</button>}
      {Math.abs(b.pending) < 1 && <button className="btn primary" disabled={busy} onClick={doClose}>✓ Mark advance settled</button>}
      {b.pending < 0 && <p className="small muted">Bills are {money(-b.pending)} more than the advance — an admin can reimburse that as a payment request to you.</p>}
      {mode === 'return' && (
        <div className="panel" style={{ width: '100%' }}>
          <p className="small" style={{ marginTop: 0 }}>Send the unspent money back{backTo?.upi_id ? <> to <b>{backTo.full_name}</b> (<span className="mono">{backTo.upi_id}</span>)</> : ''}, then record it here.</p>
          <div className="grid2 tight">
            <Field label="Amount returned (₹)"><input type="number" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
            <Field label="UTR / reference"><input className="mono" value={ref} onChange={(e) => setRef(e.target.value.trim())} /></Field>
          </div>
          <div className="seg">{[['upi', 'UPI'], ['bank', 'Bank'], ['cash', 'Cash']].map(([k, l]) => <button key={k} className={via === k ? 'on' : ''} onClick={() => setVia(k)}>{l}</button>)}</div>
          <FilePicker label="receipt" multiple={false} onFiles={(fs) => setFile(fs[0])} />
          <PendingFiles files={file ? [file] : []} onRemove={() => setFile(null)} />
          <div className="row gap" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={busy || !(Number(amt) > 0)} onClick={doReturn}>Record return</button>
            <button className="btn" onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
