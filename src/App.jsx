import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, LOGIN_DOMAIN } from './supabase';
import { has } from './util';
import { useToast } from './ui';
import Dashboard from './Dashboard';
import Daybook from './Daybook';
import ExpenseForm from './ExpenseForm';
import ExpenseDetail from './ExpenseDetail';
import Payees from './Payees';
import Users from './Users';
import More from './More';
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
        <Brand big />
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
    const [me, proj, users, payees, cats, exps, atts] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('projects').select('*').eq('code', 'bejoy-marriage').maybeSingle(),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('payees').select('*').order('name'),
      supabase.from('categories').select('*').order('sort'),
      supabase.from('expenses').select('*').order('expense_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('attachments').select('id, expense_id, kind, path, file_name, mime, uploaded_by, created_at').order('created_at'),
    ]);
    const err = [me, proj, users, payees, cats, exps, atts].find((r) => r.error)?.error;
    if (err) { setState((s) => ({ ...s, loading: false, error: err.message })); return; }
    const attByExp = {};
    (atts.data || []).forEach((a) => { (attByExp[a.expense_id] ||= []).push(a); });
    setState({
      loading: false, me: me.data, project: proj.data, users: users.data || [], payees: payees.data || [],
      categories: (cats.data || []).filter((c) => !proj.data || c.project_id === proj.data.id),
      expenses: (exps.data || []).filter((e) => !proj.data || e.project_id === proj.data.id),
      attByExp,
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
      .subscribe();
    const vis = () => document.visibilityState === 'visible' && bump();
    document.addEventListener('visibilitychange', vis);
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', vis); };
  }, [load]);

  const userById = useMemo(() => Object.fromEntries((state.users || []).map((u) => [u.id, u])), [state.users]);
  const payeeById = useMemo(() => Object.fromEntries((state.payees || []).map((p) => [p.id, p])), [state.payees]);
  const ctx = useMemo(() => ({ ...state, userById, payeeById, reload: load, toast }), [state, userById, payeeById, load, toast]);

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
  const tab = route === 'e' ? (sessionStorage.getItem('pof-tab') || 'home') : (route || 'home');
  if (route !== 'e') try { sessionStorage.setItem('pof-tab', tab); } catch {}

  const navItems = [
    ['home', '⌂', 'Home', true],
    ['daybook', '☰', 'Daybook', true],
    ['new', '+', 'Add', canInput],
    ['payees', '◉', 'Payees', canPayees],
    ['users', '👥', 'Users', isAdmin],
    ['more', '⋯', 'More', true],
  ].filter((n) => n[3]);

  const closeDetail = () => (history.length > 1 && route === 'e' ? history.back() : go('#/' + tab));

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
              <span className="nav-icon">{icon}</span><span>{label}</span>
            </a>
          ))}
        </nav>

        <main className="main">
          {tab === 'home' && <Dashboard />}
          {tab === 'daybook' && <Daybook />}
          {tab === 'new' && canInput && <ExpenseForm onDone={(id) => go('#/e/' + id)} />}
          {tab === 'payees' && canPayees && <Payees />}
          {tab === 'users' && isAdmin && <Users />}
          {tab === 'more' && <More />}
          <footer className="foot muted small">P O Foundation · Pandampurath Oommen family</footer>
        </main>

        {route === 'e' && arg && <ExpenseDetail key={arg} id={arg} onClose={closeDetail} />}
        <ShareInbox />
        {toastNode}
      </div>
    </DataCtx.Provider>
  );
}
