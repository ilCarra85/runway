// Sincronizzazione con un Google Sheet nel Drive dell'utente.
// Accesso: Google Identity Services (token OAuth nel browser).
// Scope: drive.file (scrive solo i file creati da Runway, cioè il foglio dati) +
// drive.readonly (legge i PDF delle cartelle monitorate; non può modificare né cancellare nulla).
import type { AppState, Collection, Entity } from '../types';

const SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';
const SHEET_TITLE = 'Runway - Dati';
const TOKEN_KEY = 'runway.gtoken';

export const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || '';
export const isConfigured = () => !!CLIENT_ID;

export const TABS: Record<Collection, string> = {
  movements: 'Movimenti',
  categories: 'Categorie',
  accounts: 'Conti',
  recurrences: 'Ricorrenze',
  rules: 'Regole'
};

const COLUMNS: Record<Collection, string[]> = {
  movements: ['id', 'date', 'kind', 'amount', 'categoryId', 'accountId', 'description', 'splitMode', 'splitValue', 'refund',
    'refundIncomeId', 'compFrom', 'compTo', 'planned', 'recurrenceId', 'occurrence', 'notes', 'demo', 'createdAt', 'updatedAt', 'deleted', 'refundAmount', 'importId', 'docFileId', 'docName', 'mealVouchers', 'refundIn', 'toConfirm'],
  categories: ['id', 'name', 'icon', 'color', 'kind', 'group', 'splitMode', 'splitValue', 'order', 'excluded', 'updatedAt', 'deleted'],
  accounts: ['id', 'name', 'icon', 'kind', 'order', 'updatedAt', 'deleted', 'checkDate', 'checkBalance', 'voucherValue'],
  recurrences: ['id', 'name', 'kind', 'amount', 'categoryId', 'accountId', 'splitMode', 'splitValue', 'every', 'unit', 'start', 'endMode',
    'count', 'until', 'active', 'toVerify', 'skipped', 'driveFolderId', 'driveFolderName', 'notes', 'updatedAt', 'deleted', 'confirm', 'docTemplate', 'docSupply', 'docIgnored', 'refundable', 'refundAmount', 'amountAuto', 'refundIn', 'docDate'],
  rules: ['id', 'key', 'kind', 'categoryId', 'splitMode', 'splitValue', 'updatedAt', 'deleted']
};

const NUM = new Set(['amount', 'refundAmount', 'splitValue', 'order', 'every', 'count', 'createdAt', 'updatedAt', 'mealVouchers', 'checkBalance', 'voucherValue']);
const BOOL = new Set(['planned', 'demo', 'deleted', 'excluded', 'active', 'toVerify', 'confirm', 'refundable', 'amountAuto', 'refundIn', 'docDate', 'toConfirm']);
const JSONF = new Set(['skipped', 'docIgnored']);

// ---------- Token ----------

interface TokenInfo { token: string; exp: number; scope?: string }
// un token ottenuto con permessi diversi da quelli attuali non vale: serve un nuovo consenso
let tokenInfo: TokenInfo | null = (() => {
  try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); return t?.scope === SCOPE ? t : null; } catch { return null; }
})();
/** I permessi sono cambiati dall'ultimo consenso (es. aggiunta della lettura del Drive). */
const scopeChanged = () => { try { return localStorage.getItem(TOKEN_KEY + '.scope') !== SCOPE; } catch { return true; } };

export const hasValidToken = () => !!tokenInfo && Date.now() < tokenInfo.exp;
export const hasSignedInBefore = () => !!localStorage.getItem(TOKEN_KEY + '.seen');

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisPromise = null; reject(new Error('Impossibile caricare il login Google')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** Va chiamata da un click (apre il popup Google). */
export async function signIn(): Promise<void> {
  if (!CLIENT_ID) throw new Error('Client ID Google non configurato');
  await loadGis();
  const g = (window as any).google;
  await new Promise<void>((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r: any) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        tokenInfo = { token: r.access_token, exp: Date.now() + (Number(r.expires_in) - 60) * 1000, scope: SCOPE };
        try {
          localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenInfo));
          localStorage.setItem(TOKEN_KEY + '.seen', '1');
          localStorage.setItem(TOKEN_KEY + '.scope', SCOPE);
        } catch { /* storage non disponibile */ }
        resolve();
      },
      error_callback: (e: any) => reject(new Error(e?.message || 'Accesso annullato'))
    });
    client.requestAccessToken({ prompt: hasSignedInBefore() && !scopeChanged() ? '' : 'consent' });
  });
}

export function signOut() {
  const g = (window as any).google;
  if (tokenInfo && g?.accounts?.oauth2) g.accounts.oauth2.revoke(tokenInfo.token, () => {});
  tokenInfo = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* */ }
}

export class AuthError extends Error {}

/** Token OAuth corrente (per il Picker), o null se scaduto. */
export const accessToken = () => (hasValidToken() ? tokenInfo!.token : null);

export async function api<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  if (!hasValidToken()) throw new AuthError('Sessione Google scaduta');
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${tokenInfo!.token}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  if (res.status === 401) {
    tokenInfo = null;
    throw new AuthError('Sessione Google scaduta');
  }
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? (undefined as T) : res.json();
}

// ---------- Spreadsheet ----------

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

async function findOrCreateSpreadsheet(knownId?: string): Promise<string> {
  if (knownId) {
    try {
      await api(`${SHEETS}/${knownId}?fields=spreadsheetId`);
      return knownId;
    } catch (e) {
      if (e instanceof AuthError) throw e;
    }
  }
  const q = encodeURIComponent(`name='${SHEET_TITLE}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const found = await api<{ files: { id: string }[] }>(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&orderBy=createdTime`);
  if (found.files?.length) return found.files[0].id;
  const created = await api<{ spreadsheetId: string }>(SHEETS, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: SHEET_TITLE, locale: 'it_IT' },
      sheets: Object.values(TABS).map((title) => ({ properties: { title, gridProperties: { frozenRowCount: 1 } } }))
    })
  });
  return created.spreadsheetId;
}

async function ensureTabs(id: string) {
  const meta = await api<{ sheets: { properties: { title: string } }[] }>(`${SHEETS}/${id}?fields=sheets.properties.title`);
  const have = new Set(meta.sheets.map((s) => s.properties.title));
  const missing = Object.values(TABS).filter((t) => !have.has(t));
  if (missing.length)
    await api(`${SHEETS}/${id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) })
    });
}

// ---------- Serializzazione ----------

function toRow(col: Collection, e: any): (string | number | boolean)[] {
  return COLUMNS[col].map((k) => {
    let v: any = k === 'splitMode' ? e.split?.mode : k === 'splitValue' ? e.split?.value : e[k];
    if (v === undefined || v === null) return '';
    if (JSONF.has(k)) return JSON.stringify(v);
    if (BOOL.has(k)) return v ? true : '';
    return v;
  });
}

function fromRow(col: Collection, header: string[], row: any[]): Entity | null {
  const o: any = {};
  header.forEach((k, i) => {
    const v = row[i];
    if (v === '' || v === undefined || v === null) return;
    if (NUM.has(k)) o[k] = Number(v);
    else if (BOOL.has(k)) o[k] = v === true || v === 'TRUE' || v === 'true' || v === 1;
    else if (JSONF.has(k)) { try { o[k] = JSON.parse(v); } catch { o[k] = []; } }
    else o[k] = String(v);
  });
  if (!o.id) return null;
  if ('splitMode' in o || 'splitValue' in o) {
    o.split = { mode: o.splitMode === 'amount' ? 'amount' : 'pct', value: o.splitValue ?? 100 };
    delete o.splitMode; delete o.splitValue;
  }
  if (col === 'movements') { o.planned = !!o.planned; o.refund = o.refund || 'none'; }
  if (col === 'recurrences') { o.active = !!o.active; o.skipped = o.skipped || []; }
  o.updatedAt = o.updatedAt || 0;
  return o as Entity;
}

type Data = Pick<AppState, Collection>;
const COLS = Object.keys(TABS) as Collection[];

async function pull(id: string): Promise<Data> {
  const ranges = COLS.map((c) => `ranges=${encodeURIComponent(TABS[c] + '!A1:ZZ')}`).join('&');
  const res = await api<{ valueRanges: { values?: any[][] }[] }>(`${SHEETS}/${id}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`);
  const out: any = {};
  COLS.forEach((c, i) => {
    const values = res.valueRanges[i]?.values ?? [];
    const [header = [], ...rows] = values;
    out[c] = rows.map((r) => fromRow(c, header as string[], r)).filter(Boolean);
  });
  return out;
}

async function push(id: string, data: Data) {
  await api(`${SHEETS}/${id}/values:batchClear`, {
    method: 'POST',
    body: JSON.stringify({ ranges: COLS.map((c) => `${TABS[c]}!A1:ZZ`) })
  });
  await api(`${SHEETS}/${id}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: COLS.map((c) => ({
        range: `${TABS[c]}!A1`,
        values: [COLUMNS[c], ...(data[c] as any[]).map((e) => toRow(c, e))]
      }))
    })
  });
}

function mergeList<T extends { id: string; updatedAt: number }>(a: T[], b: T[]): T[] {
  const m = new Map<string, T>();
  for (const x of a) m.set(x.id, x);
  for (const y of b) {
    const x = m.get(y.id);
    if (!x || (y.updatedAt ?? 0) > (x.updatedAt ?? 0)) m.set(y.id, y);
  }
  return [...m.values()];
}

/** Scarica, unisce (vince la modifica più recente) e ricarica tutto sullo Sheet. */
export async function syncAll(local: AppState): Promise<{ data: Data; spreadsheetId: string }> {
  const id = await findOrCreateSpreadsheet(local.settings.spreadsheetId);
  await ensureTabs(id);
  const remote = await pull(id);
  const data: any = {};
  for (const c of COLS) data[c] = mergeList(local[c] as any[], remote[c] as any[]);
  await push(id, data);
  return { data, spreadsheetId: id };
}

export const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;
