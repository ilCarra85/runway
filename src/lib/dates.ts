const pad = (n: number) => String(n).padStart(2, '0');

export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const todayISO = () => toISO(new Date());

export function addDays(s: string, n: number): string {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Aggiunge mesi mantenendo il giorno originale (31 → ultimo giorno del mese). */
export function addMonths(s: string, n: number): string {
  const d = parseISO(s);
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return toISO(t);
}

/** Giorni da a → b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

export const startOfMonth = (s: string) => s.slice(0, 7) + '-01';
export function endOfMonth(s: string): string {
  const d = parseISO(startOfMonth(s));
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
export const startOfYear = (s: string) => s.slice(0, 4) + '-01-01';
export const endOfYear = (s: string) => s.slice(0, 4) + '-12-31';

export const minISO = (a: string, b: string) => (a < b ? a : b);
export const maxISO = (a: string, b: string) => (a > b ? a : b);

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

export const monthName = (s: string) => MONTHS[parseISO(s).getMonth()];
export const monthShort = (s: string) => MONTHS_SHORT[parseISO(s).getMonth()];
export const monthLabel = (s: string) => `${cap(monthName(s))} ${s.slice(0, 4)}`;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function formatDate(s: string): string {
  const d = parseISO(s);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export function dayHeader(s: string): string {
  const t = todayISO();
  if (s === t) return 'Oggi';
  if (s === addDays(t, -1)) return 'Ieri';
  if (s === addDays(t, 1)) return 'Domani';
  const d = parseISO(s);
  const y = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${cap(WEEKDAYS[d.getDay()])} ${d.getDate()} ${MONTHS[d.getMonth()]}${y}`;
}

export function relativeDays(s: string): string {
  const n = daysBetween(todayISO(), s);
  if (n === 0) return 'oggi';
  if (n === 1) return 'domani';
  if (n === -1) return 'ieri';
  if (n > 0) return `tra ${n} giorni`;
  return `${-n} giorni fa`;
}
