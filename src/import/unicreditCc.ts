// Lettore dell'"Estratto conto carta di credito" mensile Unicredit (PDF).
// Tabella "Lista operazioni": Data registrazione | Riferimento operazione | Descrizione | ... | Importo in Euro.
// Ogni operazione è una riga con data, riferimento e importo; la descrizione sta sulle righe appena sopra e sotto
// (o sulla stessa riga, es. "QUOTA DI RINNOVO") e finisce con la data dell'operazione attaccata (es. "...123.09.25").
// I movimenti vanno nel conto della carta; l'addebito mensile sul conto corrente è un giroconto.
// Impronta: riferimento + data di registrazione + importo.

import type { PosItem } from './pdf';
import type { BankRow, Statement } from './unicredit';
import { parseIt } from './unicredit';

const DATE = /^\d{2}\.\d{2}\.\d{2}$/;
const AMOUNT = /^-?[\d.]+,\d{2}-?$/;
const isoShort = (d: string) => { const [g, m, a] = d.split('.'); return `20${a}-${m}-${g}`; };
const isoLong = (d: string) => { const [g, m, a] = d.split('.'); return `${a}-${m}-${g}`; };

export const isUnicreditCc = (pages: PosItem[][]) => {
  const t = (pages[0] ?? []).map((i) => i.s).join(' ');
  return /CARTA DI CREDITO AL \d{2}\.\d{2}\.\d{4}/.test(t) && /UNICREDITCARD|Conto Carta/i.test(t);
};

export function parseUnicreditCc(pages: PosItem[][], accountId = 'carta-credito'): Statement {
  const st: Statement = { holder: '', rows: [] };
  const all = pages.flat().map((i) => i.s).join(' ');
  const end = all.match(/CARTA DI CREDITO AL (\d{2}\.\d{2}\.\d{4})/)?.[1];
  if (end) { st.to = isoLong(end); st.from = st.to.slice(0, 8) + '01'; }
  st.account = all.match(/Numero carta:\s*([*\d ]+\d)/)?.[1]?.replace(/\s+/g, ' ').trim();
  const holder = pages.flat().find((i, _, arr) => i.s === 'Intestata a:' && arr.some((j) => j.y === i.y && j.x > i.x));
  if (holder) st.holder = pages.flat().filter((j) => Math.abs(j.y - holder.y) <= 2 && j.x > holder.x && j.x < 300).map((j) => j.s).join(' ');

  let total: number | undefined;
  for (const items of pages) {
    const head = items.find((i) => i.s === 'Descrizione' && items.some((j) => j.s === 'Riferimento' && Math.abs(j.y - i.y) <= 2));
    if (!head) continue;
    const foot = items.find((i) => /^Totale movimenti nel mese/.test(i.s) && i.y < head.y);
    const bottom = foot ? foot.y + 3 : -Infinity;
    const body = items.filter((i) => i.y < head.y - 15 && i.y > bottom);
    const anchors = body.filter((i) => i.x < head.x - 60 && DATE.test(i.s)).sort((a, b) => b.y - a.y);
    for (const a of anchors) {
      const row = body.filter((i) => Math.abs(i.y - a.y) <= 2);
      const amt = row.filter((i) => i.x > 450 && AMOUNT.test(i.s)).sort((x, y) => y.x - x.x)[0];
      if (!amt) continue;
      const ref = row.find((i) => i.x > a.x && i.x < head.x - 5)?.s ?? '';
      // descrizione: righe vicine all'ancora (sopra e sotto), nella colonna Descrizione
      const lines = body.filter((i) => i.x >= head.x - 5 && i.x < 350 && Math.abs(i.y - a.y) <= 9).sort((x, y) => y.y - x.y).map((i) => i.s);
      // rimborsi/storni: importo con il segno meno (davanti o dietro)
      const credit = /-/.test(amt.s);
      st.rows.push(toRow(a.s, ref, parseIt(amt.s.replace(/-/g, '')) * (credit ? 1 : -1), lines, accountId));
    }
    const tot = items.find((i) => /^TOTALE ADDEBITO CARTA/.test(i.s));
    if (tot) {
      const v = items.find((i) => Math.abs(i.y - tot.y) <= 2 && i.x > 450 && AMOUNT.test(i.s));
      if (v) total = (total ?? 0) + parseIt(v.s.replace(/-/g, '')) * (/-/.test(v.s) ? -1 : 1);
    }
  }
  // controllo: la somma delle operazioni deve dare il totale addebitato
  if (total !== undefined) { st.opening = 0; st.closing = -total; }
  return st;
}

function toRow(book: string, ref: string, amount: number, lines: string[], accountId: string): BankRow {
  let text = lines.join(' ').replace(/\s+/g, ' ').trim();
  // data dell'operazione attaccata in fondo (es. "3531436900123.09.25" → 23.09.25)
  let date = isoShort(book);
  const op = text.match(/(\d{2}\.\d{2}\.\d{2})$/);
  if (op) { date = isoShort(op[1]); text = text.slice(0, -8).trim(); }
  const m = text.match(/^(Pagamento [\w-]+)\s+(.*)$/i);
  const type = (m ? m[1] : text).toUpperCase();
  // esercente senza codici e numeri di riferimento
  const counterparty = (m ? m[2] : text).split(/[\s*]+/).filter((w) => w && !/\d/.test(w)).join(' ').trim() || text;
  return {
    bankId: `UCC:${ref}|${isoShort(book)}|${amount.toFixed(2)}`,
    bookDate: isoShort(book), date, amount, type: `CARTA ${type}`, counterparty,
    online: /E-COMMERCE/i.test(type) || undefined, text: lines.join(' · '), accountId
  };
}
