import { useMemo } from 'react';
import { useData, go } from './App';
import { money, has, effAmount, fmtDate, moneySummary } from './util';
import { Chip, Empty } from './ui';
import { AdvanceCard } from './Advances';

export const openDaybook = (filter) => {
  try { sessionStorage.setItem('pof-filter', JSON.stringify(filter)); } catch {}
  go('#/daybook');
};

export default function Dashboard() {
  const { me, project, expenses, categories, users, userById, payeeById, funds = [], contributions = [], advances = [] } = useData();
  const showMoney = funds.length > 0 && !me.hide_money_sources;
  const ms = useMemo(() => moneySummary({ funds, contributions, expenses, userById, advances }), [funds, contributions, expenses, userById, advances]);
  const advToApprove = advances.filter((a) => a.status === 'requested');
  const advToPay = advances.filter((a) => a.status === 'approved' && a.payer_id === me.id);
  const advOpen = advances.filter((a) => a.status === 'paid');

  const s = useMemo(() => {
    const live = expenses.filter((e) => e.status !== 'rejected');
    const sum = (arr) => arr.reduce((t, e) => t + effAmount(e), 0);
    const by = (st) => live.filter((e) => e.status === st);
    const payers = users.filter((u) => u.roles.includes('payer')).map((u) => ({
      u,
      paid: sum(expenses.filter((e) => e.status === 'paid' && (e.paid_by || e.payer_id) === u.id)),
      due: sum(expenses.filter((e) => e.status === 'approved' && e.payer_id === u.id)),
    }));
    const cat = categories.map((c) => ({
      c, spent: sum(live.filter((e) => e.category === c.name && (e.status === 'paid' || e.status === 'approved'))),
      pending: sum(live.filter((e) => e.category === c.name && (e.status === 'submitted' || e.status === 'query'))),
    }));
    const other = live.filter((e) => !categories.some((c) => c.name === e.category));
    return {
      submitted: by('submitted'), query: by('query'), approved: by('approved'), paid: by('paid'),
      committed: sum(by('approved')) + sum(by('paid')), paidAmt: sum(by('paid')),
      pendingAmt: sum(by('submitted')) + sum(by('query')),
      budget: categories.reduce((t, c) => t + Number(c.budget || 0), 0),
      payers, cat, otherAmt: sum(other.filter((e) => e.status === 'paid' || e.status === 'approved')),
      recent: [...expenses].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 6),
    };
  }, [expenses, categories, users]);

  const myToPay = s.approved.filter((e) => e.payer_id === me.id);
  const myQueries = s.query.filter((e) => e.submitted_by === me.id);
  const daysLeft = project.event_date ? Math.ceil((new Date(project.event_date + 'T00:00:00') - new Date()) / 864e5) : null;

  const actions = [];
  if (has(me, 'approver') && s.submitted.length)
    actions.push({ n: s.submitted.length, t: 'to approve', amt: s.submitted.reduce((t, e) => t + Number(e.amount), 0), tone: 'amber', f: { status: 'submitted' } });
  if (has(me, 'payer') && myToPay.length)
    actions.push({ n: myToPay.length, t: 'for you to pay', amt: myToPay.reduce((t, e) => t + effAmount(e), 0), tone: 'blue', f: { status: 'approved', payer: me.id } });
  if (has(me, 'approver') && advToApprove.length)
    actions.push({ n: advToApprove.length, t: advToApprove.length > 1 ? 'advances to approve' : 'advance to approve', amt: advToApprove.reduce((t, a) => t + Number(a.amount), 0), tone: 'amber', href: '#/a/' + advToApprove[0].id });
  if (advToPay.length)
    actions.push({ n: advToPay.length, t: advToPay.length > 1 ? 'advances for you to pay' : 'advance for you to pay', amt: advToPay.reduce((t, a) => t + Number(a.approved_amount), 0), tone: 'blue', href: '#/a/' + advToPay[0].id });
  if (myQueries.length)
    actions.push({ n: myQueries.length, t: 'queries to answer', amt: null, tone: 'orange', f: { status: 'query' } });

  return (
    <div className="page">
      <div className="hello">
        <div>
          <h1>Hello, {me.full_name.split(' ')[0]}</h1>
          <p className="muted">{project.subtitle}{project.event_date && <> · {fmtDate(project.event_date)}{daysLeft !== null && daysLeft >= 0 && <> · <b>{daysLeft === 0 ? 'Today!' : `${daysLeft} day${daysLeft > 1 ? 's' : ''} to go`}</b></>}</>}</p>
        </div>
      </div>

      {actions.length > 0 && (
        <div className="actions">
          {actions.map((a) => (
            <button key={a.t} className={`action ${a.tone}`} onClick={() => (a.href ? (location.hash = a.href) : openDaybook(a.f))}>
              <span className="action-n">{a.n}</span>
              <span className="action-t">{a.t}{a.amt !== null && <b>{money(a.amt)}</b>}</span>
              <span className="action-go">›</span>
            </button>
          ))}
        </div>
      )}

      <div className="stats">
        <Stat label="Committed" value={money(s.committed)} sub={s.budget ? `of ${money(s.budget)} budget` : 'approved + paid'} onClick={() => openDaybook({})} />
        <Stat label="Paid" value={money(s.paidAmt)} sub={`${s.paid.length} payments`} onClick={() => openDaybook({ status: 'paid' })} />
        <Stat label="Awaiting payment" value={money(s.committed - s.paidAmt)} sub={`${s.approved.length} approved`} onClick={() => openDaybook({ status: 'approved' })} />
        <Stat label="Awaiting approval" value={money(s.pendingAmt)} sub={`${s.submitted.length + s.query.length} bills`} onClick={() => openDaybook({ status: 'submitted' })} />
      </div>

      {s.budget > 0 && (
        <div className="card">
          <div className="bar big"><span style={{ width: Math.min(100, (s.committed / s.budget) * 100) + '%' }} className={s.committed > s.budget ? 'over' : ''} /></div>
          <p className="small muted" style={{ marginTop: 6 }}>
            {s.committed > s.budget ? <b className="neg">Over budget by {money(s.committed - s.budget)}</b> : <>{money(s.budget - s.committed)} left in the budget</>}
          </p>
        </div>
      )}

      <div className="grid2">
        {showMoney ? (
        <section className="card">
          <h2>Money in &amp; out</h2>
          <table className="mini">
            <thead><tr><th>Account</th><th className="r">In</th><th className="r">Out</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {ms.perFund.map(({ fund, received, out, balance }) => (
                <tr key={fund.id} className="click" onClick={() => { location.hash = '#/money'; }}>
                  <td>{fund.name}</td><td className="r">{money(received)}</td><td className="r">{money(out)}</td>
                  <td className={'r' + (balance < 0 ? ' neg' : '')}><b>{money(balance)}</b></td>
                </tr>
              ))}
              {(ms.advances.given > 0) && <tr className="click" onClick={() => { location.hash = '#/money'; }}><td>Advances (pending settlement)</td><td className="r">{money(ms.advances.given - ms.advances.returned)}</td><td className="r">{money(ms.advances.settled)}</td><td className={'r' + (ms.advances.pending < 0 ? ' neg' : '')}><b>{money(ms.advances.pending)}</b></td></tr>}
              {ms.ownTotal > 0 && <tr><td>Paid from own pocket</td><td className="r">{money(ms.ownTotal)}</td><td className="r">{money(ms.ownTotal)}</td><td className="r">—</td></tr>}
              <tr className="total"><td>Total</td><td className="r">{money(ms.totalIn)}</td><td className="r">{money(ms.totalOut)}</td>
                <td className={'r' + (ms.totalIn - ms.totalOut < 0 ? ' neg' : '')}>{money(ms.totalIn - ms.totalOut)}</td></tr>
            </tbody>
          </table>
          {ms.totalPledged > 0 && <p className="small muted" style={{ marginTop: 8 }}>+ {money(ms.totalPledged)} promised, not yet received</p>}
        </section>
        ) : !me.hide_money_sources && (
        <section className="card">
          <h2>Who has paid</h2>
          {s.payers.length === 0 ? <p className="muted small">No payers onboarded yet.</p> : (
            <table className="mini">
              <thead><tr><th>Payer</th><th className="r">Paid</th><th className="r">Due</th></tr></thead>
              <tbody>
                {s.payers.map(({ u, paid, due }) => (
                  <tr key={u.id} onClick={() => openDaybook({ payer: u.id })} className="click">
                    <td>{u.full_name}</td><td className="r">{money(paid)}</td><td className="r muted">{due ? money(due) : '—'}</td>
                  </tr>
                ))}
                <tr className="total"><td>Total</td>
                  <td className="r">{money(s.payers.reduce((t, p) => t + p.paid, 0))}</td>
                  <td className="r">{money(s.payers.reduce((t, p) => t + p.due, 0))}</td></tr>
              </tbody>
            </table>
          )}
        </section>
        )}

        <section className="card">
          <h2>By category</h2>
          {s.cat.filter((c) => c.spent || c.pending || Number(c.c.budget)).length === 0 && !s.otherAmt
            ? <p className="muted small">Nothing yet.</p>
            : (
              <div className="cats">
                {s.cat.filter((c) => c.spent || c.pending || Number(c.c.budget)).map(({ c, spent, pending }) => {
                  const b = Number(c.budget || 0);
                  return (
                    <button key={c.id} className="cat" onClick={() => openDaybook({ category: c.name })}>
                      <div className="cat-top"><span>{c.name}</span><span>{money(spent)}{b ? <span className="muted"> / {money(b)}</span> : null}</span></div>
                      {b > 0 && <div className="bar"><span style={{ width: Math.min(100, (spent / b) * 100) + '%' }} className={spent > b ? 'over' : ''} /></div>}
                      {pending > 0 && <div className="small muted">+ {money(pending)} awaiting approval</div>}
                    </button>
                  );
                })}
                {s.otherAmt > 0 && <div className="cat"><div className="cat-top"><span>Uncategorised</span><span>{money(s.otherAmt)}</span></div></div>}
              </div>
            )}
        </section>
      </div>

      {advOpen.length > 0 && (
        <section>
          <h2>Advances pending settlement</h2>
          <div className="adv-list">{advOpen.map((a) => <AdvanceCard key={a.id} a={a} />)}</div>
        </section>
      )}

      <section className="card">
        <h2>Latest</h2>
        {s.recent.length === 0 ? (
          <Empty icon="🧾" title="No expenses yet">Bejoy adds a bill with a photo, P.O. Mathew approves it, and the payer gets a pay link.</Empty>
        ) : s.recent.map((e) => (
          <a key={e.id} className="row-item" href={'#/e/' + e.id}>
            <div className="ri-main">
              <div className="ri-title">{payeeById[e.payee_id]?.name || e.description}</div>
              <div className="ri-sub">{e.serial} · {e.description} · {userById[e.submitted_by]?.full_name}</div>
            </div>
            <div className="ri-side"><div className="ri-amt">{money(effAmount(e))}</div><Chip status={e.status} /></div>
          </a>
        ))}
      </section>
    </div>
  );
}

const Stat = ({ label, value, sub, onClick }) => (
  <button className="stat" onClick={onClick}>
    <span className="stat-label">{label}</span>
    <span className="stat-value">{value}</span>
    <span className="stat-sub">{sub}</span>
  </button>
);
