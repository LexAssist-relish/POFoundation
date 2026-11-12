import { useEffect, useRef, useState } from 'react';
import { STATUS, signedUrl, copyText, bankText } from './util';

export function Sheet({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={'sheet' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const Chip = ({ status }) => {
  const s = STATUS[status] || { label: status, tone: 'grey' };
  return <span className={`chip ${s.tone}`}>{s.label}</span>;
};

export const Field = ({ label, hint, children }) => (
  <label className="field">
    <span className="field-label">{label}</span>
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </label>
);

export function Empty({ icon = '🗂️', title, children }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
    </div>
  );
}

// Camera + gallery/file pickers. Returns File[] via onFiles.
export function FilePicker({ onFiles, label = 'invoice', multiple = true }) {
  const cam = useRef(); const up = useRef();
  const pick = (e) => { const f = [...(e.target.files || [])]; if (f.length) onFiles(f); e.target.value = ''; };
  return (
    <div className="picker">
      <button type="button" className="btn ghost" onClick={() => cam.current.click()}>📷 Photo of {label}</button>
      <button type="button" className="btn ghost" onClick={() => up.current.click()}>📎 Upload file</button>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={up} type="file" accept="image/*,application/pdf" multiple={multiple} hidden onChange={pick} />
    </div>
  );
}

// Local (not yet uploaded) file previews
export function PendingFiles({ files, onRemove }) {
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    const u = files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null));
    setUrls(u); return () => u.forEach((x) => x && URL.revokeObjectURL(x));
  }, [files]);
  if (!files.length) return null;
  return (
    <div className="thumbs">
      {files.map((f, i) => (
        <div className="thumb" key={i}>
          {urls[i] ? <img src={urls[i]} alt="" /> : <div className="thumb-doc">PDF</div>}
          <button type="button" className="thumb-x" onClick={() => onRemove(i)} aria-label="Remove">✕</button>
        </div>
      ))}
    </div>
  );
}

// Stored attachments, grouped by kind, tap to open full-screen
export function Attachments({ items, canDelete, onDelete }) {
  const [view, setView] = useState(null);
  const groups = [['bill', 'Bills & invoices'], ['receipt', 'Payment receipts'], ['other', 'Other']];
  if (!items?.length) return <p className="muted small">No attachments yet.</p>;
  return (
    <>
      {groups.map(([k, label]) => {
        const list = items.filter((a) => a.kind === k);
        if (!list.length) return null;
        return (
          <div key={k} className="att-group">
            <div className="att-label">{label}</div>
            <div className="thumbs">
              {list.map((a) => <StoredThumb key={a.id} a={a} onOpen={() => setView(a)} />)}
            </div>
          </div>
        );
      })}
      {view && <Viewer a={view} onClose={() => setView(null)} canDelete={canDelete?.(view)}
        onDelete={async () => { await onDelete(view); setView(null); }} />}
    </>
  );
}

function StoredThumb({ a, onOpen }) {
  const [url, setUrl] = useState(null);
  const isImg = (a.mime || '').startsWith('image/');
  useEffect(() => { if (isImg) signedUrl(a.path).then(setUrl).catch(() => {}); }, [a.path, isImg]);
  return (
    <button type="button" className="thumb" onClick={onOpen}>
      {isImg ? (url ? <img src={url} alt={a.file_name || ''} loading="lazy" /> : <div className="thumb-doc">…</div>)
        : <div className="thumb-doc">PDF</div>}
    </button>
  );
}

function Viewer({ a, onClose, canDelete, onDelete }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { signedUrl(a.path).then(setUrl).catch(() => {}); }, [a.path]);
  const isImg = (a.mime || '').startsWith('image/');
  return (
    <div className="viewer" onClick={onClose}>
      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span>{a.file_name || a.kind}</span>
        <div className="row gap">
          {url && <a className="btn small light" href={url} target="_blank" rel="noreferrer">Open</a>}
          {canDelete && <button className="btn small danger" onClick={() => confirm('Delete this attachment?') && onDelete()}>Delete</button>}
          <button className="btn small light" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="viewer-body" onClick={(e) => e.stopPropagation()}>
        {!url ? <p>Loading…</p> : isImg ? <img src={url} alt="" /> : <iframe src={url} title="document" />}
      </div>
    </div>
  );
}

export function useToast() {
  const [t, setT] = useState(null);
  const timer = useRef();
  const show = (msg, tone = 'ok') => {
    clearTimeout(timer.current); setT({ msg, tone });
    timer.current = setTimeout(() => setT(null), tone === 'err' ? 6000 : 3000);
  };
  const node = t ? <div className={`toast ${t.tone}`} onClick={() => setT(null)}>{t.msg}</div> : null;
  return [show, node];
}

// A row showing one value with a Copy button
export function CopyRow({ label, value, mono = true }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <div className="copy-row">
      <div><small>{label}</small><b className={mono ? 'mono' : ''}>{value}</b></div>
      <button type="button" onClick={async () => { await copyText(value); setDone(true); setTimeout(() => setDone(false), 1600); }}>
        {done ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  );
}

// Payee's bank details with copy buttons, plus "Copy all"
export function BankDetails({ p }) {
  const [all, setAll] = useState(false);
  if (!p || !(p.account_no || p.ifsc)) return null;
  return (
    <div className="bank-box">
      <CopyRow label="Account name" value={p.account_name || p.name} mono={false} />
      <CopyRow label="Account no." value={p.account_no} />
      <CopyRow label="IFSC" value={p.ifsc} />
      {p.bank_name && <CopyRow label="Bank" value={p.bank_name} mono={false} />}
      <button type="button" className="btn ghost small" onClick={async () => {
        await copyText(bankText({ ...p, account_name: p.account_name || p.name })); setAll(true); setTimeout(() => setAll(false), 1600);
      }}>{all ? 'Copied all ✓' : '📋 Copy all details'}</button>
    </div>
  );
}
