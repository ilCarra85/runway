// Google Drive: selettore di cartelle (Google Picker) e lettura dei PDF di una cartella.
// Lettura con lo scope drive.readonly; il Picker serve solo a scegliere la cartella navigando nel Drive.

import { AuthError, accessToken, api } from './google';

export const API_KEY = (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined)?.trim() || '';
/** Numero del progetto Google Cloud (facoltativo, richiesto dal Picker per concedere l'accesso ai file). */
export const APP_ID = (import.meta.env.VITE_GOOGLE_APP_ID as string | undefined)?.trim() || '';
export const pickerConfigured = () => !!API_KEY;

const DRIVE = 'https://www.googleapis.com/drive/v3';

export interface DriveFile { id: string; name: string; mimeType: string; modifiedTime: string; size?: string; webViewLink?: string }

let gapiPromise: Promise<void> | null = null;
function loadPickerApi(): Promise<void> {
  if (gapiPromise) return gapiPromise;
  gapiPromise = new Promise((resolve, reject) => {
    const done = () => (window as any).gapi.load('picker', { callback: () => resolve(), onerror: () => reject(new Error('Impossibile caricare il selettore Google')) });
    if ((window as any).gapi) return done();
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.async = true;
    s.onload = done;
    s.onerror = () => { gapiPromise = null; reject(new Error('Impossibile caricare il selettore Google')); };
    document.head.appendChild(s);
  });
  return gapiPromise;
}

/** Apre il selettore di Google per scegliere una cartella. Va chiamata da un click. */
export async function pickFolder(): Promise<{ id: string; name: string } | null> {
  const token = accessToken();
  if (!token) throw new AuthError('Accedi a Google per scegliere una cartella');
  if (!API_KEY) throw new Error('Chiave API Google (VITE_GOOGLE_API_KEY) non configurata');
  await loadPickerApi();
  const g = (window as any).google;
  return new Promise((resolve) => {
    // "Il mio Drive" navigabile per cartelle (setParent('root')) + una vista di ricerca tra tutte le cartelle
    const tree = new g.picker.DocsView(g.picker.ViewId.FOLDERS)
      .setParent('root')
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder')
      .setMode(g.picker.DocsViewMode.LIST)
      .setLabel('Il mio Drive');
    const all = new g.picker.DocsView(g.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder')
      .setMode(g.picker.DocsViewMode.LIST)
      .setLabel('Tutte le cartelle');
    let builder = new g.picker.PickerBuilder()
      .addView(tree)
      .addView(all)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setLocale('it')
      .setTitle('Scegli la cartella da monitorare')
      .setCallback((data: any) => {
        const action = data[g.picker.Response.ACTION];
        if (action === g.picker.Action.PICKED) {
          const doc = data[g.picker.Response.DOCUMENTS][0];
          resolve({ id: doc[g.picker.Document.ID], name: doc[g.picker.Document.NAME] });
        } else if (action === g.picker.Action.CANCEL) resolve(null);
      });
    if (APP_ID) builder = builder.setAppId(APP_ID);
    builder.build().setVisible(true);
  });
}

/** PDF contenuti in una cartella (non ricorsivo), dal più recente. */
export async function listFolderPdfs(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and mimeType = 'application/pdf' and trashed = false`);
    const fields = encodeURIComponent('nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink)');
    const r = await api<{ files: DriveFile[]; nextPageToken?: string }>(
      `${DRIVE}/files?q=${q}&fields=${fields}&orderBy=modifiedTime desc&pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`
    );
    out.push(...r.files);
    pageToken = r.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** Contenuto di un file del Drive. */
export async function downloadFile(fileId: string): Promise<ArrayBuffer> {
  const token = accessToken();
  if (!token) throw new AuthError('Sessione Google scaduta');
  const res = await fetch(`${DRIVE}/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new AuthError('Sessione Google scaduta');
  if (!res.ok) throw new Error(`Download non riuscito (${res.status})`);
  return res.arrayBuffer();
}
