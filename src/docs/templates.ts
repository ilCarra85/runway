// Modelli di lettura dei documenti (bollette, buste paga) delle cartelle Drive monitorate.
// Ogni modello riconosce i PDF del suo fornitore ed estrae importo, scadenza e periodo di competenza.
// Un fornitore può avere più forniture nella stessa cartella (es. Octopus: luce e gas).

export interface ParsedDoc {
  /** Fornitura a cui si riferisce il documento (id della fornitura del modello). */
  supply: string;
  amount: number;
  /** Scadenza del pagamento (ISO): diventa la data del movimento. */
  dueDate?: string;
  issueDate?: string;
  periodFrom?: string;
  periodTo?: string;
  number?: string;
  /** Busta paga: rimborso spese incluso nel netto (rimborsa le uscite "da rimborsare"). */
  refundExpenses?: number;
  /** Busta paga: buoni pasto ricevuti (entrano nel conto Buoni pasto). */
  mealVouchers?: number;
  /** Busta paga: rimborso del 730 incluso nel netto (va registrato a parte). */
  refund730?: number;
  /** Busta paga: premi (di risultato e altri), netto stimato (va registrato a parte) e lordo letto. */
  bonus?: number;
  bonusGross?: number;
}

export interface DocTemplate {
  id: string;
  name: string;
  /** separate: movimento con la sua categoria, senza scadenza della ricorrenza e fuori dalla stima (es. tredicesima). */
  supplies: { id: string; label: string; categoryId?: string; separate?: boolean }[];
  /** Il testo appartiene a un documento di questo fornitore? */
  detect(text: string): boolean;
  /** Dati del documento, o null se non è una bolletta (es. contratto). */
  parse(text: string): ParsedDoc | null;
}

const iso = (d?: string) => { if (!d) return undefined; const [g, m, a] = d.split('/'); return a && m && g ? `${a.length === 2 ? '20' + a : a}-${m}-${g}` : undefined; };
const num = (s?: string) => (s ? Number(s.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.')) : NaN);

const octopus: DocTemplate = {
  id: 'octopus',
  name: 'Octopus Energy',
  supplies: [
    { id: 'luce', label: 'Luce (energia elettrica)', categoryId: 'luce' },
    { id: 'gas', label: 'Gas', categoryId: 'gas' }
  ],
  detect: (t) => /Octopus Energy/i.test(t),
  parse(t) {
    // formato dal giugno 2025: "BOLLETTA LUCE | Codice Fornitura…"
    const kind = t.match(/BOLLETTA (LUCE|GAS)/);
    if (kind) {
      const amount = num(t.match(/TOTALE DA PAGARE ([\d.,]+) ?€/)?.[1] ?? t.match(/dovrai pagare ([\d.,]+) ?€/)?.[1]);
      if (!Number.isFinite(amount)) return null;
      const per = t.match(/PERIODO DI RIFERIMENTO: dal (\d{2}\/\d{2}\/\d{4}) al (\d{2}\/\d{2}\/\d{4})/);
      return {
        supply: kind[1] === 'GAS' ? 'gas' : 'luce', amount,
        dueDate: iso(t.match(/Entro il (\d{2}\/\d{2}\/\d{4})/)?.[1]),
        issueDate: iso(t.match(/DATA FATTURA: (\d{2}\/\d{2}\/\d{4})/)?.[1]),
        periodFrom: iso(per?.[1]), periodTo: iso(per?.[2]),
        number: t.match(/FISCALI: (\S+)/)?.[1]
      };
    }
    // formato fino al maggio 2025: "Fattura n: … Totale importo da pagare € …"
    if (/Fattura n:/.test(t)) {
      const amount = num(t.match(/Totale importo da pagare € ?([\d.,]+)/)?.[1]);
      if (!Number.isFinite(amount)) return null;
      const per = t.match(/[Pp]eriodo[^\d]{0,40}(\d{2}\/\d{2}\/\d{4})[^\d]{1,10}(\d{2}\/\d{2}\/\d{4})/);
      return {
        supply: /\bPDR\b/.test(t) ? 'gas' : 'luce', amount,
        dueDate: iso(t.match(/Scadenza: (\d{2}\/\d{2}\/\d{4})/)?.[1]),
        issueDate: iso(t.match(/(?:Data emissione|emessa il|Data fattura)[: ]*(\d{2}\/\d{2}\/\d{4})/i)?.[1]),
        periodFrom: iso(per?.[1]), periodTo: iso(per?.[2]),
        number: t.match(/Fattura n: (\S+)/)?.[1]
      };
    }
    return null; // contratti e altri documenti
  }
};

const MESI: Record<string, string> = {
  gennaio: '01', febbraio: '02', marzo: '03', aprile: '04', maggio: '05', giugno: '06',
  luglio: '07', agosto: '08', settembre: '09', ottobre: '10', novembre: '11', dicembre: '12'
};
const isoDot = (d?: string) => iso(d?.replace(/\./g, '/'));

/** Hera – Tariffa Corrispettiva Puntuale (rifiuti, ex TARI). Le pagine sono ruotate: si usano solo etichette sicure. */
const heraTcp: DocTemplate = {
  id: 'hera-tcp',
  name: 'Hera – Tariffa rifiuti (TCP)',
  supplies: [{ id: 'rifiuti', label: 'Rifiuti (Tariffa Corrispettiva Puntuale)', categoryId: 'rifiuti' }],
  detect: (t) => /gruppohera|HERA S\.p\.A/i.test(t),
  parse(t) {
    // fino al 2025 "Igiene Ambientale 79,98"; dal 2026 solo il totale in testa "€ € 85,40 85,40"
    const amount = num(t.match(/Igiene Ambientale ([\d.,]+)/)?.[1] ?? t.match(/€ € ([\d.]*\d,\d{2})/)?.[1]);
    if (!Number.isFinite(amount) || !/Tariffa Corrispettiva Puntuale|Igiene Ambientale/i.test(t)) return null; // solleciti, volture, comunicazioni
    const due = t.match(/(\d{1,2}) (gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre) (\d{4})/i);
    const per = t.match(/Periodo dal (\d{2}\.\d{2}\.\d{4}) al (\d{2}\.\d{2}\.\d{4})/) ?? t.match(/dal (\d{2}\.\d{2}\.\d{4}) al (\d{2}\.\d{2}\.\d{4})/);
    const nr = t.match(/fattura elettronica Hera Spa n\. (\d+) del (\d{2}\.\d{2}\.\d{4})/);
    return {
      supply: 'rifiuti', amount,
      dueDate: due ? `${due[3]}-${MESI[due[2].toLowerCase()]}-${due[1].padStart(2, '0')}` : undefined,
      periodFrom: isoDot(per?.[1]), periodTo: isoDot(per?.[2]),
      number: nr?.[1], issueDate: isoDot(nr?.[2])
    };
  }
};

const MESI_BREVI: Record<string, string> = {
  gen: '01', feb: '02', mar: '03', apr: '04', mag: '05', giu: '06', lug: '07', ago: '08', set: '09', ott: '10', nov: '11', dic: '12'
};
const lastDay = (y: string, m: string) => String(new Date(Number(y), Number(m), 0).getDate()).padStart(2, '0');

/** Sky WiFi (internet + voce), fattura mensile. Due formati: fino a ottobre 2025 e da novembre 2025. */
const sky: DocTemplate = {
  id: 'sky-wifi',
  name: 'Sky WiFi',
  supplies: [{ id: 'internet', label: 'Internet e telefono', categoryId: 'internet' }],
  detect: (t) => /Sky Italia|sky\.it/i.test(t),
  parse(t) {
    if (!/Fattura n°/.test(t)) return null; // contratti, recap costi, revoche
    // l'ordine del testo dipende dall'impaginazione: le etichette possono essere lontane dai valori
    const amount = num(t.match(/Totale da pagare (?:€ ?)?([\d.]*\d,\d{2})/)?.[1] ?? t.match(/Totali (?:€ ?)?([\d.]*\d,\d{2}) ?€/)?.[1]);
    if (!Number.isFinite(amount)) return null;
    const issueDate = iso(t.match(/Data (?:di )?emissione (\d{2}\/\d{2}\/\d{4})/)?.[1]);
    // mese di competenza = mese di emissione (fattura del 1° del mese)
    const mon = issueDate ? [issueDate.slice(0, 4), issueDate.slice(5, 7)] : undefined;
    // scadenza: "Data di addebito … 25/06/2026" (nuovo) o "Da pagare entro … 34,90€ 30 Set" (vecchio, senza anno)
    let dueDate = iso(t.match(/Data di addebito.{0,80}?(\d{2}\/\d{2}\/\d{4})/)?.[1]);
    const short = !dueDate && t.match(/Da pagare entro.{0,100}?[\d.]*\d,\d{2} ?€? (\d{1,2}) (Gen|Feb|Mar|Apr|Mag|Giu|Lug|Ago|Set|Ott|Nov|Dic)\b/i);
    if (short && issueDate) {
      const m = MESI_BREVI[short[2].toLowerCase()];
      const y = Number(issueDate.slice(0, 4)) + (m < issueDate.slice(5, 7) ? 1 : 0); // emessa a dicembre, scade a gennaio
      dueDate = `${y}-${m}-${short[1].padStart(2, '0')}`;
    }
    return {
      supply: 'internet', amount, dueDate, issueDate,
      periodFrom: mon ? `${mon[0]}-${mon[1]}-01` : undefined,
      periodTo: mon ? `${mon[0]}-${mon[1]}-${lastDay(mon[0], mon[1])}` : undefined,
      number: t.match(/Fattura n° (\d{8,})/)?.[1]
    };
  }
};

const MESE_NUM: Record<string, number> = Object.fromEntries(Object.entries(MESI).map(([k, v]) => [k, Number(v)]));
const MESE_BREVE_NUM: Record<string, number> = Object.fromEntries(Object.entries(MESI_BREVI).map(([k, v]) => [k, Number(v)]));
const pad = (n: number) => String(n).padStart(2, '0');
/** Etichetta del vecchio formato, scritta con le lettere separate da spazi ("R I M B O R S O S P E S E"). */
const spaced = (label: string) => label.replace(/ /g, '').split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(' ?');
/** Importi "con le cifre separate" dopo un'etichetta del vecchio formato: ogni importo finisce con ", d d". */
const spacedAmounts = (s: string) => [...s.replace(/ /g, '').matchAll(/(\d*?),(\d{2})/g)].map((m) => Number(`${m[1] || '0'}.${m[2]}`));
const oldAmount = (t: string, label: string) => {
  const m = t.match(new RegExp(`${spaced(label)} ([\\d ,.]+?)(?= [A-Za-z*]|$)`));
  const v = m ? spacedAmounts(m[1]) : [];
  return v.length ? v[v.length - 1] : undefined;
};

/**
 * Netto stimato dei premi (la busta non lo dà separato dal netto): lordo meno contributi INPS (9,19%), poi
 * - premio di risultato: imposta sostitutiva 10% fino al 2022, 5% dal 2023 al 2025, 1% nel 2026-2027 (entro 5.000 €);
 * - altri premi ("Premio", "Premio ad personam"): tassati come lo stipendio, aliquota IRPEF del
 *   secondo scaglione (38% fino al 2021, 35% dal 2022, 33% dal 2026) più circa 2% di addizionali.
 * Regole fissate a oggi: per gli anni dopo l'ultimo in tabella vale l'ultima aliquota nota.
 */
const SUBST_RATE = (year: number) => (year <= 2022 ? 0.1 : year <= 2025 ? 0.05 : 0.01);
// verificate a novembre 2026: 28-55 mila al 38% fino al 2021, 28-50 mila al 35% dal 2022, 33% dal 2026 (L. 199/2025)
const IRPEF_RATE = (year: number) => (year <= 2021 ? 0.38 : year <= 2025 ? 0.35 : 0.33) + 0.02;
const bonusNet = (result: number, other: number, year: number) =>
  Math.round(((result * (1 - SUBST_RATE(year))) + other * (1 - IRPEF_RATE(year))) * (1 - 0.0919) * 100) / 100;

/**
 * Busta paga Con.se. Due formati: fino al 2023 (Libro Unico, lettere spaziate) e dal 2024 (Zucchetti).
 * Il netto è l'entrata; rimborso spese e buoni pasto vengono letti a parte. Data: accredito il 10 del mese dopo
 * (la tredicesima il 20 dicembre).
 */
const conse: DocTemplate = {
  id: 'conse',
  name: 'Busta paga Con.se.',
  supplies: [
    { id: 'stipendio', label: 'Stipendio mensile', categoryId: 'stipendio' },
    { id: 'tredicesima', label: 'Tredicesima', categoryId: 'mensilita-extra', separate: true }
  ],
  detect: (t) => /CON\.SE\. S\.R\.L|C O N \. S E \./.test(t),
  parse(t) {
    let amount: number | undefined, refund: number | undefined, meal: number | undefined, r730: number | undefined, prem: number | undefined, premOther: number | undefined, y: number | undefined, mo: number | undefined;
    const tredicesima = /13ma Mensilit|1 3 a M E N S I L I T A/.test(t);
    if (/LIBRO UNICO DEL LAVORO/.test(t)) {
      // netto: ultimo importo della riga sotto "NETTO" (a dicembre la busta ha due pagine: conta l'ultima)
      const v = [...t.matchAll(/ NETTO (.*?) SC\. /g)].map((m) => spacedAmounts(m[1])).filter((x) => x.length).pop() ?? [];
      amount = v[v.length - 1];
      refund = oldAmount(t, 'RIMBORSO SPESE');
      meal = oldAmount(t, 'BUONO VITTO ELETTRONICO');
      r730 = oldAmount(t, '730 - RIS. CONT. (CREDITO)');
      prem = oldAmount(t, 'PREMIO DI RISULTATO S');
      premOther = oldAmount(t, 'PREMIO');
      const p = [...t.matchAll(/MESE E ANNO.{0,160}?([A-Z]) ([A-Z]) ([A-Z]) \. (2) (0) (\d) (\d)/g)].pop();
      if (p) { mo = MESE_BREVE_NUM[(p[1] + p[2] + p[3]).toLowerCase()]; y = Number(p[4] + p[5] + p[6] + p[7]); }
    } else {
      amount = num(t.match(/(\d{1,3}(?:\.\d{3})*,\d{2}) ?€/)?.[1]);
      const rs = [...t.matchAll(/Rimborso spese ([\d.]+,\d{2})/g)].map((m) => num(m[1]));
      refund = rs.length ? rs.reduce((a, b) => a + b, 0) : undefined;
      meal = num(t.match(/Ticket Restaurant[^(]{0,60}\( ([\d.]+,\d{2}) \)/)?.[1]);
      const r7 = [...t.matchAll(/Rimborsi da 730 \d{4} ([\d.]+,\d{2})/g)].map((m) => num(m[1]));
      r730 = r7.length ? r7.reduce((a, b) => a + b, 0) : undefined;
      const pr = [...t.matchAll(/Premio di risultato ([\d.]+,\d{2})/g)].map((m) => num(m[1]));
      prem = pr.length ? pr.reduce((a, b) => a + b, 0) : undefined;
      const po = [...t.matchAll(/\d{6} Premio (?:ad personam )?([\d.]+,\d{2})/g)].map((m) => num(m[1]));
      premOther = po.length ? po.reduce((a, b) => a + b, 0) : undefined;
      const p = t.match(/convenzionale : \d{2}-\d{2}-\d{4} (Gennaio|Febbraio|Marzo|Aprile|Maggio|Giugno|Luglio|Agosto|Settembre|Ottobre|Novembre|Dicembre) (\d{4})/);
      if (p) { mo = MESE_NUM[p[1].toLowerCase()]; y = Number(p[2]); }
    }
    if (amount === undefined || !Number.isFinite(amount) || !y || !mo) return null; // lettere, variazioni retributive
    const next = mo === 12 ? [y + 1, 1] : [y, mo + 1];
    const pR = prem && Number.isFinite(prem) && prem > 0 ? prem : 0, pO = premOther && Number.isFinite(premOther) && premOther > 0 ? premOther : 0;
    const bonus = pR + pO > 0 ? bonusNet(pR, pO, y) : undefined;
    return {
      supply: tredicesima ? 'tredicesima' : 'stipendio', amount,
      dueDate: tredicesima ? `${y}-12-20` : `${next[0]}-${pad(next[1])}-10`,
      periodFrom: `${y}-${pad(mo)}-01`, periodTo: `${y}-${pad(mo)}-${lastDay(String(y), pad(mo))}`,
      refundExpenses: refund && Number.isFinite(refund) && refund > 0 ? Math.round(refund * 100) / 100 : undefined,
      mealVouchers: meal && Number.isFinite(meal) && meal > 0 ? meal : undefined,
      refund730: r730 && Number.isFinite(r730) && r730 > 0 && r730 < amount ? Math.round(r730 * 100) / 100 : undefined,
      bonus: bonus && bonus < amount ? bonus : undefined, bonusGross: bonus && bonus < amount ? Math.round((pR + pO) * 100) / 100 : undefined
    };
  }
};

export const TEMPLATES: DocTemplate[] = [octopus, heraTcp, sky, conse];
/** Da aumentare a ogni modifica dei modelli: i documenti non riconosciuti vengono riletti. */
export const TEMPLATES_VERSION = 7;
export const templateById = (id?: string) => TEMPLATES.find((t) => t.id === id);
export const detectTemplate = (text: string) => TEMPLATES.find((t) => t.detect(text));
/** Fornitura del documento, se va registrata a parte (es. tredicesima). */
export const separateSupply = (tplId: string | undefined, supply: string | undefined) =>
  supply ? (templateById(tplId) ?? TEMPLATES.find((t) => t.supplies.some((s) => s.id === supply)))?.supplies.find((s) => s.id === supply && s.separate) : undefined;
