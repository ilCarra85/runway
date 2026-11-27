// Lettore dell'Excel dei movimenti della carta buoni pasto Edenred.
// In testa il riepilogo della carta (N. carta, buoni caricati/utilizzati, saldo buoni); poi un blocco per ogni ordine
// di ricarica ("Numero serie", data, numero e valore dei buoni, scadenza) seguito dalle righe di dettaglio:
// "(52) Ricarica da Scarico altra Carta" = buoni spostati da una carta precedente (l'ordine allora non si conta),
// "(20) Utilizzo Ricarica" = un buono speso (con data, ora e insegna del negozio).
// Ingressi: spostamenti (giroconto) e ricariche; uscite: gli utilizzi raggruppati per data, ora e negozio.

import type { BankRow, Statement } from './unicredit';
import { parseIt } from './unicredit';

type Cell = string | number;
const S = (c: Cell | undefined) => String(c ?? '').trim();
const DT = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2})[.:](\d{2})/;

export const isEdenred = (rows: Cell[][]) =>
  S(rows[0]?.[0]) === 'N. carta' && rows.some((r) => S(r[0]) === 'Numero serie') && rows.some((r) => S(r[2]) === 'Tip. movimento');

const when = (c: Cell | undefined) => {
  const m = S(c).match(DT);
  return m ? { date: `${m[3]}-${m[2]}-${m[1]}`, time: `${m[4]}:${m[5]}`, key: `${m[3]}${m[2]}${m[1]}${m[4]}${m[5]}` } : undefined;
};
const num = (c: Cell | undefined) => (typeof c === 'number' ? c : parseIt(S(c) || '0'));
const fmtVal = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','));

export function parseEdenred(rows: Cell[][], accountId = 'buoni'): Statement {
  const card = S(rows[1]?.[0]);
  const balanceVouchers = num(rows[1]?.[7]);
  interface Order { serie: string; date: string; time: string; n: number; value: number; prog: string; due: string; transfers: { date: string; time: string; note: string }[] }
  const orders: Order[] = [];
  const uses: { date: string; time: string; key: string; n: number; shop: string; prog: string }[] = [];
  for (const r of rows) {
    const t = S(r[3]);
    const o = when(r[2]);
    if (o && /Ordine di Ricarica/i.test(t)) {
      orders.push({ serie: S(r[0]), date: o.date, time: o.time, n: num(r[5]), value: num(r[4]), prog: S(r[9]), due: S(r[10]), transfers: [] });
      continue;
    }
    const w = when(r[1]);
    if (!w) continue;
    const type = S(r[2]);
    if (/^\(52\)/.test(type) && orders.length) orders[orders.length - 1].transfers.push({ date: w.date, time: w.time, note: S(r[7]) });
    else if (/^\(20\)/.test(type)) uses.push({ ...w, n: num(r[3]) || 1, shop: S(r[6]) || 'Edenred', prog: S(r[7]) });
  }
  const value = orders[0]?.value || 10;
  const v = fmtVal(value);
  const out: BankRow[] = [];

  for (const o of orders) {
    if (o.transfers.length) {
      // buoni spostati da un'altra carta: movimento interno (non sono buoni nuovi)
      for (const tr of o.transfers) {
        const n = Number(tr.note.match(/Numero Buoni=(\d+)/i)?.[1] ?? 0);
        const da = tr.note.match(/ProgressivoDa=(\d+)/i)?.[1] ?? '', a = tr.note.match(/ProgressivoA=(\d+)/i)?.[1] ?? '';
        out.push({
          bankId: `ED:T:${card}|${tr.date}|${da}-${a}`, bookDate: tr.date, date: tr.date, time: tr.time, amount: Math.round(n * value * 100) / 100,
          type: 'EDENRED TRASFERIMENTO', counterparty: 'Buoni da altra carta',
          text: `Spostati da altra carta · ${n} buoni da ${v} €${da ? ` · n. ${da}–${a}` : ''}`, accountId
        });
      }
    } else {
      out.push({
        bankId: `ED:R:${o.serie}`, bookDate: o.date, date: o.date, time: o.time, amount: Math.round(o.n * o.value * 100) / 100,
        type: 'EDENRED RICARICA', counterparty: 'Ricarica buoni pasto',
        text: `Ordine n. ${o.serie} · ${o.n} buoni da ${fmtVal(o.value)} €${o.prog ? ` · ${o.prog}` : ''}${o.due ? ` · scadenza ${o.due}` : ''}`, accountId
      });
    }
  }

  // un buono per riga: una spesa per ogni data, ora e negozio
  const groups = new Map<string, typeof uses>();
  for (const u of uses) {
    const k = `${u.key}|${u.shop}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(u);
  }
  for (const list of groups.values()) {
    const n = list.reduce((s, u) => s + u.n, 0);
    const progs = list.map((u) => u.prog).filter(Boolean).sort();
    const f = list[0];
    out.push({
      bankId: `ED:U:${card}|${f.key}|${progs[0] ?? ''}`, bookDate: f.date, date: f.date, time: f.time, amount: -Math.round(n * value * 100) / 100,
      type: 'EDENRED PAGAMENTO', counterparty: f.shop,
      text: `${f.shop} · ${n} ${n === 1 ? 'buono' : 'buoni'} da ${v} €${progs.length ? ` · n. ${progs.length > 1 ? `${progs[0]}–${progs[progs.length - 1]}` : progs[0]}` : ''}`, accountId
    });
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
  return {
    holder: '', from: out[0]?.date, to: out[out.length - 1]?.date,
    // la carta parte da zero: il saldo finale del file deve tornare con ingressi e uscite
    opening: 0, closing: Math.round(balanceVouchers * value * 100) / 100,
    rows: out
  };
}
