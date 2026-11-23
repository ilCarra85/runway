// Controllo delle cartelle Drive monitorate: trova i PDF nuovi, li legge con il modello del fornitore
// e prepara le proposte di registrazione da confermare.

import type { AppState, Movement, Recurrence } from '../types';
import { listFolderPdfs, downloadFile, type DriveFile } from '../sync/drive';
import { pdfLines, lineText } from '../import/pdf';
import { detectTemplate, separateSupply, templateById, TEMPLATES_VERSION, type ParsedDoc } from './templates';
import { cadenceDays, nearestOccurrence } from '../import/analyze';
import { occurrencesBetween, recRefund } from '../lib/recurrence';
import { idbGet, idbSet } from '../data/idb';
import { alive } from '../lib/stats';
import { addDays, daysBetween, todayISO } from '../lib/dates';
import { uid } from '../lib/format';

/** Risultato della lettura di un file, salvato sul dispositivo per non riscaricarlo. */
interface CacheEntry { mod: string; tpl?: string; parsed: ParsedDoc | null; ver?: number; locked?: boolean }
type Cache = Record<string, CacheEntry>;
const CACHE_KEY = 'doccache';

export interface Proposal {
  recId: string;
  file: DriveFile;
  /** Dati letti dal modello; null = documento non riconosciuto (scansione, sollecito…): importo da inserire a mano. */
  parsed: ParsedDoc | null;
  /** Data del movimento: scadenza del pagamento, altrimenti data della fattura. */
  date: string;
  occurrence?: string;
  /** Movimento già esistente da completare (generato dalla ricorrenza o importato dalla banca). */
  match?: Movement;
  /** File protetto da password (o PDF illeggibile): proposto senza dati, l'importo va inserito a mano. */
  locked?: boolean;
}

/** File già gestiti: collegati a un movimento (anche eliminato) o scartati dall'utente. */
function handledFiles(state: AppState, rec: Recurrence): Set<string> {
  const s = new Set(rec.docIgnored ?? []);
  for (const m of state.movements) if (m.docFileId) s.add(m.docFileId);
  return s;
}

export async function scanRecurrence(rec: Recurrence, state: AppState, onProgress?: (msg: string) => void): Promise<Proposal[]> {
  if (!rec.driveFolderId) return [];
  const cache: Cache = (await idbGet<Cache>(CACHE_KEY)) ?? {};
  const files = await listFolderPdfs(rec.driveFolderId);
  const handled = handledFiles(state, rec);
  const todo = files.filter((f) => !handled.has(f.id));
  let dirty = false;
  const found: { file: DriveFile; parsed: ParsedDoc | null; locked?: boolean }[] = [];
  for (let i = 0; i < todo.length; i++) {
    const f = todo[i];
    let c = cache[f.id];
    // riletto se il file è cambiato, o se non era stato riconosciuto e i modelli sono cambiati
    if (!c || c.mod !== f.modifiedTime || c.ver !== TEMPLATES_VERSION) {
      onProgress?.(`${rec.name}: leggo ${f.name} (${i + 1}/${todo.length})`);
      let text: string | undefined;
      try {
        text = (await pdfLines(await downloadFile(f.id), 6)).map(lineText).join(' ').replace(/\s+/g, ' ');
      } catch (e: any) {
        // protetto da password o rovinato: si propone lo stesso; gli errori di rete invece fermano il controllo
        if (e?.name !== 'PasswordException' && e?.name !== 'InvalidPDFException') throw e;
      }
      if (text === undefined) {
        c = { mod: f.modifiedTime, ver: TEMPLATES_VERSION, parsed: null, locked: true };
      } else {
        const tpl = templateById(rec.docTemplate) ?? detectTemplate(text);
        c = { mod: f.modifiedTime, tpl: tpl?.id, ver: TEMPLATES_VERSION, parsed: tpl && (!rec.docTemplate || tpl.detect(text)) ? tpl.parse(text) : null };
      }
      cache[f.id] = c;
      dirty = true;
    }
    // non riconosciuto (scansione, sollecito, contratto…): si propone comunque, l'utente inserisce l'importo o lo scarta
    if (!c.parsed) { found.push({ file: f, parsed: null, locked: c.locked }); continue; }
    if (rec.docTemplate && c.tpl !== rec.docTemplate) continue;
    if (rec.docSupply && c.parsed.supply !== rec.docSupply) continue; // altra fornitura della stessa cartella
    found.push({ file: f, parsed: c.parsed });
  }
  if (dirty) await idbSet(CACHE_KEY, cache);

  // abbinamento ai movimenti esistenti
  const live = alive(state.movements).filter((m) => !m.docFileId);
  const used = new Set<string>();
  // scadenze della ricorrenza già coperte da un movimento: ognuna può avere un solo documento
  const occupied = new Set(alive(state.movements).filter((m) => m.recurrenceId === rec.id && m.occurrence).map((m) => m.occurrence!));
  const cad = cadenceDays(rec.every, rec.unit);
  const out: Proposal[] = [];
  const dateOf = (x: { file: DriveFile; parsed: ParsedDoc | null }) =>
    x.parsed?.dueDate ?? x.parsed?.issueDate ?? dateFromName(x.file.name) ?? x.file.modifiedTime.slice(0, 10);
  // prima i documenti riconosciuti, poi gli altri: un sollecito o una voltura non devono
  // occupare la scadenza della bolletta vera
  const byDate = (a: typeof found[0], b: typeof found[0]) => dateOf(a).localeCompare(dateOf(b));
  const ordered = [...found.filter((x) => x.parsed).sort(byDate), ...found.filter((x) => !x.parsed).sort(byDate)];
  // i documenti di prima dell'inizio della ricorrenza non vengono proposti (es. buste paga vecchie)
  const notBefore = addDays(rec.start, -Math.round(cad * 0.5));
  for (const x of ordered) {
    const { file, parsed, locked } = x;
    const date = dateOf(x);
    if (date < notBefore) continue;
    // es. tredicesima: movimento a parte, non occupa la scadenza mensile
    if (separateSupply(rec.docTemplate, parsed?.supply)) { out.push({ recId: rec.id, file, parsed, date }); continue; }
    // la prima scadenza libera in una finestra intorno alla data (una bolletta pagata in ritardo
    // non "ruba" la scadenza della successiva)
    const occurrence = occurrencesBetween({ ...rec, skipped: [] }, addDays(date, -Math.round(cad * 0.75)), addDays(date, Math.round(cad * 0.6)))
      .find((d) => !occupied.has(d));
    if (occurrence) occupied.add(occurrence);
    const near = (m: Movement, days: number) => Math.abs(daysBetween(m.date, date)) <= days;
    // un documento non riconosciuto non viene abbinato: l'importo non è noto
    const match = !parsed ? undefined :
      live.find((m) => !used.has(m.id) && m.recurrenceId === rec.id && ((occurrence && m.occurrence === occurrence) || near(m, 10))) ??
      live.find((m) => !used.has(m.id) && m.kind === rec.kind && Math.abs(m.amount - parsed.amount) < 0.01 && near(m, 10));
    if (match) used.add(match.id);
    // il movimento abbinato ha già la sua scadenza: quella calcolata torna libera
    if (match?.occurrence && occurrence && occurrence !== match.occurrence) occupied.delete(occurrence);
    out.push({ recId: rec.id, file, parsed, date, occurrence: match?.occurrence ?? occurrence, match, locked });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Movimento da salvare quando l'utente conferma una proposta (con l'importo eventualmente corretto). */
/** Rimborso scelto dall'utente per un documento (in DocReview); assente = quello della ricorrenza. */
export type DocRefund = Pick<Movement, "refund" | "refundAmount">;

export function confirmMovement(p: Proposal, amount: number, rec: Recurrence, state: AppState, dateOverride?: string, refund?: DocRefund): Movement {
  const now = Date.now();
  const doc = {
    docFileId: p.file.id, docName: p.file.name,
    compFrom: p.parsed?.periodFrom, compTo: p.parsed?.periodTo
  };
  const date = dateOverride || p.date;
  // data cambiata a mano: la scadenza della ricorrenza va ricalcolata
  const occ = date === p.date ? p.occurrence : nearestOccurrence(rec, date);
  if (p.match) {
    // movimento della banca: data e importo reali restano; altrimenti si usano quelli della bolletta
    const fromBank = !!p.match.importId;
    return {
      ...p.match, ...(refund ?? (p.match.refund === 'none' ? recRefund(rec) : {})), ...doc,
      amount: fromBank ? p.match.amount : amount,
      date: fromBank ? p.match.date : date,
      recurrenceId: rec.id, occurrence: p.match.occurrence ?? occ, updatedAt: now
    };
  }
  const sep = separateSupply(rec.docTemplate, p.parsed?.supply);
  const sepCat = sep?.categoryId && state.categories.some((c) => c.id === sep.categoryId && !c.deleted) ? sep.categoryId : undefined;
  const taken = !!sep || alive(state.movements).some((m) => m.recurrenceId === rec.id && m.occurrence === occ);
  return {
    id: uid(), kind: rec.kind, amount, categoryId: sepCat ?? rec.categoryId, accountId: rec.accountId, split: rec.split,
    date, description: sep ? `${sep.label} – ${rec.name}` : rec.name, ...(refund ?? recRefund(rec)), planned: false,
    recurrenceId: rec.id, occurrence: taken ? undefined : occ,
    notes: p.parsed?.number ? `Fattura ${p.parsed.number}` : p.parsed ? undefined : `Documento: ${p.file.name}`,
    createdAt: now, updatedAt: now, ...doc
  };
}

export const isFuture = (d: string) => d > todayISO();

/** Data nel nome del file, es. "20250818 - Sollecito.pdf" → 2025-08-18. */
function dateFromName(name: string): string | undefined {
  const m = name.match(/(20\d{2})(\d{2})(\d{2})/);
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}
