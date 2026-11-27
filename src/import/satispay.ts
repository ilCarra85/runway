// Lettore dell'export Excel di Satispay ("Esporta report"): un movimento per riga, dal più recente.
// Colonne: Data, Nome, Descrizione, Importo, Tipo, Stato, Disponibilità, Disponibilità dopo la transazione, ID.
// I movimenti vanno nel conto Satispay; l'ID è univoco e fa da impronta anti-doppioni.

import type { BankRow, Statement } from './unicredit';
import { excelDate, excelTime } from './xlsx';

type Cell = string | number;

export const isSatispay = (rows: Cell[][]) =>
  /^Data$/.test(String(rows[0]?.[0] ?? '')) && rows[0].some((c) => /Disponibilit. dopo la transazione/.test(String(c))) && rows[0].some((c) => /^ID/.test(String(c)));

/** Tipo senza l'emoji iniziale, es. "👤 a una Persona" → "a una Persona". */
const cleanType = (s: string) => s.replace(/^[^\p{L}]+/u, '').trim();

export function parseSatispay(rows: Cell[][], accountId = 'satispay'): Statement {
  const head = rows[0].map((c) => String(c));
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const cDate = col(/^Data$/), cName = col(/^Nome$/), cDesc = col(/^Descrizione$/), cAmt = col(/^Importo$/), cType = col(/^Tipo$/),
    cState = col(/^Stato$/), cAfter = col(/dopo la transazione/), cId = col(/^ID/);
  const all = rows.slice(1).filter((r) => typeof r[cDate] === 'number' && typeof r[cAmt] === 'number');
  // solo i movimenti andati a buon fine
  const ok = all.filter((r) => /Approvato/.test(String(r[cState])));
  // dal più vecchio; a parità di data conta l'ordine del file (che è dal più recente)
  const chrono = ok.map((r, i) => ({ r, i })).sort((a, b) => (a.r[cDate] as number) - (b.r[cDate] as number) || b.i - a.i).map((x) => x.r);
  const out: BankRow[] = chrono.map((r) => {
    const name = String(r[cName] ?? '').trim();
    const desc = String(r[cDesc] ?? '').trim();
    const type = cleanType(String(r[cType] ?? ''));
    const date = excelDate(r[cDate] as number);
    return {
      bankId: `SP:${String(r[cId])}`, bookDate: date, date, time: excelTime(r[cDate] as number), amount: Math.round((r[cAmt] as number) * 100) / 100,
      type: `SATISPAY ${type.toUpperCase()}`, counterparty: name || type, purpose: desc || undefined,
      text: [type, name, desc].filter(Boolean).join(' · '), accountId
    };
  });
  // saldo dopo ogni movimento: la cella è vuota quando il saldo è zero
  const after = (r: Cell[]) => (typeof r[cAfter] === 'number' ? (r[cAfter] as number) : 0);
  const first = chrono[0], last = chrono[chrono.length - 1];
  return {
    holder: '', from: out[0]?.date, to: out[out.length - 1]?.date,
    opening: first ? Math.round((after(first) - (first[cAmt] as number)) * 100) / 100 : undefined,
    closing: last ? after(last) : undefined,
    rows: out
  };
}
