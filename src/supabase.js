import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

export const LOGIN_DOMAIN = 'pof.app';
export const BUCKET = 'pof-docs';

// Calls an RPC and throws a readable error
export async function rpc(name, args) {
  const { error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
}

export async function adminUsers(method, body) {
  const { data } = await supabase.auth.getSession();
  const res = await fetch('/api/admin-users', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// After a payment is recorded, ask the server to WhatsApp the family the running payment list.
// Fire-and-forget: a WhatsApp problem never blocks the payment.
export async function notifyPayment(expenseId) {
  try {
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
      body: JSON.stringify({ expense_id: expenseId }),
    });
    return await res.json().catch(() => ({}));
  } catch (e) {
    return { error: e.message };
  }
}

// Send a receipt (photo/screenshot/PDF) to the server: GPT-4o reads it and the server
// finds the bill it pays. Returns { extracted, match, candidates, warnings } or { skipped } / { error }.
export async function readReceipt(file) {
  try {
    const { compressImage, fileToBase64 } = await import('./util');
    const f = await compressImage(file);
    const file_base64 = await fileToBase64(f);
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
      body: JSON.stringify({ file_base64, mime: f.type || 'image/jpeg', file_name: f.name }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || `Couldn't read the receipt (${res.status})` };
    return json;
  } catch (e) {
    return { error: e.message };
  }
}
