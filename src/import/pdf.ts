// Estrazione del testo da un PDF, riga per riga, conservando la posizione orizzontale di ogni pezzo.
// pdf.js viene caricato solo quando serve (è pesante).

export interface Piece { x: number; s: string }
export type Line = Piece[];

export async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  return pdfjs;
}

export async function pdfLines(data: ArrayBuffer, maxPages = Infinity): Promise<Line[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const out: Line[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows: { y: number; items: Piece[] }[] = [];
    for (const it of tc.items as any[]) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const x = Math.round(it.transform[4]);
      let row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, s: it.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) out.push(r.items.sort((a, b) => a.x - b.x));
  }
  await doc.destroy();
  return out;
}

export const lineText = (l: Line) => l.map((p) => p.s).join(' ');

/** Pezzi di testo con posizione, pagina per pagina (y cresce verso l'alto). */
export interface PosItem { x: number; y: number; w: number; s: string }
export async function pdfItems(data: ArrayBuffer, maxPages = Infinity): Promise<PosItem[][]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const out: PosItem[][] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    out.push((tc.items as any[]).filter((it) => it.str?.trim())
      .map((it) => ({ x: Math.round(it.transform[4]), y: Math.round(it.transform[5]), w: Math.round(it.width ?? 0), s: it.str.trim() })));
  }
  await doc.destroy();
  return out;
}
