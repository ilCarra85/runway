export type Kind = 'uscita' | 'entrata';

/** La "mia quota" di un importo: percentuale oppure importo fisso in euro. */
export type SplitMode = 'pct' | 'amount';
export interface Split {
  mode: SplitMode;
  value: number;
}

interface Base {
  id: string;
  updatedAt: number;
  deleted?: boolean;
}

/** Una categoria può valere per le uscite, per le entrate o per entrambe. */
export type CategoryKind = Kind | 'entrambe';

export interface Category extends Base {
  name: string;
  icon: string;
  color: string;
  kind: CategoryKind;
  group: string;
  split: Split;
  order: number;
  /** Non conta nelle statistiche (es. giroconti, ricariche Satispay). */
  excluded?: boolean;
}

export type AccountKind = 'banca' | 'app' | 'buoni' | 'contanti' | 'carta';
export interface Account extends Base {
  name: string;
  icon: string;
  kind: AccountKind;
  order: number;
  /** Conto buoni pasto: ultimo controllo del saldo della carta (data, saldo in euro, valore di un buono). */
  checkDate?: string;
  checkBalance?: number;
  voucherValue?: number;
}

/** Spesa anticipata da me e rimborsata dal lavoro in busta paga. */
export type RefundStatus = 'none' | 'pending' | 'reimbursed';

export interface Movement extends Base {
  date: string; // YYYY-MM-DD
  kind: Kind;
  amount: number; // importo totale, sempre positivo
  categoryId: string;
  accountId: string;
  description: string;
  split: Split;
  refund: RefundStatus;
  /** Importo rimborsato dall'azienda (se assente = importo intero). */
  refundAmount?: number;
  /** Impronta del movimento bancario da cui è stato importato (anti-doppioni). */
  importId?: string;
  /** File Drive (bolletta, busta paga) da cui è stato registrato o confermato. */
  docFileId?: string;
  docName?: string;
  /** Busta paga: buoni pasto caricati sulla carta (non registrati: contano al controllo dei buoni). */
  mealVouchers?: number;
  /** Entrata (busta paga) che ha incluso il rimborso. */
  refundIncomeId?: string;
  /** Periodo di competenza (es. bolletta bimestrale): l'importo viene spalmato sui giorni. */
  compFrom?: string;
  compTo?: string;
  /** Spesa/entrata futura o ipotetica: conta solo nelle proiezioni. */
  planned: boolean;
  recurrenceId?: string;
  occurrence?: string;
  notes?: string;
  demo?: boolean;
  createdAt: number;
}

export type Unit = 'giorni' | 'settimane' | 'mesi' | 'anni';
export type EndMode = 'mai' | 'volte' | 'data';

export interface Recurrence extends Base {
  name: string;
  kind: Kind;
  amount: number;
  categoryId: string;
  accountId: string;
  split: Split;
  every: number;
  unit: Unit;
  start: string;
  endMode: EndMode;
  count?: number;
  until?: string;
  active: boolean;
  /** Importo da verificare (importato dal vecchio prospetto). */
  toVerify?: boolean;
  /** Chiedi conferma prima di registrare (importi variabili). Se falso le occorrenze passate vengono registrate da sole. */
  confirm?: boolean;
  /** Importo stimato dai documenti confermati (ricorrenza con cartella): ricalcolato a ogni conferma. */
  amountAuto?: boolean;
  /** Spesa rimborsabile dal lavoro: i movimenti generati nascono "da rimborsare". */
  refundable?: boolean;
  /** Parte rimborsata di ogni occorrenza; assente = tutto l'importo. */
  refundAmount?: number;
  /** Occorrenze saltate (date ISO). */
  skipped: string[];
  /** Cartella Google Drive monitorata per questa voce. */
  driveFolderId?: string;
  driveFolderName?: string;
  /** Modello di lettura dei PDF della cartella (es. "octopus"); assente = riconoscimento automatico. */
  docTemplate?: string;
  /** Fornitura da leggere nella cartella (es. "luce", "gas"): una cartella può contenere più forniture. */
  docSupply?: string;
  /** File della cartella scartati dall'utente (id Drive): non vengono più proposti. */
  docIgnored?: string[];
  notes?: string;
}

/** Regola appresa dall'import: esercente/beneficiario → categoria. */
export interface Rule extends Base {
  /** Chiave normalizzata dell'esercente (es. "PAM"). */
  key: string;
  kind: Kind;
  categoryId: string;
  /** Ripartizione da usare al posto di quella della categoria (es. quota mutuo già solo mia). */
  split?: Split;
}

export interface Settings {
  spreadsheetId?: string;
  lastSync?: number;
}

export interface AppState {
  categories: Category[];
  accounts: Account[];
  movements: Movement[];
  recurrences: Recurrence[];
  rules: Rule[];
  settings: Settings;
}

export type Collection = 'categories' | 'accounts' | 'movements' | 'recurrences' | 'rules';
export type Entity = Category | Account | Movement | Recurrence | Rule;
