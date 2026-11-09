import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { upiLink, waLink } from './util';

// Public page (no login): pofoundation…/give — how family can send a contribution.
const UPI_ID = 'sherinemotty-2@okhdfcbank';
const HOLDER = 'Sherine Motty';
const BANK = [
  ['Account name', 'Sherine Motty'],
  ['Bank', 'South Indian Bank, Alappuzha branch'],
  ['Account no.', '0915053000001666'],
  ['IFSC', 'SIBL000915'],
  ['SWIFT (from abroad)', 'SOININ55005'],
];
const COPYABLE = ['Account no.', 'IFSC', 'SWIFT (from abroad)'];
const WHATSAPP_TO = '919446051944'; // Sherine

export default function GivePage() {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState('');

  const note = `Bejoy wedding${name.trim() ? ' - ' + name.trim() : ''}`.slice(0, 60);
  const link = upiLink({ vpa: UPI_ID, name: HOLDER, amount: Number(amount) > 0 ? amount : null, note });

  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 600, color: { dark: '#1f4f4c', light: '#ffffff' } }).then(setQr).catch(() => setQr(null));
  }, [link]);
  useEffect(() => { document.title = 'Contribute · Bejoy John - Marriage'; }, []);

  const copy = async (text, key) => {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch {} t.remove();
    }
    setCopied(key); setTimeout(() => setCopied(''), 1800);
  };

  const amt = Number(amount) > 0 ? `₹${Number(amount).toLocaleString('en-IN')}` : '₹____';
  const msg = `Hi Sherine, I've sent ${amt} towards Bejoy's wedding.\nName: ${name.trim() || '____'}\nSent by: UPI / bank transfer\n(Screenshot attached)`;

  return (
    <div className="give">
      <header className="give-hero">
        <img src="/logo-full.png" alt="P O Foundation" className="give-logo" />
        <h1>Bejoy John – Marriage</h1>
        <p className="give-date">14 November 2026</p>
        <p className="give-lead">
          The family is pooling contributions towards Bejoy’s wedding expenses. All contributions are received
          in one account held by <b>Sherine Motty</b>, and every payment from it is recorded with its bill and receipt.
        </p>
      </header>

      <main className="give-main">
        <section className="give-card">
          <div className="give-fields">
            <label><span>Your name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="So we know who it’s from" autoComplete="name" /></label>
            <label><span>Amount (₹)</span><input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="Optional" /></label>
          </div>
          <p className="give-hint">Optional — they’re added to the UPI payment note and the message below.</p>
        </section>

        <section className="give-card">
          <h2><span className="give-step">1</span> Pay by UPI</h2>
          <div className="give-upi">
            {qr && <img src={qr} alt="UPI QR code for Sherine Motty" className="give-qr" />}
            <div className="give-upi-side">
              <a className="give-btn primary" href={link}>Pay with GPay / any UPI app</a>
              <div className="give-copyrow">
                <div><small>UPI ID</small><b className="mono">{UPI_ID}</b></div>
                <button onClick={() => copy(UPI_ID, 'upi')}>{copied === 'upi' ? 'Copied ✓' : 'Copy'}</button>
              </div>
              <p className="give-hint">On a computer, scan the QR with your phone’s UPI app. Paying to the UPI ID directly always works.</p>
            </div>
          </div>
        </section>

        <section className="give-card">
          <h2><span className="give-step">2</span> Or bank transfer</h2>
          <div className="give-bank">
            {BANK.map(([k, v]) => (
              <div className="give-copyrow" key={k}>
                <div><small>{k}</small><b className={COPYABLE.includes(k) ? 'mono' : ''}>{v}</b></div>
                {COPYABLE.includes(k) && <button onClick={() => copy(v, k)}>{copied === k ? 'Copied ✓' : 'Copy'}</button>}
              </div>
            ))}
          </div>
          <p className="give-hint">Sending from outside India? Use the SWIFT code with the account number and name above.</p>
        </section>

        <section className="give-card">
          <h2><span className="give-step">3</span> Let Sherine know</h2>
          <p className="give-text">After sending, share the payment screenshot on WhatsApp so it can be recorded against your name.</p>
          <a className="give-btn wa" href={waLink(WHATSAPP_TO, msg)} target="_blank" rel="noreferrer">💬 Message Sherine on WhatsApp</a>
        </section>

        <p className="give-thanks">Thank you for being part of Bejoy’s day.</p>
      </main>

      <footer className="give-foot">P O Foundation · Pandampurath Oommen family</footer>
    </div>
  );
}
