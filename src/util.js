import { supabase, BUCKET } from './supabase';

export const ROLE_LABELS = {
  admin: 'Admin', approver: 'Approver', payer: 'Payer', inputter: 'Expense input', viewer: 'Viewer',
};

export const STATUS = {
  submitted: { label: 'Awaiting approval', tone: 'amber' },
  query: { label: 'Query raised', tone: 'orange' },
  approved: { label: 'Awaiting payment', tone: 'blue' },
  paid: { label: 'Paid', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'grey' },
};

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const money = (n) => (n === null || n === undefined || n === '' ? '—' : inr.format(Number(n)));

export const fmtDate = (d) => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d)
  .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const fmtDateTime = (d) => d ? new Date(d)
  .toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
export const todayISO = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10);
};

export const has = (me, role) => !!me?.roles?.includes(role);

// Amount the family actually owes / paid for an expense
export const effAmount = (e) => Number(e.status === 'paid' ? (e.paid_amount ?? e.approved_amount ?? e.amount)
  : (e.approved_amount ?? e.amount));

// ---------- UPI ----------
export function upiLink({ vpa, name, amount, note }) {
  const p = new URLSearchParams();
  p.set('pa', vpa.trim());
  if (name) p.set('pn', name.slice(0, 40));
  if (amount) p.set('am', Number(amount).toFixed(2));
  p.set('cu', 'INR');
  if (note) p.set('tn', note.slice(0, 60));
  return 'upi://pay?' + p.toString().replace(/\+/g, '%20');
}

// Phone numbers are stored with country code, digits only: 919446051944, 60123456789.
// A bare 10-digit number starting 6-9 is treated as Indian. Anything else must include its country code.
export function normalizePhone(raw) {
  let p = String(raw || '').trim();
  const intl = p.startsWith('+') || p.startsWith('00');
  p = p.replace(/\D/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  if (!intl && p.length === 10 && /^[6-9]/.test(p)) p = '91' + p;
  return p;
}
export const phoneLooksIncomplete = (raw) => {
  const p = normalizePhone(raw);
  return !!p && (p.startsWith('0') || p.length < 11);
};
export const fmtPhone = (p) => (p ? '+' + p : '');

export const waLink = (phone, text) =>
  `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`;

export const appLink = (id) => `${location.origin}/#/e/${id}`;

// ---------- Files ----------
// Shrinks phone-camera photos (often 4–8 MB) to ~300 KB before upload. PDFs pass through.
export async function compressImage(file, max = 1800, quality = 0.78) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (s === 1 && file.size < 600_000) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}

export const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

export async function uploadAttachment(expenseId, file, kind) {
  const f = await compressImage(file);
  const ext = (f.name?.split('.').pop() || (f.type.includes('pdf') ? 'pdf' : 'jpg')).toLowerCase().slice(0, 5);
  const path = `${expenseId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined });
  if (error) throw new Error('Upload failed: ' + error.message);
  const { error: e2 } = await supabase.from('attachments').insert({
    expense_id: expenseId, kind, path, file_name: f.name || null, mime: f.type || null,
  });
  if (e2) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(e2.message); }
}

const urlCache = new Map();
export async function signedUrl(path) {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

export function downloadCSV(filename, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- Money in / out ----------
// Per account: received, pledged (not yet in), paid out, balance.
// Plus "own money": payments made by someone from their own pocket (counts as their contribution).
export function moneySummary({ funds = [], contributions = [], expenses = [], userById = {} }) {
  const paid = expenses.filter((e) => e.status === 'paid');
  const amt = (e) => Number(e.paid_amount ?? e.approved_amount ?? e.amount ?? 0);
  const perFund = funds.map((f) => {
    const cin = contributions.filter((c) => c.fund_id === f.id);
    const received = cin.filter((c) => c.status === 'received').reduce((t, c) => t + Number(c.amount), 0);
    const pledged = cin.filter((c) => c.status === 'pledged').reduce((t, c) => t + Number(c.amount), 0);
    const out = paid.filter((e) => e.paid_from === f.id).reduce((t, e) => t + amt(e), 0);
    return { fund: f, received, pledged, out, balance: received - out };
  });
  const ownPaid = paid.filter((e) => !e.paid_from);
  const ownTotal = ownPaid.reduce((t, e) => t + amt(e), 0);

  // Contributors: money given into an account + bills paid from own pocket
  const people = new Map();
  const add = (name, key, v) => {
    const k = name.trim().toLowerCase();
    const p = people.get(k) || { name: name.trim(), received: 0, pledged: 0, direct: 0 };
    p[key] += v; people.set(k, p);
  };
  contributions.forEach((c) => add(c.contributor_id && userById[c.contributor_id] ? userById[c.contributor_id].full_name : c.contributor,
    c.status === 'received' ? 'received' : 'pledged', Number(c.amount)));
  ownPaid.forEach((e) => add(userById[e.paid_by]?.full_name || 'Unknown', 'direct', amt(e)));
  const contributors = [...people.values()].map((p) => ({ ...p, total: p.received + p.direct }))
    .sort((a, b) => b.total - a.total || b.pledged - a.pledged);

  const totalIn = perFund.reduce((t, f) => t + f.received, 0) + ownTotal;
  const totalOut = paid.reduce((t, e) => t + amt(e), 0);
  const totalPledged = perFund.reduce((t, f) => t + f.pledged, 0);
  return { perFund, ownTotal, contributors, totalIn, totalOut, totalPledged };
}

export const fundName = (funds, id) => (id ? funds.find((f) => f.id === id)?.name || 'Account' : 'Own money');
