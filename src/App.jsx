import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, LOGIN_DOMAIN } from './supabase';
import { has, money, effAmount } from './util';
import { useToast } from './ui';
import Dashboard from './Dashboard';
import Daybook from './Daybook';
import ExpenseForm from './ExpenseForm';
import ExpenseDetail from './ExpenseDetail';
import Payees from './Payees';
import Users from './Users';
import More from './More';
import MoneyIn from './MoneyIn';
import BejoyHome from './BejoyHome';
import { AdvanceDetail } from './Advances';
import ShareInbox from './ShareInbox';

const DataCtx = createContext(null);
export const useData = () => useContext(DataCtx);

function useHash() {
  const [hash, setHash] = useState(location.hash || '#/home');
  useEffect(() => {
    const on = () => setHash(location.hash || '#/home');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}
export const go = (h) => { location.hash = h; };

export default function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <Splash />;
  if (!session) return <Login />;
  return <Shell userId={session.user.id} />;
}

const Splash = () => (
  <div className="splash"><img src="/logo-mark.png" alt="" /><p>Loading…</p></div>
);

function Brand({ big }) {
  return (
    <div className={'brand' + (big ? ' big' : '')}>
      <img src="/logo-mark.png" alt="" />
      <div>
        <div className="brand-title">P O Foundation</div>
        <div className="brand-sub">Bejoy John - Marriage</div>
      </div>
    </div>
  );
}

function Login() {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({
      email: `${username.trim().toLowerCase()}@${LOGIN_DOMAIN}`, password: pin,
    });
    setBusy(false);
    if (error) setErr(error.message.includes('Invalid') ? 'Wrong username or PIN' : error.message);
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <img src="/logo-full.png" alt="P O Foundation" />
          <div className="brand-sub">Bejoy John - Marriage</div>
        </div>
        <label className="field"><span className="field-label">Username</span>
          <input autoCapitalize="none" autoComplete="username" value={username}
            onChange={(e) => setUsername(e.target.value)} placeholder="e.g. motty" required /></label>
        <label className="field"><span className="field-label">6-digit PIN</span>
          <input type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="current-password"
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required /></label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small center">Your login is created by Motty or Sherine.</p>
      </form>
    </div>
  );
}

function Shell({ userId }) {
  const hash = useHash();
  const [toast, toastNode] = useToast();
  const [state, setState] = useState({ loading: true });

  const load = useCallback(async () => {
    const [me, proj, users, payees, cats, exps, atts, fundsR, contribR, advR] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('projects').select('*').eq('code', 'bejoy-marriage').maybeSingle(),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('payees').select('*').order('name'),
      supabase.from('categories').select('*').order('sort'),
      supabase.from('expenses').select('*').order('expense_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('attachments').select('*').order('created_at'),
      supabase.from('funds').select('*').order('sort'),
      supabase.from('contributions').select('*').order('received_on', { ascending: false, nullsFirst: true }).order('created_at', { ascending: false }),
      supabase.from('advances').select('*').order('created_at', { ascending: false }),
    ]);
    const err = [me, proj, users, payees, cats, exps, atts].find((r) => r.error)?.error;
    if (err) { setState((s) => ({ ...s, loading: false, error: err.message })); return; }
    const attByExp = {};
    const attByAdv = {};
    (atts.data || []).forEach((a) => {
      if (a.expense_id) (attByExp[a.expense_id] ||= []).push(a);
      if (a.advance_id) (attByAdv[a.advance_id] ||= []).push(a);
    });
    setState({
      loading: false, me: me.data, project: proj.data, users: users.data || [], payees: payees.data || [],
      categories: (cats.data || []).filter((c) => !proj.data || c.project_id === proj.data.id),
      expenses: (exps.data || []).filter((e) => !proj.data || e.project_id === proj.data.id),
      attByExp,
      // funds/contributions exist once 004_contributions.sql has run; until then the app works without them
      funds: fundsR.error ? [] : (fundsR.data || []).filter((f) => !proj.data || f.project_id === proj.data.id),
      contributions: contribR.error ? [] : (contribR.data || []).filter((c) => !proj.data || c.project_id === proj.data.id),
      // advances exist once 005_advances.sql has run
      advances: advR.error ? [] : (advR.data || []).filter((a) => !proj.data || a.project_id === proj.data.id),
      advancesReady: !advR.error,
      attByAdv,
    });
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Live updates: any change on any phone refreshes everyone
  useEffect(() => {
    let t;
    const bump = () => { clearTimeout(t); t = setTimeout(load, 400); };
    const ch = supabase.channel('pof-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attachments' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payees' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contributions' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'advances' }, bump)
      .subscribe();
    const vis = () => document.visibilityState === 'visible' && bump();
    document.addEventListener('visibilitychange', vis);
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', vis); };
  }, [load]);

  const userById = useMemo(() => Object.fromEntries((state.users || []).map((u) => [u.id, u])), [state.users]);
  const payeeById = useMemo(() => Object.fromEntries((state.payees || []).map((p) => [p.id, p])), [state.payees]);
  const ctx = useMemo(() => ({ ...state, userById, payeeById, reload: load, toast }), [state, userById, payeeById, load, toast]);

  // ---- In-app alerts: when someone else's action needs me (or a payment is made), show a card ----
  const [alerts, setAlerts] = useState([]);
  const prevStatus = useRef(null);
  useEffect(() => {
    const { expenses, me } = state;
    if (!expenses || !me) return;
    const now = Object.fromEntries(expenses.map((e) => [e.id, e.status]));
    const before = prevStatus.current;
    prevStatus.current = now;
    if (!before) return; // first load: nothing is "new"
    const fresh = [];
    for (const e of expenses) {
      if (before[e.id] === e.status) continue;
      const who = (id) => userById[id]?.full_name?.split(' ')[0] || 'Someone';
      const what = `${e.serial} · ${money(effAmount(e))} · ${payeeById[e.payee_id]?.name || e.description}`;
      if (e.status === 'submitted' && me.roles.includes('approver') && e.submitted_by !== me.id)
        fresh.push({ id: e.id + e.status, eid: e.id, tone: 'amber', title: 'New bill to approve', text: `${what} — from ${who(e.submitted_by)}` });
      else if (e.status === 'approved' && e.payer_id === me.id && e.approved_by !== me.id)
        fresh.push({ id: e.id + e.status, eid: e.id, tone: 'blue', title: 'Please make this payment', text: `${what} — approved by ${who(e.approved_by)}` });
      else if (e.status === 'query' && e.submitted_by === me.id)
        fresh.push({ id: e.id + e.status, eid: e.id, tone: 'orange', title: 'Question on your bill', text: `${e.serial}: ${e.approver_note || ''}` });
      else if (e.status === 'rejected' && e.submitted_by === me.id)
        fresh.push({ id: e.id + e.status, eid: e.id, tone: 'grey', title: 'Bill rejected', text: `${e.serial}: ${e.approver_note || ''}` });
      else if (e.status === 'paid' && e.paid_by !== me.id)
        fresh.push({ id: e.id + e.status, eid: e.id, tone: 'green', title: 'Payment made', text: `${what} — paid by ${who(e.paid_by)}` });
    }
    if (fresh.length) {
      setAlerts((a) => [...fresh, ...a.filter((x) => !fresh.some((f) => f.id === x.id))].slice(0, 5));
      try { navigator.vibrate?.(80); } catch {}
    }
  }, [state.expenses]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.loading) return <Splash />;
  if (state.error) return <div className="splash"><p className="error">{state.error}</p><button className="btn" onClick={load}>Retry</button></div>;
  if (!state.me || !state.me.active) {
    return (
      <div className="splash">
        <p>Your account isn’t set up yet. Ask Motty or Sherine to onboard you.</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    );
  }
  if (!state.project) return <div className="splash"><p>Project not found — run supabase/schema.sql.</p></div>;

  const me = state.me;
  const canInput = has(me, 'inputter') || has(me, 'admin');
  const canPayees = has(me, 'admin') || has(me, 'approver') || has(me, 'inputter') || has(me, 'payer');
  const isAdmin = has(me, 'admin');

  const [route, arg] = hash.replace(/^#\/?/, '').split('/');
  const isSheet = route === 'e' || route === 'a';
  const tab = isSheet ? (sessionStorage.getItem('pof-tab') || 'home') : (route || 'home');
  if (!isSheet) try { sessionStorage.setItem('pof-tab', tab); } catch {}
  // Bejoy (enters bills, doesn't approve or pay) gets his own simple home screen
  const simpleHome = has(me, 'inputter') && !has(me, 'admin') && !has(me, 'approver') && !has(me, 'payer');

  const navItems = [
    ['home', '⌂', 'Home', true],
    ['daybook', '☰', 'Daybook', true],
    ['new', '+', 'Add', canInput],
    ['money', '₹', 'Money in', state.funds.length > 0],
    ['payees', '◉', 'Payees', canPayees],
    ['users', '👥', 'Users', isAdmin],
    ['more', '⋯', 'More', true],
  ].filter((n) => n[3]);

  const myActions = state.expenses.filter((e) =>
    (e.status === 'submitted' && has(me, 'approver')) ||
    (e.status === 'approved' && e.payer_id === me.id) ||
    (e.status === 'query' && e.submitted_by === me.id)).length
    + state.advances.filter((a) =>
    (a.status === 'requested' && has(me, 'approver')) ||
    (a.status === 'approved' && a.payer_id === me.id) ||
    (a.status === 'query' && a.requested_by === me.id)).length;

  const closeDetail = () => (history.length > 1 && isSheet ? history.back() : go('#/' + tab));

  return (
    <DataCtx.Provider value={ctx}>
      <div className="app">
        {import.meta.env.VITE_DEMO && <div className="demo-banner">Demo with sample data · signed in as Motty · nothing is saved</div>}
        <header className="topbar">
          <Brand />
          <div className="me" title={me.roles.join(', ')}>
            <span className="avatar">{me.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
          </div>
        </header>

        <nav className="sidenav">
          {navItems.map(([k, icon, label]) => (
            <a key={k} href={'#/' + k} className={(tab === k ? 'active ' : '') + (k === 'new' ? 'nav-add' : '')}>
              <span className="nav-icon">{icon}{k === 'home' && myActions > 0 && <span className="badge">{myActions}</span>}</span><span>{label}</span>
            </a>
          ))}
        </nav>

        <main className="main">
          {tab === 'home' && (simpleHome ? <BejoyHome /> : <Dashboard />)}
          {tab === 'daybook' && <Daybook />}
          {tab === 'new' && canInput && <ExpenseForm onDone={(id) => go('#/e/' + id)} />}
          {tab === 'money' && <MoneyIn />}
          {tab === 'payees' && canPayees && <Payees />}
          {tab === 'users' && isAdmin && <Users />}
          {tab === 'more' && <More />}
          <footer className="foot muted small">P O Foundation · Pandampurath Oommen family</footer>
        </main>

        {alerts.length > 0 && (
          <div className="alerts" role="status">
            {alerts.map((a) => (
              <div key={a.id} className={`alert ${a.tone}`}>
                <a href={'#/e/' + a.eid} onClick={() => setAlerts((x) => x.filter((y) => y.id !== a.id))}>
                  <b>{a.title}</b><span>{a.text}</span>
                </a>
                <button className="icon-btn" aria-label="Dismiss" onClick={() => setAlerts((x) => x.filter((y) => y.id !== a.id))}>✕</button>
              </div>
            ))}
          </div>
        )}
        {route === 'e' && arg && <ExpenseDetail key={arg} id={arg} onClose={closeDetail} />}
        {route === 'a' && arg && <AdvanceDetail key={arg} id={arg} onClose={closeDetail} />}
        <ShareInbox />
        {toastNode}
      </div>
    </DataCtx.Provider>
  );
}
