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

export const waLink = (phone, text) => {
  let p = (phone || '').replace(/\D/g, '');
  if (p.length === 10) p = '91' + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
};

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
