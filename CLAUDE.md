# Runway — note per Claude

PWA per monitorare spese/entrate/risparmio. Usata principalmente da telefono, anche da PC.
Lingua: tutto in italiano (UI, commenti, messaggi). Note personali in CLAUDE.local.md (non versionato).
Il repository è pubblico: niente dati personali (nomi, importi reali, numeri di conto) in codice e commenti.

## Regole di dominio
- Spese condivise: ripartizione per categoria (predefinita), modificabile sul singolo movimento (percentuale o importo fisso).
- L'assegno unico/ANF è un'entrata ripartita.
- Rimborsi: un'uscita "rimborsabile" viene rimborsata da un'entrata (es. busta paga) a cui la si collega;
  non conta né come spesa né come reddito.
- Buoni pasto: la busta NON crea movimenti (l'importo resta in Movement.mealVouchers). Controllo periodico in Home
  (views/VoucherCheck.tsx, lib/vouchers.ts): saldo carta → buoni usati = spesa nella categoria scelta + entrata "Buoni pasto"
  per la parte arrivata con la busta. I buoni welfare sono entrate manuali nel conto Buoni pasto.
- Categorie: kind 'uscita' | 'entrata' | 'entrambe' (helper fitsKind in lib/stats.ts).
- Dati online nel Google Drive dell'utente (Google Sheet "Runway - Dati").

## Stack
- Vite 6 + React 18 + TypeScript, lucide-react per le icone, vite-plugin-pwa. Nessun backend.
- Rollup è sostituito da `@rollup/wasm-node` (override in package.json): Windows Application Control blocca i binari nativi .node.
- Stato in IndexedDB, sync "last write wins" per id con `updatedAt`; le cancellazioni sono tombstone (`deleted: true`).
- `npm run build` = tsc + vite build. Verificare sempre con la build prima di consegnare.

## Stato dei lavori
1. Import estratti conto (src/import/, vista Altro → Importa): "Lista movimenti" PDF Unicredit, "Estratto conto" trimestrale
   Unicredit (unicreditEc.ts; bonifici tra intestatari = giroconto; doppioni tra i due formati riconosciuti da data contabile
   + importo) ed Excel "Esporta report" di Satispay (satispay.ts + xlsx.ts, lettore xlsx senza librerie; conto Satispay,
   impronta "SP:"+ID). Il codice operazione Unicredit NON è univoco: l'impronta è codice + data contabile + importo.
   Controllo saldi a ogni import.
2. Cartelle Drive monitorate: scope drive.readonly (il Picker con solo drive.file NON dà accesso ai file della cartella).
   Codice in src/docs/ (templates.ts = un modello per fornitore, scan.ts, inbox.tsx) e src/views/DocReview.tsx.
   Modelli: Octopus (luce+gas), Hera TCP, Sky WiFi, busta paga (730, premi, rimborsi spese, tredicesima a parte).
   PDF protetti da password: proposti senza dati. L'utente vuole procedere un passo alla volta.
3. Da fare: pubblicazione su GitHub Pages; assistente IA (API Claude tramite piccolo proxy, la chiave non deve stare nel client).
