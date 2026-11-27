import type { AppState, Category, Kind, Movement, Split } from '../types';
import { addDays, addMonths, daysBetween, endOfMonth, maxISO, minISO, startOfMonth, todayISO } from './dates';
import { occurrencesBetween, recRefund } from './recurrence';

/** La categoria si può usare per questo tipo di movimento? */
export const fitsKind = (c: Pick<Category, 'kind'>, kind: Kind) => c.kind === kind || c.kind === 'entrambe';

export function myShare(amount: number, split: Split): number {
  if (split.mode === 'amount') return Math.max(0, Math.min(split.value, amount));
  return (amount * split.value) / 100;
}

export const alive = <T extends { deleted?: boolean }>(xs: T[]) => xs.filter((x) => !x.deleted);

export interface Flow {
  kind: Kind;
  categoryId: string;
  mine: number; // quota mia, già ripartita sul periodo
  source: 'reale' | 'previsto' | 'ricorrente' | 'variabile';
  /** Movimento straordinario: fuori dalle medie (vedi summarize). */
  extra?: boolean;
}

export interface Ctx {
  cats: Map<string, Category>;
  linkedRefunds: Map<string, number>; // entrata id → somma rimborsi inclusi
  registered: Set<string>; // recurrenceId|data già registrate
}

/** Importo che l'azienda rimborsa per una spesa (0 se non rimborsabile). */
export function refundOf(m: Pick<Movement, 'kind' | 'amount' | 'refund' | 'refundAmount'>): number {
  if (m.kind !== 'uscita' || m.refund === 'none') return 0;
  return Math.max(0, Math.min(m.amount, m.refundAmount ?? m.amount));
}

export function makeCtx(state: AppState): Ctx {
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  const linkedRefunds = new Map<string, number>();
  const registered = new Set<string>();
  for (const m of state.movements) {
    if (m.deleted) continue;
    if (m.refund === 'reimbursed' && m.refundIncomeId)
      linkedRefunds.set(m.refundIncomeId, (linkedRefunds.get(m.refundIncomeId) ?? 0) + refundOf(m));
    if (m.recurrenceId && m.occurrence) registered.add(`${m.recurrenceId}|${m.occurrence}`);
  }
  return { cats, linkedRefunds, registered };
}

/** Quota mia effettiva (0 se esclusa; per le spese rimborsabili conta solo la parte non rimborsata). */
export function effectiveMine(m: Movement, ctx: Ctx): number {
  if (m.deleted) return 0;
  if (ctx.cats.get(m.categoryId)?.excluded) return 0;
  if (m.kind === 'uscita' && m.refund !== 'none') return Math.max(0, myShare(m.amount, m.split) - refundOf(m));
  let base = m.amount;
  if (m.kind === 'entrata') base = Math.max(0, base - (ctx.linkedRefunds.get(m.id) ?? 0));
  return myShare(base, m.split);
}

/** Frazione del movimento che cade in [from, to] (considera il periodo di competenza). */
export function allocation(m: Pick<Movement, 'date' | 'compFrom' | 'compTo'>, from: string, to: string): number {
  if (m.compFrom && m.compTo && m.compTo >= m.compFrom) {
    const total = daysBetween(m.compFrom, m.compTo) + 1;
    const a = maxISO(from, m.compFrom);
    const b = minISO(to, m.compTo);
    if (b < a) return 0;
    return (daysBetween(a, b) + 1) / total;
  }
  return m.date >= from && m.date <= to ? 1 : 0;
}

export interface FlowOptions {
  includePlanned?: boolean; // movimenti "previsti"
  includeForecast?: boolean; // occorrenze future delle ricorrenze
}

export function buildFlows(state: AppState, from: string, to: string, opt: FlowOptions = {}, ctx = makeCtx(state)): Flow[] {
  const flows: Flow[] = [];
  for (const m of state.movements) {
    if (m.deleted) continue;
    if (m.planned && !opt.includePlanned) continue;
    const f = allocation(m, from, to);
    if (!f) continue;
    const mine = effectiveMine(m, ctx) * f;
    if (mine) flows.push({ kind: m.kind, categoryId: m.categoryId, mine, source: m.planned ? 'previsto' : 'reale', extra: m.extraordinary || undefined });
  }
  if (opt.includeForecast) {
    const today = todayISO();
    const a = maxISO(from, addDays(today, 1));
    if (a <= to) {
      for (const r of alive(state.recurrences)) {
        // occorrenze future = stima: non per le categorie escluse dalle statistiche o dalle previsioni
        const rc = ctx.cats.get(r.categoryId);
        if (!r.active || rc?.excluded || rc?.noForecast) continue;
        for (const d of occurrencesBetween(r, a, to)) {
          if (ctx.registered.has(`${r.id}|${d}`)) continue;
          flows.push({ kind: r.kind, categoryId: r.categoryId, mine: myShare(r.amount, r.split), source: 'ricorrente' });
        }
      }
    }
  }
  return flows;
}

export interface Summary {
  income: number;
  expense: number;
  saving: number;
  /** Spese per categoria (la mia quota). */
  byCategory: Map<string, number>;
  /** Movimenti straordinari, esclusi da income/expense/saving e da byCategory. */
  extraIncome: number;
  extraExpense: number;
}

/** Totali del periodo; i movimenti straordinari restano a parte (extraIncome/extraExpense). */
export function summarize(flows: Flow[]): Summary {
  let income = 0;
  let expense = 0;
  let extraIncome = 0;
  let extraExpense = 0;
  const byCategory = new Map<string, number>();
  for (const f of flows) {
    if (f.extra) {
      if (f.kind === 'entrata') extraIncome += f.mine; else extraExpense += f.mine;
    } else if (f.kind === 'entrata') income += f.mine;
    else {
      expense += f.mine;
      // solo le spese: una categoria valida per entrambi non deve sommare le entrate
      byCategory.set(f.categoryId, (byCategory.get(f.categoryId) ?? 0) + f.mine);
    }
  }
  return { income, expense, saving: income - expense, byCategory, extraIncome, extraExpense };
}

// ---------- Periodi ----------

export type PeriodKey = 'mese' | 'mese-prec' | 'ultimi3' | 'ultimi6' | 'ultimi12' | 'anno' | 'anno-prec' | 'custom';
export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'mese', label: 'Questo mese' },
  { key: 'mese-prec', label: 'Mese scorso' },
  { key: 'ultimi3', label: 'Ultimi 3 mesi' },
  { key: 'ultimi6', label: 'Ultimi 6 mesi' },
  { key: 'ultimi12', label: 'Ultimi 12 mesi' },
  { key: 'anno', label: 'Anno in corso' },
  { key: 'anno-prec', label: 'Anno scorso' },
  { key: 'custom', label: 'Personalizzato' }
];

export function periodRange(key: PeriodKey, custom?: { from: string; to: string }): { from: string; to: string } {
  const t = todayISO();
  switch (key) {
    case 'mese': return { from: startOfMonth(t), to: endOfMonth(t) };
    case 'mese-prec': { const p = addMonths(startOfMonth(t), -1); return { from: p, to: endOfMonth(p) }; }
    case 'ultimi3': return { from: addDays(addMonths(t, -3), 1), to: t };
    case 'ultimi6': return { from: addDays(addMonths(t, -6), 1), to: t };
    case 'ultimi12': return { from: addDays(addMonths(t, -12), 1), to: t };
    case 'anno': return { from: t.slice(0, 4) + '-01-01', to: t.slice(0, 4) + '-12-31' };
    case 'anno-prec': { const y = String(Number(t.slice(0, 4)) - 1); return { from: y + '-01-01', to: y + '-12-31' }; }
    case 'custom': return custom ?? { from: startOfMonth(t), to: t };
  }
}

/** Giorni effettivamente trascorsi del periodo (per le medie). */
export function elapsedDays(from: string, to: string): number {
  const end = minISO(to, todayISO());
  if (end < from) return 0;
  return daysBetween(from, end) + 1;
}

export type NormUnit = 'giorno' | 'settimana' | 'mese' | 'anno';
export const NORM_DAYS: Record<NormUnit, number> = { giorno: 1, settimana: 7, mese: 30.4375, anno: 365.25 };
export const NORM_LABEL: Record<NormUnit, string> = { giorno: 'al giorno', settimana: 'a settimana', mese: 'al mese', anno: "all'anno" };

// ---------- Andamento mensile ----------

export interface MonthPoint { month: string; income: number; expense: number }

export function monthlySeries(state: AppState, months = 12): MonthPoint[] {
  const ctx = makeCtx(state);
  const first = addMonths(startOfMonth(todayISO()), -(months - 1));
  const out: MonthPoint[] = [];
  for (let i = 0; i < months; i++) {
    const from = addMonths(first, i);
    const s = summarize(buildFlows(state, from, endOfMonth(from), {}, ctx));
    // il grafico mensile mostra quanto è entrato e uscito davvero, straordinari compresi
    out.push({ month: from, income: s.income + s.extraIncome, expense: s.expense + s.extraExpense });
  }
  return out;
}

// ---------- Proiezione ----------

export interface Forecast {
  from: string;
  to: string;
  income: number;
  expenseRecurring: number;
  expensePlanned: number;
  expenseVariable: number;
  incomePlanned: number;
  saving: number;
  variablePerMonth: number;
}

/**
 * Proiezione sui prossimi `months` mesi:
 * - categorie coperte da una ricorrenza attiva → occorrenze future della ricorrenza;
 * - tutte le altre categorie → media reale degli ultimi 6 mesi (entrate e uscite), senza i movimenti straordinari;
 * - più i movimenti segnati come previsti/ipotetici.
 */
export function forecast(state: AppState, months = 12, extra = 0): Forecast {
  const ctx = makeCtx(state);
  const t = todayISO();
  const from = addDays(t, 1);
  const to = addMonths(t, months);
  const covered = new Set(alive(state.recurrences).filter((r) => r.active).map((r) => r.categoryId));
  let income = 0, incomePlanned = 0, expenseRecurring = 0, expensePlanned = 0;
  for (const f of buildFlows(state, from, to, { includePlanned: true, includeForecast: true }, ctx)) {
    if (f.kind === 'entrata') {
      income += f.mine;
      if (f.source === 'previsto') incomePlanned += f.mine;
    } else if (f.source === 'ricorrente') expenseRecurring += f.mine;
    else expensePlanned += f.mine;
  }
  // Media storica (ultimi 6 mesi) delle categorie non coperte da ricorrenze
  const vFrom = addDays(addMonths(t, -6), 1);
  let varOut = 0, varIn = 0;
  for (const m of state.movements) {
    if (m.deleted || m.planned || m.extraordinary || covered.has(m.categoryId) || ctx.cats.get(m.categoryId)?.noForecast) continue;
    const f = allocation(m, vFrom, t);
    if (!f) continue;
    const v = effectiveMine(m, ctx) * f;
    if (m.kind === 'uscita') varOut += v; else varIn += v;
  }
  const vDays = Math.max(1, Math.min(daysBetween(vFrom, t) + 1, daysSinceFirstMovement(state, t)));
  const days = daysBetween(from, to) + 1;
  const expenseVariable = (varOut / vDays) * days;
  income += (varIn / vDays) * days;
  expensePlanned += extra;
  return {
    from, to, income, incomePlanned, expenseRecurring, expensePlanned, expenseVariable,
    saving: income - expenseRecurring - expensePlanned - expenseVariable,
    variablePerMonth: (varOut / vDays) * NORM_DAYS.mese
  };
}

export function firstMovementDate(state: AppState): string | undefined {
  let first: string | undefined;
  for (const m of state.movements) {
    if (m.deleted || m.planned) continue;
    const d = m.compFrom && m.compFrom < m.date ? m.compFrom : m.date;
    if (!first || d < first) first = d;
  }
  return first;
}

function daysSinceFirstMovement(state: AppState, t: string): number {
  return daysBetween(firstMovementDate(state) ?? t, t) + 1;
}

// ---------- Scadenze ricorrenze ----------

export interface DueItem { recurrenceId: string; date: string; overdue: boolean }

/**
 * Movimenti da creare per le ricorrenze automatiche (senza conferma): tutte le occorrenze dall'inizio a oggi
 * non ancora registrate. Un movimento eliminato (tombstone) conta come gestito, così non viene ricreato.
 * L'id è deterministico per evitare doppioni tra dispositivi.
 */
export function autoMovements(state: AppState): Movement[] {
  const t = todayISO();
  const handled = new Set<string>();
  const ids = new Set<string>();
  for (const m of state.movements) {
    // tombstone senza occorrenza = tolto perché fuori dalle date: si può ricreare con lo stesso id
    if (m.deleted && !m.occurrence) continue;
    ids.add(m.id);
    if (m.recurrenceId && m.occurrence) handled.add(`${m.recurrenceId}|${m.occurrence}`);
  }
  const out: Movement[] = [];
  const now = Date.now();
  for (const r of alive(state.recurrences)) {
    if (!r.active || r.confirm) continue;
    for (const d of occurrencesBetween(r, r.start, t)) {
      const id = `rec-${r.id}-${d}`;
      if (handled.has(`${r.id}|${d}`) || ids.has(id)) continue;
      out.push({
        id, kind: r.kind, amount: r.amount, categoryId: r.categoryId, accountId: r.accountId, date: d,
        description: r.name, split: r.split, ...recRefund(r), planned: false, recurrenceId: r.id, occurrence: d,
        createdAt: now, updatedAt: now
      });
    }
  }
  return out;
}

/** Prefisso degli id dei movimenti previsti "virtuali" (non salvati) generati dalle ricorrenze. */
export const VIRTUAL_PREFIX = 'virt-';

/**
 * Occorrenze future (da domani) delle ricorrenze attive, come movimenti previsti non salvati.
 * Rispettano la fine della ricorrenza; escluse quelle già registrate in anticipo o saltate.
 */
export function upcomingMovements(state: AppState, from: string, to: string): Movement[] {
  const start = maxISO(from, addDays(todayISO(), 1));
  if (to < start) return [];
  const handled = new Set<string>();
  for (const m of state.movements) if (m.recurrenceId && m.occurrence) handled.add(`${m.recurrenceId}|${m.occurrence}`);
  const out: Movement[] = [];
  for (const r of alive(state.recurrences)) {
    if (!r.active) continue;
    for (const d of occurrencesBetween(r, maxISO(start, r.start), to)) {
      if (handled.has(`${r.id}|${d}`)) continue;
      out.push({
        id: `${VIRTUAL_PREFIX}${r.id}-${d}`, kind: r.kind, amount: r.amount, categoryId: r.categoryId, accountId: r.accountId,
        date: d, description: r.name, split: r.split, ...recRefund(r), planned: true, recurrenceId: r.id, occurrence: d,
        createdAt: 0, updatedAt: 0
      });
    }
  }
  return out;
}

/** Scadenze da registrare: tutte quelle passate non registrate (dall'inizio) + i prossimi giorni. */
export function dueOccurrences(state: AppState, aheadDays = 14): DueItem[] {
  const ctx = makeCtx(state);
  const t = todayISO();
  const out: DueItem[] = [];
  for (const r of alive(state.recurrences)) {
    if (!r.active) continue;
    for (const d of occurrencesBetween(r, r.start, addDays(t, aheadDays))) {
      if (ctx.registered.has(`${r.id}|${d}`)) continue;
      out.push({ recurrenceId: r.id, date: d, overdue: d < t });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- Saldi conti speciali ----------

export function accountBalance(state: AppState, accountId: string): number {
  let b = 0;
  for (const m of state.movements) {
    if (m.deleted || m.planned || m.accountId !== accountId) continue;
    b += m.kind === 'entrata' ? m.amount : -m.amount;
  }
  return b;
}

export function pendingRefunds(state: AppState): Movement[] {
  return state.movements.filter((m) => !m.deleted && m.kind === 'uscita' && m.refund === 'pending');
}
