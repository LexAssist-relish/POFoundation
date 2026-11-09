// WhatsApp message building + sending (MSG91 WhatsApp API, or Meta Cloud API directly).
// Files starting with "_" are helpers, not routes, on Vercel.

// The ONE WhatsApp template: sent to the family whenever a payment is made.
export const TEMPLATE = 'pof_payment_update';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const money = (n) => inr.format(Number(n || 0));
const paidAmt = (e) => Number(e.paid_amount ?? e.approved_amount ?? e.amount ?? 0);

// WhatsApp rejects template parameters with newlines, tabs or 4+ spaces, and empty values.
export const clean = (v, max = 200) => {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
  return (s || '-').slice(0, max);
};

/**
 * Running list of every payment so far, oldest first, as one line:
 * "1. Parish Hall ₹50,000 • 2. Caterers ₹1,00,000 • 3. Florist ₹40,000"
 * If it gets too long for WhatsApp, the oldest entries are folded into "(+N earlier)".
 */
export function paymentList(paid, payeeById, maxLen = 640) {
  const items = [...paid]
    .sort((a, b) => new Date(a.paid_at) - new Date(b.paid_at))
    .map((e, i) => `${i + 1}. ${payeeById[e.payee_id]?.name || e.description} ${money(paidAmt(e))}`);
  let shown = items;
  let hidden = 0;
  while (shown.length > 1 && shown.join(' • ').length + 20 > maxLen) { shown = shown.slice(1); hidden++; }
  return (hidden ? `(+${hidden} earlier) • ` : '') + shown.join(' • ');
}

/**
 * Messages for one payment. Everyone with alerts on gets it, except the person who paid.
 * Returns [{ user, template, params }]
 */
export function buildPaymentMessages({ expense: e, paidExpenses, payeeById, project, users, actor, link }) {
  const subtitle = project?.subtitle || project?.title || 'P O Foundation';
  const payer = users.find((u) => u.id === (e.paid_by || actor.id)) || actor;
  const total = paidExpenses.reduce((t, x) => t + paidAmt(x), 0);
  const params = [
    subtitle,                                             // {{1}} Bejoy John - Marriage
    money(paidAmt(e)),                                    // {{2}} ₹40,000
    payeeById[e.payee_id]?.name || 'payee',               // {{3}} Kumarakom Florist
    `${e.description} (${e.serial})`,                     // {{4}} Stage flowers (POF-0007)
    payer.full_name,                                      // {{5}} Varughese Koshy
    String(paidExpenses.length),                          // {{6}} 4
    money(total),                                         // {{7}} ₹2,20,000
    paymentList(paidExpenses, payeeById),                 // {{8}} 1. Parish Hall ₹50,000 • 2. …
    link,                                                 // {{9}} https://…
  ].map((p, i) => clean(p, i === 7 ? 700 : 200));

  return users
    .filter((u) => u.active && u.notify !== false && u.phone && u.id !== payer.id)
    .map((u) => ({ user: u, template: TEMPLATE, params }));
}

// Which WhatsApp provider is configured: MSG91 (preferred, same account as the Relish apps) or Meta direct.
export function waProvider() {
  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_WHATSAPP_NUMBER) return 'msg91';
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) return 'meta';
  return null;
}

export async function sendTemplate({ to, template, params }) {
  return waProvider() === 'msg91' ? sendViaMsg91({ to, template, params }) : sendViaMeta({ to, template, params });
}

// MSG91 WhatsApp template API
// POST https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/  (header: authkey)
async function sendViaMsg91({ to, template, params }) {
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
  const components = {};
  params.forEach((value, i) => { components[`body_${i + 1}`] = { type: 'text', value }; });
  const tpl = {
    name: template,
    language: { code: lang, policy: 'deterministic' },
    to_and_components: [{ to: [to], components }],
  };
  if (process.env.MSG91_WA_NAMESPACE) tpl.namespace = process.env.MSG91_WA_NAMESPACE;

  const res = await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
    method: 'POST',
    headers: { authkey: process.env.MSG91_AUTH_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      integrated_number: process.env.MSG91_WHATSAPP_NUMBER,
      content_type: 'template',
      payload: { messaging_product: 'whatsapp', type: 'template', template: tpl },
    }),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  // MSG91 can answer HTTP 200 with an error inside the body
  const failed = !res.ok || json.hasError === true || json.type === 'error' || json.msgType === 'error' ||
    (json.status && json.status !== 'success');
  if (failed) {
    const msg = json.errors ? JSON.stringify(json.errors) : json.message || json.msg || text || `HTTP ${res.status}`;
    throw new Error(`MSG91 ${res.status}: ${String(msg).slice(0, 300)}`);
  }
  const id = json.request_id || json.data?.request_id || (typeof json.data === 'string' ? json.data : null);
  return id ? String(id).slice(0, 120) : 'msg91-accepted';
}

// Meta WhatsApp Cloud API (direct), used only if MSG91 is not configured
async function sendViaMeta({ to, template, params }) {
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
  const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: lang },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
      },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error;
    throw new Error(err ? `${err.code || res.status}: ${err.error_user_msg || err.message}` : `HTTP ${res.status}`);
  }
  return json?.messages?.[0]?.id || null;
}
