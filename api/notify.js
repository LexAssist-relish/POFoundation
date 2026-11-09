// Vercel serverless function — sends the WhatsApp "payment made" update.
// It is the only WhatsApp message the app sends; every other alert is in-app.
// The browser only says "expense X was just paid"; the server checks that
// itself, so messages can't be faked or sent twice for the same payment.
import { createClient } from '@supabase/supabase-js';
import { buildPaymentMessages, sendTemplate, waProvider } from './_whatsapp.js';

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    if (!URL || !SERVICE) return res.status(500).json({ error: 'Server not configured' });
    if (!waProvider()) return res.json({ ok: true, skipped: 'WhatsApp not configured' });
    const sb = createClient(URL, SERVICE, { auth: { persistSession: false } });

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const { data: au, error: ae } = await sb.auth.getUser(token);
    if (ae || !au?.user) return res.status(401).json({ error: 'Not signed in' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { expense_id } = body;
    if (!expense_id) return res.status(400).json({ error: 'expense_id is required' });

    const [{ data: users }, { data: e }] = await Promise.all([
      sb.from('profiles').select('id, full_name, phone, roles, active, notify'),
      sb.from('expenses').select('*').eq('id', expense_id).maybeSingle(),
    ]);
    const actor = users?.find((u) => u.id === au.user.id);
    if (!actor?.active) return res.status(403).json({ error: 'Not a member' });
    if (!e) return res.status(404).json({ error: 'Expense not found' });
    if (e.status !== 'paid') return res.json({ ok: true, skipped: `expense is ${e.status}` });

    // The "paid" history entry this message is about: must be the caller's own, and recent
    const { data: act } = await sb.from('activity').select('id, actor, created_at')
      .eq('expense_id', expense_id).eq('action', 'paid')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!act) return res.json({ ok: true, skipped: 'no payment in history' });
    if (act.actor !== actor.id) return res.json({ ok: true, skipped: 'not your payment' });
    if (Date.now() - new Date(act.created_at).getTime() > 15 * 60 * 1000) return res.json({ ok: true, skipped: 'too old' });

    // Everything paid so far in this flow, for the running list
    const [{ data: paidExpenses }, { data: payees }, { data: project }] = await Promise.all([
      sb.from('expenses').select('id, serial, payee_id, description, amount, approved_amount, paid_amount, paid_at')
        .eq('project_id', e.project_id).eq('status', 'paid'),
      sb.from('payees').select('id, name'),
      sb.from('projects').select('title, subtitle').eq('id', e.project_id).maybeSingle(),
    ]);
    const payeeById = Object.fromEntries((payees || []).map((p) => [p.id, p]));

    const origin = process.env.APP_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const messages = buildPaymentMessages({
      expense: e, paidExpenses: paidExpenses || [], payeeById, project, users, actor,
      link: `${origin}/#/daybook`,
    });

    const results = [];
    for (const m of messages) {
      // claim the (payment, person) slot first — unique index stops duplicates
      const { data: row, error: ie } = await sb.from('notifications').insert({
        expense_id: e.id, activity_id: act.id, event: 'paid', recipient: m.user.id, phone: m.user.phone, template: m.template,
      }).select('id').single();
      if (ie) { results.push({ to: m.user.full_name, status: 'duplicate' }); continue; }
      try {
        const msgId = await sendTemplate({ to: m.user.phone, template: m.template, params: m.params });
        await sb.from('notifications').update({ status: 'sent', wa_message_id: msgId }).eq('id', row.id);
        results.push({ to: m.user.full_name, status: 'sent' });
      } catch (err) {
        await sb.from('notifications').update({ status: 'failed', error: String(err.message).slice(0, 500) }).eq('id', row.id);
        results.push({ to: m.user.full_name, status: 'failed', error: err.message });
      }
    }
    return res.json({ ok: true, results });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
