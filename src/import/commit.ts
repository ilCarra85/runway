// Trasforma il piano di import + le scelte dell'utente in modifiche ai dati.

import type { AppState, Movement, Recurrence, Rule, Split } from '../types';
import type { Item, Plan, RecProposal } from './analyze';
import { nearestOccurrence } from './analyze';
import { isOccurrence, occurrencesBetween, recRefund } from '../lib/recurrence';
import { alive } from '../lib/stats';
import { minISO } from '../lib/dates';
import { uid } from '../lib/format';

export interface Decisions {
  /** Categoria scelta per un gruppo (chiave "kind|esercente"). */
  groupCat: Map<string, string>;
  /** Ripartizione scelta per un gruppo (assente = quella della categoria). */
  groupSplit: Map<string, Split>;
  /** Categoria scelta per una singola riga. */
  rowCat: Map<string, string>;
  /** Descrizione scritta dall'utente per una singola riga. */
  rowDesc: Map<string, string>;
  /** Righe da non importare. */
  skip: Set<string>;
  /**
   * Scelta per ogni ricorrenza proposta (assente = da decidere, i suoi addebiti non vengono importati):
   * crea = nuova ricorrenza o aggiorna esistente; singoli = addebiti come movimenti normali;
   * escludi = non importare (es. li registrerà il monitoraggio di una cartella Drive).
   */
  recChoice: Map<string, RecChoice>;
  recEdit: Map<string, { name?: string; categoryId?: string; linkTo?: string | null; confirm?: boolean }>;
  /** Righe "Decidi dopo": importate come movimenti da confermare in Home. */
  later: Set<string>;
}

/** dopo = gli addebiti diventano movimenti singoli da confermare in Home. */
export type RecChoice = 'crea' | 'singoli' | 'dopo' | 'escludi';

export const emptyDecisions = (): Decisions => ({
  groupCat: new Map(), groupSplit: new Map(), rowCat: new Map(), rowDesc: new Map(), skip: new Set(), recChoice: new Map(), recEdit: new Map(),
  later: new Set()
});

/** La riga va importata come "da confermare"? (scelta sul gruppo o sulla ricorrenza proposta) */
export function isLater(it: Item, d: Decisions): boolean {
  return d.later.has(it.row.bankId) || (!!it.recId && d.recChoice.get(it.recId) === 'dopo');
}

export const groupKey = (it: Pick<Item, 'kind' | 'key'>) => `${it.kind}|${it.key}`;

/** Proposta con le modifiche dell'utente applicate. */
export function recView(p: RecProposal, d: Decisions) {
  const e = d.recEdit.get(p.id) ?? {};
  return {
    ...p,
    name: e.name ?? p.name,
    categoryId: e.categoryId ?? p.categoryId,
    confirm: e.confirm ?? p.confirm,
    linkTo: e.linkTo === undefined ? p.linkTo : e.linkTo ?? undefined,
    choice: d.recChoice.get(p.id),
    accepted: d.recChoice.get(p.id) === 'crea'
  };
}

/** Categoria e ripartizione finali di una riga (fuori dalle ricorrenze accettate). */
export function itemChoice(it: Item, d: Decisions) {
  const g = groupKey(it);
  return {
    categoryId: d.rowCat.get(it.row.bankId) ?? d.groupCat.get(g) ?? it.categoryId,
    split: d.groupSplit.get(g) ?? it.split
  };
}

/** Righe delle ricorrenze proposte escluse o non ancora decise: non vengono importate. */
export function heldRows(plan: Plan, d: Decisions): Set<string> {
  const s = new Set<string>();
  for (const r of plan.recs) {
    const c = d.recChoice.get(r.id);
    if (c === 'crea' || c === 'singoli' || c === 'dopo') continue;
    for (const it of r.items) s.add(it.row.bankId);
  }
  return s;
}

export interface CommitResult {
  movements: Movement[];
  recurrences: Recurrence[];
  rules: Rule[];
  stats: { created: number; updated: number; recurrences: number; rules: number };
  /** Istante dell'import (createdAt dei movimenti creati). */
  at: number;
}

/** Ultimo import registrato: i movimenti creati hanno tutti lo stesso createdAt (l'istante della conferma). */
export interface LastImport { at: number; movements: number; recurrences: number }

// tolleranza tra l'istante dell'import e il salvataggio (updatedAt viene riscritto dallo store)
const NEAR = 5000;
const near = (t: number, at: number) => Math.abs(t - at) < NEAR;

export function lastImport(state: AppState): LastImport | undefined {
  const created = alive(state.movements).filter((m) => m.importId);
  if (!created.length) return undefined;
  const at = created.reduce((t, m) => Math.max(t, m.createdAt), 0);
  const mine = new Set(created.filter((m) => m.createdAt === at).map((m) => m.id));
  if (!mine.size) return undefined;
  return { at, movements: mine.size, recurrences: undoRecurrences(state, at, mine).length };
}

/** Ricorrenze dell'import da eliminare: salvate in quell'istante e usate solo dai movimenti creati dall'import. */
function undoRecurrences(state: AppState, at: number, mine: Set<string>) {
  return alive(state.recurrences).filter((r) => near(r.updatedAt, at) &&
    !alive(state.movements).some((m) => m.recurrenceId === r.id && !mine.has(m.id)));
}

/**
 * Annulla l'ultimo import: elimina i movimenti creati (senza impronta, così il file si può reimportare), le ricorrenze
 * nate dall'import e le regole imparate; i movimenti già presenti perdono l'impronta e quelli tolti tornano.
 * Importo e data corretti dalla banca sui movimenti già presenti restano.
 */
export function undoImport(state: AppState, at: number): Pick<AppState, 'movements' | 'recurrences' | 'rules' | 'imports'> {
  const now = Date.now();
  // anche quelli già saltati da Home: perdono l'impronta, così il file si reimporta per intero
  const mine = new Set(state.movements.filter((m) => m.importId && m.createdAt === at).map((m) => m.id));
  const recs = new Set(undoRecurrences(state, at, mine).map((r) => r.id));
  return {
    movements: state.movements.map((m) => {
      if (mine.has(m.id)) return { ...m, deleted: true, importId: undefined, updatedAt: now };
      if (!near(m.updatedAt, at)) return m;
      if (!m.deleted && m.importId) return { ...m, importId: undefined, updatedAt: now };
      // generati da una ricorrenza e tolti dall'import (date vecchie): tornano
      if (m.deleted && !m.importId && m.recurrenceId && !recs.has(m.recurrenceId)) return { ...m, deleted: false, updatedAt: now };
      return m;
    }),
    recurrences: state.recurrences.map((r) => (recs.has(r.id) ? { ...r, deleted: true, updatedAt: now } : r)),
    rules: (state.rules ?? []).map((r) => (!r.deleted && near(r.updatedAt, at) ? { ...r, deleted: true, updatedAt: now } : r)),
    // nella cronologia i file restano, segnati come annullati
    imports: (state.imports ?? []).map((x) => (x.at === at && !x.undone ? { ...x, undone: true, updatedAt: now } : x))
  };
}

export function buildCommit(plan: Plan, d: Decisions, state: AppState): CommitResult {
  const now = Date.now();
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  const account = state.accounts.find((a) => a.id === 'conto' && !a.deleted)?.id
    ?? state.accounts.find((a) => a.kind === 'banca' && !a.deleted)?.id ?? state.accounts[0]?.id ?? 'conto';
  const movements = new Map<string, Movement>();
  const recurrences: Recurrence[] = [];
  const splitOf = (catId: string, s?: Split): Split => s ?? cats.get(catId)?.split ?? { mode: 'pct', value: 100 };
  let created = 0, updated = 0;

  const newMovement = (it: Item, categoryId: string, split: Split, extra: Partial<Movement> = {}): Movement => ({
    id: uid(), kind: it.kind, amount: it.amount, categoryId, accountId: it.row.accountId ?? account, date: it.row.date,
    description: d.rowDesc.get(it.row.bankId)?.trim() || it.name, notes: it.row.purpose, split, refund: 'none', planned: false,
    importId: it.row.bankId, createdAt: now, updatedAt: now, ...extra
  });

  // 1) già presenti: si collega l'impronta; se vengono da una ricorrenza si correggono importo e data
  for (const it of plan.items) {
    if (it.status !== 'presente' || !it.match || d.skip.has(it.row.bankId)) continue;
    const m: Movement = { ...it.match, importId: it.row.bankId };
    if (it.fixMatch) { m.amount = it.amount; m.date = it.row.date; }
    movements.set(m.id, m);
    updated++;
  }

  // 2) ricorrenze accettate (quelle escluse o non ancora decise: i loro addebiti non vengono importati)
  const held = heldRows(plan, d);
  const inRec = new Set<string>();
  for (const p0 of plan.recs) {
    const p = recView(p0, d);
    if (!p.accepted) continue;
    const rowsIn = p.items.filter((it) => !d.skip.has(it.row.bankId));
    if (!rowsIn.length) continue;
    const split = splitOf(p.categoryId, d.groupSplit.get(groupKey(p)) ?? rowsIn[0].split);
    const base = p.linkTo ? state.recurrences.find((r) => r.id === p.linkTo) : undefined;
    const rec: Recurrence = {
      ...(base ?? { id: uid(), skipped: [], accountId: rowsIn[0].row.accountId ?? account }),
      name: base?.name ?? p.name, kind: p.kind, amount: p.amount, categoryId: p.categoryId, split: base?.split ?? split,
      every: p.every, unit: p.unit, start: p.start, endMode: p.endMode, until: p.until, count: undefined,
      active: true, toVerify: false, confirm: p.confirm || undefined, updatedAt: now
    } as Recurrence;

    // movimenti già esistenti di questa ricorrenza (es. generati in automatico)
    const covered = new Set<string>();
    if (base) {
      for (const m of alive(state.movements)) {
        if (m.recurrenceId !== base.id) continue;
        const cur = movements.get(m.id) ?? m;
        const occ = nearestOccurrence(rec, cur.date);
        if (occ && !covered.has(occ) && (cur.importId || isOccurrence(rec, cur.occurrence ?? ''))) {
          covered.add(occ);
          if (occ !== cur.occurrence) movements.set(m.id, { ...cur, occurrence: occ });
        } else if (!cur.importId) {
          // generato con le vecchie date e non abbinato: tolto (potrà essere ricreato)
          movements.set(m.id, { ...cur, deleted: true, occurrence: undefined });
        }
      }
    }
    for (const it of rowsIn) {
      inRec.add(it.row.bankId);
      const occ = nearestOccurrence(rec, it.row.date);
      const useOcc = occ && !covered.has(occ) ? occ : undefined;
      if (useOcc) covered.add(useOcc);
      const m = newMovement(it, p.categoryId, rec.split, { recurrenceId: rec.id, occurrence: useOcc, description: d.rowDesc.get(it.row.bankId)?.trim() || rec.name, ...recRefund(rec) });
      movements.set(m.id, m);
      created++;
    }
    // occorrenze nel periodo dell'estratto senza movimento: saltate (la banca non le ha addebitate)
    const end = minISO(plan.to, rec.until ?? plan.to);
    const skipped = new Set(rec.skipped ?? []);
    for (const occ of occurrencesBetween({ ...rec, skipped: [] }, rec.start, end)) if (!covered.has(occ)) skipped.add(occ);
    rec.skipped = [...skipped].sort();
    recurrences.push(rec);
  }

  // 3) movimenti singoli
  for (const it of plan.items) {
    if (it.status !== 'nuovo' || inRec.has(it.row.bankId) || held.has(it.row.bankId) || d.skip.has(it.row.bankId)) continue;
    const c = itemChoice(it, d);
    const m = newMovement(it, c.categoryId, splitOf(c.categoryId, c.split), isLater(it, d) ? { toConfirm: true } : {});
    movements.set(m.id, m);
    created++;
  }

  // 4) regole apprese: esercente → categoria (non per le categorie generiche "Altro")
  const rules: Rule[] = [];
  const existing = new Map(alive(state.rules ?? []).map((r) => [`${r.kind}|${r.key}`, r]));
  const learned = new Map<string, { key: string; kind: Item['kind']; categoryId: string; split?: Split }>();
  for (const it of plan.items) {
    // le righe lasciate in sospeso non insegnano niente: la categoria non è ancora decisa
    if (it.status !== 'nuovo' || d.skip.has(it.row.bankId) || held.has(it.row.bankId) || isLater(it, d)) continue;
    const g = groupKey(it);
    const rp = it.recId ? plan.recs.find((r) => r.id === it.recId) : undefined;
    const rv = rp ? recView(rp, d) : undefined;
    const categoryId = rv?.accepted ? rv.categoryId : d.groupCat.get(g) ?? it.categoryId;
    if (/^altro-/.test(categoryId)) continue;
    learned.set(g, { key: it.key, kind: it.kind, categoryId, split: d.groupSplit.get(g) });
  }
  for (const [g, l] of learned) {
    const ex = existing.get(g);
    if (ex && ex.categoryId === l.categoryId && JSON.stringify(ex.split) === JSON.stringify(l.split)) continue;
    rules.push({ id: ex?.id ?? uid(), key: l.key, kind: l.kind, categoryId: l.categoryId, split: l.split, updatedAt: now });
  }

  return { at: now, movements: [...movements.values()], recurrences, rules, stats: { created, updated, recurrences: recurrences.length, rules: rules.length } };
}
