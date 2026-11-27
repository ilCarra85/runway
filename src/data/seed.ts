import type { Account, AppState, Category, Kind, Movement, Recurrence, Split, Unit } from '../types';
import { addDays, addMonths, endOfMonth, startOfMonth, todayISO } from '../lib/dates';
import { uid } from '../lib/format';

export const MINE: Split = { mode: 'pct', value: 100 };
export const HALF: Split = { mode: 'pct', value: 50 };

export const GROUP_ORDER = [
  'Casa', 'Bollette', 'Figlie', 'Quotidiano', 'Persona e tempo libero', 'Abbonamenti', 'Separazione', 'Altro',
  'Lavoro', 'Famiglia', 'Altre entrate', 'Movimenti interni'
];

export const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#0f9fb5', '#8b5e3c', '#64748b'];

type C = [id: string, name: string, icon: string, group: string, color: string, split?: Split, excluded?: boolean];

const OUT: C[] = [
  ['mutuo', 'Mutuo', 'Landmark', 'Casa', '#2a78d6', HALF],
  ['condominio', 'Condominio', 'Building2', 'Casa', '#2a78d6'],
  ['pulizie', 'Pulizie', 'SprayCan', 'Casa', '#2a78d6'],
  ['casa-manut', 'Casa e manutenzione', 'Wrench', 'Casa', '#2a78d6'],
  ['luce', 'Luce', 'Zap', 'Bollette', '#eda100'],
  ['gas', 'Gas', 'Flame', 'Bollette', '#eda100'],
  ['acqua', 'Acqua', 'Droplet', 'Bollette', '#eda100'],
  ['rifiuti', 'Rifiuti (TCP / TARI)', 'Recycle', 'Bollette', '#eda100'],
  ['internet', 'Internet e telefono', 'Wifi', 'Bollette', '#eda100'],
  ['cellulare', 'Cellulare', 'Smartphone', 'Bollette', '#eda100'],
  ['scuola', 'Scuola', 'GraduationCap', 'Figlie', '#e87ba4', HALF],
  ['sport-figlie', 'Sport e corsi', 'Medal', 'Figlie', '#e87ba4', HALF],
  ['babysitter', 'Baby sitter', 'Baby', 'Figlie', '#e87ba4', HALF],
  ['centri-estivi', 'Centri estivi', 'Sun', 'Figlie', '#e87ba4', HALF],
  ['abbigl-figlie', 'Abbigliamento figlie', 'Shirt', 'Figlie', '#e87ba4', HALF],
  ['salute-figlie', 'Salute figlie', 'Stethoscope', 'Figlie', '#e87ba4', HALF],
  ['alimentari', 'Spesa alimentare', 'ShoppingCart', 'Quotidiano', '#1baf7a'],
  ['ristoranti', 'Ristoranti e bar', 'UtensilsCrossed', 'Quotidiano', '#1baf7a'],
  ['trasporti', 'Trasporti', 'Car', 'Quotidiano', '#1baf7a'],
  ['carburante', 'Carburante', 'Fuel', 'Quotidiano', '#1baf7a'],
  ['salute', 'Salute', 'HeartPulse', 'Persona e tempo libero', '#6250d6'],
  ['cura-persona', 'Cura persona', 'Scissors', 'Persona e tempo libero', '#6250d6'],
  ['shopping', 'Shopping', 'ShoppingBag', 'Persona e tempo libero', '#6250d6'],
  ['tempo-libero', 'Tempo libero', 'Ticket', 'Persona e tempo libero', '#6250d6'],
  ['viaggi', 'Viaggi e vacanze', 'Plane', 'Persona e tempo libero', '#6250d6'],
  ['regali', 'Regali', 'Gift', 'Persona e tempo libero', '#6250d6'],
  ['sport', 'Sport', 'Dumbbell', 'Persona e tempo libero', '#6250d6'],
  ['streaming', 'Streaming e TV', 'Tv', 'Abbonamenti', '#0f9fb5'],
  ['musica', 'Musica', 'Music', 'Abbonamenti', '#0f9fb5'],
  ['abbonamenti', 'Altri abbonamenti', 'Repeat', 'Abbonamenti', '#0f9fb5'],
  ['legale', 'Spese legali', 'Scale', 'Separazione', '#8b5e3c', HALF],
  ['altro-out', 'Altre spese', 'CircleHelp', 'Altro', '#64748b'],
  ['giroconto-out', 'Giroconto / ricarica', 'ArrowLeftRight', 'Movimenti interni', '#64748b', MINE, true]
];

const IN: C[] = [
  ['stipendio', 'Stipendio', 'Briefcase', 'Lavoro', '#008300'],
  ['mensilita-extra', 'Tredicesima / quattordicesima', 'Award', 'Lavoro', '#008300'],
  ['buoni-pasto-in', 'Buoni pasto', 'Wallet', 'Lavoro', '#008300'],
  ['buoni-welfare', 'Buoni welfare', 'Gift', 'Lavoro', '#008300'],
  ['bonus', 'Bonus e premi', 'Sparkles', 'Lavoro', '#008300'],
  ['assegno-unico', 'Assegno unico / ANF', 'Users', 'Famiglia', '#1baf7a', HALF],
  ['730', 'Rimborso 730', 'Receipt', 'Altre entrate', '#2a78d6'],
  ['altro-in', 'Altre entrate', 'PiggyBank', 'Altre entrate', '#2a78d6'],
  ['giroconto-in', 'Giroconto / ricarica', 'ArrowLeftRight', 'Movimenti interni', '#64748b', MINE, true]
];

function cats(list: C[], kind: Kind, offset: number): Category[] {
  return list.map(([id, name, icon, group, color, split, excluded], i) => ({
    id, name, icon, group, color, kind, split: split ?? MINE, order: offset + i, excluded, updatedAt: 1
  }));
}

export const SEED_ACCOUNTS: Account[] = [
  { id: 'conto', name: 'Conto corrente', icon: 'Landmark', kind: 'banca', order: 0, updatedAt: 1 },
  { id: 'satispay', name: 'Satispay', icon: 'Smartphone', kind: 'app', order: 1, updatedAt: 1 },
  { id: 'buoni', name: 'Buoni pasto', icon: 'Wallet', kind: 'buoni', order: 2, updatedAt: 1 },
  { id: 'contanti', name: 'Contanti', icon: 'Banknote', kind: 'contanti', order: 3, updatedAt: 1 },
  { id: 'welfare', name: 'Buoni welfare', icon: 'Gift', kind: 'welfare', order: 4, updatedAt: 1 },
  { id: 'carta-credito', name: 'Carta di credito', icon: 'CreditCard', kind: 'carta', order: 5, updatedAt: 1 }
];

type R = [name: string, kind: Kind, amount: number, cat: string, every: number, unit: Unit, split?: Split];
/**
 * Voci ricorrenti proposte a un'installazione nuova (disattivate, "da verificare"). Vuoto: le ricorrenze vere arrivano
 * dalla sync con il foglio Google, e con id casuali qui si duplicherebbero su ogni dispositivo nuovo.
 */
const RECS: R[] = [];

function seedRecurrences(): Recurrence[] {
  const start = startOfMonth(todayISO());
  return RECS.map(([name, kind, amount, categoryId, every, unit, split]) => ({
    id: uid(), name, kind, amount, categoryId, accountId: 'conto', split: split ?? MINE,
    every, unit, start, endMode: 'mai', active: false, toVerify: true, skipped: [], updatedAt: 1
  }));
}

export function initialState(): AppState {
  return {
    categories: [...cats(OUT, 'uscita', 0), ...cats(IN, 'entrata', 100)],
    accounts: SEED_ACCOUNTS,
    movements: [],
    recurrences: seedRecurrences(),
    rules: [],
    imports: [],
    settings: {}
  };
}

// ---------- Dati di esempio (per provare l'app) ----------

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

export function demoMovements(): Movement[] {
  const r = rng(42);
  const t = todayISO();
  const out: Movement[] = [];
  const now = Date.now();
  const add = (date: string, kind: Kind, amount: number, categoryId: string, description: string, extra: Partial<Movement> = {}) => {
    if (date > t && !extra.planned) return;
    out.push({
      id: uid() + out.length, date, kind, amount: Math.round(amount * 100) / 100, categoryId, accountId: 'conto',
      description, split: MINE, refund: 'none', planned: false, demo: true, createdAt: now, updatedAt: now, ...extra
    });
  };
  for (let i = 5; i >= 0; i--) {
    const m = addMonths(startOfMonth(t), -i);
    add(addDays(m, 26), 'entrata', 2000 + r() * 120, 'stipendio', 'Stipendio');
    add(addDays(m, 26), 'entrata', 120, 'buoni-pasto-in', 'Buoni pasto', { accountId: 'buoni' });
    add(addDays(m, 19), 'entrata', 392.4, 'assegno-unico', 'Assegno unico INPS', { split: HALF });
    add(addDays(m, 0), 'uscita', 671.38, 'mutuo', 'Rata mutuo', { split: HALF });
    add(addDays(m, 4), 'uscita', 34.9, 'internet', 'Fibra casa');
    add(addDays(m, 9), 'uscita', 388, 'scuola', 'Retta scuola', { split: HALF });
    add(addDays(m, 14), 'uscita', 20.99, 'musica', 'Spotify Family', { split: HALF });
    for (let w = 0; w < 4; w++) {
      add(addDays(m, 2 + w * 7), 'uscita', 35 + r() * 40, 'alimentari', 'Supermercato', r() > 0.5 ? { accountId: 'buoni' } : {});
      add(addDays(m, 3 + w * 7), 'uscita', 30, 'sport-figlie', 'Nuoto', { split: HALF });
      if (r() > 0.4) add(addDays(m, 5 + w * 7), 'uscita', 12 + r() * 45, 'ristoranti', 'Pizzeria / bar', { accountId: r() > 0.5 ? 'satispay' : 'conto' });
    }
    if (i % 2 === 0) {
      const prev = addMonths(m, -2);
      add(addDays(m, 11), 'uscita', 95 + r() * 40, 'luce', 'Bolletta luce bimestrale', { compFrom: prev, compTo: endOfMonth(addMonths(m, -1)) });
    }
    add(addDays(m, 16), 'uscita', 40 + r() * 70, 'gas', 'Bolletta gas');
    add(addDays(m, 21), 'uscita', 30 + r() * 120, 'shopping', 'Acquisti vari');
    add(addDays(m, 23), 'uscita', 45 + r() * 50, 'carburante', 'Carburante');
  }
  add(addDays(t, -6), 'uscita', 118, 'viaggi', 'Hotel trasferta Milano', { refund: 'pending' });
  add(addDays(t, -5), 'uscita', 24.5, 'ristoranti', 'Pranzo trasferta', { refund: 'pending' });
  add(addMonths(t, 3), 'uscita', 1800, 'viaggi', 'Vacanza estiva (ipotesi)', { planned: true, description: 'Vacanza estiva (ipotesi)' });
  return out;
}
