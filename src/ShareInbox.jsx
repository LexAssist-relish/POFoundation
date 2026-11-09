import { useEffect, useMemo, useState } from 'react';
import { useData } from './App';
import { rpc, notifyPayment, readReceipt } from './supabase';
import { money, has, uploadAttachment, effAmount } from './util';
import { Sheet, Field, Chip } from './ui';
import ReceiptReadout from './ReceiptReadout';

const HOW = { utr: 'same UTR already recorded', reference: 'bill number in the payment note', 'amount+payee': 'amount and payee', amount: 'amount' };

// Receives a payment receipt shared from GPay / a bank app (via the service worker),
// reads it with GPT-4o, and pre-selects the bill it pays. The payer confirms with one tap.
export default function ShareInbox() {
  const { expenses, me, payeeById, attByExp, reload, toast } = useData();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [pick, setPick] = useState(null);
  const [ref, setRef] = useState('');
  const [reading, setReading] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!new URLSearchParams(location.search).has('share')) return;
    history.replaceState(null, '', location.pathname + location.hash);
    (async () => {
      try {
        const cache = await caches.open('pof-share');
        const [res, metaRes] = await Promise.all([cache.match('/_share/file'), cache.match('/_share/meta')]);
        const meta = metaRes ? await metaRes.json() : {};
        if (!res) { toast('Nothing was received — please share the receipt again', 'err'); return; }
        const blob = await res.blob();
        const f = new File([blob], meta.name || 'receipt.jpg', { type: meta.type || blob.type });
        setFile(f);
        const m = (meta.text || '').match(/\b\d{12}\b/); // GPay sometimes puts the UPI ref in the shared text
        if (m) setRef(m[0]);
        if (f.type.startsWith('image/')) setPreview(URL.createObjectURL(f));

        // Read it with GPT-4o and find the bill
        setReading({ loading: true });
        const r = await readReceipt(f);
        setReading(r);
        if (r.extracted?.utr) setRef(r.extracted.utr);
        if (r.match?.id) setPick(r.match.id);
      } catch (err) { toast('Could not read the shared file: ' + err.message, 'err'); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const candidates = useMemo(() => {
    const mine = (e) => e.payer_id === me.id || e.paid_by === me.id || has(me, 'admin');
    const awaiting = expenses.filter((e) => e.status === 'approved' && mine(e));
    const paidNoRcpt = expenses.filter((e) => e.status === 'paid' && mine(e) && !(attByExp[e.id] || []).some((a) => a.kind === 'receipt'));
    const list = [...awaiting, ...paidNoRcpt];
    // also include a UTR-duplicate match even if it already has a receipt
    const m = reading?.match?.id && expenses.find((e) => e.id === reading.match.id);
    if (m && !list.some((e) => e.id === m.id)) list.unshift(m);
    // server ranking first (closest amount / payee), then the rest
    const order = reading?.candidates || [];
    const pos = (id) => { const i = order.indexOf(id); return i === -1 ? 999 : i; };
    return list.sort((a, b) => pos(a.id) - pos(b.id));
  }, [expenses, me, attByExp, reading]);

  const clear = async () => {
    try { const c = await caches.open('pof-share'); await c.delete('/_share/file'); await c.delete('/_share/meta'); } catch {}
    if (preview) URL.revokeObjectURL(preview);
    setFile(null); setPreview(null); setPick(null); setRef(''); setReading(null);
  };

  const x = reading?.extracted;
  const failed = x?.status === 'failed';
  const chosen = expenses.find((e) => e.id === pick);

  const attach = async () => {
    const e = chosen;
    if (!e) return;
    setBusy(true);
    try {
      await uploadAttachment(e.id, file, 'receipt');
      if (e.status === 'approved') {
        const paid = x?.amount ?? Number(e.approved_amount);
        await rpc('mark_paid', { p_id: e.id, p_mode: x?.mode || 'upi', p_ref: ref.trim() || null, p_amount: paid, p_paid_at: null });
        notifyPayment(e.id);
      }
      await reload();
      toast(e.status === 'approved' ? `${e.serial} marked paid ✓` : `Receipt attached to ${e.serial}`);
      await clear();
      location.hash = '#/e/' + e.id;
    } catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };

  if (!file) return null;
  const amountDiffers = chosen && x?.amount != null && Math.abs(effAmount(chosen) - x.amount) >= 1;
  return (
    <Sheet title="Payment receipt" onClose={clear}>
      {preview ? <img src={preview} alt="Shared receipt" className="share-preview" /> : <p className="muted">📄 {file.name}</p>}
      <ReceiptReadout reading={reading} />

      {candidates.length === 0 ? (
        <p className="note orange">No approved bills are waiting for your payment. Open the bill and attach the receipt from there.</p>
      ) : (
        <>
          <p className="small muted">
            {reading?.match ? <>Matched by <b>{HOW[reading.match.how] || reading.match.how}</b> — check it’s right:</> : 'Which bill is this payment for?'}
          </p>
          <div className="pick-list">
            {candidates.map((e) => (
              <label key={e.id} className={'pick' + (pick === e.id ? ' on' : '')}>
                <input type="radio" name="pick" checked={pick === e.id} onChange={() => setPick(e.id)} />
                <div className="ri-main">
                  <div className="ri-title">{payeeById[e.payee_id]?.name} <span className="ri-serial">{e.serial}</span></div>
                  <div className="ri-sub">{e.description}</div>
                </div>
                <div className="ri-side"><div className="ri-amt">{money(effAmount(e))}</div><Chip status={e.status} /></div>
              </label>
            ))}
          </div>
          <Field label="UTR / UPI transaction ID" hint={x?.utr ? 'Read from the receipt — check it matches.' : 'Copy it from the receipt if it isn’t filled in.'}>
            <input className="mono" value={ref} onChange={(ev) => setRef(ev.target.value.trim())} />
          </Field>
          {amountDiffers && chosen.status === 'approved' && (
            <p className="note orange small">The receipt shows {money(x.amount)} but {chosen.serial} was approved for {money(effAmount(chosen))}. It will be recorded as {money(x.amount)} paid.</p>
          )}
          <button className="btn primary block" disabled={!pick || busy || failed || reading?.loading} onClick={attach}>
            {busy ? 'Saving…' : failed ? 'Receipt shows a failed payment' : reading?.loading ? 'Reading receipt…'
              : chosen?.status === 'paid' ? `Attach receipt to ${chosen.serial}` : chosen ? `Confirm: ${chosen.serial} paid` : 'Choose the bill'}
          </button>
        </>
      )}
    </Sheet>
  );
}
