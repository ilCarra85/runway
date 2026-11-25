// Conti dei buoni pasto per il controllo del saldo (vedi views/VoucherCheck.tsx).
import type { Account, AppState } from '../types';
import { todayISO } from './dates';

export const MEAL_CAT = 'buoni-pasto-in';
export const WELFARE_CAT = 'buoni-welfare';
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Conti dei buoni dall'ultimo controllo: caricati con la busta, welfare, e buoni della busta non ancora contati come entrata. */
export function voucherFlows(state: AppState, acc: Account, upTo = todayISO()) {
  const live = state.movements.filter((m) => !m.deleted && !m.planned);
  // carta welfare: niente buoni dalla busta, solo i caricamenti registrati come entrate sul conto
  if (acc.kind === 'welfare') {
    const loaded = r2(live.filter((m) => m.kind === 'entrata' && m.accountId === acc.id && (!acc.checkDate || m.date > acc.checkDate) && m.date <= upTo)
      .reduce((s, m) => s + m.amount, 0));
    return { payslip: 0, welfare: loaded, pendingIncome: 0 };
  }
  const after = (d: string) => (!acc.checkDate || d > acc.checkDate) && d <= upTo;
  const payslip = r2(live.filter((m) => m.mealVouchers && after(m.date)).reduce((s, m) => s + m.mealVouchers!, 0));
  const welfare = r2(live.filter((m) => m.kind === 'entrata' && m.accountId === acc.id && m.categoryId !== MEAL_CAT && after(m.date))
    .reduce((s, m) => s + m.amount, 0));
  // buoni della busta mai diventati entrata (da sempre): limite all'entrata da registrare quando si usano
  const allPayslip = live.reduce((s, m) => s + (m.mealVouchers ?? 0), 0);
  const counted = live.filter((m) => m.kind === 'entrata' && m.accountId === acc.id && m.categoryId === MEAL_CAT).reduce((s, m) => s + m.amount, 0);
  return { payslip, welfare, pendingIncome: Math.max(0, r2(allPayslip - counted)) };
}

