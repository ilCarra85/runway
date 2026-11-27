// Controllo del saldo di una carta buoni (buoni pasto o welfare, stesso funzionamento): si inserisce il numero di buoni
// sulla carta (mai negativo) e lo si confronta con il saldo precedente (quello dei movimenti se i buoni pasto arrivano
// dall'estratto Edenred, altrimenti l'ultimo controllo aggiornato con i movimenti inseriti dopo):
// primo controllo = solo punto di partenza; saldo minore = uscita di oggi nella categoria scelta;
// saldo maggiore = ricarica di oggi (entrata "Buoni pasto" o "Buoni welfare"). Descrizione: "Adeguamento saldo manuale".

import { useMemo, useState } from 'react';
import type { Account, Movement } from '../types';
import { useStore } from '../data/store';
import { AmountInput, CategoryGrid, Field, Sheet, categoryUsage } from '../components/ui';
import { amountToInput, money, parseAmount, uid } from '../lib/format';
import { formatDate, todayISO } from '../lib/dates';
import { MEAL_CAT, WELFARE_CAT, voucherBalance } from '../lib/vouchers';
import { fitsKind } from '../lib/stats';

/** Giorni dopo i quali la Home ricorda di controllare i buoni. */
export const VOUCHER_CHECK_DAYS = 30;

const r2 = (n: number) => Math.round(n * 100) / 100;

export const voucherCheckDue = (acc: Account | undefined) =>
  !!acc && (!acc.checkDate || (Date.parse(todayISO()) - Date.parse(acc.checkDate)) / 86400000 >= VOUCHER_CHECK_DAYS);

export function VoucherCheck({ account, onClose, previous }: { account: Account; onClose: () => void; previous?: number }) {
  const { state, upsert, upsertMany } = useStore();
  const welfare = account.kind === 'welfare';
  const what = welfare ? 'Buoni welfare' : 'Buoni pasto';
  const [count, setCount] = useState('');
  const [value, setValue] = useState(amountToInput(account.voucherValue ?? 10));
  const [categoryId, setCategoryId] = useState(state.categories.some((c) => c.id === 'alimentari' && !c.deleted) ? 'alimentari' : '');
  const [error, setError] = useState('');
  const usage = useMemo(() => categoryUsage(state.movements.filter((m) => m.kind === 'uscita')), [state.movements]);

  const today = todayISO();
  const unit = parseAmount(value);
  const n = Number(count.replace(',', '.'));
  const valid = count.trim() !== '' && Number.isFinite(n) && n >= 0 && Number.isFinite(unit) && unit > 0;
  const balance = valid ? r2(n * unit) : NaN;
  // saldo precedente: dei movimenti (estratto Edenred) o dell'ultimo controllo aggiornato con i movimenti inseriti dopo
  const prev = previous !== undefined ? previous : voucherBalance(state, account);
  const first = prev === undefined;
  const diff = valid && !first ? r2(prev - balance) : 0;
  const used = diff > 0.005 ? diff : 0;
  const recharge = diff < -0.005 ? -diff : 0;
  const num = (x: number) => (Number.isInteger(r2(x)) ? String(r2(x)) : x.toFixed(1).replace('.', ','));

  const save = () => {
    if (!valid) { setError('Inserisci quanti buoni hai sulla carta e il valore di un buono'); return; }
    if (used && !categoryId) { setError('Scegli per cosa hai usato i buoni'); return; }
    const now = Date.now();
    const out: Movement[] = [];
    // movimenti nati dal nuovo saldo: descrizione fissa, il dettaglio (buoni e saldi) va nelle note
    const base = (detail: string) => ({ accountId: account.id, date: today, split: { mode: 'pct' as const, value: 100 }, refund: 'none' as const,
      planned: false, description: 'Adeguamento saldo manuale',
      notes: `${detail} · saldo ${money(prev ?? 0)} → ${money(balance)}`, createdAt: now, updatedAt: now });
    if (used) out.push({ ...base(`${what} usati: ${num(used / unit)}`), id: uid(), kind: 'uscita', amount: used, categoryId });
    if (recharge) {
      const catId = welfare ? WELFARE_CAT : MEAL_CAT;
      const cat = state.categories.find((c) => c.id === catId && !c.deleted)
        ?? state.categories.find((c) => fitsKind(c, 'entrata') && new RegExp(welfare ? 'welfare' : 'buoni', 'i').test(c.name) && !c.deleted);
      out.push({ ...base(`Ricarica ${what.toLowerCase()}: ${num(recharge / unit)}`), id: uid(), kind: 'entrata', amount: recharge, categoryId: cat?.id ?? catId });
    }
    if (out.length) upsertMany('movements', out);
    upsert('accounts', { ...account, checkDate: today, checkBalance: balance, checkAt: now, voucherValue: unit });
    onClose();
  };

  return (
    <Sheet title={`Controllo ${what.toLowerCase()}`} onClose={onClose}
      footer={<button className="btn primary grow" onClick={save}>{used || recharge ? 'Registra e salva saldo' : 'Salva saldo'}</button>}>
      <p className="muted small">
        {first ? 'Primo controllo: il saldo di oggi diventa il punto di partenza.'
          : previous !== undefined ? `Saldo secondo i movimenti: ${money(prev)} (${num(prev / (unit || 10))} buoni).`
          : `Saldo atteso ${money(prev)}: controllo del ${formatDate(account.checkDate!)} (${money(account.checkBalance!)}) con i movimenti registrati dopo.`}
      </p>
      <div className="voucher-row">
        <Field label="Buoni sulla carta">
          <input type="number" inputMode="decimal" min={0} step={1} value={count} onChange={(e) => setCount(e.target.value)} autoFocus placeholder="es. 12" />
        </Field>
        <Field label="Valore di un buono"><AmountInput value={value} onChange={setValue} /></Field>
      </div>
      {valid && <p className="small">Saldo attuale <strong>{money(balance)}</strong></p>}
      {valid && !first && (
        <p className="small">{used ? <>Usati <strong>{money(used)}</strong>: registro un'uscita di oggi.</>
          : recharge ? <>Ricarica di <strong>{money(recharge)}</strong>: registro un'entrata «{what}» di oggi.</>
          : 'Il saldo non è cambiato.'}</p>
      )}
      {used > 0 && (
        <Field label={`Per cosa li hai usati? (${num(used / unit)} buoni, ${money(used)})`}>
          <CategoryGrid categories={state.categories} kind="uscita" value={categoryId} onChange={setCategoryId} usage={usage} />
        </Field>
      )}
      {error && <div className="error-msg">{error}</div>}
    </Sheet>
  );
}
