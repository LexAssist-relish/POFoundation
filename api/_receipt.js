// Payment-receipt reading (GPT-4o) and matching to expenses.
// Ported from the Relish Approvals receipt flow, including its bank-label lessons.

export const EXTRACT_PROMPT = `You read Indian payment receipts and screenshots: Google Pay, PhonePe, Paytm, BHIM, WhatsApp Pay,
and bank apps (Federal, HDFC, ICICI, SBI, Canara, Axis, Kotak, South Indian Bank, etc.), and bank SMS/email confirmations.

Return ONLY a JSON object with these keys:
{
  "is_payment_receipt": true|false,
  "status": "success" | "failed" | "pending" | "unknown",
  "amount": number or null,                 // rupees, no commas, e.g. 40000 or 1250.5
  "utr": string or null,                    // the bank reference for this transfer, see rules
  "mode": "upi" | "bank" | null,            // bank = NEFT/IMPS/RTGS/within-bank transfer
  "beneficiary_name": string or null,       // who was PAID (not the payer)
  "beneficiary_upi": string or null,        // payee UPI ID like name@okaxis, if shown
  "transaction_date": "YYYY-MM-DD" or null,
  "note": string or null,                   // message / remarks / purpose typed by the payer
  "bank_name": string or null,              // bank the money was paid FROM, if shown
  "raw_text": string                         // ALL text visible on the receipt, top to bottom, labels included
}

UTR rules — the reference banks use to trace the transfer. It appears under one of these labels:
"UPI transaction ID", "UPI Ref No", "UPI Reference No", "UTR", "UTR No", "Transaction ID" (Federal Bank),
"RRN", "RRN Number", "Reference Number", "Ref No", "IMPS Ref No", "NEFT Ref".
- Google Pay: use "UPI transaction ID" (usually 12 digits). NEVER the "Google transaction ID" (mixed letters like CICAgO…).
- PhonePe: use "UTR" — NOT the "Transaction ID" that starts with T.
- Paytm: use "UPI Ref No" — NOT the "Order ID".
- Canara within-bank transfers may only have an alphanumeric "Reference Number" (e.g. H49023IDHR) — use it.
- Keep leading zeros. Return it exactly as printed, without spaces.
- Never return account numbers, phone numbers, order IDs, or app-internal transaction IDs as the utr.
- If no such reference is visible, utr = null.

status: "success" only if the receipt clearly says paid/successful/completed. "failed" if failed/declined/reversed.
If the image is not a payment receipt at all, set is_payment_receipt=false and everything else null.`;

// Backup when the model's utr is missing or rejected: look for a reference right after a known label.
const UTR_LABELS = [
  'upi transaction id', 'upi txn id', 'upi ref(?:erence)?(?:\\.)?\\s*(?:no|number)?', 'utr(?:\\s*(?:no|number))?',
  'transaction id', 'txn id', 'rrn(?:\\s*number)?', 'ref(?:erence)?(?:\\.)?\\s*(?:no|number)', 'imps ref(?:\\s*no)?', 'neft ref(?:\\s*no)?',
];
export function findUtrInText(text) {
  if (!text) return null;
  const t = String(text).replace(/\r/g, '');
  const ignore = /google transaction id|order id|merchant/i;
  for (const lab of UTR_LABELS) {
    const re = new RegExp(`(${lab})\\s*[:#.\\-]?\\s*\\n?\\s*([A-Za-z0-9 ]{9,30})`, 'gi');
    let m;
    while ((m = re.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 12), m.index + m[1].length);
      if (ignore.test(before)) continue;
      const cand = cleanUtr(m[2].replace(/\s+/g, '').toUpperCase().slice(0, 22))
        || cleanUtr((m[2].match(/\d[\d ]{8,14}\d/) || [''])[0]);
      if (cand) return cand;
    }
  }
  // last resort: a lone 12-digit UPI reference anywhere on the receipt
  const twelve = [...t.matchAll(/(?<![\d])(\d{4}\s?\d{4}\s?\d{4})(?![\d])/g)].map((x) => x[1].replace(/\s/g, ''));
  const uniq = [...new Set(twelve)];
  return uniq.length === 1 ? uniq[0] : null;
}

// A UTR we trust: 12-digit UPI/IMPS, 9-digit older NEFT, or an uppercase alphanumeric bank ref (9–22 chars, has letters and digits)
export function cleanUtr(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/[\s-]/g, '');
  if (/^\d{12}$/.test(s) || /^\d{9}$/.test(s)) return s;
  if (/^[A-Z0-9]{9,22}$/.test(s) && /[A-Z]/.test(s) && (s.match(/\d/g) || []).length >= 3) return s;
  return null; // lowercase/mixed-case = app-internal IDs (Google "CICAg…", Razorpay order ids), reject
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9@.]/g, ' ').replace(/\s+/g, ' ').trim();
const effAmount = (e) => Number(e.status === 'paid' ? (e.paid_amount ?? e.approved_amount ?? e.amount) : (e.approved_amount ?? e.amount));

function payeeScore(x, payee) {
  if (!payee) return 0;
  let s = 0;
  if (x.beneficiary_upi && payee.upi_id && norm(x.beneficiary_upi) === norm(payee.upi_id)) s += 3;
  const words = (t) => new Set(norm(t).split(' ').filter((w) => w.length > 2));
  const a = words(x.beneficiary_name), b = words(payee.name);
  for (const w of a) if (b.has(w)) { s += 1; break; }
  return s;
}

/**
 * Decide which expense a receipt belongs to.
 * pool: expenses this person may attach a receipt to (approved & theirs to pay, or paid without a receipt)
 * Returns { match: { id, how, attachOnly } | null, candidates: [id…], warnings: [text…] }
 */
export function matchReceipt({ x, pool, allExpenses, payeeById }) {
  const warnings = [];
  if (x.is_payment_receipt === false) warnings.push('This doesn’t look like a payment receipt.');
  if (x.status === 'failed') warnings.push('The receipt says the payment FAILED — don’t mark it paid.');
  if (x.status === 'pending') warnings.push('The receipt says the payment is still PENDING.');

  // 1. Same UTR already recorded → this receipt belongs to that (already paid) expense
  if (x.utr) {
    const dup = allExpenses.find((e) => e.payment_ref && e.payment_ref.replace(/\s/g, '') === x.utr);
    if (dup) {
      warnings.push(`UTR ${x.utr} is already recorded on ${dup.serial}.`);
      return { match: { id: dup.id, how: 'utr', attachOnly: true }, candidates: [dup.id], warnings };
    }
  }

  // 2. The narration carries the bill number (we pre-fill "POF-0007 …" in the UPI note)
  const ref = String(x.note || '').toUpperCase().match(/POF[-\s]?(\d{1,5})/);
  if (ref) {
    const serial = 'POF-' + ref[1].padStart(4, '0');
    const hit = pool.find((e) => e.serial === serial);
    if (hit) {
      if (x.amount != null && Math.abs(effAmount(hit) - x.amount) >= 1)
        warnings.push(`Receipt shows ₹${x.amount}, but ${serial} is for ₹${effAmount(hit)}.`);
      return { match: { id: hit.id, how: 'reference', attachOnly: hit.status === 'paid' }, candidates: rank(pool, x, payeeById), warnings };
    }
  }

  // 3. Exact amount (₹1 tolerance), tie-broken by payee UPI / name
  if (x.amount != null) {
    const same = pool.filter((e) => Math.abs(effAmount(e) - x.amount) < 1);
    const scored = same.map((e) => ({ e, s: payeeScore(x, payeeById[e.payee_id]) })).sort((a, b) => b.s - a.s);
    const unpaid = scored.filter((c) => c.e.status === 'approved');
    const best = (unpaid.length ? unpaid : scored);
    if (best.length === 1 || (best.length > 1 && best[0].s > best[1].s)) {
      const hit = best[0].e;
      return { match: { id: hit.id, how: best[0].s > 0 ? 'amount+payee' : 'amount', attachOnly: hit.status === 'paid' }, candidates: rank(pool, x, payeeById), warnings };
    }
    if (best.length > 1) warnings.push(`${best.length} bills are for this amount — pick the right one.`);
    else warnings.push(`No bill waiting for payment is for ₹${x.amount}.`);
  }
  return { match: null, candidates: rank(pool, x, payeeById), warnings };
}

// Closest first: amount difference, then payee likeness
function rank(pool, x, payeeById) {
  return [...pool]
    .map((e) => ({ id: e.id, d: x.amount != null ? Math.abs(effAmount(e) - x.amount) : 0, s: payeeScore(x, payeeById[e.payee_id]), paid: e.status === 'paid' }))
    .sort((a, b) => (a.paid - b.paid) || (a.d - b.d) || (b.s - a.s))
    .map((c) => c.id);
}

export async function extractReceipt({ base64, mime, fileName }) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const filePart = mime === 'application/pdf'
    ? { type: 'file', file: { filename: fileName || 'receipt.pdf', file_data: `data:application/pdf;base64,${base64}` } }
    : { type: 'image_url', image_url: { url: `data:${mime || 'image/jpeg'};base64,${base64}`, detail: 'high' } };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user', content: [{ type: 'text', text: 'Read this payment receipt.' }, filePart] },
      ],
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${json?.error?.message || 'request failed'}`);
  let x = {};
  try { x = JSON.parse(json.choices?.[0]?.message?.content || '{}'); } catch { x = {}; }
  const amount = x.amount == null ? null : Number(String(x.amount).replace(/[^\d.]/g, ''));
  return {
    is_payment_receipt: x.is_payment_receipt !== false,
    status: ['success', 'failed', 'pending'].includes(x.status) ? x.status : 'unknown',
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    utr: cleanUtr(x.utr) || findUtrInText(x.raw_text),
    utr_raw: x.utr || null,
    mode: x.mode === 'bank' ? 'bank' : x.mode === 'upi' ? 'upi' : null,
    beneficiary_name: x.beneficiary_name || null,
    beneficiary_upi: x.beneficiary_upi || null,
    transaction_date: /^\d{4}-\d{2}-\d{2}$/.test(x.transaction_date || '') ? x.transaction_date : null,
    note: x.note || null,
    bank_name: x.bank_name || null,
  };
}
