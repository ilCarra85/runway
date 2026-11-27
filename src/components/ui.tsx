import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Account, Category, Kind, Split } from '../types';
import { Badge, Icon } from './Icon';
import { GROUP_ORDER } from '../data/seed';
import { amountToInput, money, parseAmount } from '../lib/format';
import { fitsKind, myShare } from '../lib/stats';

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi"><X size={22} /></button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, className }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div className={`segmented ${className ?? ''}`} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, icon, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; icon?: ReactNode; label: string; hint?: string;
}) {
  return (
    <button type="button" className={`toggle-row ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} aria-pressed={checked}>
      {icon && <span className="toggle-icon">{icon}</span>}
      <span className="toggle-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <span className="switch" aria-hidden><span /></span>
    </button>
  );
}

export function AmountInput({ value, onChange, autoFocus, big, placeholder = '0,00' }: {
  value: string; onChange: (v: string) => void; autoFocus?: boolean; big?: boolean; placeholder?: string;
}) {
  return (
    <div className={`amount-input ${big ? 'big' : ''}`}>
      <span>€</span>
      <input inputMode="decimal" value={value} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,-]/g, ''))} />
    </div>
  );
}

/** Griglia categorie: prima le più usate, poi (a richiesta) tutte raggruppate. */
export function CategoryGrid({ categories, kind, value, onChange, usage }: {
  categories: Category[]; kind: Kind; value: string; onChange: (id: string) => void; usage?: Map<string, number>;
}) {
  const [all, setAll] = useState(false);
  const list = categories.filter((c) => !c.deleted && fitsKind(c, kind));
  const frequent = usage && usage.size >= 3
    ? [...list].filter((c) => usage.has(c.id)).sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0)).slice(0, 8)
    : [];
  const selected = list.find((c) => c.id === value);
  if (selected && frequent.length && !frequent.includes(selected)) frequent[frequent.length - 1] = selected;
  const showAll = all || frequent.length === 0;
  const chip = (c: Category) => (
    <button key={c.id} type="button" className={`cat-chip ${value === c.id ? 'on' : ''}`}
      style={{ ['--c' as any]: c.color }} onClick={() => { onChange(c.id); setAll(false); }} aria-pressed={value === c.id}>
      <Badge icon={c.icon} color={c.color} size={36} />
      <span>{c.name}</span>
    </button>
  );
  return (
    <div className="cat-grid-wrap">
      {!showAll && <div className="cat-grid">{frequent.map(chip)}</div>}
      {showAll && groupCategories(list).map(([g, cs]) => (
        <div key={g}>
          <div className="cat-group-title">{g}</div>
          <div className="cat-grid">{cs.map(chip)}</div>
        </div>
      ))}
      {frequent.length > 0 && (
        <button type="button" className="btn small ghost show-all" onClick={() => setAll(!all)}>
          {all ? 'Mostra solo le più usate' : `Tutte le categorie (${list.length})`}
        </button>
      )}
    </div>
  );
}

export function categoryUsage(movements: { categoryId: string; deleted?: boolean }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of movements) if (!x.deleted) m.set(x.categoryId, (m.get(x.categoryId) ?? 0) + 1);
  return m;
}

export function groupCategories(list: Category[]): [string, Category[]][] {
  const m = new Map<string, Category[]>();
  for (const c of [...list].sort((a, b) => a.order - b.order)) {
    if (!m.has(c.group)) m.set(c.group, []);
    m.get(c.group)!.push(c);
  }
  const rank = (g: string) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? 99 : i; };
  return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}

export function AccountChips({ accounts, value, onChange }: { accounts: Account[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="chips">
      {accounts.filter((a) => !a.deleted).sort((a, b) => a.order - b.order).map((a) => (
        <button key={a.id} type="button" className={`chip ${value === a.id ? 'on' : ''}`} onClick={() => onChange(a.id)} aria-pressed={value === a.id}>
          <Icon name={a.icon} size={16} /> {a.name}
        </button>
      ))}
    </div>
  );
}

type SplitChoice = 'mine' | 'half' | 'pct' | 'amount';
const choiceOf = (s: Split): SplitChoice =>
  s.mode === 'amount' ? 'amount' : s.value === 100 ? 'mine' : s.value === 50 ? 'half' : 'pct';

/** Selettore della "mia quota". */
export function SplitPicker({ split, onChange, amount, kind }: { split: Split; onChange: (s: Split) => void; amount: number; kind: Kind }) {
  const choice = choiceOf(split);
  const total = Number.isFinite(amount) ? amount : 0;
  const mine = myShare(total, split);
  const set = (c: SplitChoice) => {
    if (c === 'mine') onChange({ mode: 'pct', value: 100 });
    else if (c === 'half') onChange({ mode: 'pct', value: 50 });
    else if (c === 'pct') onChange({ mode: 'pct', value: split.mode === 'pct' && split.value !== 100 && split.value !== 50 ? split.value : 60 });
    else onChange({ mode: 'amount', value: split.mode === 'amount' ? split.value : Math.round(total * 50) / 100 });
  };
  return (
    <div className="split">
      <Segmented<SplitChoice> value={choice} onChange={set} options={[
        { value: 'mine', label: 'Tutta mia' },
        { value: 'half', label: '50 / 50' },
        { value: 'pct', label: '%' },
        { value: 'amount', label: '€' }
      ]} />
      {choice === 'pct' && (
        <div className="split-input">
          <span>La mia quota</span>
          <input inputMode="decimal" value={String(split.value)} onChange={(e) => {
            const v = Math.max(0, Math.min(100, Number(e.target.value.replace(',', '.')) || 0));
            onChange({ mode: 'pct', value: v });
          }} />
          <span>%</span>
        </div>
      )}
      {choice === 'amount' && (
        <div className="split-input">
          <span>La mia quota</span>
          <AmountInput value={amountToInput(split.value)} onChange={(v) => onChange({ mode: 'amount', value: parseAmount(v) || 0 })} />
        </div>
      )}
      {choice !== 'mine' && total > 0 && (
        <div className="split-summary">
          <span><strong>{money(mine)}</strong> {kind === 'uscita' ? 'a mio carico' : 'a me'}</span>
          <span className="muted">{money(total - mine)} {kind === 'uscita' ? "a carico dell'altro genitore" : "all'altro genitore"}</span>
        </div>
      )}
    </div>
  );
}

export function SplitBadge({ split }: { split: Split }) {
  if (split.mode === 'pct' && split.value === 100) return null;
  return (
    <span className="tag tag-split" title="Spesa condivisa">
      <Icon name="Users" size={12} /> {split.mode === 'pct' ? `${split.value}%` : money(split.value)}
    </span>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
