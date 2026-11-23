// Lettore della "Lista movimenti" esportata in PDF dall'home banking Unicredit.
// Ogni movimento: riga con data contabile, data valuta, codice operazione e importo,
// seguita da 2-6 righe di descrizione (tipo operazione, esercente/beneficiario, causale…).

import { lineText, type Line } from './pdf';

export interface BankRow {
  /** Impronta anti-doppioni: codice operazione + data contabile + importo. */
  bankId: string;
  bookDate: string; // data contabile ISO
  /** Data reale dell'operazione (es. data del pagamento POS), altrimenti data valuta. */
  date: string;
  amount: number; // con segno: negativo = uscita
  type: string; // es. "PAGAMENTO POS"
  /** Esercente, beneficiario o ordinante, già ripulito. */
  counterparty: string;
  /** Causale (bonifici, addebiti SEPA). */
  purpose?: string;
  /** Pagamento online (POS E-Commerce). */
  online?: boolean;
  text: string; // descrizione completa
  /** Conto del movimento (es. satispay); assente = conto corrente. */
  accountId?: string;
}

export interface Statement {
  holder: string;
  /** Numero di conto (se il documento lo riporta). */
  account?: string;
  from?: string;
  to?: string;
  opening?: number;
  closing?: number;
  rows: BankRow[];
}

const DATE = /^\d{2}\.\d{2}\.\d{4}$/;
const AMOUNT = /^-?[\d.]+,\d{2}$/;
const iso = (d: string) => { const [g, m, a] = d.split(/[./]/); return `${a.length === 2 ? '20' + a : a}-${m}-${g}`; };
export const parseIt = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

const SKIP = /^(Data contabile|Il presente documento|LISTA MOVIMENTI|Filiale|Data da)/;

export function isUnicredit(lines: Line[]): boolean {
  const head = lines.slice(0, 15).map(lineText).join(' ');
  return /LISTA MOVIMENTI/.test(head) && /Data contabile/.test(lines.slice(0, 30).map(lineText).join(' '));
}

export function parseUnicredit(lines: Line[]): Statement {
  const st: Statement = { holder: '', rows: [] };
  const lm = lines.findIndex((l) => lineText(l) === 'LISTA MOVIMENTI');
  if (lm > 0) st.holder = lineText(lines[lm - 1]).toUpperCase();

  let cur: { head: Line; desc: Line[] } | null = null;
  const blocks: { head: Line; desc: Line[] }[] = [];
  for (const l of lines) {
    const t = lineText(l);
    if (/^Data da /.test(t)) {
      const m = t.match(/Data da (\S+) Data a (\S+)/);
      if (m) { st.from = iso(m[1]); st.to = iso(m[2]); }
      continue;
    }
    if (/Saldo iniziale/.test(t)) { st.opening = parseIt(l[l.length - 1].s); continue; }
    if (/Saldo finale/.test(t)) { st.closing = parseIt(l[l.length - 1].s); cur = null; continue; }
    if (SKIP.test(t) || /Pagina \d+ di \d+/.test(t)) continue;
    if (l.length >= 3 && l[0].x < 40 && DATE.test(l[0].s) && DATE.test(l[1].s) && AMOUNT.test(l[l.length - 1].s)) {
      cur = { head: l, desc: [] };
      blocks.push(cur);
      continue;
    }
    if (cur && l[0].x >= 130) cur.desc.push(l);
  }
  st.rows = blocks.map(toRow);
  return st;
}

function toRow({ head, desc }: { head: Line; desc: Line[] }): BankRow {
  const bookDate = iso(head[0].s);
  const valueDate = iso(head[1].s);
  const amount = parseIt(head[head.length - 1].s);
  // il codice operazione da solo non basta: la banca lo riusa a distanza di mesi
  const code = head.length >= 4 ? head[2].s : desc.map(lineText).join(' ').slice(0, 60);
  const bankId = `uc:${code}|${bookDate}|${amount.toFixed(2)}`;
  const texts = desc.map(lineText);
  const type = (texts[0] ?? '').toUpperCase();
  const row: BankRow = { bankId, bookDate, date: valueDate, amount, type, counterparty: '', text: texts.join(' · ') };

  const after = (re: RegExp) => { const i = texts.findIndex((t) => re.test(t)); return i; };
  const opDate = (t?: string) => { const m = t?.match(/(\d{2}\/\d{2}\/\d{2,4})/); return m ? iso(m[1]) : undefined; };
  const purposeFrom = (i: number) => {
    if (i < 0) return undefined;
    const parts = [texts[i].replace(/^(PER:|Per)\s*/i, '')];
    for (let j = i + 1; j < texts.length && !/^(TRN:|COMM|mandato|SPESE)/i.test(texts[j]); j++) parts.push(texts[j]);
    return parts.join(' ').replace(/\s+/g, ' ').trim() || undefined;
  };

  if (/^(PAGAMENTO|INCASSO) POS/.test(type)) {
    row.date = opDate(texts[1]) ?? valueDate;
    row.online = /E-Commerce/i.test(texts[1] ?? '');
    // riga esercente: nome a sinistra, città più a destra (x >= 260)
    const m = desc[3];
    row.counterparty = m ? lineText(m.filter((p) => p.x < 260)) || lineText(m) : (texts[1] ?? '');
  } else if (/^ADDEBITO SEPA/.test(type)) {
    const i = after(/^SDD da/i);
    row.counterparty = i >= 0 ? (texts[i + 1] ?? '') : (texts[1] ?? '');
    row.purpose = purposeFrom(after(/^Per /));
  } else if (/BONIFICO|GIROCONTO|EMOLUMENTI/.test(type)) {
    const i = after(/(^| )(A|DA):/);
    if (i >= 0) {
      const sameLine = texts[i].replace(/^.*?(A|DA):\s*/, '');
      row.counterparty = sameLine || (texts[i + 1] ?? '');
    }
    const d = texts[1]?.match(/DEL (\d{2}\.\d{2}\.\d{4})/);
    if (d) row.date = iso(d[1]);
    row.purpose = purposeFrom(after(/^PER:/));
  } else if (/^PRELEVAMENTO/.test(type)) {
    row.date = opDate(texts[1]) ?? valueDate;
    row.counterparty = 'Prelievo contanti';
  } else if (/RATA MUTUO/.test(type)) {
    row.counterparty = 'Rata mutuo';
  } else if (/^COMMISSIONI/.test(type)) {
    row.counterparty = 'Commissioni e spese bancarie';
    row.purpose = texts[1];
  } else {
    row.counterparty = texts[1] ?? texts[0] ?? '';
  }
  row.counterparty = row.counterparty.replace(/\s+-\s*$/, '').trim() || type;
  return row;
}
