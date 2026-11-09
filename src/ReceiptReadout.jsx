import { money, fmtDate } from './util';

// Shows what GPT-4o read from a payment receipt, plus any warnings.
export default function ReceiptReadout({ reading }) {
  if (!reading) return null;
  if (reading.loading) return <div className="readout muted small">🔎 Reading the receipt…</div>;
  if (reading.error) return <div className="readout small"><span className="neg">Couldn’t read the receipt automatically.</span> Fill in the details yourself. <span className="muted">({reading.error})</span></div>;
  if (reading.skipped) return null;
  const x = reading.extracted || {};
  const statusChip = x.status === 'success' ? <span className="chip green">Successful</span>
    : x.status === 'failed' ? <span className="chip orange">Failed</span>
    : x.status === 'pending' ? <span className="chip amber">Pending</span> : null;
  return (
    <div className="readout">
      <div className="readout-head"><b>Read from receipt</b>{statusChip}</div>
      <dl className="readout-grid">
        <div><dt>Amount</dt><dd>{x.amount != null ? money(x.amount) : '—'}</dd></div>
        <div><dt>Paid to</dt><dd>{x.beneficiary_name || '—'}{x.beneficiary_upi ? <span className="mono small"> · {x.beneficiary_upi}</span> : null}</dd></div>
        <div><dt>UTR / Ref</dt><dd className="mono">{x.utr || (x.utr_raw ? <span className="neg">{x.utr_raw} (looks wrong)</span> : '—')}</dd></div>
        <div><dt>Date</dt><dd>{x.transaction_date ? fmtDate(x.transaction_date) : '—'}{x.bank_name ? ` · ${x.bank_name}` : ''}</dd></div>
      </dl>
      {(reading.warnings || []).map((w) => <div key={w} className="readout-warn">⚠ {w}</div>)}
    </div>
  );
}
