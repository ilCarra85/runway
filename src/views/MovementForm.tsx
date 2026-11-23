import { useMemo, useState } from 'react';
import { Briefcase, CalendarRange, Clock, Trash2 } from 'lucide-react';
import type { Kind, Movement, Split } from '../types';
import { useStore } from '../data/store';
import { AccountChips, AmountInput, CategoryGrid, Field, Segmented, Sheet, SplitPicker, Toggle, categoryUsage } from '../components/ui';
import { amountToInput, money, parseAmount, uid } from '../lib/format';
import { endOfMonth, formatDate, todayISO } from '../lib/dates';
import { Badge } from '../components/Icon';
import { fitsKind, myShare, refundOf } from '../lib/stats';
import { confirmDialog } from '../components/Dialog';
import { RefundLinks } from '../components/RefundLinks';

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

  // Rimborsi lavoro da collegare a un'entrata (busta paga)
  const refundsAvailable = useMemo(
    () => state.movements.filter((m) => !m.deleted && m.kind === 'uscita' && m.refund !== 'none' &&
      (m.refund === 'pending' || m.refundIncomeId === initial?.id)),
    [state.movements, initial?.id]
  );
  const [linked, setLinked] = useState<Set<string>>(
    () => new Set(state.movements.filter((m) => !m.deleted && m.refundIncomeId && m.refundIncomeId === initial?.id).map((m) => m.id))
  );
  const [linkRefunds, setLinkRefunds] = useState(linked.size > 0);
  const linkedTotal = refundsAvailable.filter((m) => linked.has(m.id)).reduce((s, m) => s + refundOf(m), 0);
  // nuova occorrenza di una ricorrenza con cartella monitorata (es. busta paga): i rimborsi si collegano
  // confermando il documento, non qui. Resta possibile correggerli modificando il movimento salvato.
  const fromMonitored = !editing && !!initial?.recurrenceId &&
    !!state.recurrences.find((r) => r.id === initial.recurrenceId && !r.deleted)?.driveFolderId;
  // entrata che ha rimborsato questa uscita
  const refundIncome = initial?.refundIncomeId ? state.movements.find((m) => m.id === initial.refundIncomeId && !m.deleted) : undefined;

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
      id, kind, amount: value, categoryId, accountId, date,
      description: description.trim() || cat?.name || '',
      split, refund: kind === 'uscita' ? refund : 'none',
      refundAmount: kind === 'uscita' && refund !== 'none' ? refundAmount : undefined,
      refundIncomeId: kind === 'uscita' && refund === 'reimbursed' ? initial?.refundIncomeId : undefined,
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
    <Sheet title={editing ? 'Modifica movimento' : initial?.recurrenceId ? 'Registra ricorrenza' : 'Nuovo movimento'} onClose={onClose}
      footer={<>
        {editing && <button className="btn ghost danger" onClick={del}><Trash2 size={18} /> Elimina</button>}
        <button className="btn primary grow" onClick={save}>Salva</button>
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
            hint={refund === 'reimbursed'
              ? `Rimborsata${refundIncome ? ` con «${refundIncome.description}» del ${formatDate(refundIncome.date)}` : ''}`
              : "La parte rimborsata non conta nelle tue spese. Resta da rimborsare finché non la colleghi all'entrata che la rimborsa"} />
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

      {kind === 'entrata' && !fromMonitored && (refundsAvailable.length > 0 || linked.size > 0) && (
        <div className="toggles">
          <Toggle checked={linkRefunds} onChange={setLinkRefunds} icon={<Briefcase size={20} />} label="Rimborsato"
            hint={linkRefunds
              ? (linkedTotal > 0 ? `${money(linkedTotal)} di rimborsi (${linked.size}): non contano come reddito` : 'Aggiungi le uscite rimborsate da questa entrata')
              : `${refundsAvailable.filter((m) => m.refund === 'pending').length} uscite da rimborsare`} />
        </div>
      )}
      {kind === 'entrata' && linkRefunds && (
        <Field label="Uscite rimborsate">
          <RefundLinks selected={[...linked]} candidates={refundsAvailable} categories={state.categories} near={date}
            onChange={(ids) => setLinked(new Set(ids))} />
        </Field>
      )}

      <Field label="Note"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {error && <div className="error-msg">{error}</div>}
    </Sheet>
  );
}
