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
// UPI deep link / QR text, in the format NPCI apps expect:
// upi://pay?pa=name@bank&pn=Name&am=100.00&cu=INR&tn=Note
// The UPI ID is written as-is (a "%40" instead of "@" makes GPay reject the QR).
export function upiLink({ vpa, name, amount, note }) {
  const enc = (v) => encodeURIComponent(String(v)).replace(/%40/g, '@');
  const clean = (v, max) => String(v || '').replace(/[&=?#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const parts = [`pa=${String(vpa).trim()}`];
  if (name) parts.push(`pn=${enc(clean(name, 40))}`);
  if (amount && Number(amount) > 0) parts.push(`am=${Number(amount).toFixed(2)}`);
  parts.push('cu=INR');
  if (note) parts.push(`tn=${enc(clean(note, 60))}`);
  return 'upi://pay?' + parts.join('&');
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

// target: an expense id (string), or { advance_id } for an advance
export async function uploadAttachment(target, file, kind) {
  const link = typeof target === 'string' ? { expense_id: target } : target;
  const folder = link.expense_id || `adv-${link.advance_id}`;
  const f = await compressImage(file);
  const ext = (f.name?.split('.').pop() || (f.type.includes('pdf') ? 'pdf' : 'jpg')).toLowerCase().slice(0, 5);
  const path = `${folder}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined });
  if (error) throw new Error('Upload failed: ' + error.message);
  const { error: e2 } = await supabase.from('attachments').insert({
    ...link, kind, path, file_name: f.name || null, mime: f.type || null,
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
export function moneySummary({ funds = [], contributions = [], expenses = [], userById = {}, advances = [] }) {
  const paid = expenses.filter((e) => e.status === 'paid');
  const amt = (e) => Number(e.paid_amount ?? e.approved_amount ?? e.amount ?? 0);
  const paidAdv = advances.filter((a) => a.status === 'paid' || a.status === 'closed');
  const perFund = funds.map((f) => {
    const cin = contributions.filter((c) => c.fund_id === f.id);
    const received = cin.filter((c) => c.status === 'received').reduce((t, c) => t + Number(c.amount), 0);
    const pledged = cin.filter((c) => c.status === 'pledged').reduce((t, c) => t + Number(c.amount), 0);
    // bills paid straight from this account + advances paid out of it (less anything returned)
    const out = paid.filter((e) => e.paid_from === f.id && !e.advance_id).reduce((t, e) => t + amt(e), 0)
      + paidAdv.filter((a) => a.paid_from === f.id).reduce((t, a) => t + Number(a.paid_amount) - Number(a.returned_amount || 0), 0);
    return { fund: f, received, pledged, out, balance: received - out };
  });
  // Advances: money handed over, then settled by bills
  const advGiven = paidAdv.reduce((t, a) => t + Number(a.paid_amount), 0);
  const advReturned = paidAdv.reduce((t, a) => t + Number(a.returned_amount || 0), 0);
  const advSettled = paid.filter((e) => e.advance_id).reduce((t, e) => t + amt(e), 0);
  const advances_ = { given: advGiven, returned: advReturned, settled: advSettled, pending: advGiven - advReturned - advSettled };
  // own-pocket: bills, plus advances paid by someone from their own money
  const ownAdv = paidAdv.filter((a) => !a.paid_from);
  const ownPaid = paid.filter((e) => !e.paid_from && !e.advance_id);
  const ownTotal = ownPaid.reduce((t, e) => t + amt(e), 0)
    + ownAdv.reduce((t, a) => t + Number(a.paid_amount) - Number(a.returned_amount || 0), 0);

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
  ownAdv.forEach((a) => add(userById[a.paid_by]?.full_name || 'Unknown', 'direct', Number(a.paid_amount) - Number(a.returned_amount || 0)));
  const contributors = [...people.values()].map((p) => ({ ...p, total: p.received + p.direct }))
    .sort((a, b) => b.total - a.total || b.pledged - a.pledged);

  const totalIn = perFund.reduce((t, f) => t + f.received, 0) + ownTotal;
  const totalOut = paid.reduce((t, e) => t + amt(e), 0);
  const totalPledged = perFund.reduce((t, f) => t + f.pledged, 0);
  return { perFund, ownTotal, contributors, totalIn, totalOut, totalPledged, advances: advances_ };
}

export const fundName = (funds, id) => (id ? funds.find((f) => f.id === id)?.name || 'Account' : 'Own money');

// One advance: how much was handed over, how much has been settled by bills, what's still pending
export function advanceBalance(a, expenses = []) {
  const given = Number(a.paid_amount ?? 0);
  const bills = expenses.filter((e) => e.advance_id === a.id && e.status === 'paid');
  const settled = bills.reduce((t, e) => t + Number(e.paid_amount ?? e.amount ?? 0), 0);
  const returned = Number(a.returned_amount || 0);
  return { given, settled, returned, pending: given - settled - returned, bills };
}

export const ADV_STATUS = {
  requested: { label: 'Awaiting approval', tone: 'amber' },
  query: { label: 'Query raised', tone: 'orange' },
  approved: { label: 'Awaiting payment', tone: 'blue' },
  paid: { label: 'Pending settlement', tone: 'teal' },
  rejected: { label: 'Rejected', tone: 'grey' },
  closed: { label: 'Settled', tone: 'green' },
};

// ---------- Bank details ----------
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// Pull account name / number / IFSC / bank out of pasted text (WhatsApp message, SMS, cheque-leaf text…)
export function parseBankDetails(text) {
  const t = String(text || '').replace(/\r/g, '');
  const out = {};
  const ifsc = t.toUpperCase().match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/);
  if (ifsc) out.ifsc = ifsc[1];
  const labelled = t.match(/(?:a\/?c|acc(?:ount)?|acct)\.?\s*(?:no|number|#)?\.?\s*[:\-#]?\s*([0-9][0-9 \-]{7,22}[0-9])/i);
  const acc = labelled ? labelled[1] : (t.match(/\b(\d{9,18})\b/) || [])[1];
  if (acc) out.account_no = acc.replace(/[\s-]/g, '');
  const name = t.match(/(?:a\/?c(?:count)?\s*(?:holder)?\s*name|name|beneficiary|holder)\s*[:\-]\s*([^\n,]{2,60})/i);
  if (name) out.account_name = name[1].trim();
  const bank = t.match(/(?:bank(?:\s*name)?)\s*[:\-]\s*([^\n,]{2,60})/i)
    || t.match(/\b([A-Z][A-Za-z ]{1,30} Bank)\b/);
  if (bank) out.bank_name = bank[1].trim();
  return out;
}

export function bankText(p) {
  return [p.account_name && `Name: ${p.account_name}`, p.account_no && `A/c No: ${p.account_no}`,
    p.ifsc && `IFSC: ${p.ifsc}`, p.bank_name && `Bank: ${p.bank_name}`].filter(Boolean).join('\n');
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    t.remove(); return ok;
  }
}
