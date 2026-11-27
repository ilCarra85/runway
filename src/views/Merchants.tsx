import { useState } from 'react';
import { ListChecks, Store, Trash2 } from 'lucide-react';
import type { Movement, Rule } from '../types';
import { useStore } from '../data/store';
import { Field, Sheet, Toggle } from '../components/ui';
import { confirmDialog } from '../components/Dialog';
import { alive } from '../lib/stats';

/** Nome dell'ente come letto dall'estratto conto (per le regole vecchie senza nome: la chiave). */
export const merchantName = (r: Rule) => r.name?.trim() || r.key;

/** Movimenti dell'associazione: descrizione uguale a quella dell'associazione e note che iniziano con il nome dell'ente. */
function matching(movements: Movement[], ente: string, description: string) {
  const e = ente.toLowerCase();
  return alive(movements).filter((m) => m.description.trim() === description && (m.notes ?? '').trim().toLowerCase().startsWith(e));
}

/** Altro → Enti e descrizioni: la descrizione data ai movimenti di un ente (impostata registrando un movimento da confermare). */
export function Merchants() {
  const { state, upsert, upsertMany, remove } = useStore();
  const [edit, setEdit] = useState<Rule | null>(null);
  const [desc, setDesc] = useState('');
  const [toConfirm, setToConfirm] = useState(true);
  const [registered, setRegistered] = useState(true);
  const list = alive(state.rules ?? []).filter((r) => r.description)
    .sort((a, b) => a.description!.localeCompare(b.description!, 'it'));

  const open = (r: Rule) => { setEdit(r); setDesc(r.description ?? ''); setToConfirm(true); setRegistered(true); };
  const found = edit ? matching(state.movements, merchantName(edit), edit.description!) : [];
  const nConfirm = found.filter((m) => m.toConfirm).length;
  const nRegistered = found.length - nConfirm;
  const changed = !!edit && !!desc.trim() && desc.trim() !== edit.description;

  const save = () => {
    if (!edit || !desc.trim()) return;
    const d = desc.trim();
    upsert('rules', { ...edit, description: d });
    if (changed) {
      const sel = found.filter((m) => (m.toConfirm ? toConfirm : registered)).map((m) => ({ ...m, description: d }));
      if (sel.length) upsertMany('movements', sel);
    }
    setEdit(null);
  };

  const del = async () => {
    if (!edit) return;
    if (!await confirmDialog(`Togliere l'associazione «${merchantName(edit)}» → «${edit.description}»? I prossimi import useranno di nuovo il nome dell'ente; i movimenti già presenti non cambiano.`, { ok: 'Togli', danger: true })) return;
    // la regola resta se ricorda anche una categoria
    if (edit.categoryId) upsert('rules', { ...edit, description: undefined });
    else remove('rules', edit.id);
    setEdit(null);
  };

  return (
    <div className="page">
      <div className="card list">
        {list.map((r) => (
          <button key={r.id} className="row" onClick={() => open(r)}>
            <span className="badge" style={{ ['--c' as any]: '#64748b' }}><Store size={20} /></span>
            <span className="row-main">
              <span className="row-title">{r.description}</span>
              <span className="row-sub">{merchantName(r)} · {r.kind === 'entrata' ? 'entrate' : 'uscite'}</span>
            </span>
          </button>
        ))}
        {!list.length && <p className="muted small center">Nessuna associazione</p>}
      </div>
      <p className="muted small center">Si crea registrando un movimento da confermare con una descrizione diversa dal nome dell'ente.
        Il nome dell'ente va all'inizio delle note.</p>
      {edit && (
        <Sheet title="Ente e descrizione" onClose={() => setEdit(null)} footer={<>
          <button className="btn ghost danger" onClick={del}><Trash2 size={18} /> Togli</button>
          <button className="btn primary grow" onClick={save} disabled={!desc.trim()}>Salva</button>
        </>}>
          <Field label="Ente (dall'estratto conto)"><input value={merchantName(edit)} readOnly /></Field>
          <Field label="Descrizione"><input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="es. Fornitore luce" /></Field>
          {changed && (found.length ? (
            <div className="toggles">
              <p className="small">Movimenti con descrizione «{edit.description}» e note che iniziano con «{merchantName(edit)}»: applico la nuova descrizione anche a</p>
              <Toggle checked={toConfirm} onChange={setToConfirm} icon={<ListChecks size={20} />}
                label={`Da registrare (${nConfirm})`} hint="Importati, ancora da confermare" />
              <Toggle checked={registered} onChange={setRegistered} icon={<Store size={20} />}
                label={`Già registrati (${nRegistered})`} hint="Movimenti confermati" />
            </div>
          ) : <p className="muted small">Nessun movimento con descrizione «{edit.description}» e note che iniziano con «{merchantName(edit)}».</p>)}
        </Sheet>
      )}
    </div>
  );
}
