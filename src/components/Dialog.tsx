import { useEffect, useState } from 'react';

/**
 * Dialoghi interni all'app al posto di confirm()/alert() del browser
 * (alcuni browser integrati e PWA li bloccano o li chiudono subito).
 */
interface Req {
  message: string;
  ok: string;
  cancel?: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
}

let show: ((r: Req) => void) | null = null;

export function confirmDialog(message: string, opts: { ok?: string; cancel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(window.confirm(message));
    show({ message, ok: opts.ok ?? 'Conferma', cancel: opts.cancel ?? 'Annulla', danger: opts.danger, resolve });
  });
}

export function alertDialog(message: string): Promise<void> {
  return new Promise((resolve) => {
    if (!show) { window.alert(message); return resolve(); }
    show({ message, ok: 'OK', resolve: () => resolve() });
  });
}

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);

  useEffect(() => {
    show = setReq;
    return () => { show = null; };
  }, []);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      // non far chiudere anche lo sheet sottostante
      e.stopImmediatePropagation();
      e.preventDefault();
      close(e.key === 'Enter');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  if (!req) return null;
  const close = (v: boolean) => { req.resolve(v); setReq(null); };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true">
        <p>{req.message}</p>
        <div className="dialog-actions">
          {req.cancel && <button className="btn ghost" onClick={() => close(false)}>{req.cancel}</button>}
          <button className={`btn ${req.danger ? 'danger-solid' : 'primary'}`} onClick={() => close(true)} autoFocus>{req.ok}</button>
        </div>
      </div>
    </div>
  );
}
