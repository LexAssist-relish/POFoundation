import { useMemo, useState } from 'react';
import { useData } from './App';
import { supabase, readReceipt, BUCKET } from './supabase';
import { money, fmtDate, todayISO, has, moneySummary, compressImage, signedUrl, downloadCSV } from './util';
import { Sheet, Field, FilePicker, PendingFiles, Empty } from './ui';
import ReceiptReadout from './ReceiptReadout';

const MODES = [['upi', 'UPI'], ['bank', 'Bank'], ['cash', 'Cash'], ['cheque', 'Cheque']];

export default function MoneyIn() {
  const { funds, contributions, expenses, users, userById, me, project, advances = [] } = useData();
  const [edit, setEdit] = useState(null); // contribution | 'new'
  const s = useMemo(() => moneySummary({ funds, contributions, expenses, userById, advances }), [funds, contributions, expenses, userById, advances]);
  const myFunds = funds.filter((f) => has(me, 'admin') || f.holder === me.id);
  const restricted = !!me.hide_money_sources; // e.g. Bejoy: sees only his own account
  const shownFunds = restricted ? funds.filter((f) => f.holder === me.id) : funds;
  const canEdit = (c) => has(me, 'admin') || funds.find((f) => f.id === c.fund_id)?.holder === me.id;

  const exportCSV = () => {
    const rows = [['Date', 'From', 'Amount', 'Status', 'Into account', 'Mode', 'Reference', 'Note', 'Recorded by']];
    contributions.forEach((c) => rows.push([c.received_on || '', c.contributor, c.amount, c.status === 'received' ? 'Received' : 'Will come',
      funds.find((f) => f.id === c.fund_id)?.name, c.mode || '', c.reference || '', c.note || '', userById[c.recorded_by]?.full_name || '']));
    downloadCSV(`${project.code}-money-in-${todayISO()}.csv`, rows);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Money in</h1>
        <div className="row gap">
          {!restricted && <button className="btn ghost small" onClick={exportCSV} disabled={!contributions.length}>⬇ CSV</button>}
          {myFunds.length > 0 && <button className="btn primary small" onClick={() => setEdit('new')}>+ Record money</button>}
        </div>
      </div>

      {restricted && <p className="small muted">Record money that relatives give you directly. It’s used for bills you mark as “already paid”.</p>}

      {!restricted && <>
      <div className="stats">
        <div className="stat"><span className="stat-label">Received</span><span className="stat-value">{money(s.totalIn)}</span><span className="stat-sub">incl. bills paid from own pocket</span></div>
        <div className="stat"><span className="stat-label">Paid out</span><span className="stat-value">{money(s.totalOut)}</span><span className="stat-sub">all payments</span></div>
        <div className="stat"><span className="stat-label">Balance</span><span className={'stat-value' + (s.totalIn - s.totalOut < 0 ? ' neg' : '')}>{money(s.totalIn - s.totalOut)}</span><span className="stat-sub">received − paid</span></div>
        <div className="stat"><span className="stat-label">Will come</span><span className="stat-value">{money(s.totalPledged)}</span><span className="stat-sub">promised, not yet in</span></div>
      </div>

      <section className="card">
        <h2>Accounts</h2>
        <table className="mini">
          <thead><tr><th>Account</th><th className="r">In</th><th className="r">Out</th><th className="r">Balance</th></tr></thead>
          <tbody>
            {s.perFund.map(({ fund, received, out, balance, pledged }) => (
              <tr key={fund.id}>
                <td>{fund.name}{pledged > 0 && <div className="small muted">+ {money(pledged)} to come</div>}</td>
                <td className="r">{money(received)}</td><td className="r">{money(out)}</td>
                <td className={'r' + (balance < 0 ? ' neg' : '')}><b>{money(balance)}</b></td>
              </tr>
            ))}
            {s.advances.given > 0 && (
              <tr><td>Advances — pending settlement<div className="small muted">handed over, not yet covered by bills</div></td>
                <td className="r">{money(s.advances.given - s.advances.returned)}</td><td className="r">{money(s.advances.settled)}</td>
                <td className={'r' + (s.advances.pending < 0 ? ' neg' : '')}><b>{money(s.advances.pending)}</b></td></tr>
            )}
            {s.ownTotal > 0 && (
              <tr><td>Paid from own pocket<div className="small muted">counted as that person’s contribution</div></td>
                <td className="r">{money(s.ownTotal)}</td><td className="r">{money(s.ownTotal)}</td><td className="r">—</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Contributors</h2>
        {s.contributors.length === 0 ? <p className="muted small">No contributions recorded yet.</p> : (
          <table className="mini">
            <thead><tr><th>Name</th><th className="r">Given</th><th className="r">To come</th></tr></thead>
            <tbody>
              {s.contributors.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}{p.direct > 0 && <div className="small muted">{money(p.direct)} paid directly</div>}</td>
                  <td className="r">{money(p.total)}</td><td className="r muted">{p.pledged ? money(p.pledged) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      </>}

      {restricted && shownFunds.map((f) => {
        const r = s.perFund.find((x) => x.fund.id === f.id);
        return r ? (
          <div key={f.id} className="stats">
            <div className="stat"><span className="stat-label">Received</span><span className="stat-value">{money(r.received)}</span><span className="stat-sub">{f.name}</span></div>
            <div className="stat"><span className="stat-label">Spent</span><span className="stat-value">{money(r.out)}</span><span className="stat-sub">bills you paid</span></div>
            <div className="stat"><span className="stat-label">Balance with you</span><span className={'stat-value' + (r.balance < 0 ? ' neg' : '')}>{money(r.balance)}</span><span className="stat-sub">received − spent</span></div>
          </div>
        ) : null;
      })}

      {shownFunds.map((f) => {
        const list = contributions.filter((c) => c.fund_id === f.id);
        return (
          <section key={f.id}>
            <div className="day-head"><span>{f.name}</span><span>{list.length} entr{list.length === 1 ? 'y' : 'ies'}</span></div>
            {list.length === 0 ? <div className="card"><Empty icon="💰" title="Nothing recorded yet">{f.holder ? `${userById[f.holder]?.full_name || 'The holder'} or an admin can record money received here.` : ''}</Empty></div> : (
              <div className="card flush">
                {list.map((c) => (
                  <button key={c.id} className="row-item" onClick={() => canEdit(c) ? setEdit(c) : c.proof_path && signedUrl(c.proof_path).then((u) => window.open(u, '_blank'))}>
                    <div className="ri-main">
                      <div className="ri-title">{c.contributor}</div>
                      <div className="ri-sub">{c.received_on ? fmtDate(c.received_on) : 'Date not set'}{c.mode ? ` · ${c.mode.toUpperCase()}` : ''}{c.note ? ` · ${c.note}` : ''}</div>
                      <div className="ri-meta">{c.reference && <span className="mono">{c.reference}</span>}{c.proof_path && <span>📎 proof</span>}</div>
                    </div>
                    <div className="ri-side">
                      <div className="ri-amt">{money(c.amount)}</div>
                      <span className={`chip ${c.status === 'received' ? 'green' : 'amber'}`}>{c.status === 'received' ? 'Received' : 'Will come'}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {edit && <ContributionSheet c={edit === 'new' ? null : edit} myFunds={myFunds} onClose={() => setEdit(null)} users={users} />}
    </div>
  );
}

function ContributionSheet({ c, myFunds, onClose, users }) {
  const { project, contributions, reload, toast, me } = useData();
  const defFund = myFunds.find((f) => f.holder === me.id) || myFunds.find((f) => f.is_default) || myFunds[0];
  const [v, setV] = useState({
    fund_id: c?.fund_id || defFund?.id || '', contributor: c?.contributor || '', amount: c?.amount ?? '',
    status: c?.status || 'received', received_on: c?.received_on || todayISO(), mode: c?.mode || 'upi',
    reference: c?.reference || '', note: c?.note || '',
  });
  const [file, setFile] = useState(null);
  const [reading, setReading] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));

  // names already used, plus app users, for quick picking
  const names = [...new Set([...contributions.map((x) => x.contributor), ...users.map((u) => u.full_name)])].sort();

  const pickFile = async (fs) => {
    const f = fs[0]; if (!f) return;
    setFile(f);
    setReading({ loading: true });
    const r = await readReceipt(f);
    // matching to bills isn't relevant here; just use what was read
    setReading({ ...r, warnings: (r.warnings || []).filter((w) => /FAILED|PENDING|doesn’t look/.test(w)) });
    const x = r.extracted;
    if (x) setV((cur) => ({
      ...cur,
      amount: cur.amount || x.amount || '',
      reference: cur.reference || x.utr || '',
      received_on: x.transaction_date || cur.received_on,
      mode: x.mode || cur.mode,
    }));
  };

  const save = async (e) => {
    e.preventDefault();
    if (!v.fund_id) return toast('Choose which account the money went into', 'err');
    setBusy(true);
    try {
      let proof = {};
      if (file) {
        const f = await compressImage(file);
        const ext = (f.name?.split('.').pop() || 'jpg').toLowerCase().slice(0, 5);
        const path = `contributions/${project.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined });
        if (error) throw new Error('Upload failed: ' + error.message);
        proof = { proof_path: path, proof_mime: f.type || null };
      }
      const u = users.find((x) => x.full_name.toLowerCase() === v.contributor.trim().toLowerCase());
      const row = {
        fund_id: v.fund_id, contributor: v.contributor.trim(), contributor_id: u?.id || null, amount: Number(v.amount),
        status: v.status, received_on: v.received_on || null, mode: v.mode || null,
        reference: v.reference.trim() || null, note: v.note.trim() || null, updated_at: new Date().toISOString(), ...proof,
      };
      const { error } = c
        ? await supabase.from('contributions').update(row).eq('id', c.id)
        : await supabase.from('contributions').insert({ ...row, project_id: project.id });
      if (error) throw new Error(error.message);
      await reload(); toast(c ? 'Saved' : `${money(row.amount)} from ${row.contributor} recorded`); onClose();
    } catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };

  const del = async () => {
    const { error } = await supabase.from('contributions').delete().eq('id', c.id);
    if (error) return toast(error.message, 'err');
    if (c.proof_path) await supabase.storage.from(BUCKET).remove([c.proof_path]);
    await reload(); toast('Deleted'); onClose();
  };

  return (
    <Sheet title={c ? 'Money received' : 'Record money in'} onClose={onClose}
      footer={<>
        {c && !confirmDel && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmDel(true)}>Delete</button>}
        {c && confirmDel && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Tap again to delete</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" form="contrib-form" disabled={busy || reading?.loading}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <form id="contrib-form" className="form" onSubmit={save}>
        <div className="seg">
          <button type="button" className={v.status === 'received' ? 'on' : ''} onClick={() => setV({ ...v, status: 'received' })}>Received</button>
          <button type="button" className={v.status === 'pledged' ? 'on' : ''} onClick={() => setV({ ...v, status: 'pledged' })}>Will come (promised)</button>
        </div>
        <Field label="From (name)">
          <input required list="contributor-names" value={v.contributor} onChange={set('contributor')} placeholder="e.g. Christy Baby" />
          <datalist id="contributor-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
        </Field>
        <div className="grid2 tight">
          <Field label="Amount (₹)"><input required type="number" min="0.01" step="0.01" inputMode="decimal" className="amount-input" value={v.amount} onChange={set('amount')} /></Field>
          <Field label={v.status === 'received' ? 'Received on' : 'Expected by'}><input type="date" value={v.received_on || ''} onChange={set('received_on')} /></Field>
        </div>
        <Field label="Into which account">
          <select value={v.fund_id} onChange={set('fund_id')}>
            {myFunds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        {v.status === 'received' && <>
          <div className="seg">{MODES.map(([k, l]) => <button type="button" key={k} className={v.mode === k ? 'on' : ''} onClick={() => setV({ ...v, mode: k })}>{l}</button>)}</div>
          <Field label={v.mode === 'cheque' ? 'Cheque no.' : 'UTR / reference (optional)'}><input className="mono" value={v.reference} onChange={set('reference')} /></Field>
          <Field label="Screenshot of the credit (optional)" hint="Bank SMS, GPay 'received' screen, or cheque photo — the amount and reference are filled in automatically.">
            <FilePicker label="screenshot" multiple={false} onFiles={pickFile} />
            <PendingFiles files={file ? [file] : []} onRemove={() => { setFile(null); setReading(null); }} />
            <ReceiptReadout reading={reading} />
            {c?.proof_path && !file && <button type="button" className="btn ghost small" onClick={() => signedUrl(c.proof_path).then((u) => window.open(u, '_blank'))}>📎 View saved proof</button>}
          </Field>
        </>}
        <Field label="Note (optional)"><input value={v.note} onChange={set('note')} placeholder="e.g. for catering, gift from family" /></Field>
      </form>
    </Sheet>
  );
}
