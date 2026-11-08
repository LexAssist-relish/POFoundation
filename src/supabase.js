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
