import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Briefcase, FolderSync, Loader2, CalendarClock, Clock, ListChecks, PiggyBank, SkipForward, Sparkle, Target, TriangleAlert, Wallet } from 'lucide-react';
import type { Movement } from '../types';
import { useStore } from '../data/store';
import { Badge } from '../components/Icon';
import { AmountInput, Segmented } from '../components/ui';
import { MonthlyChart } from '../components/MonthlyChart';
import { useDocInbox } from '../docs/inbox';
import { DocReview } from './DocReview';
import { VoucherCheck, voucherCheckDue } from './VoucherCheck';
import {
  NORM_DAYS, NORM_LABEL, PERIODS, alive, buildFlows, dueOccurrences, elapsedDays, firstMovementDate, forecast, makeCtx,
  monthlySeries, myShare, pendingRefunds, refundOf, periodRange, summarize, type NormUnit, type PeriodKey
} from '../lib/stats';
import { formatDate, relativeDays, todayISO } from '../lib/dates';
import { recRefund } from '../lib/recurrence';
import { money, money0, parseAmount } from '../lib/format';
import type { MovementDraft } from './MovementForm';

export function Dashboard({ onAdd, goTo }: { onAdd: (d: MovementDraft) => void; goTo: (tab: string) => void }) {
  const { state, upsert, remove } = useStore();
  const [period, setPeriod] = useState<PeriodKey>(() => (localStorage.getItem('runway.period') as PeriodKey) || 'ultimi12');
  const [allDue, setAllDue] = useState(false);
  const [custom, setCustom] = useState({ from: todayISO().slice(0, 4) + '-01-01', to: todayISO() });
  const [unit, setUnit] = useState<NormUnit>(() => (localStorage.getItem('runway.unit') as NormUnit) || 'mese');
  const [byGroup, setByGroup] = useState(false);
  const [whatIf, setWhatIf] = useState('');
  const inbox = useDocInbox();
  const [docsOpen, setDocsOpen] = useState(false);

  const setP = (p: PeriodKey) => { setPeriod(p); try { localStorage.setItem('runway.period', p); } catch { /* */ } };
  const setU = (u: NormUnit) => { setUnit(u); try { localStorage.setItem('runway.unit', u); } catch { /* */ } };

  const ctx = useMemo(() => makeCtx(state), [state]);
  const range = periodRange(period, custom);
  const first = firstMovementDate(state);
  const days = elapsedDays(first && first > range.from ? first : range.from, range.to);
  const sum = useMemo(() => summarize(buildFlows(state, range.from, range.to, {}, ctx)), [state, range.from, range.to, ctx]);
  const norm = (v: number) => (days > 0 ? (v / days) * NORM_DAYS[unit] : 0);
  const series = useMemo(() => monthlySeries(state, 12), [state]);
  const extra = parseAmount(whatIf);
  const fc = useMemo(() => forecast(state, 12), [state]);
  const fcWhatIf = Number.isFinite(extra) && extra > 0 ? fc.saving - extra : null;
  const due = useMemo(() => dueOccurrences(state), [state]);
  // movimenti importati lasciati in sospeso (quelli delle ricorrenze sono già tra le scadenze)
  const toConfirm = useMemo(() => alive(state.movements).filter((m) => m.toConfirm && !m.recurrenceId)
    .sort((a, b) => a.date.localeCompare(b.date)), [state.movements]);
  const [allToConfirm, setAllToConfirm] = useState(false);
  const refunds = pendingRefunds(state);
  const refundTotal = refunds.reduce((s, m) => s + refundOf(m), 0);
  const buoni = state.accounts.find((a) => a.kind === 'buoni' && !a.deleted);
  const [checkVouchers, setCheckVouchers] = useState(false);
  const vouchersDue = voucherCheckDue(buoni);
  const toVerify = alive(state.recurrences).filter((r) => r.toVerify).length;
  const recMap = new Map(state.recurrences.map((r) => [r.id, r]));
  const savingRate = sum.income > 0 ? (sum.saving / sum.income) * 100 : 0;

  const rows = useMemo(() => {
    const m = new Map<string, { key: string; name: string; icon: string; color: string; value: number }>();
    for (const [cid, v] of sum.byCategory) {
      const c = ctx.cats.get(cid);
      if (!c) continue;
      const key = byGroup ? c.group : c.id;
      const cur = m.get(key) ?? { key, name: byGroup ? c.group : c.name, icon: c.icon, color: c.color, value: 0 };
      cur.value += v;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  }, [sum, ctx, byGroup]);
  const maxRow = Math.max(1, ...rows.map((r) => r.value));

  const register = (recurrenceId: string, date: string) => {
    const r = recMap.get(recurrenceId);
    if (!r) return;
    const d: MovementDraft = {
      kind: r.kind, amount: r.amount, categoryId: r.categoryId, accountId: r.accountId, date, description: r.name,
      split: r.split, recurrenceId: r.id, occurrence: date, planned: false, ...recRefund(r)
    };
    onAdd(d);
  };
  const skip = (recurrenceId: string, date: string) => {
    const r = recMap.get(recurrenceId);
    if (r) upsert('recurrences', { ...r, skipped: [...(r.skipped ?? []), date] });
  };

  const empty = alive(state.movements).length === 0;

  return (
    <div className="page dash">
      <div className="period-bar">
        <select value={period} onChange={(e) => setP(e.target.value as PeriodKey)} aria-label="Periodo">
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <Segmented<NormUnit> className="small" value={unit} onChange={setU} options={[
          { value: 'giorno', label: 'Giorno' }, { value: 'settimana', label: 'Sett.' }, { value: 'mese', label: 'Mese' }, { value: 'anno', label: 'Anno' }
        ]} />
      </div>
      {period === 'custom' && (
        <div className="row-2 custom-range">
          <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="Dal" />
          <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="Al" />
        </div>
      )}
      <p className="range-note">{formatDate(range.from)} – {formatDate(range.to)} · medie calcolate su {days} giorni · solo la tua quota</p>

      {empty && (
        <div className="card notice">
          <strong>Benvenuto in Runway!</strong>
          <p>Aggiungi la prima spesa con il pulsante <b>+</b>, oppure carica dei dati di esempio da <button className="link" onClick={() => goTo('altro')}>Altro → Impostazioni</button> per vedere come funziona.</p>
        </div>
      )}

      <section className="hero card">
        <div className="hero-main">
          <span className="hero-label"><PiggyBank size={18} /> Risparmio {NORM_LABEL[unit]}</span>
          <span className={`hero-value ${sum.saving < 0 ? 'neg' : ''}`}>{money0(norm(sum.saving))}</span>
          <span className="hero-sub">{money(sum.saving)} nel periodo · {sum.income > 0 ? `${Math.round(savingRate)}% delle entrate` : '—'}</span>
        </div>
        <div className="hero-tiles">
          <div className="tile">
            <span className="tile-label"><ArrowDownLeft size={16} /> Entrate {NORM_LABEL[unit]}</span>
            <strong className="pos">{money0(norm(sum.income))}</strong>
            <small>{money(sum.income)} totali</small>
          </div>
          <div className="tile">
            <span className="tile-label"><ArrowUpRight size={16} /> Uscite {NORM_LABEL[unit]}</span>
            <strong>{money0(norm(sum.expense))}</strong>
            <small>{money(sum.expense)} totali</small>
          </div>
        </div>
        {(sum.extraExpense > 0 || sum.extraIncome > 0) && (
          <p className="hero-extra">
            <Sparkle size={14} /> Esclusi dalle medie i movimenti straordinari:
            {sum.extraExpense > 0 && <> uscite <b>{money(sum.extraExpense)}</b></>}
            {sum.extraIncome > 0 && <> entrate <b>{money(sum.extraIncome)}</b></>}
            . Risparmio reale nel periodo: <b>{money(sum.saving + sum.extraIncome - sum.extraExpense)}</b>
          </p>
        )}
      </section>

      {inbox.monitored > 0 && (
        <section className={`card doc-banner ${inbox.proposals.length ? 'has' : ''}`}>
          <FolderSync size={20} />
          <span className="doc-banner-text">
            {inbox.proposals.length
              ? <><strong>{inbox.proposals.length} {inbox.proposals.length === 1 ? 'documento' : 'documenti'} da confermare</strong><small>Letti dalle cartelle Drive monitorate</small></>
              : <><strong>Cartelle Drive monitorate</strong><small>{inbox.busy || inbox.error || (inbox.lastScan ? `Nessun documento nuovo · controllate alle ${new Date(inbox.lastScan).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : 'Non ancora controllate in questa sessione')}</small></>}
          </span>
          {inbox.proposals.length
            ? <button className="btn small primary" onClick={() => setDocsOpen(true)}>Rivedi</button>
            : <button className="btn small ghost" onClick={inbox.scan} disabled={!!inbox.busy}>{inbox.busy ? <Loader2 size={16} className="spin" /> : 'Controlla'}</button>}
        </section>
      )}
      {docsOpen && <DocReview onClose={() => setDocsOpen(false)} />}

      {(due.length > 0 || refunds.length > 0 || buoni || toVerify > 0) && (
        <section className="info-grid">
          {refunds.length > 0 && (
            <button className="card mini" onClick={() => goTo('movimenti')}>
              <Briefcase size={20} />
              <span><small>Rimborsi in attesa</small><strong>{money(refundTotal)}</strong><small>{refunds.length} spese</small></span>
            </button>
          )}
          {buoni && (
            <button className={`card mini${vouchersDue ? ' warn' : ''}`} onClick={() => setCheckVouchers(true)}>
              <Wallet size={20} />
              <span><small>Buoni pasto</small>
                {buoni.checkBalance !== undefined && buoni.checkDate
                  ? <><strong>{money(buoni.checkBalance)}</strong><small>{vouchersDue ? 'Da ricontrollare · ' : ''}saldo del {formatDate(buoni.checkDate)}</small></>
                  : <><strong>Controlla</strong><small>Inserisci il saldo della carta</small></>}
              </span>
            </button>
          )}
          {toVerify > 0 && (
            <button className="card mini warn" onClick={() => goTo('ricorrenze')}>
              <TriangleAlert size={20} />
              <span><small>Ricorrenze da verificare</small><strong>{toVerify}</strong><small>importate dal vecchio prospetto</small></span>
            </button>
          )}
        </section>
      )}

      {toConfirm.length > 0 && (
        <section className="card">
          <h3 className="card-title"><ListChecks size={18} /> Movimenti da confermare</h3>
          <div className="list">
            {(allToConfirm ? toConfirm : toConfirm.slice(0, 6)).map((m) => {
              const c = ctx.cats.get(m.categoryId);
              return (
                <div key={m.id} className="row static">
                  <Badge icon={c?.icon ?? 'CircleHelp'} color={c?.color ?? '#64748b'} />
                  <span className="row-main">
                    <span className="row-title">{m.description || c?.name}</span>
                    <span className="row-sub">{formatDate(m.date)}{c ? ` · ${c.name}` : ''}</span>
                  </span>
                  <span className="row-amount"><strong className={m.kind === 'entrata' ? 'pos' : ''}>{money(m.amount)}</strong></span>
                  <span className="row-actions">
                    <button className="btn small primary" onClick={() => onAdd(m)}>Registra</button>
                    {/* saltato: non conta, e reimportando lo stesso estratto non viene riproposto */}
                    <button className="icon-btn" title="Salta questa volta" aria-label="Salta" onClick={() => remove('movements', m.id)}><SkipForward size={18} /></button>
                  </span>
                </div>
              );
            })}
          </div>
          {toConfirm.length > 6 && (
            <button className="btn small ghost" onClick={() => setAllToConfirm(!allToConfirm)}>
              {allToConfirm ? 'Mostra solo i primi 6' : `Mostra tutti (altri ${toConfirm.length - 6})`}
            </button>
          )}
        </section>
      )}

      {due.length > 0 && (
        <section className="card">
          <h3 className="card-title"><CalendarClock size={18} /> Scadenze ricorrenti</h3>
          <div className="list">
            {(allDue ? due : due.slice(0, 6)).map((d) => {
              const r = recMap.get(d.recurrenceId)!;
              const c = ctx.cats.get(r.categoryId);
              return (
                <div key={d.recurrenceId + d.date} className="row static">
                  <Badge icon={c?.icon ?? 'Repeat'} color={c?.color ?? '#64748b'} />
                  <span className="row-main">
                    <span className="row-title">{r.name}</span>
                    <span className={`row-sub ${d.overdue ? 'neg' : ''}`}>{formatDate(d.date)} · {relativeDays(d.date)}</span>
                  </span>
                  <span className="row-amount"><strong className={r.kind === 'entrata' ? 'pos' : ''}>{money(myShare(r.amount, r.split))}</strong></span>
                  <span className="row-actions">
                    <button className="btn small primary" onClick={() => register(r.id, d.date)}>Registra</button>
                    <button className="icon-btn" title="Salta questa volta" aria-label="Salta" onClick={() => skip(r.id, d.date)}><SkipForward size={18} /></button>
                  </span>
                </div>
              );
            })}
          </div>
          {due.length > 6 && (
            <button className="btn small ghost" onClick={() => setAllDue(!allDue)}>
              {allDue ? 'Mostra solo le prime 6' : `Mostra tutte (altre ${due.length - 6})`}
            </button>
          )}
        </section>
      )}

      <section className="card">
        <h3 className="card-title">Andamento ultimi 12 mesi</h3>
        <MonthlyChart data={series} />
      </section>

      <section className="card">
        <div className="card-title-row">
          <h3 className="card-title">Spese per {byGroup ? 'gruppo' : 'categoria'}</h3>
          <Segmented<'c' | 'g'> className="small" value={byGroup ? 'g' : 'c'} onChange={(v) => setByGroup(v === 'g')}
            options={[{ value: 'c', label: 'Categorie' }, { value: 'g', label: 'Gruppi' }]} />
        </div>
        {rows.length === 0 && <p className="muted">Nessuna spesa nel periodo.</p>}
        <div className="cat-bars">
          {rows.map((r) => (
            <div key={r.key} className="cat-bar">
              <Badge icon={r.icon} color={r.color} size={34} />
              <div className="cat-bar-main">
                <div className="cat-bar-head">
                  <span>{r.name}</span>
                  <span><strong>{money0(norm(r.value))}</strong><small> {NORM_LABEL[unit]}</small></span>
                </div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.value / maxRow) * 100}%`, background: r.color }} /></div>
                <small className="muted">{money(r.value)} nel periodo · {sum.expense > 0 ? Math.round((r.value / sum.expense) * 100) : 0}%</small>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3 className="card-title"><Target size={18} /> Proiezione prossimi 12 mesi</h3>
        <div className="fc-grid">
          <div><small>Entrate previste</small><strong className="pos">{money0(fc.income)}</strong></div>
          <div><small>Spese ricorrenti</small><strong>{money0(fc.expenseRecurring)}</strong></div>
          <div><small>Altre spese (media 6 mesi)</small><strong>{money0(fc.expenseVariable)}</strong><small>≈ {money0(fc.variablePerMonth)} al mese</small></div>
          <div><small>Spese previste/ipotetiche</small><strong>{money0(fc.expensePlanned)}</strong></div>
        </div>
        <div className={`fc-total ${fc.saving < 0 ? 'neg' : ''}`}>
          <span>Risparmio previsto</span><strong>{money0(fc.saving)}</strong>
        </div>
        <div className="whatif">
          <span><Clock size={16} /> E se spendessi…</span>
          <AmountInput value={whatIf} onChange={setWhatIf} placeholder="es. 2.000" />
        </div>
        {fcWhatIf !== null && (
          <p className="whatif-result">
            Il risparmio previsto passerebbe a <strong className={fcWhatIf < 0 ? 'neg' : 'pos'}>{money0(fcWhatIf)}</strong>
            {fc.saving > 0 && <> ({Math.round((extra / fc.saving) * 100)}% del risparmio annuo)</>}.
            <button className="link" onClick={() => onAdd({ kind: 'uscita', amount: extra, planned: true, date: todayISO(), description: 'Spesa ipotetica' } as Partial<Movement>)}>Salvala come spesa prevista</button>
          </p>
        )}
        <p className="muted small">Calcolo: ricorrenze attive per le loro categorie, media reale degli ultimi 6 mesi per tutte le altre, più le spese previste.</p>
      </section>
      {checkVouchers && buoni && <VoucherCheck account={buoni} onClose={() => setCheckVouchers(false)} />}
    </div>
  );
}
