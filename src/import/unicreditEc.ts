// Lettore dell'"Estratto conto" periodico Unicredit (PDF trimestrale), diverso dalla "Lista movimenti".
// Tabella "Data | Valuta | Descrizione | Uscite | Entrate": la descrizione di ogni movimento è un blocco di righe
// centrato sulla riga con data e importo; la colonna dell'importo dice se è un'uscita o un'entrata.
// Non c'è il codice operazione: l'impronta è data contabile + importo + testo.

import type { PosItem } from './pdf';
import type { BankRow, Statement } from './unicredit';
import { parseIt } from './unicredit';

const DATE = /^\d{2}\.\d{2}\.\d{2}$/;
const AMOUNT = /^[\d.]+,\d{2}$/;
const isoShort = (d: string) => { const [g, m, a] = d.split('.'); return `20${a}-${m}-${g}`; };
const isoAny = (d: string) => { const [g, m, a] = d.split(/[./]/); return `${a.length === 2 ? '20' + a : a}-${m}-${g}`; };

export const isUnicreditEc = (pages: PosItem[][]) => {
  const t = (pages[0] ?? []).map((i) => i.s).join(' ');
  return /Estratto conto al/.test(t) && /ELENCO MOVIMENTI/.test(t) && /UNCRITM/.test(t);
};

/** Testo semplice (per i controlli): hash breve per distinguere movimenti uguali nello stesso giorno. */
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function parseUnicreditEc(pages: PosItem[][]): Statement {
  const st: Statement = { holder: '', rows: [] };
  const all = pages.flat().map((i) => i.s).join(' ');
  st.account = all.match(/Conto Corrente:\s*(\d{6,})/)?.[1];
  // intestatari nell'indirizzo, es. "ROSSI MARIA,BIANCHI" + "LUCA," → due nomi separati da ";"
  const names = (pages[0] ?? []).filter((i) => /^[A-Z][A-Z' ]*,([A-Z][A-Z' ]*)?$/.test(i.s)).map((i) => i.s).join(' ');
  st.holder = names.split(',').map((n) => n.trim()).filter(Boolean).join(';');
  const per = all.match(/periodo\s+(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/);
  if (per) { st.from = isoAny(per[1]); st.to = isoAny(per[2]); }

  const blocks: { book: string; value?: string; amount: number; lines: string[] }[] = [];
  for (const items of pages) {
    const head = items.find((i) => i.s === 'Descrizione' && items.some((j) => j.s === 'Entrate' && Math.abs(j.y - i.y) <= 2));
    if (!head) continue;
    const xOut = items.find((i) => i.s === 'Uscite' && Math.abs(i.y - head.y) <= 2)?.x ?? 469;
    const xIn = items.find((i) => i.s === 'Entrate' && Math.abs(i.y - head.y) <= 2)?.x ?? 529;
    // fine tabella: prima riga di testo a sinistra che non è una data (note a piè di pagina, sezioni successive)
    const body = items.filter((i) => i.y < head.y - 3);
    const anchors = body.filter((i) => i.x < head.x - 60 && i.x < 70 && DATE.test(i.s)).sort((a, b) => b.y - a.y);
    const bottom = Math.min(...anchors.map((a) => a.y)) - 30;
    const desc = body.filter((i) => i.x >= head.x - 5 && i.x < xOut - 20 && i.y >= bottom).sort((a, b) => b.y - a.y);
    // righe di descrizione → blocchi (dentro un blocco le righe distano ~9, tra blocchi ~11 o più)
    const groups: PosItem[][] = [];
    for (const d of desc) {
      const g = groups[groups.length - 1];
      if (g && g[g.length - 1].y - d.y <= 10) g.push(d); else groups.push([d]);
    }
    for (const a of anchors) {
      const row = body.filter((i) => Math.abs(i.y - a.y) <= 2);
      const value = row.find((i) => i !== a && DATE.test(i.s) && i.x < head.x);
      const amt = row.find((i) => i.x >= xOut - 20 && AMOUNT.test(i.s));
      if (!amt) continue;
      const g = groups.find((gr) => a.y <= gr[0].y + 2 && a.y >= gr[gr.length - 1].y - 2);
      const lines = (g ?? row.filter((i) => i.x >= head.x - 5 && i.x < xOut - 20)).map((i) => i.s);
      // la colonna Entrate è più a destra
      const income = amt.x >= (xOut + xIn) / 2;
      const text = lines.join(' ');
      if (/^SALDO INIZIALE/.test(text)) { st.opening = parseIt(amt.s) * (income ? 1 : -1); continue; }
      if (/^SALDO FINALE/.test(text)) { st.closing = parseIt(amt.s) * (income ? 1 : -1); continue; }
      blocks.push({ book: isoShort(a.s), value: value ? isoShort(value.s) : undefined, amount: parseIt(amt.s) * (income ? 1 : -1), lines });
    }
  }
  // movimenti a zero (es. competenze senza interessi) non servono
  st.rows = blocks.filter((b) => Math.abs(b.amount) >= 0.005).map(toRow);
  return st;
}

function toRow(b: { book: string; value?: string; amount: number; lines: string[] }): BankRow {
  // il tipo senza la data finale (es. "PAGAMENTO GOOGLE PAY MASTERCARD NFC del 23/11/2025"): serve per raggruppare
  const type = (b.lines[0] ?? '').toUpperCase().replace(/\s+DEL \d{2}\/\d{2}\/\d{4}$/, '');
  const rest = b.lines.slice(1).join(' ').replace(/\s+/g, ' ').trim();
  const full = b.lines.join(' ');
  const row: BankRow = {
    bankId: `uce:${hash(full)}|${b.book}|${b.amount.toFixed(2)}`,
    bookDate: b.book, date: b.value ?? b.book, amount: b.amount, type, counterparty: '', text: b.lines.join(' · ')
  };
  const m = (re: RegExp, s = rest) => s.match(re)?.[1]?.trim();
  if (/BONIFICO|GIROCONTO|EMOLUMENTI/.test(type)) {
    row.counterparty = m(/\b(?:DA|A):\s*(.+?)(?:\s+PER:|\s+TRN:|\s+COMM:|$)/) ?? '';
    row.purpose = m(/\bPER:\s*(.+?)(?:\s+TRN:|\s+COMM:|$)/)?.replace(/\s+Chiusura$/, '');
    const d = m(/DEL (\d{2}\.\d{2}\.\d{4})/);
    if (d) row.date = isoAny(d);
  } else if (/^ADDEBITO SEPA/.test(type)) {
    row.counterparty = m(/SDD da \S+\s+(.+?)\s+mandato/i) ?? rest;
    row.purpose = m(/\bPer\s+(.+)$/);
  } else if (/^PAGAMENTO .*(POS|PAY|NFC|CARTA \*)/.test(type) || /^CARTA \*/.test(rest)) {
    const d = m(/del (\d{2}\/\d{2}\/\d{4})/i, full);
    if (d) row.date = isoAny(d);
    row.counterparty = m(/EUR [\d.]+,\d{2}\s+(.+)$/) ?? rest;
  } else if (/CARTE DI CREDITO/.test(type)) {
    row.counterparty = 'Carta di credito';
    row.purpose = rest || undefined;
  } else if (/^VERSAMENTO/.test(type)) {
    row.counterparty = 'Versamento contanti';
    // dopo la riga dello sportello c'è la causale scritta al versamento (es. "SPESE BIMBE GINNASTICA")
    row.purpose = b.lines.slice(2).join(' ').trim() || undefined;
  } else if (/^PRELEVAMENTO/.test(type)) {
    row.counterparty = 'Prelievo contanti';
  } else if (/RATA MUTUO/.test(type)) {
    row.counterparty = 'Rata mutuo';
    row.purpose = m(/(RATA N\. \d+)/);
  } else if (/^COMMISSIONI|^COMPETENZE|^IMPOSTA/.test(type)) {
    row.counterparty = 'Commissioni e spese bancarie';
  } else {
    row.counterparty = b.lines[1] ?? b.lines[0] ?? '';
  }
  row.counterparty = row.counterparty.replace(/\s+-\s*$/, '').trim() || type;
  return row;
}
