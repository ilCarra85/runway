import { useMemo, useState } from 'react';
import { Briefcase, FolderSync, ListChecks, Plus, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import type { EndMode, Kind, Movement, Recurrence, Split, Unit } from '../types';
import { useStore } from '../data/store';
import { Badge } from '../components/Icon';
import { confirmDialog } from '../components/Dialog';
import { listFolderPdfs, pickFolder, pickerConfigured } from '../sync/drive';
import { TEMPLATES, templateById } from '../docs/templates';
import { accessToken } from '../sync/google';
import { AccountChips, AmountInput, CategoryGrid, Empty, Field, Segmented, Sheet, SplitBadge, SplitPicker, Toggle } from '../components/ui';
import { cadenceLabel, estimateAmount, isOccurrence, nextOccurrence, timesPerYear } from '../lib/recurrence';
import { formatDate, relativeDays, todayISO } from '../lib/dates';
import { amountToInput, money, money0, parseAmount, uid } from '../lib/format';
import { alive, myShare } from '../lib/stats';

export function Recurrences() {
  const { state, upsert } = useStore();
  const [edit, setEdit] = useState<Recurrence | 'new' | null>(null);
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  const t = todayISO();

  const list = useMemo(() => alive(state.recurrences).sort((a, b) => a.name.localeCompare(b.name)), [state.recurrences]);
  const active = list.filter((r) => r.active);
  const inactive = list.filter((r) => !r.active);
  const monthly = (k: Kind) => active.filter((r) => r.kind === k).reduce((s, r) => s + (myShare(r.amount, r.split) * timesPerYear(r)) / 12, 0);

  const Row = (r: Recurrence) => {
    const c = cats.get(r.categoryId);
    const next = nextOccurrence(r, t);
    return (
      <button key={r.id} className={`row ${r.active ? '' : 'inactive'}`} onClick={() => setEdit(r)}>
        <Badge icon={c?.icon ?? 'Repeat'} color={c?.color ?? '#64748b'} />
        <span className="row-main">
          <span className="row-title">{r.name}</span>
          <span className="row-sub">{cadenceLabel(r)}{r.active && next ? ` · prossima ${formatDate(next)} (${relativeDays(next)})` : ''}{r.docDate ? ' · data dal documento' : ''}</span>
          <span className="row-tags">
            <SplitBadge split={r.split} />
            {r.toVerify && <span className="tag tag-warn"><TriangleAlert size={12} /> Da verificare</span>}
            {r.confirm && <span className="tag"><ListChecks size={12} /> Con conferma</span>}
            {r.driveFolderName && <span className="tag"><FolderSync size={12} /> {r.driveFolderName}</span>}
          </span>
        </span>
        <span className="row-amount">
          <strong className={r.kind === 'entrata' ? 'pos' : ''}>{money(myShare(r.amount, r.split))}</strong>
          <small>≈ {money0((myShare(r.amount, r.split) * timesPerYear(r)) / 12)}/mese</small>
        </span>
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <label className="mini-switch" title={r.active ? 'Attiva' : 'Disattivata'}>
            <input type="checkbox" checked={r.active} onChange={(e) => upsert('recurrences', { ...r, active: e.target.checked, toVerify: e.target.checked ? false : r.toVerify })} />
            <span />
          </label>
        </span>
      </button>
    );
  };

  return (
    <div className="page">
      <div className="totals-strip">
        <div><small>Entrate fisse / mese</small><strong className="pos">{money0(monthly('entrata'))}</strong></div>
        <div><small>Uscite fisse / mese</small><strong>{money0(monthly('uscita'))}</strong></div>
        <div><small>Margine</small><strong className={monthly('entrata') - monthly('uscita') >= 0 ? 'pos' : 'neg'}>{money0(monthly('entrata') - monthly('uscita'))}</strong></div>
      </div>
      <div className="page-actions">
        <button className="btn primary" onClick={() => setEdit('new')}><Plus size={18} /> Nuova ricorrenza</button>
      </div>

      {list.length === 0 && <Empty icon="Repeat" title="Nessuna ricorrenza">Aggiungi stipendio, mutuo, abbonamenti e spese fisse.</Empty>}
      {active.length > 0 && <><h3 className="section-title">Attive</h3><div className="card list">{active.map(Row)}</div></>}
      {inactive.length > 0 && <>
        <h3 className="section-title">Non attive</h3>
        <p className="muted small">Le voci "da verificare" vengono dal tuo vecchio prospetto: controlla l'importo e attivale con l'interruttore.</p>
        <div className="card list">{inactive.map(Row)}</div>
      </>}

      {edit && <RecurrenceForm initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RecurrenceForm({ initial, onClose }: { initial?: Recurrence; onClose: () => void }) {
  const { state, upsert, upsertMany, remove } = useStore();
  const [folder, setFolder] = useState<{ id: string; name: string } | null>(
    initial?.driveFolderId ? { id: initial.driveFolderId, name: initial.driveFolderName ?? 'Cartella' } : null);
  const [docTemplate, setDocTemplate] = useState(initial?.docTemplate ?? '');
  const [docSupply, setDocSupply] = useState(initial?.docSupply ?? '');
  const [skipped, setSkipped] = useState<string[]>(initial?.skipped ?? []);

  // Occorrenze saltate (da Home) o il cui movimento è stato eliminato: si possono ripristinare
  const removed = useMemo(() => {
    if (!initial) return [];
    const live = new Set<string>();
    const dead = new Map<string, Movement>();
    for (const m of state.movements) {
      if (m.recurrenceId !== initial.id || !m.occurrence) continue;
      if (m.deleted) dead.set(m.occurrence, m); else live.add(m.occurrence);
    }
    const out: { date: string; how: 'saltata' | 'eliminata'; movement?: Movement }[] = [];
    const cur = state.recurrences.find((r) => r.id === initial.id) ?? initial;
    for (const [d, m] of dead) if (!live.has(d) && isOccurrence(cur, d)) out.push({ date: d, how: 'eliminata', movement: m });
    for (const d of skipped) if (!live.has(d) && !dead.has(d) && isOccurrence(cur, d)) out.push({ date: d, how: 'saltata' });
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [state.movements, state.recurrences, skipped, initial]);

  const restore = (it: (typeof removed)[number]) => {
    if (!initial) return;
    const nextSkipped = skipped.filter((d) => d !== it.date);
    if (nextSkipped.length !== skipped.length) {
      setSkipped(nextSkipped);
      const cur = state.recurrences.find((r) => r.id === initial.id) ?? initial;
      upsert('recurrences', { ...cur, skipped: nextSkipped });
    }
    if (it.movement) upsert('movements', { ...it.movement, deleted: false });
  };
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'uscita');
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(initial?.amountAuto ? '' : amountToInput(initial?.amount));
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [accountId, setAccountId] = useState(initial?.accountId ?? 'conto');
  const [split, setSplit] = useState<Split>(initial?.split ?? { mode: 'pct', value: 100 });
  const [every, setEvery] = useState(String(initial?.every ?? 1));
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? 'mesi');
  // vuota (solo con cartella monitorata) = data presa dal documento
  const [start, setStart] = useState(initial?.docDate ? '' : initial?.start ?? '');
  const [endMode, setEndMode] = useState<EndMode>(initial?.endMode ?? 'mai');
  const [count, setCount] = useState(String(initial?.count ?? 12));
  const [until, setUntil] = useState(initial?.until ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [confirmFirst, setConfirmFirst] = useState(initial?.confirm ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [refundable, setRefundable] = useState(initial?.refundable ?? false);
  const [refundAmt, setRefundAmt] = useState(amountToInput(initial?.refundAmount));
  const [refundIn, setRefundIn] = useState(initial?.refundIn ?? false);
  const [error, setError] = useState('');
  const value = parseAmount(amount);
  const refundValue = parseAmount(refundAmt);
  const refundAmount = refundAmt.trim() && Number.isFinite(refundValue) && refundValue >= 0 ? refundValue : undefined;

  const draft = { every: Math.max(1, Number(every) || 1), unit, endMode, count: Number(count) || 0, until };

  const deleteRecurrence = async () => {
    if (!initial) return;
    if (!await confirmDialog(`Eliminare la ricorrenza "${initial.name}"?`, { ok: 'Elimina', danger: true })) return;
    const linked = state.movements.filter((m) => !m.deleted && m.recurrenceId === initial.id);
    if (linked.length) {
      const n = linked.length;
      const total = linked.reduce((s, m) => s + m.amount, 0);
      const alsoMovements = await confirmDialog(
        `${n === 1 ? 'C\'è 1 movimento già registrato' : `Ci sono ${n} movimenti già registrati`} da questa ricorrenza (${money(total)}). Vuoi eliminare anche ${n === 1 ? 'quello' : 'quelli'}?`,
        { ok: n === 1 ? 'Elimina anche il movimento' : 'Elimina anche i movimenti', cancel: 'Mantienili', danger: true });
      if (alsoMovements) {
        // documenti liberati (una nuova ricorrenza sulla stessa cartella li ripropone) e
        // uscite rimborsate da questi movimenti di nuovo "da rimborsare"
        // rimborso 730 e premio registrati a parte dalla stessa busta (nota "Da <file>")
        const docNotes = new Set(linked.filter((m) => m.docName).map((m) => `Da ${m.docName}`));
        const extra = state.movements.filter((m) => !m.deleted && !m.recurrenceId && m.notes && docNotes.has(m.notes));
        linked.push(...extra);
        const ids = new Set(linked.map((m) => m.id));
        const freed = state.movements.filter((m) => !m.deleted && !ids.has(m.id) && m.refundIncomeId && ids.has(m.refundIncomeId))
          .map((m) => ({ ...m, refund: 'pending' as const, refundIncomeId: undefined }));
        upsertMany('movements', [
          ...linked.map((m) => ({ ...m, deleted: true, docFileId: undefined, docName: undefined })),
          ...freed
        ]);
      }
    }
    remove('recurrences', initial.id);
    onClose();
  };

  const save = async () => {
    if (!name.trim()) return setError('Dai un nome alla ricorrenza');
    // con una cartella collegata l'importo è facoltativo: vuoto = stimato dai documenti confermati
    const auto = !!folder && !amount.trim();
    const estimate = auto ? (initial ? estimateAmount(initial.id, state.movements, categoryId) : 0) || initial?.amount || 0 : value;
    if (!auto && (!Number.isFinite(value) || value <= 0)) return setError(folder ? "Inserisci un importo maggiore di zero, oppure lascialo vuoto per stimarlo dai documenti" : "Inserisci un importo maggiore di zero");
    if (!categoryId) return setError('Scegli una categoria');
    if (endMode === 'data' && !until) return setError('Indica la data di fine');
    if (!start && !folder) return setError('Indica la data (si può lasciare vuota solo con una cartella monitorata)');
    // data vuota: la danno i documenti; la partenza di scadenze e previsioni è l'ultimo documento confermato
    const docDate = !start && !!folder;
    const lastDoc = initial ? state.movements.filter((m) => !m.deleted && !m.planned && m.recurrenceId === initial.id)
      .reduce((d, m) => (m.date > d ? m.date : d), '') : '';
    const startValue = docDate ? (initial?.docDate ? initial.start : lastDoc) : start;
    // Voce "da verificare" salvata ancora spenta: probabilmente l'utente vuole attivarla
    let isActive = active;
    if (!active && initial?.toVerify) {
      isActive = await confirmDialog(
        'Questa ricorrenza è ancora disattivata: non crea movimenti e non conta nelle proiezioni. Vuoi attivarla?',
        { ok: 'Attiva', cancel: 'Lascia disattivata' });
      setActive(isActive);
    }
    const rec: Recurrence = {
      id: initial?.id ?? uid(), name: name.trim(), kind, amount: estimate, amountAuto: auto || undefined, categoryId, accountId, split,
      every: draft.every, unit, start: startValue, docDate: docDate || undefined, endMode, count: endMode === 'volte' ? draft.count : undefined,
      until: endMode === 'data' ? until : undefined, active: isActive, toVerify: initial?.toVerify && !isActive ? true : false, confirm: confirmFirst || undefined,
      skipped, driveFolderId: folder?.id, driveFolderName: folder?.name,
      docTemplate: folder ? docTemplate || undefined : undefined,
      docSupply: folder ? (docSupply || defaultSupply(docTemplate, categoryId)) || undefined : undefined,
      docIgnored: initial?.docIgnored,
      refundable: kind === 'uscita' && refundable ? true : undefined,
      refundAmount: kind === 'uscita' && refundable ? refundAmount : undefined,
      refundIn: kind === 'entrata' && refundIn ? true : undefined,
      notes: notes.trim() || undefined, updatedAt: Date.now()
    };
    upsert('recurrences', rec);

    // «Rimborsabile» / «Contiene rimborso» valgono per i movimenti ancora da registrare: quelli registrati restano come sono

    // Movimenti già registrati che non cadono più su una data della ricorrenza (es. dopo la nuova fine)
    const outside = initial && !docDate ? state.movements.filter((m) =>
      !m.deleted && m.recurrenceId === rec.id && m.occurrence && !isOccurrence(rec, m.occurrence)) : [];
    if (outside.length) {
      const n = outside.length;
      const total = outside.reduce((s, m) => s + m.amount, 0);
      const ok = await confirmDialog(
        `${n === 1 ? 'C\'è 1 movimento' : `Ci sono ${n} movimenti`} di questa ricorrenza (${money(total)}) che non ${n === 1 ? 'rientra' : 'rientrano'} più nelle nuove date. ${n === 1 ? 'Eliminarlo' : 'Eliminarli'}?`,
        { ok: 'Elimina', cancel: 'Mantieni', danger: true });
      // occurrence tolta: non contano come "saltati", così se riestendi le date vengono ricreati
      if (ok) upsertMany('movements', outside.map((m) => ({ ...m, deleted: true, occurrence: undefined })));
    }
    onClose();
  };

  return (
    <Sheet title={initial ? 'Modifica ricorrenza' : 'Nuova ricorrenza'} onClose={onClose} footer={<>
      {initial && <button className="btn ghost danger" onClick={deleteRecurrence}><Trash2 size={18} /> Elimina</button>}
      <button className="btn primary grow" onClick={save}>Salva</button>
    </>}>
      <Segmented<Kind> className={`kind-switch ${kind}`} value={kind} onChange={(k) => { setKind(k); setCategoryId(''); }}
        options={[{ value: 'uscita', label: 'Uscita' }, { value: 'entrata', label: 'Entrata' }]} />
      <div className="row-2">
        <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Mutuo" /></Field>
        <Field label={folder ? 'Importo stimato' : 'Importo totale'}
          hint={folder && !amount.trim() ? 'Vuoto: media dei documenti confermati negli ultimi 12 mesi' : undefined}>
          <AmountInput value={amount} onChange={setAmount}
            placeholder={folder ? (initial && estimateAmount(initial.id, state.movements, categoryId) ? 'Stimato ' + amountToInput(estimateAmount(initial.id, state.movements, categoryId)) : 'Dai documenti') : undefined} />
        </Field>
      </div>
      <Field label="Categoria">
        <CategoryGrid categories={state.categories} kind={kind} value={categoryId} onChange={(id) => {
          setCategoryId(id);
          const c = state.categories.find((x) => x.id === id);
          if (c && !initial) setSplit(c.split);
          // il nome segue la categoria finché non lo scrivi tu (vuoto o uguale al nome di una categoria)
          if (c && (!name.trim() || state.categories.some((x) => x.name === name.trim()))) setName(c.name);
        }} />
      </Field>
      <Field label="Ripeti">
        <div className="repeat-row">
          <span>Ogni</span>
          <input className="num" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value.replace(/\D/g, ''))} />
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            <option value="giorni">giorni</option><option value="settimane">settimane</option>
            <option value="mesi">mesi</option><option value="anni">anni</option>
          </select>
        </div>
      </Field>
      <div className="row-2">
        <Field label="Prima volta il" hint={folder ? (start ? 'La data dei movimenti è questa, non quella dei documenti' : 'Vuota: data presa dal documento') : undefined}>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Termina">
          <select value={endMode} onChange={(e) => setEndMode(e.target.value as EndMode)}>
            <option value="mai">Mai</option><option value="volte">Dopo N volte</option><option value="data">In una data</option>
          </select>
        </Field>
      </div>
      {endMode === 'volte' && <Field label="Numero di volte"><input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} /></Field>}
      {endMode === 'data' && <Field label="Fino al"><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>}
      <p className="muted small">{cadenceLabel(draft)}</p>
      <Field label={kind === 'uscita' ? 'Pagato con' : 'Accreditato su'}><AccountChips accounts={state.accounts} value={accountId} onChange={setAccountId} /></Field>
      <Field label="Ripartizione"><SplitPicker split={split} onChange={setSplit} amount={value} kind={kind} /></Field>
      <div className="toggles">
        <Toggle checked={active} onChange={setActive} label="Attiva" hint="Conta nei movimenti, nelle scadenze e nelle proiezioni" />
        <Toggle checked={confirmFirst} onChange={setConfirmFirst} icon={<ListChecks size={20} />} label="Chiedi conferma prima di registrare"
          hint={confirmFirst
            ? "Per importi variabili (bollette, busta paga): ogni volta trovi una scadenza in Home da registrare con l'importo reale"
            : 'Le occorrenze vengono registrate da sole alla loro data, anche quelle passate. Puoi modificarle o eliminarle dai movimenti'} />
        {kind === 'uscita' && (
          <Toggle checked={refundable} onChange={setRefundable} icon={<Briefcase size={20} />} label="Rimborsabile"
            hint="Ogni movimento nasce «da rimborsare»: la parte rimborsata non conta nelle tue spese" />
        )}
        {kind === 'entrata' && (
          <Toggle checked={refundIn} onChange={setRefundIn} icon={<Briefcase size={20} />} label="Contiene rimborso"
            hint="Ogni movimento può rimborsare uscite rimborsabili (es. rimborso spese in busta paga): le scegli sul movimento" />
        )}
        {kind === 'uscita' && refundable && (
          <Field label="Importo rimborsato ogni volta"
            hint={refundAmount !== undefined && Number.isFinite(value)
              ? `${money(Math.max(0, myShare(value, split) - Math.min(refundAmount, value)))} restano a tuo carico ogni volta`
              : "Vuoto = rimborso dell'intero importo. Su un movimento puoi sempre correggerlo"}>
            <div className="refund-amount">
              <AmountInput value={refundAmt} onChange={setRefundAmt} placeholder="Tutto" />
              {refundAmt && <button type="button" className="btn small ghost" onClick={() => setRefundAmt('')}>Tutto</button>}
            </div>
          </Field>
        )}
        <DriveFolderRow folder={folder} onChange={setFolder} />
      </div>
      {folder && (
        <div className="row-2">
          <Field label="Modello di lettura" hint="Come leggere i PDF di questo fornitore">
            <select value={docTemplate} onChange={(e) => setDocTemplate(e.target.value)}>
              <option value="">Riconoscimento automatico</option>
              {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Fornitura" hint="La cartella può contenere più forniture: questa ricorrenza legge solo questa">
            <select value={docSupply || defaultSupply(docTemplate, categoryId)} onChange={(e) => setDocSupply(e.target.value)}>
              <option value="">Tutte le forniture della cartella</option>
              {supplyOptions(docTemplate).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
        </div>
      )}
      {removed.length > 0 && (
        <div className="field">
          <span className="field-label">Occorrenze saltate o eliminate</span>
          <div className="check-list">
            {removed.map((it) => (
              <div key={it.date} className="check-item">
                <Undo2 size={18} className="muted" />
                <span>{formatDate(it.date)}<small>{it.how === 'eliminata' ? `Movimento eliminato · ${money(it.movement!.amount)}` : 'Saltata dalle scadenze'}</small></span>
                <button type="button" className="btn small ghost" onClick={() => restore(it)}>Ripristina</button>
              </div>
            ))}
          </div>
          <span className="field-hint">
            {initial?.confirm ? 'Le occorrenze saltate ripristinate tornano tra le scadenze in Home.' : 'Le occorrenze ripristinate tornano tra i movimenti.'}
          </span>
        </div>
      )}
      <Field label="Note"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {error && <div className="error-msg">{error}</div>}
    </Sheet>
  );
}

/** Cartella Google Drive collegata alla ricorrenza (scelta con il selettore di Google). */
function DriveFolderRow({ folder, onChange }: { folder: { id: string; name: string } | null; onChange: (f: { id: string; name: string } | null) => void }) {
  const { sync } = useStore();
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const [err, setErr] = useState('');

  const check = async (f: { id: string; name: string }) => {
    setInfo('Controllo i file della cartella…'); setErr('');
    try {
      const files = await listFolderPdfs(f.id);
      setInfo(files.length
        ? `${files.length} PDF visibili nella cartella (es. «${files[0].name}»)`
        : 'Nessun PDF visibile nella cartella');
    } catch (e: any) { setInfo(''); setErr(e?.message || String(e)); }
  };

  const choose = async () => {
    setBusy(true); setErr('');
    try {
      if (!accessToken()) await sync.run(true);
      const f = await pickFolder();
      if (f) { onChange(f); await check(f); }
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  if (!pickerConfigured()) {
    return (
      <div className="toggle-row disabled">
        <span className="toggle-icon"><FolderSync size={20} /></span>
        <span className="toggle-text"><strong>Cartella Google Drive monitorata</strong><small>Configura la sincronizzazione Google per usarla</small></span>
      </div>
    );
  }
  return (
    <div className="toggle-row drive-row">
      <span className="toggle-icon"><FolderSync size={20} /></span>
      <span className="toggle-text">
        <strong>Cartella Google Drive monitorata</strong>
        <small>{folder ? `📁 ${folder.name}` : 'Bollette, buste paga… i PDF nuovi vengono letti e proposti da confermare'}</small>
        {info && <small className="pos">{info}</small>}
        {err && <small className="neg">{err}</small>}
      </span>
      <span className="drive-actions">
        <button type="button" className="btn small" onClick={choose} disabled={busy}>{folder ? 'Cambia' : 'Scegli'}</button>
        {folder && <button type="button" className="btn small ghost" onClick={() => check(folder)} disabled={busy}>Verifica</button>}
        {folder && <button type="button" className="btn small ghost danger" onClick={() => { onChange(null); setInfo(''); }} disabled={busy}>Scollega</button>}
      </span>
    </div>
  );
}

/** Forniture selezionabili: quelle del modello scelto, o di tutti i modelli se automatico. */
function supplyOptions(tpl: string) {
  const list = tpl ? (templateById(tpl)?.supplies ?? []) : TEMPLATES.flatMap((t) => t.supplies);
  return list.filter((s, i) => list.findIndex((x) => x.id === s.id) === i);
}
/** Fornitura proposta in base alla categoria della ricorrenza (es. categoria Luce → fornitura luce). */
function defaultSupply(tpl: string, categoryId: string) {
  return supplyOptions(tpl).find((s) => s.categoryId === categoryId)?.id ?? '';
}
