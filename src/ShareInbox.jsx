import { useEffect, useMemo, useState } from 'react';
import { useData } from './App';
import { rpc } from './supabase';
import { money, has, uploadAttachment, effAmount } from './util';
import { Sheet, Field, Chip } from './ui';

// Receives a payment receipt shared from GPay / a bank app (via the service worker)
export default function ShareInbox() {
  const { expenses, me, payeeById, attByExp, reload, toast } = useData();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [pick, setPick] = useState(null);
  const [ref, setRef] = useState('');
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
        const m = (meta.text || '').match(/\b\d{12}\b/); // UPI refs are 12 digits; GPay often puts it in the shared text
        if (m) setRef(m[0]);
        if (f.type.startsWith('image/')) setPreview(URL.createObjectURL(f));
      } catch (err) { toast('Could not read the shared file: ' + err.message, 'err'); }
    })();
  }, [toast]);

  const candidates = useMemo(() => {
    const mine = (e) => e.payer_id === me.id || e.paid_by === me.id || has(me, 'admin');
    const awaiting = expenses.filter((e) => e.status === 'approved' && mine(e));
    const paidNoRcpt = expenses.filter((e) => e.status === 'paid' && mine(e) && !(attByExp[e.id] || []).some((a) => a.kind === 'receipt'));
    return [...awaiting, ...paidNoRcpt];
  }, [expenses, me, attByExp]);

  const clear = async () => {
    try { const c = await caches.open('pof-share'); await c.delete('/_share/file'); await c.delete('/_share/meta'); } catch {}
    if (preview) URL.revokeObjectURL(preview);
    setFile(null); setPreview(null); setPick(null); setRef('');
  };

  const attach = async () => {
    const e = expenses.find((x) => x.id === pick);
    if (!e) return;
    setBusy(true);
    try {
      await uploadAttachment(e.id, file, 'receipt');
      if (e.status === 'approved') {
        await rpc('mark_paid', { p_id: e.id, p_mode: 'upi', p_ref: ref.trim() || null, p_amount: Number(e.approved_amount), p_paid_at: null });
      }
      await reload();
      toast(e.status === 'approved' ? `${e.serial} marked paid ✓` : `Receipt attached to ${e.serial}`);
      await clear();
      location.hash = '#/e/' + e.id;
    } catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };

  if (!file) return null;
  return (
    <Sheet title="Attach payment receipt" onClose={clear}>
      {preview ? <img src={preview} alt="Shared receipt" className="share-preview" /> : <p className="muted">📄 {file.name}</p>}
      {candidates.length === 0 ? (
        <p className="note orange">No approved expenses are waiting for your payment. Open the expense and attach it from there.</p>
      ) : (
        <>
          <p className="small muted">Which payment is this for?</p>
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
          <Field label="UTR / UPI transaction ID" hint="Copy it from the receipt if it isn’t filled in.">
            <input className="mono" value={ref} onChange={(x) => setRef(x.target.value.trim())} />
          </Field>
          <button className="btn primary block" disabled={!pick || busy} onClick={attach}>{busy ? 'Saving…' : 'Attach & mark paid'}</button>
        </>
      )}
    </Sheet>
  );
}
