import { useState } from 'react';
import { ChevronLeft, ChevronRight, Cloud, CloudAlert, CloudOff, FileUp, House, Landmark, List, LogIn, Menu, Plus, RefreshCw, Repeat, Settings as Cog, Store, Tags } from 'lucide-react';
import { useStore } from './data/store';
import { Dashboard } from './views/Dashboard';
import { Movements } from './views/Movements';
import { MovementForm, type MovementDraft } from './views/MovementForm';
import { Recurrences } from './views/Recurrences';
import { Accounts, Categories } from './views/Categories';
import { Settings } from './views/Settings';
import { Merchants } from './views/Merchants';
import { Import } from './views/Import';
import { DialogHost } from './components/Dialog';

type Tab = 'home' | 'movimenti' | 'ricorrenze' | 'altro';
type Sub = null | 'categorie' | 'conti' | 'enti' | 'impostazioni' | 'importa';

const TITLES: Record<Tab, string> = { home: 'Runway', movimenti: 'Movimenti', ricorrenze: 'Ricorrenze', altro: 'Altro' };
const SUB_TITLES: Record<Exclude<Sub, null>, string> = { categorie: 'Categorie', conti: 'Conti e portafogli', enti: 'Enti e descrizioni', impostazioni: 'Impostazioni', importa: 'Importa estratto conto' };

export default function App() {
  const { sync } = useStore();
  const [tab, setTab] = useState<Tab>('home');
  const [sub, setSub] = useState<Sub>(null);
  const [form, setForm] = useState<MovementDraft | null>(null);

  const go = (t: string) => {
    if (t === 'altro') { setTab('altro'); setSub('impostazioni'); }
    else { setTab(t as Tab); setSub(null); }
    window.scrollTo(0, 0);
  };

  const SyncIcon = { off: CloudOff, login: LogIn, idle: Cloud, syncing: RefreshCw, ok: Cloud, error: CloudAlert }[sync.status];
  const syncTitle = { off: 'Sync non configurata', login: 'Accedi a Google per sincronizzare', idle: 'Sincronizza', syncing: 'Sincronizzazione…', ok: 'Sincronizzato', error: 'Errore di sincronizzazione' }[sync.status];

  return (
    <div className="app">
      <header className="topbar">
        {tab === 'altro' && sub
          ? <button className="icon-btn" onClick={() => setSub(null)} aria-label="Indietro"><ChevronLeft /></button>
          : tab === 'home' ? <img src="./icon.svg" alt="" className="logo" /> : <span className="topbar-spacer" />}
        <h1>{tab === 'altro' && sub ? SUB_TITLES[sub] : TITLES[tab]}</h1>
        <button className={`icon-btn sync-btn s-${sync.status}`} title={syncTitle} aria-label={syncTitle}
          onClick={() => (sync.status === 'off' ? go('altro') : sync.run(true))}>
          <SyncIcon size={20} className={sync.status === 'syncing' ? 'spin' : ''} />
        </button>
      </header>

      <main>
        {tab === 'home' && <Dashboard onAdd={setForm} goTo={go} />}
        {tab === 'movimenti' && <Movements onEdit={(m) => setForm(m)} />}
        {tab === 'ricorrenze' && <Recurrences />}
        {tab === 'altro' && !sub && (
          <div className="page">
            <div className="card list">
              {([['importa', FileUp, 'Importa estratto conto', 'PDF della banca: movimenti, ricorrenze e categorie'],
                 ['categorie', Tags, 'Categorie', 'Icone, colori e ripartizione predefinita'],
                 ['conti', Landmark, 'Conti e portafogli', 'Conto corrente, Satispay, buoni pasto…'],
                 ['enti', Store, 'Enti e descrizioni', 'Descrizione da dare ai movimenti di un ente'],
                 ['impostazioni', Cog, 'Impostazioni', 'Sincronizzazione Google, backup, dati di esempio']] as const).map(([k, I, t, d]) => (
                <button key={k} className="row" onClick={() => setSub(k)}>
                  <span className="badge" style={{ ['--c' as any]: '#64748b' }}><I size={20} /></span>
                  <span className="row-main"><span className="row-title">{t}</span><span className="row-sub">{d}</span></span>
                  <ChevronRight size={18} className="muted" />
                </button>
              ))}
            </div>
            <p className="muted small center">In arrivo: cartelle Drive monitorate, assistente IA.</p>
          </div>
        )}
        {tab === 'altro' && sub === 'categorie' && <Categories />}
        {tab === 'altro' && sub === 'conti' && <Accounts />}
        {tab === 'altro' && sub === 'enti' && <Merchants />}
        {tab === 'altro' && sub === 'impostazioni' && <Settings />}
        {tab === 'altro' && sub === 'importa' && <Import onDone={() => go('movimenti')} />}
      </main>

      <nav className="bottombar">
        <NavBtn on={tab === 'home'} onClick={() => go('home')} icon={<House size={22} />} label="Home" />
        <NavBtn on={tab === 'movimenti'} onClick={() => go('movimenti')} icon={<List size={22} />} label="Movimenti" />
        <button className="fab" onClick={() => setForm({ kind: 'uscita' })} aria-label="Aggiungi movimento"><Plus size={28} /></button>
        <NavBtn on={tab === 'ricorrenze'} onClick={() => go('ricorrenze')} icon={<Repeat size={22} />} label="Ricorrenze" />
        <NavBtn on={tab === 'altro'} onClick={() => { setTab('altro'); setSub(null); }} icon={<Menu size={22} />} label="Altro" />
      </nav>

      {form && <MovementForm initial={form} onClose={() => setForm(null)} />}
      <DialogHost />
    </div>
  );
}

function NavBtn({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button className={`nav-btn ${on ? 'on' : ''}`} onClick={onClick} aria-current={on ? 'page' : undefined}>
      {icon}<span>{label}</span>
    </button>
  );
}
