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
  // data dal documento, nessun documento ancora confermato: nessuna scadenza
  if (!r.start) return out;
  for (let k = firstK(r); k < 50000; k++) {
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
  if (!r.start) return undefined;
  for (let k = firstK(r); k < 50000; k++) {
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
 * Importo stimato di una ricorrenza: media dei movimenti registrati negli ultimi 12 mesi
 * (contati dal più recente). 0 se non ce ne sono.
 */
export function estimateAmount(recId: string, movements: Movement[], categoryId?: string): number {
  const mine = movements.filter((m) => !m.deleted && m.recurrenceId === recId && !m.planned && m.amount > 0 && (!categoryId || m.categoryId === categoryId));
  if (!mine.length) return 0;
  const latest = mine.reduce((d, m) => (m.date > d ? m.date : d), '');
  const from = addMonths(latest, -12);
  const last = mine.filter((m) => m.date > from);
  return Math.round(last.reduce((s, m) => s + m.amount, 0) / last.length * 100) / 100;
}

/**
 * Data della ricorrenza lasciata vuota: le date le danno i documenti (serve una cartella monitorata).
 * In questo caso `start` è la data dell'ultimo documento confermato (vuota finché non ce n'è uno):
 * da lì si calcolano scadenze e previsioni.
 */
export const dateFromDoc = (r: Pick<Recurrence, 'docDate' | 'driveFolderId'>) => !!r.docDate && !!r.driveFolderId;

/** Stato di rimborso dei movimenti generati dalla ricorrenza. */
export function recRefund(r: Pick<Recurrence, 'kind' | 'refundable' | 'refundAmount' | 'refundIn'>): Pick<Movement, 'refund' | 'refundAmount' | 'refundIn'> {
  if (r.kind === 'entrata') return { refund: 'none', refundAmount: undefined, refundIn: r.refundIn || undefined };
  return r.refundable ? { refund: 'pending', refundAmount: r.refundAmount } : { refund: 'none', refundAmount: undefined };
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

/**
 * Data dal documento: `start` è l'ultimo documento confermato, già registrato; le scadenze ripartono dalla successiva.
 * (Il conteggio "dopo N volte" in questo caso parte dall'ultimo documento.)
 */
function firstK(r: Pick<Recurrence, 'docDate' | 'driveFolderId'>): number {
  return dateFromDoc(r) ? 1 : 0;
}
