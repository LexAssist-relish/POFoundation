// Vercel serverless function — user onboarding (admins only).
// Users sign in with username + 6-digit PIN; the username maps to a hidden
// email `<username>@pof.app` in Supabase Auth.
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOMAIN = 'pof.app';
const ROLES = ['admin', 'approver', 'payer', 'inputter', 'viewer'];

const admin = () => createClient(URL, SERVICE, { auth: { persistSession: false } });

function clean(body) {
  const out = {};
  if (body.username !== undefined) out.username = String(body.username).trim().toLowerCase();
  if (body.full_name !== undefined) out.full_name = String(body.full_name).trim();
  if (body.relation !== undefined) out.relation = String(body.relation || '').trim() || null;
  if (body.phone !== undefined) out.phone = String(body.phone || '').replace(/[^\d]/g, '') || null;
  if (body.roles !== undefined) {
    const r = (Array.isArray(body.roles) ? body.roles : []).filter((x) => ROLES.includes(x));
    out.roles = r.length ? r : ['viewer'];
  }
  if (body.active !== undefined) out.active = !!body.active;
  return out;
}

export default async function handler(req, res) {
  try {
    if (!URL || !SERVICE) return res.status(500).json({ error: 'Server not configured (SUPABASE_SERVICE_ROLE_KEY missing)' });
    const sb = admin();

    // --- who is calling? must be an active admin
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const { data: u, error: ue } = await sb.auth.getUser(token);
    if (ue || !u?.user) return res.status(401).json({ error: 'Not signed in' });
    const { data: me } = await sb.from('profiles').select('roles, active').eq('id', u.user.id).single();
    if (!me?.active || !me.roles.includes('admin')) return res.status(403).json({ error: 'Admins only' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

    if (req.method === 'POST') {
      const p = clean(body);
      const pin = String(body.pin || '');
      if (!/^[a-z0-9._-]{2,32}$/.test(p.username || '')) return res.status(400).json({ error: 'Username: 2–32 letters/numbers, no spaces' });
      if (!p.full_name) return res.status(400).json({ error: 'Full name required' });
      if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 6 digits' });
      const { data: created, error } = await sb.auth.admin.createUser({
        email: `${p.username}@${DOMAIN}`, password: pin, email_confirm: true,
        user_metadata: { full_name: p.full_name },
      });
      if (error) return res.status(400).json({ error: error.message.includes('already') ? 'That username is taken' : error.message });
      const { error: pe } = await sb.from('profiles').insert({ id: created.user.id, roles: ['viewer'], ...p });
      if (pe) { await sb.auth.admin.deleteUser(created.user.id); return res.status(400).json({ error: pe.message }); }
      return res.json({ ok: true, id: created.user.id });
    }

    if (req.method === 'PATCH') {
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const p = clean(body);
      delete p.username; // usernames are permanent (they are the login)
      if (id === u.user.id && p.roles && !p.roles.includes('admin')) return res.status(400).json({ error: "You can't remove your own admin role" });
      if (id === u.user.id && p.active === false) return res.status(400).json({ error: "You can't deactivate yourself" });
      if (Object.keys(p).length) {
        const { error } = await sb.from('profiles').update(p).eq('id', id);
        if (error) return res.status(400).json({ error: error.message });
      }
      if (body.pin) {
        if (!/^\d{6}$/.test(String(body.pin))) return res.status(400).json({ error: 'PIN must be 6 digits' });
        const { error } = await sb.auth.admin.updateUserById(id, { password: String(body.pin) });
        if (error) return res.status(400).json({ error: error.message });
      }
      if (p.active !== undefined) {
        await sb.auth.admin.updateUserById(id, { ban_duration: p.active ? 'none' : '876000h' });
      }
      return res.json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = body.id || req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      if (id === u.user.id) return res.status(400).json({ error: "You can't delete yourself" });
      // Users with history are deactivated, not erased (keeps the audit trail intact)
      const [{ count: a }, { count: b }] = await Promise.all([
        sb.from('activity').select('id', { count: 'exact', head: true }).eq('actor', id),
        sb.from('expenses').select('id', { count: 'exact', head: true }).or(`submitted_by.eq.${id},payer_id.eq.${id},approved_by.eq.${id},paid_by.eq.${id}`),
      ]);
      if ((a || 0) + (b || 0) > 0) {
        await sb.from('profiles').update({ active: false }).eq('id', id);
        await sb.auth.admin.updateUserById(id, { ban_duration: '876000h' });
        return res.json({ ok: true, deactivated: true });
      }
      const { error } = await sb.auth.admin.deleteUser(id); // cascades profile
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ ok: true, deleted: true });
    }

    res.setHeader('Allow', 'POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
}
