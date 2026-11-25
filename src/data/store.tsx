import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppState, Collection, Settings } from '../types';
import { idbGet, idbSet } from './idb';
import { initialState } from './seed';
import * as google from '../sync/google';
import { autoMovements } from '../lib/stats';

type Item<C extends Collection> = AppState[C][number];
export type SyncStatus = 'off' | 'login' | 'idle' | 'syncing' | 'ok' | 'error';

interface Store {
  state: AppState;
  upsert<C extends Collection>(col: C, item: Item<C>): void;
  upsertMany<C extends Collection>(col: C, items: Item<C>[]): void;
  remove(col: Collection, id: string): void;
  patchSettings(p: Partial<Settings>): void;
  replace(s: AppState): void;
  sync: { status: SyncStatus; error?: string; run(interactive?: boolean): Promise<void>; signOut(): void };
}

const Ctx = createContext<Store | null>(null);
const KEY = 'state';

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const ref = useRef<AppState | null>(null);
  ref.current = state;
  const [dirty, setDirty] = useState(0);
  const [status, setStatus] = useState<SyncStatus>(
    !google.isConfigured() ? 'off' : google.hasValidToken() ? 'idle' : 'login'
  );
  const [error, setError] = useState<string>();
  const syncing = useRef(false);

  // Caricamento iniziale
  useEffect(() => {
    idbGet<AppState>(KEY)
      .then((s) => setState(s ? withNewSeedCategories({ ...initialState(), ...s }) : initialState()))
      .catch(() => setState(initialState()));
  }, []);

  // Salvataggio locale (debounce)
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => idbSet(KEY, state).catch(console.error), 250);
    return () => clearTimeout(t);
  }, [state]);

  // Salvataggio immediato quando l'app va in background o viene chiusa (il debounce potrebbe non arrivare)
  useEffect(() => {
    const flush = () => { if (ref.current) idbSet(KEY, ref.current).catch(console.error); };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', flush); };
  }, []);

  const edit = useCallback((fn: (s: AppState) => AppState, markDirty = true) => {
    setState((s) => (s ? fn(s) : s));
    if (markDirty) setDirty((d) => d + 1);
  }, []);

  // Ricorrenze automatiche: registra le occorrenze arrivate a scadenza (all'avvio, dopo ogni modifica o sync)
  useEffect(() => {
    if (!state) return;
    const add = autoMovements(state);
    if (add.length) edit((s) => {
      const byId = new Map(s.movements.map((m) => [m.id, m]));
      for (const m of add) {
        const cur = byId.get(m.id);
        // sostituisce solo i tombstone senza occorrenza (tolti perché fuori dalle date)
        if (!cur || (cur.deleted && !cur.occurrence)) byId.set(m.id, m);
      }
      return { ...s, movements: [...byId.values()] };
    });
  }, [state, edit]);

  const run = useCallback(async (interactive = false) => {
    if (!google.isConfigured() || syncing.current) return;
    try {
      if (!google.hasValidToken()) {
        if (!interactive) { setStatus('login'); return; }
        await google.signIn();
      }
      syncing.current = true;
      setStatus('syncing');
      setError(undefined);
      const cur = ref.current;
      if (!cur) return;
      const { data, spreadsheetId } = await google.syncAll(cur);
      setState((s) => {
        if (!s) return s;
        // Eventuali modifiche fatte durante la sync: vince la più recente
        const merged: any = { ...s, settings: { ...s.settings, spreadsheetId, lastSync: Date.now() } };
        for (const c of Object.keys(data) as Collection[]) {
          const m = new Map((data[c] as any[]).map((x) => [x.id, x]));
          for (const x of s[c] as any[]) {
            const y = m.get(x.id);
            if (!y || x.updatedAt > y.updatedAt) m.set(x.id, x);
          }
          merged[c] = [...m.values()];
        }
        return merged;
      });
      setStatus('ok');
    } catch (e: any) {
      if (e instanceof google.AuthError) setStatus('login');
      else { setStatus('error'); setError(e?.message || String(e)); }
    } finally {
      syncing.current = false;
    }
  }, []);

  // Sync automatica: all'avvio e 3 secondi dopo ogni modifica (se il token Google è valido)
  useEffect(() => {
    if (!state || !google.isConfigured() || !google.hasValidToken()) return;
    const t = setTimeout(() => run(false), dirty === 0 ? 300 : 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, state === null]);

  const store = useMemo<Store | null>(() => {
    if (!state) return null;
    return {
      state,
      upsert: (col, item) => edit((s) => {
        const it = { ...item, updatedAt: Date.now() } as any;
        const list = s[col] as any[];
        const i = list.findIndex((x) => x.id === it.id);
        const next = i >= 0 ? list.map((x, j) => (j === i ? it : x)) : [...list, it];
        return { ...s, [col]: next };
      }),
      upsertMany: (col, items) => edit((s) => {
        const now = Date.now();
        const m = new Map((s[col] as any[]).map((x) => [x.id, x]));
        for (const it of items as any[]) m.set(it.id, { ...it, updatedAt: now });
        return { ...s, [col]: [...m.values()] };
      }),
      remove: (col, id) => edit((s) => ({
        ...s,
        [col]: (s[col] as any[]).map((x) => (x.id === id ? { ...x, deleted: true, updatedAt: Date.now() } : x))
      })),
      patchSettings: (p) => edit((s) => ({ ...s, settings: { ...s.settings, ...p } }), false),
      replace: (n) => edit(() => n),
      sync: {
        status, error, run,
        signOut: () => { google.signOut(); setStatus('login'); }
      }
    };
  }, [state, status, error, edit, run]);

  if (!store) return <div className="splash">Runway</div>;
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider mancante');
  return s;
}

/** Aggiunge ai dati esistenti le categorie e i conti predefiniti introdotti dopo (es. Rifiuti, Buoni welfare), se mancano. */
function withNewSeedCategories(s: AppState): AppState {
  const init = initialState();
  const haveC = new Set(s.categories.map((c) => c.id));
  const haveA = new Set(s.accounts.map((a) => a.id));
  const cats = init.categories.filter((c) => !haveC.has(c.id));
  const accs = init.accounts.filter((a) => !haveA.has(a.id));
  if (!cats.length && !accs.length) return s;
  return { ...s, categories: [...s.categories, ...cats], accounts: [...s.accounts, ...accs] };
}
