import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../data/store';
import { alive, fitsKind } from '../lib/stats';
import { uid } from '../lib/format';
import { estimateAmount } from '../lib/recurrence';
import type { Movement } from '../types';
import { AuthError, hasValidToken } from '../sync/google';
import { confirmMovement, scanRecurrence, type DocRefund, type Proposal } from './scan';

interface Inbox {
  proposals: Proposal[];
  busy: string;
  error: string;
  lastScan?: number;
  /** Ricorrenze con una cartella collegata. */
  monitored: number;
  scan(): Promise<void>;
  confirm(p: Proposal, amount: number, date?: string, choice?: DocChoice): void;
  /** choiceFor: scelte fatte su ogni voce (rimborso, uscite rimborsate, buoni pasto). */
  confirmAll(list: Proposal[], choiceFor?: (p: Proposal) => DocChoice | undefined): void;
  ignore(p: Proposal): void;
}

/** Scelte dell'utente su un documento da confermare. */
export interface DocChoice {
  /** Rimborso dell'uscita (assente = quello della ricorrenza). */
  refund?: DocRefund;
  /** Entrata (busta paga): uscite "da rimborsare" che rimborsa. */
  links?: string[];
  /** Entrata (busta paga): buoni pasto da registrare nel conto Buoni pasto. */
  meal?: number; // salvato sullo stipendio, nessun movimento
  /** Entrata (busta paga): rimborso 730 da togliere dal netto e registrare a parte. */
  r730?: number;
  /** Entrata (busta paga): premio di risultato da togliere dal netto e registrare a parte. */
  bonus?: number;
}

const Ctx = createContext<Inbox | null>(null);

export function DocInboxProvider({ children }: { children: ReactNode }) {
  const { state, upsertMany, sync } = useStore();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [lastScan, setLastScan] = useState<number>();
  const stateRef = useRef(state);
  stateRef.current = state;
  const running = useRef(false);
  const monitored = alive(state.recurrences).filter((r) => r.driveFolderId).length;

  const scan = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setError('');
    try {
      const recs = alive(stateRef.current.recurrences).filter((r) => r.driveFolderId);
      const all: Proposal[] = [];
      for (const r of recs) {
        setBusy(`Controllo ${r.driveFolderName ?? r.name}…`);
        all.push(...await scanRecurrence(r, stateRef.current, setBusy));
      }
      // un documento non riconosciuto in una cartella condivisa da più ricorrenze si propone una volta sola
      const seen = new Set<string>();
      setProposals(all.filter((p) => p.parsed || (seen.has(p.file.id) ? false : (seen.add(p.file.id), true))));
      setLastScan(Date.now());
    } catch (e: any) {
      setError(e instanceof AuthError ? 'Accedi a Google per controllare le cartelle' : e?.message || String(e));
    } finally {
      setBusy('');
      running.current = false;
    }
  }, []);

  // controllo automatico: una volta per sessione, appena l'accesso Google è valido
  const autoDone = useRef(false);
  useEffect(() => {
    if (autoDone.current || !monitored || !hasValidToken()) return;
    autoDone.current = true;
    scan();
  }, [monitored, sync.status, scan]);

  const drop = (ids: string[]) => setProposals((ps) => ps.filter((p) => !ids.includes(p.file.id + p.recId)));
  const recOf = (p: Proposal) => stateRef.current.recurrences.find((r) => r.id === p.recId);
  // movimento del documento + uscite rimborsate collegate + buoni pasto
  const build = (p: Proposal, amount: number, date: string | undefined, c: DocChoice | undefined): Movement[] => {
    const rec = recOf(p);
    if (!rec) return [];
    const st = stateRef.current;
    const m = confirmMovement(p, amount, rec, st, date, c?.refund);
    const out: Movement[] = [m];
    const now = Date.now();
    if (c?.r730 && c.r730 > 0 && c.r730 < m.amount) {
      // lo stipendio resta senza il 730 (così la media è quella vera); il 730 è un'entrata a sé
      m.amount = Math.round((m.amount - c.r730) * 100) / 100;
      const cat730 = st.categories.find((x) => x.id === '730' && !x.deleted) ?? st.categories.find((x) => fitsKind(x, 'entrata') && /730/.test(x.name) && !x.deleted);
      out.push({
        id: uid(), kind: 'entrata', amount: c.r730, categoryId: cat730?.id ?? rec.categoryId, accountId: m.accountId,
        date: m.date, description: 'Rimborso 730', split: { mode: 'pct', value: 100 }, refund: 'none', planned: false,
        notes: `Da ${p.file.name}`, createdAt: now, updatedAt: now
      });
    }
    if (c?.bonus && c.bonus > 0 && c.bonus < m.amount) {
      // come il 730: il premio non sfasa la media dello stipendio
      m.amount = Math.round((m.amount - c.bonus) * 100) / 100;
      const catB = st.categories.find((x) => x.id === 'bonus' && !x.deleted) ?? st.categories.find((x) => fitsKind(x, 'entrata') && /premi/i.test(x.name) && !x.deleted);
      out.push({
        id: uid(), kind: 'entrata', amount: c.bonus, categoryId: catB?.id ?? rec.categoryId, accountId: m.accountId,
        date: m.date, description: 'Premio di risultato', split: { mode: 'pct', value: 100 }, refund: 'none', planned: false,
        notes: `Da ${p.file.name}`, createdAt: now, updatedAt: now
      });
    }
    for (const id of c?.links ?? []) {
      const u = st.movements.find((x) => x.id === id && !x.deleted && x.refund === 'pending');
      if (u) out.push({ ...u, refund: 'reimbursed', refundIncomeId: m.id, updatedAt: now });
    }
    // buoni pasto: non diventano un movimento; si contano quando li usi (controllo dei buoni in Home)
    if (c?.meal && c.meal > 0) m.mealVouchers = c.meal;
    return out;
  };

  // ricorrenze con importo stimato: la stima si aggiorna con i nuovi documenti confermati
  const reestimate = (ms: Movement[]) => {
    const st = stateRef.current;
    const ids = new Set(ms.map((m) => m.recurrenceId).filter(Boolean));
    const all = [...st.movements.filter((m) => !ms.some((x) => x.id === m.id)), ...ms];
    const recs = st.recurrences.filter((r) => ids.has(r.id) && r.amountAuto && !r.deleted)
      .map((r) => ({ ...r, amount: estimateAmount(r.id, all, r.categoryId) || r.amount, updatedAt: Date.now() }));
    if (recs.length) upsertMany('recurrences', recs);
  };

  const value: Inbox = {
    proposals, busy, error, lastScan, monitored, scan,
    confirm(p, amount, date, choice) {
      const ms = build(p, amount, date, choice);
      if (ms.length) { upsertMany('movements', ms); reestimate(ms); }
      drop([p.file.id + p.recId]);
    },
    confirmAll(list, choiceFor) {
      // solo i documenti riconosciuti: quelli senza importo letto vanno confermati uno per uno
      const ok = list.filter((p) => p.parsed);
      const ms = ok.flatMap((p) => build(p, p.parsed!.amount, undefined, choiceFor?.(p)));
      if (ms.length) { upsertMany('movements', ms); reestimate(ms); }
      drop(ok.map((p) => p.file.id + p.recId));
    },
    ignore(p) {
      const rec = recOf(p);
      if (!rec) return;
      // scartato per tutte le ricorrenze che leggono la stessa cartella
      const same = stateRef.current.recurrences.filter((r) => !r.deleted && r.driveFolderId && r.driveFolderId === rec.driveFolderId);
      upsertMany('recurrences', (same.length ? same : [rec]).map((r) => ({ ...r, docIgnored: [...new Set([...(r.docIgnored ?? []), p.file.id])] })));
      drop([p.file.id + p.recId]);
    }
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDocInbox(): Inbox {
  const v = useContext(Ctx);
  if (!v) throw new Error('DocInboxProvider mancante');
  return v;
}
