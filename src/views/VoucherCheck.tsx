// Controllo dei buoni pasto: i buoni della busta non vengono registrati quando arrivano.
// Ogni tanto si inserisce il saldo della carta; la differenza con il controllo precedente
// (più i buoni caricati nel frattempo) sono i buoni usati: diventano una spesa nella categoria scelta
// e, per la parte arrivata con la busta, un'entrata "Buoni pasto". I buoni welfare sono entrate inserite a mano.
// La carta welfare (conto di tipo 'welfare') funziona allo stesso modo, ma il saldo si inserisce in euro
// e i buoni ricevuti sono già entrate: i buoni usati diventano solo una spesa.

import { useMemo, useState } from 'react';
import type { Account, AppState, Movement } from '../types';
import { useStore } from '../data/store';
import { AmountInput, CategoryGrid, Field, Sheet, categoryUsage } from '../components/ui';
import { amountToInput, money, parseAmount, uid } from '../lib/format';
import { formatDate, todayISO } from '../lib/dates';
import { MEAL_CAT, voucherFlows } from '../lib/vouchers';
import { fitsKind } from '../lib/stats';

/** Giorni dopo i quali la Home ricorda di controllare i buoni. */
export const VOUCHER_CHECK_DAYS = 30;

const r2 = (n: number) => Math.round(n * 100) / 100;

export const voucherCheckDue = (acc: Account | undefined) =>
  !!acc && (!acc.checkDate || (Date.parse(todayISO()) - Date.parse(acc.checkDate)) / 86400000 >= VOUCHER_CHECK_DAYS);

/** Carta welfare: da controllare se dall'ultimo controllo sono arrivati buoni, o se ne restano da spendere da più di 30 giorni. */
export const welfareCheckDue = (state: AppState, acc: Account | undefined) =>
  !!acc && (voucherFlows(state, acc).welfare > 0 || (voucherCheckDue(acc) && (acc.checkBalance ?? 0) > 0));

export function VoucherCheck({ account, onClose }: { account: Account; onClose: () => void }) {
  const { state, upsert, upsertMany } = useStore();
  const welfare = account.kind === 'welfare';
  const [count, setCount] = useState('');
  const [euro, setEuro] = useState('');
  const [value, setValue] = useState(amountToInput(account.voucherValue ?? 10));
  const [categoryId, setCategoryId] = useState(state.categories.some((c) => c.id === 'alimentari' && !c.deleted) ? 'alimentari' : '');
  const [error, setError] = useState('');
  const usage = useMemo(() => categoryUsage(state.movements.filter((m) => m.kind === 'uscita')), [state.movements]);

  const today = todayISO();
  const unit = parseAmount(value);
  const n = Number(count.replace(',', '.'));
  const e = parseAmount(euro);
  const valid = welfare
    ? euro.trim() !== '' && Number.isFinite(e) && e >= 0
    : count.trim() !== '' && Number.isFinite(n) && n >= 0 && Number.isFinite(unit) && unit > 0;
  const balance = valid ? r2(welfare ? e : n * unit) : NaN;
  const first = account.checkBalance === undefined || !account.checkDate;
  const flows = voucherFlows(state, account, today);
  const used = valid && !first ? r2(account.checkBalance! + flows.payslip + flows.welfare - balance) : 0;
  const usedCount = valid && used > 0 && !welfare ? used / unit : 0;

  const save = () => {
    if (!valid) { setError(welfare ? 'Inserisci il saldo della carta welfare' : 'Inserisci quanti buoni hai sulla carta e il valore di un buono'); return; }
    if (used > 0.005 && !categoryId) { setError('Scegli per cosa hai usato i buoni'); return; }
    const now = Date.now();
    const out: Movement[] = [];
    if (used > 0.005) {
      const label = welfare ? 'Buoni welfare usati'
        : `Buoni pasto usati (${Number.isInteger(r2(usedCount)) ? r2(usedCount) : usedCount.toFixed(1).replace('.', ',')})`;
      const base = { accountId: account.id, date: today, split: { mode: 'pct' as const, value: 100 }, refund: 'none' as const, planned: false,
        notes: `Controllo buoni dal ${formatDate(account.checkDate!)} al ${formatDate(today)}`, createdAt: now, updatedAt: now };
      out.push({ ...base, id: uid(), kind: 'uscita', amount: used, categoryId, description: label });
      // l'entrata è la parte dei buoni arrivati con la busta (i welfare sono già entrate)
      const income = r2(Math.min(used, flows.pendingIncome));
      const mealCat = state.categories.find((c) => c.id === MEAL_CAT && !c.deleted)
        ?? state.categories.find((c) => fitsKind(c, 'entrata') && /buoni/i.test(c.name) && !c.deleted);
      if (income > 0.005) out.push({ ...base, id: uid(), kind: 'entrata', amount: income, categoryId: mealCat?.id ?? MEAL_CAT, description: 'Buoni pasto' });
    }
    if (out.length) upsertMany('movements', out);
    upsert('accounts', { ...account, checkDate: today, checkBalance: balance, voucherValue: welfare ? account.voucherValue : unit });
    onClose();
  };

  return (
    <Sheet title={welfare ? 'Controllo buoni welfare' : 'Controllo buoni pasto'} onClose={onClose}
      footer={<button className="btn primary grow" onClick={save}>{used > 0.005 ? 'Registra e salva saldo' : 'Salva saldo'}</button>}>
      <p className="muted small">
        {first ? 'Primo controllo: il saldo di oggi diventa il punto di partenza.'
          : `Ultimo controllo il ${formatDate(account.checkDate!)}: ${money(account.checkBalance!)} sulla carta.`}
      </p>
      {welfare ? (
        <Field label="Saldo della carta welfare"><AmountInput value={euro} onChange={setEuro} /></Field>
      ) : (
      <div className="voucher-row">
        <Field label="Buoni sulla carta">
          <input type="number" inputMode="decimal" min={0} step={1} value={count} onChange={(e) => setCount(e.target.value)} autoFocus placeholder="es. 12" />
        </Field>
        <Field label="Valore di un buono"><AmountInput value={value} onChange={setValue} /></Field>
      </div>
      )}
      {valid && !welfare && <p className="small">Saldo attuale <strong>{money(balance)}</strong></p>}
      {!first && (
        <div className="voucher-calc small">
          {!welfare && <><span>Caricati con la busta dal {formatDate(account.checkDate!)}</span><strong>{money(flows.payslip)}</strong></>}
          <span>{welfare ? 'Buoni ricevuti' : 'Buoni welfare'} dal {formatDate(account.checkDate!)}</span><strong>{money(flows.welfare)}</strong>
          {valid && <><span>Usati</span><strong className={used < -0.005 ? 'neg' : ''}>{money(used)}</strong></>}
        </div>
      )}
      {valid && !first && used < -0.005 && (
        <p className="warn-text small">Sulla carta ci sono {money(-used)} in più del previsto: forse {welfare ? 'dei buoni ricevuti che non hai ancora aggiunto' : "un caricamento che l'app non conosce (buoni welfare da aggiungere come entrata?)"}. Salvo solo il nuovo saldo.</p>
      )}
      {valid && used > 0.005 && (
        <Field label={welfare ? `Per cosa li hai usati? (${money(used)})` : `Quanti ne hai usati per fare…? (${usedCount.toFixed(usedCount % 1 ? 1 : 0).replace('.', ',')} buoni, ${money(used)})`}>
          <CategoryGrid categories={state.categories} kind="uscita" value={categoryId} onChange={setCategoryId} usage={usage} />
        </Field>
      )}
      {error && <div className="error-msg">{error}</div>}
    </Sheet>
  );
}
