import type { Movement, Recurrence, Unit } from '../types';
import { addDays, addMonths, formatDate } from './dates';

export function nthDate(r: Pick<Recurrence, 'start' | 'every' | 'unit'>, k: number): string {
  const n = k * Math.max(1, r.every);
  switch (r.unit) {
    case 'giorni': return addDays(r.start, n);
    case 'settimane': return addDays(r.start, n * 7);
    case 'mesi': return addMonths(r.start, n);
    case 'anni': return addMonths(r.start, n * 12);
  }
}

/** Date delle occorrenze in [from, to], escluse quelle saltate. */
export function occurrencesBetween(r: Recurrence, from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = 0; k < 50000; k++) {
    if (r.endMode === 'volte' && k >= (r.count ?? 0)) break;
    const d = nthDate(r, k);
    if (d > to) break;
    if (r.endMode === 'data' && r.until && d > r.until) break;
    if (d >= from && !r.skipped?.includes(d)) out.push(d);
  }
  return out;
}

/** La data è un'occorrenza valida della ricorrenza (dentro inizio/fine/numero di volte)? Le saltate contano come valide. */
export function isOccurrence(r: Recurrence, date: string): boolean {
  return occurrencesBetween({ ...r, skipped: [] }, date, date).length > 0;
}

export function nextOccurrence(r: Recurrence, fromInclusive: string): string | undefined {
  for (let k = 0; k < 50000; k++) {
    if (r.endMode === 'volte' && k >= (r.count ?? 0)) return undefined;
    const d = nthDate(r, k);
    if (r.endMode === 'data' && r.until && d > r.until) return undefined;
    if (d >= fromInclusive && !r.skipped?.includes(d)) return d;
  }
  return undefined;
}

const SINGULAR: Record<Unit, string> = { giorni: 'Ogni giorno', settimane: 'Ogni settimana', mesi: 'Ogni mese', anni: 'Ogni anno' };

export function cadenceLabel(r: Pick<Recurrence, 'every' | 'unit' | 'endMode' | 'count' | 'until'>): string {
  const base = r.every <= 1 ? SINGULAR[r.unit] : `Ogni ${r.every} ${r.unit}`;
  if (r.endMode === 'volte') return `${base} · ${r.count ?? 0} volte`;
  if (r.endMode === 'data' && r.until) return `${base} · fino al ${formatDate(r.until)}`;
  return base;
}

/**
 * Importo stimato di una ricorrenza: mediana degli ultimi 6 movimenti registrati
 * (la mediana non si fa spostare da una busta con premio o da una bolletta di conguaglio). 0 se non ce ne sono.
 */
export function estimateAmount(recId: string, movements: Movement[], categoryId?: string): number {
  const last = movements.filter((m) => !m.deleted && m.recurrenceId === recId && !m.planned && m.amount > 0 && (!categoryId || m.categoryId === categoryId))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map((m) => m.amount).sort((a, b) => a - b);
  if (!last.length) return 0;
  const mid = Math.floor(last.length / 2);
  const v = last.length % 2 ? last[mid] : (last[mid - 1] + last[mid]) / 2;
  return Math.round(v * 100) / 100;
}

/** Stato di rimborso dei movimenti generati dalla ricorrenza. */
export function recRefund(r: Pick<Recurrence, 'kind' | 'refundable' | 'refundAmount'>): Pick<Movement, 'refund' | 'refundAmount'> {
  return r.kind === 'uscita' && r.refundable ? { refund: 'pending', refundAmount: r.refundAmount } : { refund: 'none', refundAmount: undefined };
}

/** Quante volte all'anno ricorre (per stime rapide). */
export function timesPerYear(r: Pick<Recurrence, 'every' | 'unit'>): number {
  const e = Math.max(1, r.every);
  switch (r.unit) {
    case 'giorni': return 365.25 / e;
    case 'settimane': return 52.1786 / e;
    case 'mesi': return 12 / e;
    case 'anni': return 1 / e;
  }
}
