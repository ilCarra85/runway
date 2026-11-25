import { useMemo, useState } from 'react';
import { Briefcase, CalendarRange, Clock, FileText, Trash2 } from 'lucide-react';
import type { Kind, Movement, Split } from '../types';
import { useStore } from '../data/store';
import { AccountChips, AmountInput, CategoryGrid, Field, Segmented, Sheet, SplitPicker, Toggle, categoryUsage } from '../components/ui';
import { amountToInput, money, parseAmount, uid } from '../lib/format';
import { endOfMonth, formatDate, todayISO } from '../lib/dates';
import { Badge } from '../components/Icon';
import { fitsKind, myShare, refundOf } from '../lib/stats';
import { confirmDialog } from '../components/Dialog';
import { RefundLinks } from '../components/RefundLinks';
import { PdfPreview } from './DocReview';

export type MovementDraft = Partial<Movement> & { kind?: Kind };

export function MovementForm({ initial, onClose }: { initial?: MovementDraft; onClose: () => void }) {
  const { state, upsert, upsertMany, remove } = useStore();
  const editing = !!initial?.id && state.movements.some((m) => m.id === initial.id);
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'uscita');
  const [amount, setAmount] = useState(amountToInput(initial?.amount));
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [accountId, setAccountId] = useState(initial?.accountId ?? 'conto');
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [description, setDescription] = useState(initial?.description ?? '');
  const [split, setSplit] = useState<Split>(initial?.split ?? { mode: 'pct', value: 100 });
  const [splitTouched, setSplitTouched] = useState(!!initial?.split);
  const [refund, setRefund] = useState(initial?.refund ?? 'none');
  // vuoto = rimborso dell'importo intero
  const [refundAmt, setRefundAmt] = useState(amountToInput(initial?.refundAmount));
  const [planned, setPlanned] = useState(initial?.planned ?? false);
  const [plannedTouched, setPlannedTouched] = useState(initial?.planned !== undefined);
  const [comp, setComp] = useState(!!(initial?.compFrom && initial?.compTo));
  const [compFrom, setCompFrom] = useState((initial?.compFrom ?? date).slice(0, 7));
  const [compTo, setCompTo] = useState((initial?.compTo ?? date).slice(0, 7));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState('');

  // Uscite rimborsabili da collegare a un'entrata (busta paga): quelle da rimborsare, quelle già collegate a questa
  // e anche quelle collegate a un'altra entrata (per correggere un collegamento sbagliato: scegliendola si sposta qui)
  const refundsAvailable = useMemo(
    () => state.movements.filter((m) => !m.deleted && m.kind === 'uscita' && m.refund !== 'none'),
    [state.movements]
  );
  const incomeOf = useMemo(() => new Map(state.movements.filter((m) => !m.deleted && m.kind === 'entrata').map((m) => [m.id, m])), [state.movements]);
  const refundNote = (m: Movement) => {
    if (m.refund !== 'reimbursed' || !m.refundIncomeId || m.refundIncomeId === initial?.id) return undefined;
    const inc = incomeOf.get(m.refundIncomeId);
    return inc ? `ora con «${inc.description}» del ${formatDate(inc.date)}` : undefined;
  };
  const [preview, setPreview] = useState(false);
  const [linked, setLinked] = useState<Set<string>>(
    () => new Set(state.movements.filter((m) => !m.deleted && m.refundIncomeId && m.refundIncomeId === initial?.id).map((m) => m.id))
  );
  // entrata: «Contiene rimborso» (dalla ricorrenza o dal movimento) e uscite che rimborsa
  const [linkRefunds, setLinkRefunds] = useState(!!initial?.refundIn || linked.size > 0);
  const linkedTotal = refundsAvailable.filter((m) => linked.has(m.id)).reduce((s, m) => s + refundOf(m), 0);
  // uscita: entrata che la rimborsa, scelta tra quelle con «Contiene rimborso» (vuoto = ancora da rimborsare)
  const [incomeId, setIncomeId] = useState(initial?.refundIncomeId && incomeOf.has(initial.refundIncomeId) ? initial.refundIncomeId : '');
  const refundIncomes = useMemo(() => [...incomeOf.values()]
    .filter((m) => m.refundIn || m.id === incomeId || state.movements.some((x) => !x.deleted && x.refundIncomeId === m.id))
    .sort((a, b) => b.date.localeCompare(a.date)), [incomeOf, incomeId, state.movements]);

  const usage = useMemo(() => categoryUsage(state.movements), [state.movements]);
  const value = parseAmount(amount);
  const refundValue = parseAmount(refundAmt);
  // undefined = rimborso totale
  const refundAmount = refundAmt.trim() && Number.isFinite(refundValue) && !(Number.isFinite(value) && refundValue >= value)
    ? Math.max(0, refundValue) : undefined;
  const refunded = Number.isFinite(value) ? (refundAmount ?? value) : 0;
  const leftToMe = Number.isFinite(value) ? Math.max(0, myShare(value, split) - refunded) : 0;
  const cat = state.categories.find((c) => c.id === categoryId);

  const pickCategory = (id: string) => {
    setCategoryId(id);
    const c = state.categories.find((x) => x.id === id);
    if (c && !splitTouched) setSplit(c.split);
    if (!description || state.categories.some((x) => x.name === description)) setDescription(c?.name ?? '');
  };

  const changeKind = (k: Kind) => {
    setKind(k);
    // una categoria valida per entrambi resta scelta
    if (!cat || !fitsKind(cat, k)) setCategoryId('');
    if (k === 'entrata') setRefund('none');
  };

  const changeDate = (d: string) => {
    setDate(d);
    if (!plannedTouched) setPlanned(d > todayISO());
  };

  const save = () => {
    if (!Number.isFinite(value) || value <= 0) return setError("Inserisci un importo maggiore di zero");
    if (!categoryId) return setError('Scegli una categoria');
    const now = Date.now();
    const id = initial?.id ?? uid();
    const m: Movement = {
      // campi non modificabili qui (documento, import, buoni pasto) restano quelli del movimento
      importId: initial?.importId, docFileId: initial?.docFileId, docName: initial?.docName, mealVouchers: initial?.mealVouchers,
      id, kind, amount: value, categoryId, accountId, date,
      description: description.trim() || cat?.name || '',
      split, refund: kind === 'uscita' && refund !== 'none' ? (incomeId ? 'reimbursed' : 'pending') : 'none',
      refundAmount: kind === 'uscita' && refund !== 'none' ? refundAmount : undefined,
      refundIncomeId: kind === 'uscita' && refund !== 'none' && incomeId ? incomeId : undefined,
      refundIn: kind === 'entrata' && linkRefunds ? true : undefined,
      compFrom: comp ? compFrom + '-01' : undefined,
      compTo: comp ? endOfMonth(compTo + '-01') : undefined,
      planned, recurrenceId: initial?.recurrenceId, occurrence: initial?.occurrence,
      notes: notes.trim() || undefined, demo: initial?.demo, createdAt: initial?.createdAt ?? now, updatedAt: now
    };
    upsert('movements', m);
    if (kind === 'entrata') {
      const changes: Movement[] = [];
      for (const r of refundsAvailable) {
        const want = linkRefunds && linked.has(r.id);
        const has = r.refundIncomeId === id && r.refund === 'reimbursed';
        if (want && !has) changes.push({ ...r, refund: 'reimbursed', refundIncomeId: id });
        if (!want && has) changes.push({ ...r, refund: 'pending', refundIncomeId: undefined });
      }
      if (changes.length) upsertMany('movements', changes);
    }
    onClose();
  };

  const del = async () => {
    if (!initial?.id) return;
    if (!await confirmDialog(initial.recurrenceId
      ? 'Eliminare questo movimento? Vale come "saltato" per questa occorrenza della ricorrenza: non verrà ricreato.'
      : 'Eliminare questo movimento?', { ok: 'Elimina', danger: true })) return;
    // libera eventuali rimborsi collegati
    const freed = state.movements.filter((m) => m.refundIncomeId === initial.id).map((m) => ({ ...m, refund: 'pending' as const, refundIncomeId: undefined }));
    if (freed.length) upsertMany('movements', freed);
    remove('movements', initial.id);
    onClose();
  };

  return (
    <Sheet title={initial?.toConfirm ? 'Registra movimento' : editing ? 'Modifica movimento' : initial?.recurrenceId ? 'Registra ricorrenza' : 'Nuovo movimento'} onClose={onClose}
      footer={<>
        {editing && <button className="btn ghost danger" onClick={del}><Trash2 size={18} /> Elimina</button>}
        {/* da confermare: salvando diventa un movimento normale (toConfirm non viene riportato) */}
        <button className="btn primary grow" onClick={save}>{initial?.toConfirm ? 'Registra' : 'Salva'}</button>
      </>}>
      <Segmented<Kind> className={`kind-switch ${kind}`} value={kind} onChange={changeKind} options={[
        { value: 'uscita', label: 'Uscita' }, { value: 'entrata', label: 'Entrata' }
      ]} />

      <div className="amount-row">
        {cat && <Badge icon={cat.icon} color={cat.color} size={44} />}
        <AmountInput big value={amount} onChange={setAmount} autoFocus={!editing} />
      </div>

      <Field label="Categoria">
        <CategoryGrid categories={state.categories} kind={kind} value={categoryId} onChange={pickCategory} usage={usage} />
      </Field>

      <div className="row-2">
        <Field label="Data"><input type="date" value={date} onChange={(e) => changeDate(e.target.value)} /></Field>
        <Field label="Descrizione"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="es. Supermercato" /></Field>
      </div>

      <Field label={kind === 'uscita' ? 'Pagato con' : 'Accreditato su'}>
        <AccountChips accounts={state.accounts} value={accountId} onChange={setAccountId} />
      </Field>

      <Field label="Ripartizione" hint={cat && cat.split.value !== 100 ? `Predefinita per ${cat.name}` : undefined}>
        <SplitPicker split={split} onChange={(s) => { setSplit(s); setSplitTouched(true); }} amount={value} kind={kind} />
      </Field>

      <div className="toggles">
        {kind === 'uscita' && (
          <Toggle checked={refund !== 'none'} onChange={(v) => setRefund(v ? (refund === 'reimbursed' ? 'reimbursed' : 'pending') : 'none')}
            icon={<Briefcase size={20} />} label="Rimborsabile"
            hint={refund === 'none' ? 'Nessun rimborso'
              : incomeId ? 'Rimborsata: la parte rimborsata non conta nelle tue spese'
              : "Da rimborsare: scegli l'entrata che la rimborsa quando arriva"} />
        )}
        {kind === 'uscita' && refund !== 'none' && (
          <Field label="Rimborsata da" hint={!refundIncomes.some((m) => m.date >= date) && !incomeId ? 'Nessuna entrata con «Contiene rimborso» da questa data in poi' : undefined}>
            <select value={incomeId} onChange={(e) => setIncomeId(e.target.value)}>
              <option value="">Non ancora rimborsata</option>
              {refundIncomes.filter((m) => m.date >= date || m.id === incomeId).map((m) => (
                <option key={m.id} value={m.id}>{m.description} · {formatDate(m.date)} · {money(m.amount)}</option>
              ))}
            </select>
          </Field>
        )}
        {kind === 'uscita' && refund !== 'none' && (
          <Field label="Importo rimborsato"
            hint={leftToMe > 0 ? `${money(leftToMe)} restano a tuo carico e contano come spesa` : 'Rimborso totale: non conta nelle tue spese'}>
            <div className="refund-amount">
              <AmountInput value={refundAmt} onChange={setRefundAmt}
                placeholder={Number.isFinite(value) && value > 0 ? amountToInput(value) : 'Tutto'} />
              {refundAmt && <button type="button" className="btn small ghost" onClick={() => setRefundAmt('')}>Tutto</button>}
            </div>
          </Field>
        )}
        <Toggle checked={planned} onChange={(v) => { setPlanned(v); setPlannedTouched(true); }} icon={<Clock size={20} />}
          label={kind === 'uscita' ? 'Spesa prevista / ipotetica' : 'Entrata prevista'}
          hint="Conta solo nelle proiezioni, non nel consuntivo" />
        <Toggle checked={comp} onChange={setComp} icon={<CalendarRange size={20} />} label="Periodo di competenza"
          hint="Es. bolletta bimestrale: l'importo viene spalmato sui mesi" />
      </div>

      {comp && (
        <div className="row-2">
          <Field label="Dal mese"><input type="month" value={compFrom} onChange={(e) => setCompFrom(e.target.value)} /></Field>
          <Field label="Al mese"><input type="month" value={compTo} onChange={(e) => setCompTo(e.target.value)} /></Field>
        </div>
      )}

      {kind === 'entrata' && (
        <div className="toggles">
          <Toggle checked={linkRefunds} onChange={setLinkRefunds} icon={<Briefcase size={20} />} label="Contiene rimborso"
            hint={linkRefunds
              ? (linkedTotal > 0 ? `${money(linkedTotal)} di rimborsi (${linked.size}): non contano come reddito` : 'Aggiungi le uscite rimborsate da questa entrata')
              : `${refundsAvailable.filter((m) => m.refund === 'pending' && m.date <= date).length} uscite da rimborsare`} />
        </div>
      )}
      {kind === 'entrata' && linkRefunds && (
        <Field label="Uscite rimborsate">
          <RefundLinks selected={[...linked]} categories={state.categories} near={date} noteOf={refundNote}
            candidates={refundsAvailable.filter((m) => m.date <= date || linked.has(m.id))}
            onChange={(ids) => setLinked(new Set(ids))} />
        </Field>
      )}

      {editing && initial?.docFileId && (
        <button type="button" className="btn ghost doc-open" onClick={() => setPreview(true)}>
          <FileText size={18} /> Documento: {initial.docName ?? 'anteprima'}
        </button>
      )}
      {preview && initial?.docFileId && <PdfPreview fileId={initial.docFileId} name={initial.docName ?? 'Documento'} onClose={() => setPreview(false)} />}

      <Field label="Note"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {error && <div className="error-msg">{error}</div>}
    </Sheet>
  );
}
