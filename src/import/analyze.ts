// Analisi di un estratto conto rispetto ai dati dell'app:
// - abbina i movimenti già presenti (anche quelli generati da una ricorrenza, correggendone importo/data);
// - riconosce le ricorrenze non ancora inserite;
// - propone una categoria per tutto il resto (regole apprese + parole chiave).

import type { AppState, Category, Kind, Movement, Recurrence, Split, Unit } from '../types';
import type { BankRow } from './unicredit';
import { addDays, daysBetween } from '../lib/dates';
import { occurrencesBetween } from '../lib/recurrence';
import { alive, fitsKind } from '../lib/stats';

export type Reason = 'regola' | 'tipo' | 'parola' | 'nessuna';

export interface Item {
  row: BankRow;
  kind: Kind;
  amount: number; // positivo
  /** Chiave dell'esercente per raggruppare e per le regole. */
  key: string;
  /** Nome leggibile dell'esercente. */
  name: string;
  /** Nome letto dal file, quando una regola lo sostituisce con una descrizione scelta dall'utente. */
  origName?: string;
  status: 'nuovo' | 'presente' | 'importato';
  /** Movimento esistente abbinato (status "presente"). */
  match?: Movement;
  /** L'abbinato viene da una ricorrenza: importo/data vengono corretti con quelli della banca. */
  fixMatch?: boolean;
  categoryId: string;
  split?: Split;
  reason: Reason;
  /** Proposta di ricorrenza a cui appartiene. */
  recId?: string;
}

export interface RecProposal {
  id: string;
  key: string;
  kind: Kind;
  name: string;
  categoryId: string;
  amount: number;
  every: number;
  unit: Unit;
  start: string;
  last: string;
  endMode: 'mai' | 'data';
  until?: string;
  confirm: boolean;
  items: Item[];
  /** Ricorrenza esistente simile a cui collegarla (proposta). */
  linkTo?: string;
}

export interface Plan {
  items: Item[];
  recs: RecProposal[];
  from: string;
  to: string;
}

// ---------- Esercente ----------

const STOP = new Set(['SRL', 'S.R.L.', 'SPA', 'S.P.A.', 'SNC', 'SAS', 'SA', 'S.A.', 'SRLS', 'DI', 'DEL', 'E', 'WWW', 'COM', 'IT']);

/** Chiave normalizzata: maiuscolo, niente codici numerici, forme societarie e punteggiatura. */
export function merchantKey(s: string, fallback = true): string {
  const words = s.toUpperCase()
    .replace(/[*'’"`.,/\\:;()\[\]-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/\d/.test(w) && !STOP.has(w));
  return words.slice(0, 4).join(' ') || (fallback ? s.toUpperCase().trim() : '');
}

const MONTHS = /^(GEN|FEB|MAR|APR|MAG|GIU|LUG|AGO|SET|OTT|NOV|DIC)/;

/**
 * Chiave di raggruppamento: esercente; per addebiti SEPA e bonifici anche la causale (senza mesi e numeri),
 * così lo stesso fornitore con due contratti (es. gas e luce) resta distinto.
 */
export function itemKey(row: Pick<BankRow, 'type' | 'counterparty' | 'purpose'>): string {
  const base = merchantKey(row.counterparty);
  if (!row.purpose || !/ADDEBITO SEPA|DISPOSIZIONE DI BONIFICO|BONIFICO A VOSTRO FAVORE/.test(row.type)) return base;
  const p = merchantKey(row.purpose, false).split(' ').filter((w) => w.length > 2 && !MONTHS.test(w) && !base.includes(w)).slice(0, 3).join(' ');
  return p ? `${base} · ${p}` : base;
}

export function prettyName(s: string): string {
  const t = s.replace(/^PAYPAL\s*\*\s*/i, '').replace(/\b[A-Z0-9]*\d[A-Z0-9]*\b/g, '')
    .replace(/\s+/g, ' ').replace(/[\s*.,·-]+$/, '').trim() || s;
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'(/-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}

// ---------- Categoria proposta ----------

const KW: [RegExp, string][] = [
  [/SATISPAY/, 'giroconto-out'],
  [/OCTOPUS.*GAS|GAS METANO|\bGAS\b/, 'gas'],
  [/ENERGIA|LUCE|ENEL|OCTOPUS|EDISON|IREN|SORGENIA/, 'luce'],
  // Hera per l'utente è la Tariffa Corrispettiva Puntuale (rifiuti, ex TARI), non l'acqua
  [/\bHERA\b|TARIFFA CORRISPETTIVA|RIFIUTI|\bTARI\b|IGIENE AMBIENTALE/, 'rifiuti'],
  [/ACQUA|IDRIC/, 'acqua'],
  [/FASTWEB|TIM\b|TELECOM|WIND|VODAFONE|ILIAD|TISCALI|LINKEM|EOLO/, 'internet'],
  [/CONDOMINIO/, 'condominio'],
  [/NETFLIX|DISNEY|PRIME VIDEO|DAZN|NOW TV|SKY/, 'streaming'],
  [/SPOTIFY|APPLE MUSIC|DEEZER/, 'musica'],
  [/AMAZON|AMZN|ZALANDO|IKEA|DECATHLON|ZARA|H&M|OVS|PRIMARK|MEDIAWORLD|UNIEURO|EURONICS/, 'shopping'],
  [/ESSELUNGA|CONAD|\bCOOP\b|LIDL|EUROSPIN|CARREFOUR|\bPAM\b|DESPAR|\bIPER|IPERCOOP|ALDI|PENNY|\bMD\b|SIGMA|CRAI|TIGRE|BENNET|FAMILA|MERCATONE|PANIFIC|FORNO|MACELLER|ALIMENTARI|FRUTTA|PESCHERIA|SUPERMERC|MARKET|AGRIPIU|ORTOFRUTT/, 'alimentari'],
  [/RISTOR|PIZZ|TRATTORIA|OSTERIA|SUSHI|MCDONALD|BURGER|KEBAB|\bBAR\b|CAFF|GELAT|PASTICC|DOLCE|ENOTECA|BIRRER|PUB\b|PIADIN|ROSTICC|TAVOLA|BISTRO|DELIVEROO|GLOVO|JUST EAT/, 'ristoranti'],
  [/\bENI\b|ENILIVE|\bQ8\b|\bIP\b|ESSO|TAMOIL|AGIP|SHELL|\bAPI\b|CARBUR/, 'carburante'],
  [/TRENITALIA|ITALO|AUTOSTRAD|TELEPASS|PARCHEGG|PARKING|TPER|\bATM\b|TAXI|UBER|FREE NOW|\bBUS\b/, 'trasporti'],
  [/FARMACI|PARAFARM|MEDIC|OSPEDAL|DENTIST|OTTIC|SANITAR|POLIAMBUL/, 'salute'],
  [/EASYPARK|MYCICERO/, 'trasporti'],
  [/\bEAT\b/, 'ristoranti'],
  [/PARRUCCH|BARBIER|\w*HAIR\w*|ESTETIC|PROFUMER|SEPHORA|DOUGLAS|ACQUA E SAPONE|TIGOTA/, 'cura-persona'],
  [/LIBRER|MONDADORI|FELTRINELLI|CINEMA|TEATRO|MUSEO|MUSEU|CONCERT|TICKET|GIOCATTOL/, 'tempo-libero'],
  [/HOTEL|BOOKING|AIRBNB|RYANAIR|EASYJET|ALITALIA|ITA AIRWAYS|VOLOTEA|CAMPEGG|CAMPING/, 'viaggi'],
  [/PALESTRA|PISCINA|FITNESS|SPORT/, 'sport'],
  [/SCUOLA|ISTITUTO|ASILO|MENSA/, 'scuola']
];

function suggest(row: BankRow, kind: Kind, key: string, state: AppState, holderWords: string[][], cats: Map<string, Category>):
  { categoryId: string; reason: Reason; split?: Split } {
  // categoria eliminata o non valida per il tipo (es. due "Giroconto" uniti in uno "Entrambe"): si usa quella con lo stesso nome
  const ok = (id: string) => {
    const c = cats.get(id);
    if (!c) return undefined;
    if (!c.deleted && fitsKind(c, kind)) return id;
    const name = c.name.trim().toLowerCase();
    return [...cats.values()].find((x) => !x.deleted && fitsKind(x, kind) && x.name.trim().toLowerCase() === name)?.id;
  };
  const rule = alive(state.rules ?? []).find((r) => r.key === key && r.kind === kind && ok(r.categoryId));
  if (rule) return { categoryId: ok(rule.categoryId)!, reason: 'regola', split: rule.split };

  const t = row.type;
  const hay = `${row.counterparty} ${row.purpose ?? ''}`.toUpperCase();
  // da/verso un intestatario del conto (anche cointestato): movimento tra conti propri
  const toSelf = holderWords.some((ws) => ws.length > 0 && ws.every((w) => hay.includes(w)));
  const pick = (id: string, reason: Reason = 'tipo') => { const v = ok(id); return v ? { categoryId: v, reason } : undefined; };

  let r: { categoryId: string; reason: Reason; split?: Split } | undefined;
  // carta buoni pasto Edenred: buoni spostati da un'altra carta = movimento interno; ricariche = entrata Buoni pasto
  if (/^EDENRED TRASFERIMENTO/.test(t)) r = pick(kind === 'uscita' ? 'giroconto-out' : 'giroconto-in');
  else if (/^EDENRED RICARICA/.test(t)) r = pick('buoni-pasto-in');
  else if (/^SATISPAY /.test(t)) {
    // Satispay: ricariche e salvadanaio sono movimenti interni; il resto passa dalle regole e dalle parole chiave
    if (/BANCA|RISPARMI|INVESTIMENTO/.test(t)) r = pick(kind === 'uscita' ? 'giroconto-out' : 'giroconto-in');
    else if (/PREMIO/.test(t)) r = pick('altro-in');
    if (r || /SATISPAY/.test(hay)) return r ?? { categoryId: ok(kind === 'uscita' ? 'altro-out' : 'altro-in') ?? firstOf(kind, cats), reason: 'nessuna' };
  }
  else if (/EMOLUMENTI/.test(t)) r = pick('stipendio');
  else if (/RATA MUTUO/.test(t)) r = pick('mutuo');
  // bonifico tra conti propri: giroconto anche se parla di mutuo (la rata la conta il conto che la paga)
  else if (toSelf && /BONIFICO/.test(t)) r = pick(kind === 'uscita' ? 'giroconto-out' : 'giroconto-in');
  else if (/MUTUO/.test(hay)) r = pick('mutuo');
  else if (/GIROCONTO/.test(t) || (toSelf && /BONIFICO/.test(t)) || /SATISPAY/.test(hay)) r = pick(kind === 'uscita' ? 'giroconto-out' : 'giroconto-in');
  else if (/RIC\.?PREP/.test(hay)) r = pick(kind === 'uscita' ? 'giroconto-out' : 'giroconto-in');
  // addebito mensile della carta di credito sul conto: le spese sono già nel conto della carta (estratto della carta)
  else if (/CARTE DI CREDITO/.test(t) || /^ESTRATTO \d{2}\/\d{4} CARTA/.test(row.purpose ?? '')) r = pick(kind === 'uscita' ? 'giroconto-out' : 'giroconto-in');
  else if (/INPS|ASSEGNO UNICO/.test(hay) && kind === 'entrata') r = pick('assegno-unico');
  else if (kind === 'entrata' && /RIMBORSO 730|730/.test(hay)) r = pick('730');
  if (!r && kind === 'uscita') {
    for (const [re, id] of KW) if (re.test(hay)) { r = pick(id, 'parola'); if (r) break; }
  }
  return r ?? { categoryId: ok(kind === 'uscita' ? 'altro-out' : 'altro-in') ?? firstOf(kind, cats), reason: 'nessuna' };
}

/** Ultima scelta: una categoria "Altre …" del tipo giusto, altrimenti la prima. */
function firstOf(kind: Kind, cats: Map<string, Category>): string {
  const list = [...cats.values()].filter((c) => !c.deleted && fitsKind(c, kind)).sort((a, b) => a.order - b.order);
  return (list.find((c) => c.kind === kind && /^altr/i.test(c.name)) ?? list.find((c) => /^altr/i.test(c.name)) ?? list[0])?.id ?? '';
}

// ---------- Ricorrenze ----------

const CADENCES: { every: number; unit: Unit; days: number }[] = [
  { every: 1, unit: 'settimane', days: 7 },
  { every: 2, unit: 'settimane', days: 14 },
  { every: 1, unit: 'mesi', days: 30.44 },
  { every: 2, unit: 'mesi', days: 60.88 },
  { every: 3, unit: 'mesi', days: 91.31 },
  { every: 6, unit: 'mesi', days: 182.6 },
  { every: 1, unit: 'anni', days: 365.25 }
];
export const cadenceDays = (every: number, unit: Unit) =>
  unit === 'giorni' ? every : unit === 'settimane' ? every * 7 : unit === 'mesi' ? every * 30.44 : every * 365.25;

/** Tipi di operazione da cui possono nascere ricorrenze (non la spesa al supermercato col bancomat). */
const RECURRING_TYPE = (it: Item) =>
  !/PRELEVAMENTO|COMMISSIONI|INCASSO POS|EDENRED/.test(it.row.type) && (!/PAGAMENTO POS/.test(it.row.type) || it.row.online);

/**
 * Cadenza regolare di una serie di date (ordinate).
 * Settimanali: intervalli tra le date. Da un mese in su: quota di periodi coperti, così una mensilità extra
 * (es. tredicesima) o un addebito saltato non rompono il riconoscimento.
 */
function detectCadence(dates: string[]) {
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  const monthIdx = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
  const m0 = monthIdx(dates[0]);
  for (const c of CADENCES) {
    if (c.unit === 'settimane') {
      const tol = Math.max(2, c.days * 0.2);
      const fit = gaps.filter((g) => Math.abs(g - c.days) <= tol || Math.abs(g - 2 * c.days) <= tol).length;
      const exact = gaps.filter((g) => Math.abs(g - c.days) <= tol).length;
      if (fit / gaps.length >= 0.8 && exact / gaps.length >= 0.6) return c;
      continue;
    }
    const months = c.unit === 'anni' ? 12 * c.every : c.every;
    const buckets = new Set(dates.map((d) => Math.floor((monthIdx(d) - m0) / months)));
    const total = Math.floor((monthIdx(dates[dates.length - 1]) - m0) / months) + 1;
    if (total < 3) continue;
    if (buckets.size / total >= 0.75 && dates.length / buckets.size <= 1.6) return c;
  }
  return undefined;
}

/** Occorrenza della ricorrenza più vicina a una data (entro metà intervallo). */
export function nearestOccurrence(r: Recurrence, date: string): string | undefined {
  const half = Math.max(2, Math.floor(cadenceDays(r.every, r.unit) / 2));
  const occ = occurrencesBetween({ ...r, skipped: [] }, addDays(date, -half), addDays(date, half));
  let best: string | undefined, bd = Infinity;
  for (const d of occ) { const x = Math.abs(daysBetween(d, date)); if (x < bd) { bd = x; best = d; } }
  return best;
}

// ---------- Analisi ----------

export function analyze(rows: BankRow[], state: AppState, holder: string, period: { from: string; to: string }): Plan {
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  // più intestatari separati da ";"
  const holderWords = holder.toUpperCase().split(';').map((h) => h.split(/[\s,]+/).filter((w) => w.length > 2)).filter((ws) => ws.length);

  // doppioni tra file diversi
  const seen = new Set<string>();
  // stesso movimento Unicredit da "Lista movimenti" (uc:) ed "Estratto conto" (uce:): data contabile + importo, contati
  const fmt = (id: string) => (id.startsWith('uc:') ? 'uc' : id.startsWith('uce:') ? 'uce' : '');
  const tail = (id: string) => id.split('|').slice(-2).join('|');
  const counts = new Map<string, number>();
  const bump = (f: string, t: string) => counts.set(f + '>' + t, (counts.get(f + '>' + t) ?? 0) + 1);
  const take = (f: string, t: string) => { const n = counts.get(f + '>' + t) ?? 0; if (n > 0) counts.set(f + '>' + t, n - 1); return n > 0; };
  const other = (f: string) => (f === 'uc' ? 'uce' : 'uc');
  const uniq = rows.filter((r) => {
    if (seen.has(r.bankId)) return false;
    seen.add(r.bankId);
    const f = fmt(r.bankId);
    if (f && take(other(f), tail(r.bankId))) return false;
    if (f) bump(f, tail(r.bankId));
    return true;
  });
  counts.clear();
  for (const m of state.movements) if (m.importId && !m.deleted && fmt(m.importId)) bump(fmt(m.importId), tail(m.importId));
  const dupOfOther = (id: string) => !!fmt(id) && take(other(fmt(id)), tail(id));

  const live = alive(state.movements);
  const imported = new Set(state.movements.filter((m) => m.importId).map((m) => m.importId!));
  const used = new Set<string>();
  const banks = new Set(state.accounts.filter((a) => a.kind === 'banca' && !a.deleted).map((a) => a.id));

  const items: Item[] = uniq.map((row) => {
    const kind: Kind = row.amount < 0 ? 'uscita' : 'entrata';
    const amount = Math.abs(row.amount);
    const key = itemKey(row);
    const s = suggest(row, kind, key, state, holderWords, cats);
    const pretty = prettyName(row.counterparty);
    const ren = alive(state.rules ?? []).find((r) => r.key === key && r.kind === kind && r.description)?.description;
    const it: Item = { row, kind, amount, key, name: ren ?? pretty, origName: ren && ren !== pretty ? pretty : undefined, status: 'nuovo', ...s };
    if (imported.has(row.bankId) || dupOfOther(row.bankId)) { it.status = 'importato'; return it; }

    // un movimento di un altro conto (es. Satispay) non va confuso con uno della banca
    const sameAccount = (m: Movement) => !row.accountId || m.accountId === row.accountId || (banks.has(row.accountId) && banks.has(m.accountId));
    // 1) movimento identico già inserito a mano (stesso importo, data vicina)
    let best: Movement | undefined, bd = Infinity;
    for (const m of live) {
      if (m.importId || used.has(m.id) || m.kind !== kind || m.planned) continue;
      if (!sameAccount(m)) continue;
      if (Math.abs(m.amount - amount) > 0.005) continue;
      const d = Math.min(Math.abs(daysBetween(m.date, row.date)), Math.abs(daysBetween(m.date, row.bookDate)));
      if (d <= 4 && d < bd) { bd = d; best = m; }
    }
    if (best) { used.add(best.id); return { ...it, status: 'presente', match: best }; }

    // 2) movimento generato da una ricorrenza: importo simile, data entro 10 giorni → si corregge
    for (const m of live) {
      if (m.importId || used.has(m.id) || m.kind !== kind || !m.recurrenceId) continue;
      if (!sameAccount(m)) continue;
      const diff = Math.abs(m.amount - amount) / Math.max(m.amount, amount);
      if (diff > 0.25 || (diff > 0.02 && m.categoryId !== it.categoryId)) continue;
      const d = Math.abs(daysBetween(m.date, row.date));
      if (d <= 10 && d < bd) { bd = d; best = m; }
    }
    if (best) { used.add(best.id); return { ...it, status: 'presente', match: best, fixMatch: true, categoryId: best.categoryId }; }
    return it;
  });

  // Ricorrenze: stesso esercente ≥3 volte a intervalli regolari
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    if (it.status !== 'nuovo' || !RECURRING_TYPE(it)) continue;
    const g = `${it.kind}|${it.key}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(it);
  }
  const recs: RecProposal[] = [];
  const recCats = (r: Recurrence) => r.categoryId;
  for (const [g, list] of groups) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.row.date.localeCompare(b.row.date));
    const c = detectCadence(sorted.map((x) => x.row.date));
    if (!c) continue;
    const amounts = sorted.map((x) => x.amount);
    const min = Math.min(...amounts), max = Math.max(...amounts);
    const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const med = median(amounts);
    // bollette e stipendi variano per natura (stagioni, mensilità extra); per il resto importi simili
    const variableByNature = /ADDEBITO SEPA|EMOLUMENTI/.test(sorted[0].row.type);
    const near = amounts.filter((a) => Math.abs(a - med) <= med * 0.5).length;
    if (!variableByNature && near / amounts.length < 0.6) continue;
    const first = sorted[0], last = sorted[sorted.length - 1];
    const variable = max / min > 1.03;
    // importo proposto: l'ultimo se fisso, la mediana degli ultimi 3 se variabile
    const amount = variable ? median(amounts.slice(-3)) : last.amount;
    const stale = daysBetween(last.row.date, period.to) > c.days * 1.5;
    const catCount = new Map<string, number>();
    for (const x of sorted) catCount.set(x.categoryId, (catCount.get(x.categoryId) ?? 0) + 1);
    const categoryId = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (cats.get(categoryId)?.excluded) continue; // giroconti e ricariche: nessuna ricorrenza
    const id = `rp-${g}`;
    // ricorrenza esistente da collegare: stessa categoria e nome in comune,
    // oppure unica ricorrenza di una categoria "specifica" (mutuo, stipendio…) con importo simile
    const words = new Set(merchantKey(`${first.row.counterparty} ${first.row.purpose ?? ''}`).split(' ').filter((w) => w.length > 3));
    const sameCat = alive(state.recurrences).filter((r) => r.kind === first.kind && recCats(r) === categoryId);
    const byName = sameCat.find((r) => merchantKey(r.name).split(' ').some((w) => words.has(w)));
    const generic = /^(altro-|streaming|musica|abbonamenti|sport|tempo-libero|shopping)/.test(categoryId);
    const byAmount = !generic && sameCat.length === 1 &&
      Math.abs(sameCat[0].amount - amount) / Math.max(sameCat[0].amount, amount) <= 0.25 ? sameCat[0] : undefined;
    const linkTo = (byName ?? byAmount)?.id;
    for (const x of sorted) x.recId = id;
    recs.push({
      id, key: first.key, kind: first.kind, name: first.name, categoryId, amount: Math.round(amount * 100) / 100,
      every: c.every, unit: c.unit, start: first.row.date, last: last.row.date,
      endMode: stale ? 'data' : 'mai', until: stale ? last.row.date : undefined,
      confirm: variable, items: sorted, linkTo
    });
  }
  recs.sort((a, b) => b.items.length - a.items.length);
  // stesso nome per più proposte (es. gas e luce dallo stesso fornitore): si aggiunge la categoria
  for (const r of recs) {
    if (recs.filter((x) => x.name === r.name).length > 1) r.name = `${r.name} – ${cats.get(r.categoryId)?.name ?? ''}`;
  }
  return { items, recs, from: period.from, to: period.to };
}
