import { useState } from 'react';
import { EyeOff, Plus, Trash2 } from 'lucide-react';
import type { Account, AccountKind, AppState, Category, CategoryKind, Kind, Split } from '../types';
import { useStore } from '../data/store';
import { Badge, ICONS, Icon } from '../components/Icon';
import { Field, Segmented, Sheet, SplitBadge, SplitPicker, Toggle, groupCategories } from '../components/ui';
import { COLORS } from '../data/seed';
import { uid } from '../lib/format';
import { confirmDialog } from '../components/Dialog';
import { fitsKind } from '../lib/stats';

const KIND_OPTIONS: { value: CategoryKind; label: string }[] = [
  { value: 'uscita', label: 'Uscita' }, { value: 'entrata', label: 'Entrata' }, { value: 'entrambe', label: 'Entrambe' }
];

/** Cambio di tipo: avvisa se ci sono movimenti dell'altro tipo che resterebbero con una categoria non valida. */
async function kindChangeOk(state: AppState, c: Category, kind: CategoryKind): Promise<boolean> {
  if (kind === 'entrambe' || kind === c.kind) return true;
  const other = state.movements.filter((m) => !m.deleted && m.categoryId === c.id && m.kind !== kind).length;
  if (!other) return true;
  return confirmDialog(`«${c.name}» è usata da ${other} ${kind === 'uscita' ? 'entrate' : 'uscite'}: resteranno con questa categoria, ma non potrai più sceglierla per quel tipo. Continuare?`, { ok: 'Cambia' });
}

export function Categories() {
  const { state, upsert } = useStore();
  const [show, setShow] = useState<'tutte' | Kind>('tutte');
  const [edit, setEdit] = useState<Category | 'new' | null>(null);
  const groups = groupCategories(state.categories.filter((c) => !c.deleted && (show === 'tutte' || fitsKind(c, show))));
  const setKind = async (c: Category, kind: CategoryKind) => {
    if (await kindChangeOk(state, c, kind)) upsert('categories', { ...c, kind, updatedAt: Date.now() });
  };
  return (
    <div className="page">
      <div className="page-actions">
        <Segmented<'tutte' | Kind> value={show} onChange={setShow} options={[{ value: 'tutte', label: 'Tutte' }, { value: 'uscita', label: 'Uscite' }, { value: 'entrata', label: 'Entrate' }]} />
        <button className="btn primary" onClick={() => setEdit('new')}><Plus size={18} /> Nuova</button>
      </div>
      <p className="muted small">Per ogni categoria scegli se vale per le uscite, per le entrate o per entrambe: compare solo dove serve.</p>
      {groups.map(([g, cs]) => (
        <section key={g}>
          <h3 className="section-title">{g}</h3>
          <div className="card list">
            {cs.map((c) => (
              <div key={c.id} className="row cat-row">
                <button className="cat-open" onClick={() => setEdit(c)}>
                  <Badge icon={c.icon} color={c.color} />
                  <span className="row-main">
                    <span className="row-title">{c.name}</span>
                    <span className="row-tags">
                      <SplitBadge split={c.split} />
                      {c.excluded && <span className="tag"><EyeOff size={12} /> Esclusa dalle statistiche</span>}
                    </span>
                  </span>
                </button>
                <Segmented<CategoryKind> className="small cat-kind" value={c.kind} onChange={(v) => setKind(c, v)} options={KIND_OPTIONS} />
              </div>
            ))}
          </div>
        </section>
      ))}
      {edit && <CategoryForm initial={edit === 'new' ? undefined : edit} kind={show === 'tutte' ? 'uscita' : show} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CategoryForm({ initial, kind: k0, onClose }: { initial?: Category; kind: Kind; onClose: () => void }) {
  const { state, upsert, remove } = useStore();
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<CategoryKind>(initial?.kind ?? k0);
  const [group, setGroup] = useState(initial?.group ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? 'CircleHelp');
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [split, setSplit] = useState<Split>(initial?.split ?? { mode: 'pct', value: 100 });
  const [excluded, setExcluded] = useState(!!initial?.excluded);
  const groups = [...new Set(state.categories.filter((c) => !c.deleted).map((c) => c.group))];
  const used = initial ? state.movements.some((m) => !m.deleted && m.categoryId === initial.id) : false;

  const save = async () => {
    if (!name.trim()) return;
    if (initial && !(await kindChangeOk(state, initial, kind))) return;
    upsert('categories', {
      id: initial?.id ?? uid(), name: name.trim(), kind, group: group.trim() || 'Altro', icon, color, split, excluded: excluded || undefined,
      order: initial?.order ?? Math.max(0, ...state.categories.map((c) => c.order)) + 1, updatedAt: Date.now()
    });
    onClose();
  };

  return (
    <Sheet title={initial ? 'Modifica categoria' : 'Nuova categoria'} onClose={onClose} footer={<>
      {initial && <button className="btn ghost danger" onClick={async () => {
        if (await confirmDialog(used ? 'Questa categoria è usata da alcuni movimenti, che resteranno senza categoria. Eliminarla comunque?' : 'Eliminare la categoria?', { ok: 'Elimina', danger: true })) { remove('categories', initial.id); onClose(); }
      }}><Trash2 size={18} /> Elimina</button>}
      <button className="btn primary grow" onClick={save}>Salva</button>
    </>}>
      <div className="amount-row"><Badge icon={icon} color={color} size={52} /><input className="title-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome categoria" autoFocus={!initial} /></div>
      <Segmented<CategoryKind> value={kind} onChange={setKind} options={KIND_OPTIONS} />
      <Field label="Gruppo">
        <input list="groups" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="es. Figlie" />
        <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      </Field>
      <Field label="Colore">
        <div className="swatches">{COLORS.map((c) => (
          <button key={c} type="button" className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
        ))}</div>
      </Field>
      <Field label="Icona">
        <div className="icon-picker">{Object.keys(ICONS).map((n) => (
          <button key={n} type="button" className={`icon-opt ${n === icon ? 'on' : ''}`} onClick={() => setIcon(n)} aria-label={n} title={n}><Icon name={n} size={20} /></button>
        ))}</div>
      </Field>
      <Field label="Ripartizione predefinita" hint="Proposta automaticamente quando scegli questa categoria">
        <SplitPicker split={split} onChange={setSplit} amount={0} kind={kind === 'entrata' ? 'entrata' : 'uscita'} />
      </Field>
      <Toggle checked={excluded} onChange={setExcluded} icon={<EyeOff size={20} />} label="Escludi dalle statistiche" hint="Per giroconti e ricariche (es. ricarica Satispay dal conto)" />
    </Sheet>
  );
}

const ACCOUNT_KINDS: { value: AccountKind; label: string }[] = [
  { value: 'banca', label: 'Conto bancario' }, { value: 'carta', label: 'Carta' }, { value: 'app', label: 'App di pagamento' },
  { value: 'buoni', label: 'Buoni pasto' }, { value: 'contanti', label: 'Contanti' }
];

export function Accounts() {
  const { state, upsert, remove } = useStore();
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('Landmark');
  const [kind, setKind] = useState<AccountKind>('banca');
  const open = (a: Account | 'new') => {
    setEdit(a);
    setName(a === 'new' ? '' : a.name); setIcon(a === 'new' ? 'Landmark' : a.icon); setKind(a === 'new' ? 'banca' : a.kind);
  };
  const save = () => {
    if (!name.trim() || !edit) return;
    upsert('accounts', { id: edit === 'new' ? uid() : edit.id, name: name.trim(), icon, kind, order: edit === 'new' ? state.accounts.length : edit.order, updatedAt: Date.now() });
    setEdit(null);
  };
  return (
    <div className="page">
      <div className="page-actions"><button className="btn primary" onClick={() => open('new')}><Plus size={18} /> Nuovo conto</button></div>
      <div className="card list">
        {state.accounts.filter((a) => !a.deleted).sort((a, b) => a.order - b.order).map((a) => (
          <button key={a.id} className="row" onClick={() => open(a)}>
            <Badge icon={a.icon} color="#64748b" />
            <span className="row-main"><span className="row-title">{a.name}</span><span className="row-sub">{ACCOUNT_KINDS.find((k) => k.value === a.kind)?.label}</span></span>
          </button>
        ))}
      </div>
      {edit && (
        <Sheet title={edit === 'new' ? 'Nuovo conto' : 'Modifica conto'} onClose={() => setEdit(null)} footer={<>
          {edit !== 'new' && <button className="btn ghost danger" onClick={async () => { if (await confirmDialog('Eliminare il conto?', { ok: 'Elimina', danger: true })) { remove('accounts', edit.id); setEdit(null); } }}><Trash2 size={18} /> Elimina</button>}
          <button className="btn primary grow" onClick={save}>Salva</button>
        </>}>
          <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Tipo"><select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>{ACCOUNT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></Field>
          <Field label="Icona"><div className="icon-picker">{['Landmark', 'CreditCard', 'Smartphone', 'Wallet', 'Banknote', 'PiggyBank', 'Coins', 'HandCoins'].map((n) => (
            <button key={n} type="button" className={`icon-opt ${n === icon ? 'on' : ''}`} onClick={() => setIcon(n)} aria-label={n}><Icon name={n} size={20} /></button>
          ))}</div></Field>
        </Sheet>
      )}
    </div>
  );
}
