if (typeof window !== "undefined") { window.confirm = () => true; window.alert = () => {}; } // demo: the artifact viewer suppresses dialogs
// In-browser stand-in for Supabase, used only by the click-through demo build
// (npm run build:demo). Sample data is illustrative; nothing is saved.
export const LOGIN_DOMAIN = 'pof.app';
export const BUCKET = 'pof-docs';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const now = () => new Date().toISOString();
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

const U = {
  motty: 'u-motty', sherine: 'u-sherine', mathew: 'u-mathew', bejoy: 'u-bejoy', varughese: 'u-varughese', saramma: 'u-saramma',
};
const db = {
  profiles: [
    { id: U.motty, username: 'motty', full_name: 'Motty Philip', relation: 'Cousin', phone: '9800000001', roles: ['admin', 'approver', 'payer'], active: true },
    { id: U.sherine, username: 'sherine', full_name: 'Sherine Motty', relation: '', phone: '9800000002', roles: ['admin', 'viewer'], active: true },
    { id: U.mathew, username: 'pomathew', full_name: 'P.O. Mathew', relation: 'Uncle', phone: '9800000003', roles: ['approver', 'payer'], active: true },
    { id: U.bejoy, username: 'bejoy', full_name: 'Bejoy John', relation: 'Groom', phone: '9800000004', roles: ['inputter'], active: true },
    { id: U.varughese, username: 'varughese', full_name: 'Varughese Koshy', relation: '', phone: '9800000005', roles: ['payer'], active: true },
    { id: U.saramma, username: 'saramma', full_name: 'Saramma Koshy', relation: '', phone: '9800000006', roles: ['viewer'], active: true },
  ],
  projects: [{ id: 'p1', code: 'bejoy-marriage', title: 'P O Foundation', subtitle: 'Bejoy John - Marriage', event_date: '2026-11-14', status: 'active' }],
  categories: ['Venue & Hall', 'Catering', 'Decoration & Flowers', 'Clothing & Jewellery', 'Photography & Video', 'Transport',
    'Church & Ceremony', 'Printing & Invitations', 'Accommodation', 'Gifts', 'Miscellaneous'].map((name, i) => ({
    id: 'c' + i, project_id: 'p1', name, sort: i,
    budget: [250000, 400000, 120000, 0, 90000, 30000, 25000, 15000, 0, 0, 20000][i] })),
  payees: [
    { id: 'py1', name: 'Sample Caterers', upi_id: 'samplecaterers@okaxis', phone: '9800001111', category: 'Catering', verified: true },
    { id: 'py2', name: 'Sample Parish Hall', upi_id: 'parishhall@oksbi', category: 'Venue & Hall', verified: true },
    { id: 'py3', name: 'Sample Florist', upi_id: 'florist@ybl', category: 'Decoration & Flowers', verified: false },
    { id: 'py4', name: 'Sample Studio', upi_id: 'studio@okhdfcbank', category: 'Photography & Video', verified: true },
    { id: 'py5', name: 'Sample Press', upi_id: null, bank_note: 'Cash only', category: 'Printing & Invitations', verified: false },
  ],
  expenses: [],
  attachments: [],
  activity: [],
};
let serial = 0;
function addExp(o) {
  serial++;
  const e = { id: 'e' + serial, serial: 'POF-' + String(serial).padStart(4, '0'), project_id: 'p1', approved_amount: null, payer_id: null,
    approver_note: null, payment_mode: null, payment_ref: null, paid_amount: null, paid_at: null, paid_by: null, approved_by: null,
    approved_at: null, submitted_by: U.bejoy, created_at: now(), updated_at: now(), ...o };
  db.expenses.push(e);
  db.activity.push({ id: db.activity.length + 1, expense_id: e.id, actor: U.bejoy, action: 'submitted', details: { amount: e.amount }, created_at: now() });
  db.attachments.push({ id: uid(), expense_id: e.id, kind: 'bill', path: 'demo/bill', file_name: 'bill.jpg', mime: 'image/svg+xml', uploaded_by: U.bejoy, created_at: now() });
  if (o.status && o.status !== 'submitted') db.activity.push({ id: db.activity.length + 1, expense_id: e.id, actor: U.mathew, action: o.status === 'query' ? 'query' : 'approved',
    details: o.status === 'query' ? { note: o.approver_note } : { submitted_amount: e.amount, approved_amount: e.approved_amount, altered: e.approved_amount !== e.amount, payer: db.profiles.find((p) => p.id === e.payer_id)?.full_name }, created_at: now() });
  if (o.status === 'paid') {
    db.attachments.push({ id: uid(), expense_id: e.id, kind: 'receipt', path: 'demo/receipt', file_name: 'gpay.jpg', mime: 'image/svg+xml', uploaded_by: e.paid_by, created_at: now() });
    db.activity.push({ id: db.activity.length + 1, expense_id: e.id, actor: e.paid_by, action: 'paid', details: { mode: 'upi', ref: e.payment_ref, amount: e.paid_amount }, created_at: now() });
  }
}
addExp({ expense_date: day(6), payee_id: 'py2', category: 'Venue & Hall', description: 'Hall booking advance', amount: 50000, status: 'paid', approved_amount: 50000, payer_id: U.mathew, approved_by: U.mathew, paid_by: U.mathew, paid_amount: 50000, payment_mode: 'upi', payment_ref: '531245678901', paid_at: now() });
addExp({ expense_date: day(5), payee_id: 'py1', category: 'Catering', description: 'Catering advance — 600 plates', amount: 100000, status: 'paid', approved_amount: 100000, payer_id: U.motty, approved_by: U.mathew, paid_by: U.motty, paid_amount: 100000, payment_mode: 'upi', payment_ref: '531287654321', paid_at: now() });
addExp({ expense_date: day(3), payee_id: 'py4', category: 'Photography & Video', description: 'Photo + video package advance', amount: 35000, status: 'paid', approved_amount: 30000, payer_id: U.varughese, approved_by: U.mathew, paid_by: U.varughese, paid_amount: 30000, payment_mode: 'upi', payment_ref: '531299990000', paid_at: now() });
addExp({ expense_date: day(1), payee_id: 'py3', category: 'Decoration & Flowers', description: 'Stage + church flowers', amount: 42500, status: 'approved', approved_amount: 40000, payer_id: U.motty, approved_by: U.mathew, approver_note: 'Agreed ₹40,000 with the florist' });
addExp({ expense_date: day(1), payee_id: 'py5', category: 'Printing & Invitations', description: '400 invitation cards', amount: 11200, status: 'query', approver_note: 'Is this inclusive of envelopes?', approved_by: U.mathew });
addExp({ expense_date: day(0), payee_id: 'py1', category: 'Catering', description: 'Second instalment', amount: 150000, status: 'submitted' });

const billSVG = (label, color) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#fff"/><rect x="20" y="20" width="260" height="40" fill="${color}"/>` +
  Array.from({ length: 9 }, (_, i) => `<rect x="20" y="${90 + i * 28}" width="${150 + (i * 37) % 100}" height="10" fill="#ddd"/>`).join('') +
  `<text x="150" y="370" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#555">${label}</text></svg>`);

let listeners = [];
const emit = () => listeners.forEach((f) => f());

class Q {
  constructor(t) { this.t = t; this.f = []; this.o = null; this.mode = 'select'; this.one = null; this.ret = false; }
  select() { this.ret = true; return this; }
  eq(k, v) { this.f.push((r) => r[k] === v); return this; }
  or() { return this; }
  order(k, o = {}) { const prev = this.o; this.o = [k, o.ascending !== false, prev]; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  single() { this.one = 'single'; return this; }
  insert(row) { this.mode = 'insert'; this.row = row; return this; }
  update(row) { this.mode = 'update'; this.row = row; return this; }
  delete() { this.mode = 'delete'; return this; }
  run() {
    const T = db[this.t];
    if (this.mode === 'insert') {
      const r = { id: uid(), created_at: now(), updated_at: now(), ...this.row };
      if (this.t === 'expenses') {
        serial++; Object.assign(r, { serial: 'POF-' + String(serial).padStart(4, '0'), status: 'submitted', submitted_by: U.motty });
        db.activity.push({ id: db.activity.length + 1, expense_id: r.id, actor: U.motty, action: 'submitted', details: { amount: r.amount }, created_at: now() });
      }
      T.push(r); emit(); return { data: r, error: null };
    }
    let rows = T.filter((r) => this.f.every((f) => f(r)));
    if (this.mode === 'update') { rows.forEach((r) => Object.assign(r, this.row)); emit(); return { data: rows[0], error: null }; }
    if (this.mode === 'delete') { db[this.t] = T.filter((r) => !rows.includes(r)); emit(); return { data: null, error: null }; }
    rows = [...rows];
    if (this.o) { const [k, asc] = this.o; rows.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1)); }
    if (this.one) return { data: rows[0] ?? null, error: null };
    return { data: JSON.parse(JSON.stringify(rows)), error: null };
  }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
}

const log = (id, action, details) => db.activity.push({ id: db.activity.length + 1, expense_id: id, actor: U.motty, action, details, created_at: now() });
const E = (id) => db.expenses.find((e) => e.id === id);
const RPC = {
  approve_expense: ({ p_id, p_amount, p_payer, p_category, p_note }) => {
    const e = E(p_id); const was = e.status;
    Object.assign(e, { status: 'approved', approved_amount: p_amount, payer_id: p_payer, category: p_category || e.category, approver_note: p_note, approved_by: U.motty, approved_at: now(), updated_at: now() });
    log(p_id, was === 'approved' ? 're-approved' : 'approved', { submitted_amount: e.amount, approved_amount: p_amount, altered: p_amount !== e.amount, payer: db.profiles.find((p) => p.id === p_payer)?.full_name, note: p_note });
  },
  return_expense: ({ p_id, p_action, p_note }) => { Object.assign(E(p_id), { status: p_action, approver_note: p_note, payer_id: null, approved_amount: null, updated_at: now() }); log(p_id, p_action, { note: p_note }); },
  mark_paid: ({ p_id, p_mode, p_ref, p_amount }) => { Object.assign(E(p_id), { status: 'paid', payment_mode: p_mode, payment_ref: p_ref, paid_amount: p_amount, paid_at: now(), paid_by: U.motty, updated_at: now() }); log(p_id, 'paid', { mode: p_mode, ref: p_ref, amount: p_amount }); },
  revert_payment: ({ p_id, p_note }) => { Object.assign(E(p_id), { status: 'approved', payment_mode: null, payment_ref: null, paid_amount: null, paid_at: null, paid_by: null, updated_at: now() }); log(p_id, 'payment_reverted', { note: p_note }); },
  edit_expense: ({ p_id, p_date, p_payee, p_category, p_description, p_amount }) => {
    const e = E(p_id); Object.assign(e, { expense_date: p_date, payee_id: p_payee, category: p_category, description: p_description, amount: p_amount, status: e.status === 'query' ? 'submitted' : e.status, updated_at: now() });
    log(p_id, 'edited', { from: {}, to: { amount: p_amount } });
  },
};

const session = { user: { id: U.motty }, access_token: 'demo' };
export const supabase = {
  from: (t) => new Q(t),
  rpc: async (n, a) => { RPC[n](a); emit(); return { error: null }; },
  auth: {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ error: null }),
    signOut: async () => { alert('Demo — sign out is disabled'); },
    updateUser: async () => ({ error: null }),
  },
  storage: {
    from: () => ({
      upload: async () => ({ error: null }),
      remove: async () => ({ error: null }),
      createSignedUrl: async (path) => ({ data: { signedUrl: path.includes('receipt') ? billSVG('GPay receipt', '#1a73e8') : billSVG('Invoice', '#489490') }, error: null }),
    }),
  },
  channel: () => { const ch = { on: (_a, _b, fn) => { listeners.push(fn); return ch; }, subscribe: () => ch }; return ch; },
  removeChannel: () => { listeners = []; },
};

export async function rpc(name, args) { await supabase.rpc(name, args); }
export async function adminUsers(method, body) {
  if (method === 'POST') db.profiles.push({ id: uid(), active: true, ...body, pin: undefined });
  if (method === 'PATCH') Object.assign(db.profiles.find((p) => p.id === body.id), body);
  if (method === 'DELETE') db.profiles.find((p) => p.id === body.id).active = false;
  emit(); return { ok: true, deactivated: method === 'DELETE' };
}
