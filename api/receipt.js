// Vercel serverless function — reads a payment receipt with GPT-4o and finds the bill it pays.
// Nothing is saved here: the app shows the result and the payer confirms with one tap.
import { createClient } from '@supabase/supabase-js';
import { extractReceipt, matchReceipt } from './_receipt.js';

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    if (!URL || !SERVICE) return res.status(500).json({ error: 'Server not configured' });
    if (!process.env.OPENAI_API_KEY) return res.json({ ok: true, skipped: 'Receipt reading not configured (OPENAI_API_KEY)' });
    const sb = createClient(URL, SERVICE, { auth: { persistSession: false } });

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const { data: au, error: ae } = await sb.auth.getUser(token);
    if (ae || !au?.user) return res.status(401).json({ error: 'Not signed in' });
    const { data: me } = await sb.from('profiles').select('id, roles, active').eq('id', au.user.id).maybeSingle();
    if (!me?.active) return res.status(403).json({ error: 'Not a member' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { file_base64, mime, file_name } = body;
    if (!file_base64) return res.status(400).json({ error: 'file_base64 is required' });
    if (file_base64.length > 5_500_000) return res.status(413).json({ error: 'File too large — share a screenshot instead' });

    const x = await extractReceipt({ base64: file_base64, mime, fileName: file_name });

    // Bills this person may attach a receipt to
    const isAdmin = me.roles.includes('admin');
    const [{ data: exps }, { data: payees }, { data: rcpts }] = await Promise.all([
      sb.from('expenses').select('id, serial, status, payee_id, description, amount, approved_amount, paid_amount, payer_id, paid_by, payment_ref')
        .in('status', ['approved', 'paid']),
      sb.from('payees').select('id, name, upi_id'),
      sb.from('attachments').select('expense_id').eq('kind', 'receipt'),
    ]);
    const hasReceipt = new Set((rcpts || []).map((r) => r.expense_id));
    const mine = (e) => isAdmin || e.payer_id === me.id || e.paid_by === me.id;
    const pool = (exps || []).filter((e) => mine(e) && (e.status === 'approved' || !hasReceipt.has(e.id)));
    const payeeById = Object.fromEntries((payees || []).map((p) => [p.id, p]));

    const result = matchReceipt({ x, pool, allExpenses: exps || [], payeeById });
    return res.json({ ok: true, extracted: x, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
