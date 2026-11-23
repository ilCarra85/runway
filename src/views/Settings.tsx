import { useRef } from 'react';
import { Cloud, CloudOff, Database, Download, ExternalLink, FlaskConical, LogIn, LogOut, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { AppState } from '../types';
import { useStore } from '../data/store';
import { demoMovements, initialState } from '../data/seed';
import { isConfigured, sheetUrl } from '../sync/google';
import { todayISO } from '../lib/dates';
import { alertDialog, confirmDialog } from '../components/Dialog';

export function Settings() {
  const store = useStore();
  const { state, sync } = store;
  const file = useRef<HTMLInputElement>(null);
  const demoCount = state.movements.filter((m) => m.demo && !m.deleted).length;

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `runway-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as AppState;
      if (!Array.isArray(data.movements) || !Array.isArray(data.categories)) throw new Error('File non valido');
      if (!await confirmDialog(`Sostituire i dati attuali con il backup (${data.movements.length} movimenti)?`, { ok: 'Sostituisci', danger: true })) return;
      store.replace({ ...initialState(), ...data });
    } catch (e: any) {
      await alertDialog('Impossibile leggere il backup: ' + (e?.message || e));
    }
  };

  return (
    <div className="page">
      <section className="card">
        <h3 className="card-title"><Cloud size={18} /> Sincronizzazione Google Drive</h3>
        {!isConfigured() ? (
          <div className="muted">
            <p><CloudOff size={16} /> Non ancora configurata: i dati restano solo su questo dispositivo.</p>
            <p className="small">Serve un <b>Client ID OAuth</b> di Google Cloud nel file <code>.env.local</code>. Segui la guida nel README del progetto.</p>
          </div>
        ) : (
          <>
            <p className="small">
              Stato: <b>{({ off: 'non configurata', login: 'accesso richiesto', idle: 'pronta', syncing: 'sincronizzazione…', ok: 'sincronizzato', error: 'errore' } as const)[sync.status]}</b>
              {state.settings.lastSync && <> · ultima sync {new Date(state.settings.lastSync).toLocaleString('it-IT')}</>}
            </p>
            {sync.error && <p className="error-msg">{sync.error}</p>}
            <div className="btn-row">
              {sync.status === 'login'
                ? <button className="btn primary" onClick={() => sync.run(true)}><LogIn size={18} /> Accedi con Google</button>
                : <button className="btn primary" onClick={() => sync.run(true)} disabled={sync.status === 'syncing'}><RefreshCw size={18} /> Sincronizza ora</button>}
              {state.settings.spreadsheetId && <a className="btn" href={sheetUrl(state.settings.spreadsheetId)} target="_blank" rel="noreferrer"><ExternalLink size={18} /> Apri il foglio</a>}
              {sync.status !== 'login' && <button className="btn ghost" onClick={sync.signOut}><LogOut size={18} /> Esci</button>}
            </div>
            <p className="muted small">I dati sono salvati nel foglio "Runway - Dati" nel tuo Drive. Runway scrive solo nel suo foglio; il resto del Drive lo può solo leggere (per le cartelle monitorate), mai modificare.</p>
          </>
        )}
      </section>

      <section className="card">
        <h3 className="card-title"><Database size={18} /> Backup</h3>
        <div className="btn-row">
          <button className="btn" onClick={exportJson}><Download size={18} /> Esporta backup</button>
          <button className="btn" onClick={() => file.current?.click()}><Upload size={18} /> Ripristina backup</button>
          <input ref={file} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </div>
      </section>

      <section className="card">
        <h3 className="card-title"><FlaskConical size={18} /> Dati di esempio</h3>
        <p className="muted small">Carica sei mesi di movimenti inventati per vedere come funziona l'app. Puoi rimuoverli in un attimo.</p>
        <div className="btn-row">
          {demoCount === 0
            ? <button className="btn" onClick={() => store.upsertMany('movements', demoMovements())}>Carica dati di esempio</button>
            : <button className="btn" onClick={() => store.replace({ ...state, movements: state.movements.map((m) => (m.demo ? { ...m, deleted: true, updatedAt: Date.now() } : m)) })}>
                Rimuovi {demoCount} movimenti di esempio
              </button>}
        </div>
      </section>

      <section className="card">
        <h3 className="card-title danger"><Trash2 size={18} /> Zona pericolosa</h3>
        <p className="muted small">
          <b>Ricomincia da capo</b> elimina movimenti, ricorrenze e regole su tutti i dispositivi e sul foglio Google
          (alla prossima sync); categorie e conti restano. Gli estratti conto e i documenti delle cartelle si potranno reimportare.
        </p>
        <button className="btn ghost danger" onClick={async () => {
          const n = state.movements.filter((m) => !m.deleted).length, r = state.recurrences.filter((x) => !x.deleted).length;
          if (!await confirmDialog(`Eliminare ${n} movimenti e ${r} ricorrenze su tutti i dispositivi e sul foglio Google? Categorie e conti restano. Non si può annullare: se vuoi, prima scarica un backup.`, { ok: 'Elimina tutto', danger: true })) return;
          const now = Date.now();
          // tombstone senza impronte di import né documenti: così estratti conto e PDF delle cartelle si possono reimportare
          store.replace({
            ...state,
            movements: state.movements.map((m) => ({ ...m, deleted: true, importId: undefined, docFileId: undefined, docName: undefined, updatedAt: now })),
            recurrences: state.recurrences.map((x) => ({ ...x, deleted: true, updatedAt: now })),
            rules: state.rules.map((x) => ({ ...x, deleted: true, updatedAt: now })),
            accounts: state.accounts.map((a) => (a.checkDate || a.checkBalance !== undefined ? { ...a, checkDate: undefined, checkBalance: undefined, updatedAt: now } : a))
          });
          // la sync automatica parte da sola dopo la modifica e porta le cancellazioni sul foglio
        }}>Ricomincia da capo</button>
        <button className="btn ghost danger" onClick={async () => {
          if (await confirmDialog('Cancellare TUTTI i dati su questo dispositivo? Se la sync è attiva, i dati sul foglio Google restano e verranno riscaricati.', { ok: 'Cancella tutto', danger: true }))
            store.replace({ ...initialState(), settings: state.settings });
        }}>Cancella solo da questo dispositivo</button>
      </section>
      <p className="muted small center">Runway v0.1</p>
    </div>
  );
}
