import { useMemo, useState } from 'react';
import { Briefcase, ChevronLeft, ChevronRight, Clock, ListChecks, Search, CalendarRange, Repeat, Sparkle } from 'lucide-react';
import type { Movement } from '../types';
import { useStore } from '../data/store';
import { Badge, Icon } from '../components/Icon';
import { Empty, Segmented, SplitBadge } from '../components/ui';
import { addMonths, dayHeader, endOfMonth, monthLabel, startOfMonth, todayISO } from '../lib/dates';
import { money } from '../lib/format';
import { VIRTUAL_PREFIX, effectiveMine, makeCtx, myShare, refundOf, upcomingMovements } from '../lib/stats';

type KindFilter = 'tutti' | 'uscita' | 'entrata' | 'previsti' | 'rimborsi' | 'confermare' | 'straordinari';

export function Movements({ onEdit }: { onEdit: (m: Movement) => void }) {
  const { state } = useStore();
  const [month, setMonth] = useState<string | null>(startOfMonth(todayISO()));
  const [q, setQ] = useState('');
  const [kf, setKf] = useState<KindFilter>('tutti');
  const [cat, setCat] = useState('');

  const ctx = useMemo(() => makeCtx(state), [state]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    // occorrenze future delle ricorrenze: nel mese mostrato, o nei prossimi 12 mesi per "Tutti i movimenti"
    const upcoming = month
      ? upcomingMovements(state, month, endOfMonth(month))
      : upcomingMovements(state, todayISO(), addMonths(todayISO(), 12));
    return [...state.movements, ...upcoming]
      .filter((m) => !m.deleted)
      .filter((m) => !month || (m.date >= month && m.date <= endOfMonth(month)))
      .filter((m) => kf === 'tutti' || (kf === 'previsti' ? m.planned : kf === 'rimborsi' ? m.refund !== 'none' : kf === 'confermare' ? !!m.toConfirm : kf === 'straordinari' ? !!m.extraordinary : m.kind === kf))
      .filter((m) => !cat || m.categoryId === cat)
      .filter((m) => !s || m.description.toLowerCase().includes(s) || ctx.cats.get(m.categoryId)?.name.toLowerCase().includes(s) || m.notes?.toLowerCase().includes(s))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? '') || b.createdAt - a.createdAt);
  }, [state, month, q, kf, cat, ctx]);

  const totals = useMemo(() => {
    let inc = 0, out = 0, pInc = 0, pOut = 0;
    for (const m of list) {
      const v = effectiveMine(m, ctx);
      if (m.planned) { if (m.kind === 'entrata') pInc += v; else pOut += v; continue; }
      if (m.kind === 'entrata') inc += v; else out += v;
    }
    return { inc, out, pInc, pOut };
  }, [list, ctx]);

  const open = (m: Movement) => {
    // prevista virtuale: si apre come registrazione (anticipata) dell'occorrenza
    if (m.id.startsWith(VIRTUAL_PREFIX)) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...draft } = m;
      onEdit({ ...draft, planned: false } as Movement);
    } else onEdit(m);
  };

  const byDay = useMemo(() => {
    const g = new Map<string, Movement[]>();
    for (const m of list) { if (!g.has(m.date)) g.set(m.date, []); g.get(m.date)!.push(m); }
    return [...g.entries()];
  }, [list]);

  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  const methods = new Map((state.methods ?? []).map((x) => [x.id, x]));

  return (
    <div className="page">
      <div className="month-nav">
        <button className="icon-btn" aria-label="Mese precedente" onClick={() => setMonth(addMonths(month ?? startOfMonth(todayISO()), -1))}><ChevronLeft /></button>
        <button className="month-label" onClick={() => setMonth(month ? null : startOfMonth(todayISO()))}>
          {month ? monthLabel(month) : 'Tutti i movimenti'}
        </button>
        <button className="icon-btn" aria-label="Mese successivo" onClick={() => setMonth(addMonths(month ?? startOfMonth(todayISO()), 1))}><ChevronRight /></button>
      </div>

      <div className="totals-strip">
        <div><small>Entrate (mia quota)</small><strong className="pos">{money(totals.inc)}</strong></div>
        <div><small>Uscite (mia quota)</small><strong>{money(totals.out)}</strong></div>
        <div><small>Saldo</small><strong className={totals.inc - totals.out >= 0 ? 'pos' : 'neg'}>{money(totals.inc - totals.out)}</strong></div>
      </div>
      {(totals.pInc > 0 || totals.pOut > 0) && (
        <p className="planned-note"><Clock size={14} /> Previsti, non inclusi nei totali:
          {totals.pInc > 0 && <strong className="pos"> +{money(totals.pInc)}</strong>}
          {totals.pOut > 0 && <strong> −{money(totals.pOut)}</strong>}
        </p>
      )}

      <div className="filters">
        <div className="search">
          <Search size={18} />
          <input placeholder="Cerca descrizione, categoria, note…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="filter-row">
          <Segmented<KindFilter> value={kf} onChange={setKf} className="small scroll" options={[
            { value: 'tutti', label: 'Tutti' }, { value: 'uscita', label: 'Uscite' }, { value: 'entrata', label: 'Entrate' },
            { value: 'previsti', label: 'Previsti' }, { value: 'rimborsi', label: 'Rimborsi' },
            { value: 'confermare', label: 'Da confermare' },
            { value: 'straordinari', label: 'Straordinari' }
          ]} />
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
            <option value="">Tutte le categorie</option>
            {state.categories.filter((c) => !c.deleted).sort((a, b) => a.order - b.order).map((c) => (
              <option key={c.id} value={c.id}>{c.kind === 'entrata' ? '↓ ' : ''}{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {byDay.length === 0 && (
        <Empty icon="Receipt" title="Nessun movimento">Tocca il pulsante + per aggiungere una spesa o un'entrata.</Empty>
      )}

      {byDay.map(([day, ms]) => (
        <section key={day} className="day-group">
          <h3 className="day-title">{dayHeader(day)}</h3>
          <div className="card list">
            {ms.map((m) => {
              const c = ctx.cats.get(m.categoryId);
              const acc = accounts.get(m.accountId);
              const mine = m.refund !== 'none' ? myShare(m.amount, m.split) : effectiveMine(m, ctx);
              const shared = !(m.split.mode === 'pct' && m.split.value === 100);
              const partial = m.refund !== 'none' && refundOf(m) < m.amount;
              return (
                <button key={m.id} className={`row ${m.planned ? 'planned' : ''}`} onClick={() => open(m)}>
                  <Badge icon={c?.icon ?? 'CircleHelp'} color={c?.color ?? '#64748b'} />
                  <span className="row-main">
                    <span className="row-title">{m.description || c?.name}</span>
                    <span className="row-sub">
                      {m.time && <span className="dot-sep">{m.time}</span>}
                      {c && m.description && m.description !== c.name && <span>{c.name}</span>}
                      {acc && <span className="dot-sep"><Icon name={acc.icon} size={12} /> {acc.name}</span>}
                      {m.methodId && methods.get(m.methodId) && <span className="dot-sep">{methods.get(m.methodId)!.name}</span>}
                    </span>
                    <span className="row-tags">
                      <SplitBadge split={m.split} />
                      {m.refund === 'pending' && <span className="tag tag-refund"><Briefcase size={12} /> Da rimborsare{partial ? ` ${money(refundOf(m))}` : ''}</span>}
                      {m.refund === 'reimbursed' && <span className="tag tag-ok"><Briefcase size={12} /> Rimborsata{partial ? ` ${money(refundOf(m))}` : ''}</span>}
                      {m.planned && <span className="tag tag-planned"><Clock size={12} /> Prevista</span>}
                      {m.toConfirm && <span className="tag tag-refund"><ListChecks size={12} /> Da confermare</span>}
                      {m.extraordinary && <span className="tag"><Sparkle size={12} /> Straordinaria</span>}
                      {m.compFrom && <span className="tag"><CalendarRange size={12} /> Competenza</span>}
                      {m.recurrenceId && <span className="tag"><Repeat size={12} /> Ricorrente</span>}
                    </span>
                  </span>
                  <span className="row-amount">
                    <strong className={m.kind === 'entrata' ? 'pos' : ''}>{m.kind === 'entrata' ? '+' : '−'}{money(mine)}</strong>
                    {shared && <small>su {money(m.amount)}</small>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
