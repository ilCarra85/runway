import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, FileUp, Repeat, History, Loader2, Undo2 } from 'lucide-react';
import type { Category, Kind, Split } from '../types';
import { useStore } from '../data/store';
import { Badge } from '../components/Icon';
import { Segmented, Toggle, groupCategories } from '../components/ui';
import { pdfItems, pdfLines } from '../import/pdf';
import { isUnicreditEc, parseUnicreditEc } from '../import/unicreditEc';
import { isUnicreditCc, parseUnicreditCc } from '../import/unicreditCc';
import { isUnicredit, parseUnicredit, type BankRow, type Statement } from '../import/unicredit';
import { readXlsx } from '../import/xlsx';
import { isSatispay, parseSatispay } from '../import/satispay';
import { analyze, type Item, type Plan } from '../import/analyze';
import { buildCommit, emptyDecisions, groupKey, heldRows, isLater, itemChoice, lastImport, recView, undoImport, type Decisions, type RecChoice } from '../import/commit';
import { confirmDialog } from '../components/Dialog';
import { cadenceLabel } from '../lib/recurrence';
import { formatDate } from '../lib/dates';
import { money, uid } from '../lib/format';
import { alive, fitsKind } from '../lib/stats';

type Filter = 'rivedere' | 'tutti' | 'presenti';
const PAGE = 40;
const stamp = (t: number) => new Date(t).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Import({ onDone }: { onDone: () => void }) {
  const { state, upsertMany, replace } = useStore();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [files, setFiles] = useState<{ name: string; from?: string; to?: string; rows: number }[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [d, setD] = useState<Decisions>(emptyDecisions);
  const [filter, setFilter] = useState<Filter>('rivedere');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [result, setResult] = useState<ReturnType<typeof buildCommit>['stats'] | null>(null);

  const cats = useMemo(() => new Map(state.categories.map((c) => [c.id, c])), [state.categories]);
  const last = useMemo(() => lastImport(state), [state]);
  const history = useMemo(() => (state.imports ?? []).filter((x) => !x.deleted).sort((a, b) => b.at - a.at || a.name.localeCompare(b.name)), [state.imports]);
  const [allHistory, setAllHistory] = useState(false);
  // metodo di pagamento dei movimenti del file: si ricorda l'ultimo scelto per ogni tipo di file
  const [fmt, setFmt] = useState('');
  const [methodId, setMethodId] = useState<string>();
  const pickMethod = (id?: string) => { setMethodId(id); try { if (id) localStorage.setItem('runway.method.' + fmt, id); else localStorage.removeItem('runway.method.' + fmt); } catch { /* */ } };
  const upd = (fn: (x: Decisions) => void) => setD((cur) => {
    const n: Decisions = {
      groupCat: new Map(cur.groupCat), groupSplit: new Map(cur.groupSplit), rowCat: new Map(cur.rowCat), rowDesc: new Map(cur.rowDesc),
      skip: new Set(cur.skip), recChoice: new Map(cur.recChoice), recEdit: new Map(cur.recEdit), later: new Set(cur.later)
    };
    fn(n);
    return n;
  });

  const load = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(''); setPlan(null); setResult(null);
    const rows: BankRow[] = [];
    const info: typeof files = [];
    let holder = '', from = '', to = '';
    const fmts = new Set<string>();
    try {
      for (const f of Array.from(list)) {
        setBusy(`Leggo ${f.name}…`);
        let st: Statement;
        if (/\.xlsx$/i.test(f.name)) {
          const cells = await readXlsx(await f.arrayBuffer());
          if (!isSatispay(cells)) throw new Error(`"${f.name}" non sembra un export di Satispay.`);
          const acc = state.accounts.find((a) => a.id === 'satispay' && !a.deleted) ?? state.accounts.find((a) => /satispay/i.test(a.name) && !a.deleted);
          st = parseSatispay(cells, acc?.id ?? 'satispay');
          fmts.add('satispay');
        } else {
          const data = await f.arrayBuffer();
          const lines = await pdfLines(data.slice(0));
          if (isUnicredit(lines)) { st = parseUnicredit(lines); fmts.add('uc-lista'); }
          else {
            // estratto conto periodico: i movimenti sono nelle prime pagine
            const items = await pdfItems(data.slice(0), 4);
            if (isUnicreditCc(items)) {
              // carta di credito: i movimenti vanno nel conto della carta
              const acc = state.accounts.find((a) => a.id === 'carta-credito' && !a.deleted)
                ?? state.accounts.find((a) => a.kind === 'carta' && /credito/i.test(a.name) && !a.deleted);
              st = parseUnicreditCc(items, acc?.id ?? 'carta-credito');
              fmts.add('uc-carta');
            } else if (isUnicreditEc(items)) { st = parseUnicreditEc(items); fmts.add('uc-ec'); }
            else throw new Error(`"${f.name}" non sembra una lista movimenti, un estratto conto o un estratto della carta di credito Unicredit, né un export Satispay.`);
          }
        }
        const sum = st.rows.reduce((s, r) => s + r.amount, 0);
        if (st.opening !== undefined && st.closing !== undefined && Math.abs(st.opening + sum - st.closing) > 0.01)
          throw new Error(`"${f.name}": i movimenti letti non tornano con i saldi (${money(st.opening + sum)} invece di ${money(st.closing)}). Avvisami: il formato potrebbe essere cambiato.`);
        rows.push(...st.rows);
        info.push({ name: f.name, from: st.from, to: st.to, rows: st.rows.length });
        // più intestatari (conto cointestato): tutti, separati da ";"
        holder = [...new Set([...holder.split(';'), ...st.holder.split(';')].map((h) => h.trim()).filter(Boolean))].join(';');
        if (st.from && (!from || st.from < from)) from = st.from;
        if (st.to && (!to || st.to > to)) to = st.to;
      }
      setBusy('Confronto con i tuoi dati…');
      const p = analyze(rows, state, holder, { from, to });
      const f = [...fmts].sort().join('+');
      let saved: string | undefined;
      try { saved = localStorage.getItem('runway.method.' + f) ?? undefined; } catch { /* */ }
      setFmt(f); setMethodId(saved && state.methods?.some((x) => x.id === saved && !x.deleted) ? saved : undefined);
      setFiles(info); setD(emptyDecisions()); setPlan(p); setShown(PAGE); setOpen(new Set());
      setFilter(p.items.some((i) => i.status === 'nuovo' && i.reason === 'nessuna') ? 'rivedere' : 'tutti');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy('');
    }
  };

  // gli addebiti delle ricorrenze proposte restano nella loro card, salvo "importa come movimenti singoli"
  const inRecCard = useMemo(() => {
    const s = new Set<string>();
    if (plan) for (const r of plan.recs) if (d.recChoice.get(r.id) !== 'singoli') for (const it of r.items) s.add(it.row.bankId);
    return s;
  }, [plan, d.recChoice]);

  const groups = useMemo(() => {
    if (!plan) return [];
    const m = new Map<string, Item[]>();
    for (const it of plan.items) {
      if (it.status !== 'nuovo' || inRecCard.has(it.row.bankId)) continue;
      const g = groupKey(it);
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(it);
    }
    return [...m.entries()].map(([g, items]) => {
      const categoryId = d.groupCat.get(g) ?? items[0].categoryId;
      // addebiti di una ricorrenza proposta importati come "Movimenti singoli": da rivedere (categoria da confermare)
      const fromRec = items.some((i) => i.recId && d.recChoice.get(i.recId) === 'singoli');
      // "da rivedere" in base alla proposta iniziale: il gruppo resta in elenco anche dopo la scelta
      return { g, items: items.sort((a, b) => b.row.date.localeCompare(a.row.date)), categoryId, fromRec,
        review: fromRec || /^altro-/.test(items[0].categoryId), decided: d.groupCat.has(g),
        later: items.every((i) => d.later.has(i.row.bankId)) };
    }).sort((a, b) => Number(b.fromRec) - Number(a.fromRec) || b.items.length - a.items.length || a.items[0].name.localeCompare(b.items[0].name));
  }, [plan, inRecCard, d.groupCat, d.later, d.recChoice]);

  if (result) {
    return (
      <div className="page">
        <section className="card center-card">
          <CheckCircle2 size={40} className="pos" />
          <h3>Import completato</h3>
          <p>{result.created} movimenti creati{result.updated ? `, ${result.updated} già presenti aggiornati` : ''}.
            {result.recurrences ? ` ${result.recurrences} ricorrenze create o aggiornate.` : ''}
            {result.rules ? ` ${result.rules} regole memorizzate per i prossimi import.` : ''}</p>
          <div className="row-btns">
            <button className="btn" onClick={() => { setResult(null); setPlan(null); setFiles([]); }}>Importa un altro file</button>
            <button className="btn primary" onClick={onDone}>Vai ai movimenti</button>
          </div>
        </section>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="page">
        <section className="card">
          <h3 className="card-title"><FileUp size={18} /> Importa estratto conto</h3>
          <p className="muted">Carica i PDF "Lista movimenti" o "Estratto conto" di Unicredit, gli estratti della carta di credito Unicredit (vanno nel conto Carta di credito), o gli Excel "Esporta report" di Satispay (vanno nel conto Satispay). Il file viene letto
            solo su questo dispositivo: non viene inviato a nessuno.</p>
          <ul className="muted small bullets">
            <li>i movimenti già presenti vengono riconosciuti e non duplicati (anche se reimporti lo stesso file);</li>
            <li>quelli nati da una ricorrenza vengono corretti con importo e data reali;</li>
            <li>le spese che si ripetono regolarmente vengono proposte come ricorrenze;</li>
            <li>per il resto viene proposta una categoria, che puoi confermare per gruppi di esercente.</li>
          </ul>
          <label className={`btn primary file-btn ${busy ? 'disabled' : ''}`}>
            {busy ? <><Loader2 size={18} className="spin" /> {busy}</> : <><FileUp size={18} /> Scegli i file</>}
            <input type="file" accept="application/pdf,.pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple disabled={!!busy} onChange={(e) => { load(e.target.files); e.target.value = ''; }} />
          </label>
          {error && <div className="error-msg">{error}</div>}
        </section>
        {last && (
          <section className="card">
            <h3 className="card-title"><Undo2 size={18} /> Ultimo import</h3>
            <p className="muted small">Del {stamp(last.at)}:
              {' '}{last.movements} movimenti creati{last.recurrences ? ` e ${last.recurrences} ricorrenze` : ''}.
              Annullandolo vengono eliminati e potrai reimportare gli stessi file.</p>
            <button className="btn ghost danger" onClick={async () => {
              if (!await confirmDialog(`Annullare l'ultimo import? Vengono eliminati ${last.movements} movimenti${last.recurrences ? ` e ${last.recurrences} ricorrenze` : ''} su tutti i dispositivi.`, { ok: 'Annulla import', cancel: 'Indietro', danger: true })) return;
              replace({ ...state, ...undoImport(state, last.at) });
            }}>Annulla l'ultimo import</button>
          </section>
        )}
        {history.length > 0 && (
          <section className="card">
            <h3 className="card-title"><History size={18} /> File importati</h3>
            <div className="imp-list">
              {(allHistory ? history : history.slice(0, 10)).map((x) => (
                <div key={x.id} className={`imp-row ${x.undone ? 'off' : ''}`}>
                  <span className="imp-text">{x.name}
                    <small>{x.from && x.to ? `Dal ${formatDate(x.from)} al ${formatDate(x.to)} · ` : ''}{x.rows} movimenti letti
                      {' · '}importato il {stamp(x.at)}{x.undone ? ' · annullato' : ''}</small>
                  </span>
                </div>
              ))}
            </div>
            {history.length > 10 && (
              <button className="btn small ghost" onClick={() => setAllHistory(!allHistory)}>
                {allHistory ? 'Mostra solo gli ultimi 10' : `Mostra tutti (altri ${history.length - 10})`}
              </button>
            )}
          </section>
        )}
      </div>
    );
  }

  const items = plan.items;
  const present = items.filter((i) => i.status !== 'nuovo');
  const held = heldRows(plan, d);
  const toCreate = items.filter((i) => i.status === 'nuovo' && !d.skip.has(i.row.bankId) && !held.has(i.row.bankId)).length;
  const toUpdate = items.filter((i) => i.status === 'presente' && !d.skip.has(i.row.bankId)).length;
  const recCount = plan.recs.filter((r) => d.recChoice.get(r.id) === 'crea').length;
  const recPending = plan.recs.filter((r) => !d.recChoice.has(r.id)).length;
  const reviewGroups = groups.filter((g) => g.review);
  // in sospeso ("Decidi dopo") conta come deciso
  const undecided = reviewGroups.filter((g) => !g.decided && !g.later);
  const laterCount = items.filter((i) => i.status === 'nuovo' && !d.skip.has(i.row.bankId) && !held.has(i.row.bankId) && isLater(i, d)).length;
  const list = filter === 'rivedere' ? reviewGroups : groups;

  const commit = async () => {
    // conferma esplicita: un tocco involontario (es. alla riaccensione dello schermo) non deve importare tutto
    if (!await confirmDialog(`Importare ${toCreate} movimenti${laterCount ? ` (${laterCount} da confermare dopo in Home)` : ''}${recCount ? ` e ${recCount} ricorrenze` : ''}?`, { ok: 'Importa', cancel: 'Non ancora' })) return;
    const res = buildCommit(plan, d, state, methodId);
    if (res.recurrences.length) upsertMany('recurrences', res.recurrences);
    if (res.movements.length) upsertMany('movements', res.movements);
    if (res.rules.length) upsertMany('rules', res.rules);
    // cronologia: un record per file
    upsertMany('imports', files.map((f) => ({ id: uid(), name: f.name, from: f.from, to: f.to, rows: f.rows, at: res.at, updatedAt: res.at })));
    setResult(res.stats);
    window.scrollTo(0, 0);
  };

  const toggleOpen = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="page imp">
      <section className="card">
        <h3 className="card-title"><FileUp size={18} /> {files.length === 1 ? files[0].name : `${files.length} file`}</h3>
        <p className="muted small">Dal {formatDate(plan.from)} al {formatDate(plan.to)} · {items.length} movimenti letti, saldi verificati</p>
        <div className="imp-stats">
          <span><strong>{toCreate}</strong> da importare</span>
          <span><strong>{present.filter((i) => i.status === 'presente').length}</strong> già presenti</span>
          {present.some((i) => i.status === 'importato') && <span><strong>{present.filter((i) => i.status === 'importato').length}</strong> già importati</span>}
          {laterCount > 0 && <span><strong>{laterCount}</strong> da confermare dopo</span>}
          <span className={undecided.length ? 'warn' : ''}><strong>{undecided.reduce((s, g) => s + g.items.length, 0)}</strong> da rivedere</span>
        </div>
        <label className="imp-method">
          <span className="muted small">Metodo di pagamento di questi movimenti</span>
          <select value={methodId ?? ''} onChange={(e) => pickMethod(e.target.value || undefined)}>
            <option value="">Non impostato</option>
            {(state.methods ?? []).filter((x) => !x.deleted).sort((a, b) => a.order - b.order).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      </section>

      {plan.recs.length > 0 && (
        <section className="card">
          <h3 className="card-title"><Repeat size={18} /> Ricorrenze trovate ({plan.recs.length})</h3>
          <p className="muted small">Decidi tu per ognuna: <strong>Crea</strong> la ricorrenza (o aggiorna una esistente) con i suoi addebiti,
            importa gli addebiti come <strong>movimenti singoli</strong>, oppure <strong>escludili</strong> del tutto
            (per esempio se li registrerà il monitoraggio di una cartella Drive).
            {recPending > 0 && <> Ne restano da decidere <strong>{recPending}</strong>.</>}</p>
          <div className="imp-recs">
            {plan.recs.map((p0) => {
              const p = recView(p0, d);
              const c = cats.get(p.categoryId);
              const k = 'r:' + p.id;
              const others = alive(state.recurrences).filter((r) => r.kind === p.kind);
              const edit = (e: Partial<{ name: string; categoryId: string; linkTo: string | null; confirm: boolean }>) =>
                upd((x) => x.recEdit.set(p.id, { ...x.recEdit.get(p.id), ...e }));
              return (
                <div key={p.id} className={`imp-rec ${p.choice === 'escludi' ? 'off' : ''} ${p.choice ? '' : 'pending'}`}>
                  <div className="imp-rec-head">
                    <Badge icon={c?.icon ?? 'Repeat'} color={c?.color ?? '#64748b'} size={34} />
                    <input className="imp-name" value={p.name} onChange={(e) => edit({ name: e.target.value })} disabled={!p.accepted} />
                    <strong className={p.kind === 'entrata' ? 'pos' : ''}>{money(p.amount)}</strong>
                  </div>
                  <p className="imp-rec-desc">
                    {cadenceLabel({ every: p.every, unit: p.unit, endMode: 'mai' })} · dal {formatDate(p.start)}
                    {p.endMode === 'mai' ? ' · senza fine' : ` al ${formatDate(p.until!)}`} · {p.items.length} addebiti
                    {p.confirm ? ' · importo variabile' : ''}
                  </p>
                  <Segmented<RecChoice> className="small rec-choice" value={(p.choice ?? '') as RecChoice}
                    onChange={(v) => upd((x) => x.recChoice.set(p.id, v))} options={[
                      { value: 'crea', label: p.linkTo ? 'Aggiorna' : 'Crea' },
                      { value: 'singoli', label: 'Movimenti singoli' },
                      { value: 'dopo', label: 'Decidi dopo' },
                      { value: 'escludi', label: 'Escludi' }
                    ]} />
                  {p.choice === 'escludi' && <p className="muted small">Questi {p.items.length} addebiti non verranno importati.</p>}
                  {p.choice === 'dopo' && <p className="muted small">Questi {p.items.length} addebiti vengono importati come movimenti da confermare: li ritrovi in Home, in «Movimenti da confermare».</p>}
                  {p.choice === 'singoli' && <p className="muted small">Gli addebiti compaiono qui sotto in «Movimenti», in cima a «Da rivedere»: lì puoi cambiare la categoria prima di importarli.</p>}
                  {p.accepted && <>
                    <div className="imp-controls">
                      <CategorySelect kind={p.kind} value={p.categoryId} categories={state.categories} onChange={(v) => edit({ categoryId: v })} />
                      <SplitSelect cat={c} value={d.groupSplit.get(groupKey(p)) ?? p.items[0].split}
                        onChange={(s) => upd((x) => { if (s) x.groupSplit.set(groupKey(p), s); else x.groupSplit.delete(groupKey(p)); })} />
                      <select value={p.linkTo ?? ''} onChange={(e) => edit({ linkTo: e.target.value || null })} aria-label="Collega a una ricorrenza esistente">
                        <option value="">Nuova ricorrenza</option>
                        {others.map((r) => <option key={r.id} value={r.id}>Aggiorna «{r.name}»</option>)}
                      </select>
                    </div>
                    <Toggle checked={p.confirm} onChange={(v) => edit({ confirm: v })} label="Chiedi conferma prima di registrare"
                      hint={p.confirm ? 'Importo variabile: dopo questo estratto le scadenze andranno registrate a mano con l\'importo reale' : 'Importo fisso: le prossime occorrenze si registrano da sole'} />
                  </>}
                  <button className="link-btn" onClick={() => toggleOpen(k)}>
                    {open.has(k) ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Addebiti
                  </button>
                  {open.has(k) && <RowList items={p.items} d={d} upd={upd} />}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="card">
        <h3 className="card-title">Movimenti</h3>
        <Segmented<Filter> value={filter} onChange={(f) => { setFilter(f); setShown(PAGE); }} className="small" options={[
          { value: 'rivedere', label: `Da rivedere (${undecided.length})` },
          { value: 'tutti', label: `Tutti (${groups.length})` },
          { value: 'presenti', label: `Già presenti (${present.length})` }
        ]} />

        {filter === 'presenti' ? (
          present.length === 0 ? <p className="muted small">Nessun movimento di questo estratto è già nell'app.</p> : (
            <div className="imp-list">
              {present.map((it) => (
                <div key={it.row.bankId} className="imp-row">
                  <span className="imp-date">{formatDate(it.row.date)}</span>
                  <span className="imp-text">{it.name}<small>{it.status === 'importato' ? 'Già importato in precedenza'
                    : it.fixMatch ? `Da ricorrenza: ${money(it.match!.amount)} del ${formatDate(it.match!.date)} → corretto con i dati della banca` : 'Già inserito a mano'}</small></span>
                  <strong className={it.kind === 'entrata' ? 'pos' : ''}>{it.kind === 'entrata' ? '+' : '−'}{money(it.amount)}</strong>
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            {filter === 'rivedere' && <p className="muted small">Gruppi senza una categoria precisa. Scegline una: vale per tutto il gruppo e
              viene ricordata per i prossimi import. Quelli già classificati li trovi in "Tutti".</p>}
            {filter === 'rivedere' && undecided.length > 0 && (
              <button className="btn small ghost" onClick={() => upd((x) => { for (const g of undecided) for (const i of g.items) x.later.add(i.row.bankId); })}>
                Decidi dopo per tutti quelli ancora da rivedere
              </button>
            )}
            {list.length === 0 && <p className="muted small">Niente da rivedere.</p>}
            <div className="imp-groups">
              {list.slice(0, shown).map(({ g, items: its, categoryId, decided, fromRec }) => {
                const c = cats.get(categoryId);
                const kind = its[0].kind;
                const included = its.filter((i) => !d.skip.has(i.row.bankId));
                const total = included.reduce((s, i) => s + i.amount, 0);
                const later = its.every((i) => d.later.has(i.row.bankId));
                const k = 'g:' + g;
                return (
                  <div key={g} className={`imp-group ${included.length ? '' : 'off'}`}>
                    <div className="imp-rec-head">
                      <input type="checkbox" checked={included.length > 0} aria-label="Importa questo gruppo"
                        onChange={(e) => upd((x) => { for (const i of its) { if (e.target.checked) x.skip.delete(i.row.bankId); else x.skip.add(i.row.bankId); } })} />
                      <Badge icon={c?.icon ?? 'CircleHelp'} color={c?.color ?? '#64748b'} size={34} />
                      <button className="imp-gname" onClick={() => toggleOpen(k)}>
                        <span>{decided && <CheckCircle2 size={14} className="pos" />} {its[0].name}</span>
                        <small>{its.length} {its.length === 1 ? 'movimento' : 'movimenti'} · {fromRec ? 'dalla ricorrenza proposta' : its[0].row.type.toLowerCase()}</small>
                      </button>
                      <strong className={kind === 'entrata' ? 'pos' : ''}>{money(total)}</strong>
                    </div>
                    <div className="imp-controls">
                      <CategorySelect kind={kind} value={categoryId} categories={state.categories}
                        onChange={(v) => upd((x) => { x.groupCat.set(g, v); for (const i of its) x.rowCat.delete(i.row.bankId); })} />
                      <SplitSelect cat={c} value={d.groupSplit.get(g) ?? its[0].split}
                        onChange={(s) => upd((x) => { if (s) x.groupSplit.set(g, s); else x.groupSplit.delete(g); })} />
                    </div>
                    {included.length > 0 && (
                      <Toggle checked={later} onChange={(v) => upd((x) => { for (const i of its) { if (v) x.later.add(i.row.bankId); else x.later.delete(i.row.bankId); } })}
                        label="Decidi dopo" hint={later ? 'Importati come movimenti da confermare: li registri da Home' : undefined} />
                    )}
                    <button className="link-btn" onClick={() => toggleOpen(k)}>
                      {open.has(k) ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Dettaglio
                    </button>
                    {open.has(k) && <RowList items={its} d={d} upd={upd} editable />}
                  </div>
                );
              })}
            </div>
            {list.length > shown && <button className="btn small ghost show-all" onClick={() => setShown(shown + PAGE)}>Mostra altri {Math.min(PAGE, list.length - shown)} gruppi su {list.length - shown}</button>}
          </>
        )}
      </section>

      <div className="imp-footer">
        <button className="btn ghost" onClick={() => { setPlan(null); setFiles([]); }}>Annulla</button>
        <button className="btn primary grow" onClick={commit} disabled={recPending > 0 || (!toCreate && !toUpdate)}>
          {recPending > 0
            ? <span className="btn-2l">Decidi prima le ricorrenze<small>{recPending} da decidere</small></span>
            : <span className="btn-2l">Importa {toCreate} movimenti{recCount ? <small>e {recCount} ricorrenze</small> : null}</span>}
        </button>
      </div>
    </div>
  );
}

function RowList({ items, d, upd, editable }: { items: Item[]; d: Decisions; upd: (fn: (x: Decisions) => void) => void; editable?: boolean }) {
  const { state } = useStore();
  return (
    <div className="imp-list">
      {items.map((it) => {
        const skip = d.skip.has(it.row.bankId);
        return (
          <div key={it.row.bankId} className={`imp-row ${skip ? 'off' : ''}`}>
            <input type="checkbox" checked={!skip} aria-label="Importa"
              onChange={(e) => upd((x) => { if (e.target.checked) x.skip.delete(it.row.bankId); else x.skip.add(it.row.bankId); })} />
            <span className="imp-date">{formatDate(it.row.date)}</span>
            <span className="imp-text">
              {editable && !skip
                ? <input className="imp-desc" value={d.rowDesc.get(it.row.bankId) ?? it.name} aria-label="Descrizione"
                    onChange={(e) => { const v = e.target.value; upd((x) => x.rowDesc.set(it.row.bankId, v)); }} />
                : (d.rowDesc.get(it.row.bankId) || it.name)}
              {it.row.purpose && <small>{it.row.purpose}</small>}
              {editable && !skip && (
                <CategorySelect small kind={it.kind} value={itemChoice(it, d).categoryId} categories={state.categories}
                  onChange={(v) => upd((x) => x.rowCat.set(it.row.bankId, v))} />
              )}
            </span>
            <strong className={it.kind === 'entrata' ? 'pos' : ''}>{it.kind === 'entrata' ? '+' : '−'}{money(it.amount)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function CategorySelect({ kind, value, categories, onChange, small }: {
  kind: Kind; value: string; categories: Category[]; onChange: (id: string) => void; small?: boolean;
}) {
  const groups = groupCategories(categories.filter((c) => !c.deleted && fitsKind(c, kind)));
  return (
    <select className={small ? 'small' : ''} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Categoria">
      {groups.map(([g, cs]) => (
        <optgroup key={g} label={g}>
          {cs.map((c) => <option key={c.id} value={c.id}>{c.name}{c.excluded ? ' (esclusa dalle statistiche)' : ''}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function SplitSelect({ cat, value, onChange }: { cat?: Category; value?: Split; onChange: (s?: Split) => void }) {
  const catLabel = !cat ? 'della categoria' : cat.split.mode === 'pct' ? (cat.split.value === 100 ? 'tutta mia' : `${cat.split.value}%`) : money(cat.split.value);
  const v = !value ? 'cat' : value.mode === 'pct' && value.value === 100 ? 'mine' : value.mode === 'pct' && value.value === 50 ? 'half' : 'cat';
  return (
    <select value={v} aria-label="Ripartizione" onChange={(e) => {
      const x = e.target.value;
      onChange(x === 'mine' ? { mode: 'pct', value: 100 } : x === 'half' ? { mode: 'pct', value: 50 } : undefined);
    }}>
      <option value="cat">Quota: come la categoria ({catLabel})</option>
      <option value="mine">Quota: tutta mia</option>
      <option value="half">Quota: 50 / 50</option>
    </select>
  );
}
