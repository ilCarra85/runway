const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const eur0 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export const money = (n: number) => eur.format(round2(n));
export const money0 = (n: number) => eur0.format(Math.round(n));
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Accetta "12,50", "12.50", "1.234,56". */
export function parseAmount(s: string): number {
  const t = s.trim().replace(/\s|€/g, '');
  if (!t) return NaN;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return Number(norm);
}

export const amountToInput = (n: number | undefined) =>
  n === undefined || Number.isNaN(n) ? '' : String(round2(n)).replace('.', ',');

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const pct = (n: number) => `${Math.round(n)}%`;
