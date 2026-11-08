import { useMemo, useState } from 'react';
import { useData } from './App';
import { money, fmtDate, effAmount, STATUS, downloadCSV, fmtDateTime } from './util';
import { Chip, Empty } from './ui';

function initialFilter() {
  try {
    const f = JSON.parse(sessionStorage.getItem('pof-filter') || 'null');
    sessionStorage.removeItem('pof-filter');
    if (f) return { status: '', category: '', payer: '', q: '', ...f };
  } catch {}
  return { status: '', category: '', payer: '', q: '' };
}

export default function Daybook() {
  const { expenses, categories, users, userById, payeeById, attByExp, project } = useData();
  const [f, setF] = useState(initialFilter);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const list = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return expenses.filter((e) => {
      if (f.status && e.status !== f.status) return false;
      if (f.category && e.category !== f.category) return false;
      if (f.payer && (e.paid_by || e.payer_id) !== f.payer) return false;
      if (q) {
        const hay = [e.serial, e.description, e.category, e.payment_ref, payeeById[e.payee_id]?.name].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [expenses, f, payeeById]);

  const days = useMemo(() => {
    const m = new Map();
    list.forEach((e) => { if (!m.has(e.expense_date)) m.set(e.expense_date, []); m.get(e.expense_date).push(e); });
    return [...m.entries()];
  }, [list]);

  const total = list.filter((e) => e.status !== 'rejected').reduce((t, e) => t + effAmount(e), 0);
  const payers = users.filter((u) => u.roles.includes('payer'));

  const exportCSV = () => {
    const rows = [['Serial', 'Date', 'Payee', 'Payee UPI', 'Category', 'Description', 'Submitted amount', 'Approved amount',
      'Paid amount', 'Status', 'Submitted by', 'Approved by', 'Payer', 'Paid by', 'Paid on', 'Mode', 'UTR / Ref', 'Bills', 'Receipts', 'Approver note']];
    list.forEach((e) => {
      const at = attByExp[e.id] || [];
      rows.push([e.serial, e.expense_date, payeeById[e.payee_id]?.name, payeeById[e.payee_id]?.upi_id, e.category, e.description,
        e.amount, e.approved_amount, e.paid_amount, STATUS[e.status]?.label, userById[e.submitted_by]?.full_name,
        userById[e.approved_by]?.full_name, userById[e.payer_id]?.full_name, userById[e.paid_by]?.full_name,
        e.paid_at ? fmtDateTime(e.paid_at) : '', e.payment_mode, e.payment_ref,
        at.filter((a) => a.kind === 'bill').length, at.filter((a) => a.kind === 'receipt').length, e.approver_note]);
    });
    downloadCSV(`${project.code}-daybook-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Daybook</h1>
        <button className="btn ghost small" onClick={exportCSV} disabled={!list.length}>⬇ Export CSV</button>
      </div>

      <div className="filters">
        <div className="seg scroll">
          {[['', 'All'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])].map(([k, l]) => (
            <button key={k} className={f.status === k ? 'on' : ''} onClick={() => set('status', k)}>{l}</button>
          ))}
        </div>
        <div className="filter-row">
          <input type="search" placeholder="Search payee, item, UTR, POF-…" value={f.q} onChange={(e) => set('q', e.target.value)} />
          <select value={f.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id}>{c.name}</option>)}
          </select>
          <select value={f.payer} onChange={(e) => set('payer', e.target.value)}>
            <option value="">All payers</option>
            {payers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
      </div>

      <div className="summary-line">
        <span>{list.length} {list.length === 1 ? 'entry' : 'entries'}</span>
        <b>{money(total)}</b>
      </div>

      {days.length === 0 ? <Empty icon="📒" title="Nothing here">Try clearing the filters.</Empty> : days.map(([d, items]) => (
        <section key={d} className="day">
          <div className="day-head">
            <span>{fmtDate(d)}</span>
            <span>{money(items.filter((e) => e.status !== 'rejected').reduce((t, e) => t + effAmount(e), 0))}</span>
          </div>
          <div className="card flush">
            {items.map((e) => {
              const at = attByExp[e.id] || [];
              const bills = at.filter((a) => a.kind === 'bill').length;
              const rcpt = at.filter((a) => a.kind === 'receipt').length;
              const altered = e.approved_amount !== null && Number(e.approved_amount) !== Number(e.amount);
              return (
                <a key={e.id} className="row-item" href={'#/e/' + e.id}>
                  <div className="ri-main">
                    <div className="ri-title">{payeeById[e.payee_id]?.name || '—'} <span className="ri-serial">{e.serial}</span></div>
                    <div className="ri-sub">{e.description}{e.category ? ` · ${e.category}` : ''}</div>
                    <div className="ri-meta">
                      {bills > 0 && <span title="Bills">🧾 {bills}</span>}
                      {rcpt > 0 && <span title="Payment receipts">✅ {rcpt}</span>}
                      {e.payer_id && <span>→ {userById[e.paid_by || e.payer_id]?.full_name}</span>}
                      {e.payment_ref && <span className="mono">{e.payment_ref}</span>}
                    </div>
                  </div>
                  <div className="ri-side">
                    <div className="ri-amt">{money(effAmount(e))}</div>
                    {altered && <div className="ri-was">was {money(e.amount)}</div>}
                    <Chip status={e.status} />
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
