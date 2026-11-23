# Runway

Web app personale (PWA) per monitorare spese, entrate e risparmio, con ripartizione delle spese condivise,
ricorrenze, rimborsi dal lavoro, buoni pasto e proiezioni. Dati locali sul dispositivo + sincronizzazione
su un Google Sheet nel proprio Drive.

## Avvio in locale

```bash
npm install
npm run dev
```

Apri http://localhost:5173. Senza configurazione Google l'app funziona comunque, salvando i dati solo nel browser.

> Nota Windows: il controllo applicazioni di Windows blocca il binario nativo di Rollup, quindi in `package.json`
> Rollup è sostituito dalla versione WebAssembly (`overrides` → `@rollup/wasm-node`). Non toglierlo.

## Configurare la sincronizzazione Google (una volta sola, ~10 minuti)

1. Vai su https://console.cloud.google.com e crea un nuovo progetto (es. "Runway").
2. **API e servizi → Libreria**: abilita **Google Sheets API** e **Google Drive API**.
3. **API e servizi → Schermata consenso OAuth**:
   - tipo utente **Esterno**, nome app "Runway", la tua email come supporto e contatto;
   - ambiti: `.../auth/drive.file` (scrive solo i file creati da lei, cioè il foglio dati) e `.../auth/drive.readonly`
     (legge i PDF delle cartelle monitorate, senza poter modificare nulla);
   - **Utenti di test**: aggiungi il tuo indirizzo Google. Lasciare l'app in modalità "Test" va benissimo per uso personale.
4. **API e servizi → Credenziali → Crea credenziali → ID client OAuth**:
   - tipo **Applicazione web**;
   - **Origini JavaScript autorizzate**: `http://localhost:5173` (più, in seguito, l'indirizzo GitHub Pages, es. `https://<utente>.github.io`).
5. Copia il **Client ID** e crealo nel file `.env.local` (vedi `.env.example`):
   ```
   VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   ```
6. Riavvia `npm run dev`, vai in **Altro → Impostazioni → Accedi con Google**. Al primo accesso l'app crea il foglio
   **"Runway - Dati"** nel tuo Drive.

Google accetta come origine solo `localhost` o indirizzi `https`: per usare la sync dal telefono serve la versione
pubblicata (GitHub Pages).

## Come funzionano i calcoli

- **Mia quota**: ogni movimento ha una ripartizione (percentuale o importo fisso). Statistiche e medie usano solo la tua quota.
- **Rimborsi dal lavoro**: una spesa "rimborsabile" non conta nelle tue spese. Quando registri la busta paga spunti
  i rimborsi inclusi: quell'importo viene sottratto dall'entrata, così il reddito non risulta gonfiato.
- **Buoni pasto**: conto di tipo "buoni". Entrano come entrata con la busta paga ed escono quando paghi la spesa.
- **Periodo di competenza**: l'importo viene spalmato sui giorni del periodo (es. bolletta bimestrale).
- **Medie**: totale del periodo ÷ giorni trascorsi (dal primo movimento, se più recente) × giorni dell'unità scelta.
- **Proiezione 12 mesi**: ricorrenze attive per le loro categorie + media reale degli ultimi 6 mesi per le altre
  categorie + movimenti segnati come previsti/ipotetici.
- **Categorie escluse**: giroconti e ricariche (es. ricarica Satispay dal conto) non contano nelle statistiche.

## Import estratto conto

Altro → Importa: PDF "Lista movimenti" dell'home banking Unicredit, letti nel browser con pdf.js (nessun invio di dati).
L'app verifica i saldi, riconosce i movimenti già presenti (anche quelli generati da una ricorrenza, che vengono corretti con
importo e data reali), propone le ricorrenze (stesso esercente a intervalli regolari) e una categoria per il resto, da confermare
per gruppi di esercente. Le scelte diventano regole riusate ai prossimi import.

## Struttura

```
src/
  types.ts            modello dati
  data/seed.ts        categorie, conti e ricorrenze iniziali, dati di esempio
  data/store.tsx      stato, salvataggio IndexedDB, sync automatica
  sync/google.ts      login Google + lettura/scrittura dello Sheet
  lib/stats.ts        quote, medie, andamento, proiezione, scadenze
  lib/recurrence.ts   calcolo delle occorrenze
  views/              schermate
  components/         UI riutilizzabile
  import/             lettura PDF Unicredit, analisi (abbinamenti, ricorrenze, categorie), salvataggio
```

## Roadmap

- Import Satispay (le spese pagate con Satispay non sono nell'estratto conto)
- Cartelle Google Drive monitorate per bollette e buste paga (estrazione importi da PDF)
- Assistente IA (domande su spese, budget, scenari)
- Pubblicazione su GitHub Pages
