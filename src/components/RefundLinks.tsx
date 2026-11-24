// Uscite rimborsate da un'entrata (busta paga): elenco di quelle collegate, ognuna rimovibile,
// e "Aggiungi spesa" per sceglierne altre tra quelle ancora da rimborsare.

import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Category, Movement } from '../types';
import { formatDate } from '../lib/dates';
import { money } from '../lib/format';
import { refundOf } from '../lib/stats';

export function RefundLinks({ selected, candidates, categories, onChange, target, near, noteOf }: {
  /** nota sull'uscita (es. già collegata a un'altra entrata). */
  noteOf?: (m: Movement) => string | undefined;
  /** id delle uscite collegate. */
  selected: string[];
  /** uscite che si possono collegare (comprese quelle già collegate). */
  candidates: Movement[];
  categories: Category[];
  onChange: (ids: string[]) => void;
  /** rimborso spese letto dal documento: si mostra la differenza. */
  target?: number;
  /** data dell'entrata: nell'elenco da aggiungere prima le uscite più vicine. */
  near?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map(candidates.map((m) => [m.id, m])), [candidates]);
  const chosen = selected.map((id) => byId.get(id)).filter((m): m is Movement => !!m).sort((a, b) => a.date.localeCompare(b.date));
  const total = chosen.reduce((s, m) => s + refundOf(m), 0);
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';
  const rest = useMemo(() => {
    const s = q.trim().toLowerCase();
    const dist = (d: string) => (near ? Math.abs(Date.parse(d) - Date.parse(near)) : -Date.parse(d));
    return candidates.filter((m) => !selected.includes(m.id))
      .filter((m) => !s || `${m.description} ${catName(m.categoryId)} ${formatDate(m.date)}`.toLowerCase().includes(s))
      .sort((a, b) => dist(a.date) - dist(b.date));
  }, [candidates, selected, q, near, categories]);
  const diff = target !== undefined ? Math.round((target - total) * 100) / 100 : 0;

  return (
    <div className="refund-links">
      {chosen.length > 0 && (
        <div className="check-list">
          {chosen.map((m) => (
            <div key={m.id} className="check-item">
              <span>{m.description}<small>{formatDate(m.date)} · spesa {money(m.amount)}</small></span>
              <strong>{money(refundOf(m))}</strong>
              <button type="button" className="icon-btn" aria-label="Togli" onClick={() => onChange(selected.filter((x) => x !== m.id))}><X size={18} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="refund-links-foot">
        <span className="muted small">
          {chosen.length ? <>Rimborsate {chosen.length} · <strong>{money(total)}</strong></> : 'Nessuna uscita collegata'}
          {target !== undefined && Math.abs(diff) > 0.005 && <strong className="neg"> · differenza {money(diff)}</strong>}
        </span>
        <button type="button" className="btn small ghost" onClick={() => setAdding(!adding)}>
          {adding ? 'Fine' : <><Plus size={16} /> Aggiungi spesa</>}
        </button>
      </div>
      {adding && (
        <>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca (es. Telefono, 03/2025)" />
          <div className="check-list refund-list">
            {rest.map((m) => (
              <button type="button" key={m.id} className="check-item refund-add" onClick={() => onChange([...selected, m.id])}>
                <Plus size={18} />
                <span>{m.description}<small>{formatDate(m.date)} · spesa {money(m.amount)}{noteOf?.(m) ? ` · ${noteOf(m)}` : ''}</small></span>
                <strong>{money(refundOf(m))}</strong>
              </button>
            ))}
            {!rest.length && <p className="muted small refund-empty">Nessuna altra uscita da rimborsare{q ? ' per questa ricerca' : ''}.</p>}
          </div>
        </>
      )}
    </div>
  );
}
