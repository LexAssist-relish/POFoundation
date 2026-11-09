import { useMemo, useState } from 'react';
import { useData, go } from './App';
import { money, fmtDate, effAmount, advanceBalance, moneySummary } from './util';
import { Chip, Sheet } from './ui';
import { AdvanceForm, AdvanceCard } from './Advances';
import SettleForm from './SettleForm';

// Simple home for the person who spends (Bejoy): three big actions, what's pending, what needs answering.
export default function BejoyHome() {
  const { me, project, expenses, advances = [], advancesReady, funds = [], contributions = [], payeeById, userById } = useData();
  const [sheet, setSheet] = useState(null); // { type: 'settle', adv } | { type: 'advance' }

  const mineAdv = advances.filter((a) => a.requested_by === me.id);
  const openAdv = mineAdv.filter((a) => a.status === 'paid');
  const inProgress = mineAdv.filter((a) => ['requested', 'query', 'approved'].includes(a.status));
  const pendingTotal = openAdv.reduce((t, a) => t + advanceBalance(a, expenses).pending, 0);
  const myFund = funds.find((f) => f.holder === me.id);
  const fundRow = useMemo(() => myFund && moneySummary({ funds: [myFund], contributions, expenses, userById, advances: [] }).perFund[0], [myFund, contributions, expenses, userById]);
  const myBills = expenses.filter((e) => e.submitted_by === me.id).slice(0, 8);
  const toBePaid = expenses.filter((e) => e.submitted_by === me.id && ['submitted', 'query', 'approved'].includes(e.status));
  const queries = [
    ...expenses.filter((e) => e.submitted_by === me.id && e.status === 'query').map((e) => ({ href: '#/e/' + e.id, title: `${e.serial} · ${payeeById[e.payee_id]?.name || e.description}`, note: e.approver_note })),
    ...mineAdv.filter((a) => a.status === 'query').map((a) => ({ href: '#/a/' + a.id, title: `${a.serial} advance`, note: a.approver_note })),
  ];
  const daysLeft = project.event_date ? Math.ceil((new Date(project.event_date + 'T00:00:00') - new Date()) / 864e5) : null;
  const canSettle = openAdv.length > 0 || !!myFund;

  return (
    <div className="page">
      <div className="hello">
        <h1>Hi {me.full_name.split(' ')[0]}</h1>
        <p className="muted">{project.subtitle}{daysLeft != null && daysLeft >= 0 && <> · <b>{daysLeft === 0 ? 'Today!' : `${daysLeft} day${daysLeft > 1 ? 's' : ''} to go`}</b></>}</p>
      </div>

      {queries.map((q) => (
        <a key={q.href} href={q.href} className="action orange">
          <span className="action-n">?</span>
          <span className="action-t">Question on {q.title}<b>{q.note}</b></span><span className="action-go">›</span>
        </a>
      ))}

      <div className="big-actions">
        <button className="big-action primary" disabled={!canSettle} onClick={() => setSheet({ type: 'settle' })}>
          <span className="ba-icon">🧾</span>
          <span className="ba-text"><b>I paid a bill</b><span>{canSettle ? 'From my advance — upload bill + receipt' : 'Available once an advance is paid to you'}</span></span>
        </button>
        <button className="big-action" onClick={() => (advancesReady ? setSheet({ type: 'request' }) : go('#/new'))}>
          <span className="ba-icon">📤</span>
          <span className="ba-text"><b>Request a payment</b><span>A bill to be paid, or an advance to you</span></span>
        </button>
      </div>

      {openAdv.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Pending settlement</h2>
            <span className={'pend-total' + (pendingTotal < 0 ? ' neg' : '')}>{pendingTotal < 0 ? `Over by ${money(-pendingTotal)}` : money(pendingTotal)}</span>
          </div>
          <p className="small muted" style={{ margin: '0 0 8px' }}>Money advanced to you that isn’t covered by bills yet. Add each bill you pay to bring this to zero.</p>
          <div className="adv-list">{openAdv.map((a) => <AdvanceCard key={a.id} a={a} onSettle={(x) => setSheet({ type: 'settle', adv: x })} />)}</div>
        </section>
      )}

      {inProgress.length > 0 && (
        <section>
          <h2>Advances requested</h2>
          <div className="adv-list">{inProgress.map((a) => <AdvanceCard key={a.id} a={a} />)}</div>
        </section>
      )}

      {toBePaid.length > 0 && (
        <section className="card">
          <h2>Bills to be paid</h2>
          {toBePaid.map((e) => (
            <a key={e.id} className="row-item" href={'#/e/' + e.id}>
              <div className="ri-main">
                <div className="ri-title">{payeeById[e.payee_id]?.name || e.description} <span className="ri-serial">{e.serial}</span></div>
                <div className="ri-sub">{e.description}</div>
              </div>
              <div className="ri-side"><div className="ri-amt">{money(effAmount(e))}</div><Chip status={e.status} /></div>
            </a>
          ))}
        </section>
      )}

      {myFund && fundRow && (fundRow.received > 0 || fundRow.out > 0) && (
        <section className="card">
          <h2>Money given to me directly</h2>
          <div className="settle-box compact">
            <div><span>Received</span><b>{money(fundRow.received)}</b></div>
            <div><span>Spent</span><b>{money(fundRow.out)}</b></div>
            <div className="pend"><span>With me</span><b>{money(fundRow.balance)}</b></div>
          </div>
          <button className="btn ghost small" onClick={() => go('#/money')}>Record money a relative gave me</button>
        </section>
      )}
      {myFund && fundRow && !fundRow.received && !fundRow.out && (
        <button className="btn ghost block" onClick={() => go('#/money')}>💰 A relative gave me money directly — record it</button>
      )}

      <section className="card">
        <h2>My bills</h2>
        {myBills.length === 0 ? <p className="muted small">Nothing yet.</p> : myBills.map((e) => (
          <a key={e.id} className="row-item" href={'#/e/' + e.id}>
            <div className="ri-main">
              <div className="ri-title">{payeeById[e.payee_id]?.name || e.description} <span className="ri-serial">{e.serial}</span></div>
              <div className="ri-sub">{e.description} · {fmtDate(e.expense_date)}{e.advance_id ? ` · from ${advances.find((a) => a.id === e.advance_id)?.serial || 'advance'}` : ''}</div>
            </div>
            <div className="ri-side"><div className="ri-amt">{money(effAmount(e))}</div><Chip status={e.status} /></div>
          </a>
        ))}
        {myBills.length > 0 && <button className="btn ghost small" onClick={() => go('#/daybook')}>See all in Daybook</button>}
      </section>

      {sheet?.type === 'settle' && <SettleForm defaultAdvance={sheet.adv} onClose={(id) => { setSheet(null); if (id) go('#/e/' + id); }} />}
      {sheet?.type === 'advance' && <AdvanceForm onClose={() => setSheet(null)} />}
      {sheet?.type === 'request' && (
        <Sheet title="Request a payment" onClose={() => setSheet(null)}>
          <div className="big-actions one">
            <button className="big-action" onClick={() => { setSheet(null); go('#/new'); }}>
              <span className="ba-icon">🧾</span>
              <span className="ba-text"><b>Bill to be paid</b><span>A vendor’s bill — after approval, Sherine or another payer pays the vendor directly.</span></span>
            </button>
            <button className="big-action" onClick={() => setSheet({ type: 'advance' })}>
              <span className="ba-icon">💵</span>
              <span className="ba-text"><b>Advance</b><span>Money paid to you, to cover several payments. You settle it by adding each bill you pay.</span></span>
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
