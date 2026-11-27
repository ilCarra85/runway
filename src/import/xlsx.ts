// Lettore minimo di file Excel (.xlsx) senza librerie: un .xlsx è uno zip di file XML.
// Si estrae il primo foglio come tabella di celle (testo o numero). Basta per gli export delle app (es. Satispay).

type Cell = string | number;

/** Estrae dallo zip i file richiesti (per nome). */
async function unzip(data: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const v = new DataView(data);
  const u8 = new Uint8Array(data);
  // fine della directory centrale: firma 0x06054b50 cercata dal fondo
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Il file non è un Excel valido (.xlsx)');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commLen;
    if (!wanted(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = u8.slice(start, start + size);
    if (method === 0) { out.set(name, dec.decode(raw)); continue; }
    if (method !== 8) throw new Error('Compressione dell\'Excel non supportata');
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    out.set(name, await new Response(stream).text());
  }
  return out;
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const colIndex = (ref: string) => [...ref.replace(/\d+$/, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** Righe del primo foglio; le celle vuote sono stringhe vuote. */
export async function readXlsx(data: ArrayBuffer): Promise<Cell[][]> {
  const files = await unzip(data, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/worksheets/sheet1.xml');
  const sheet = files.get('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('Nell\'Excel non trovo il primo foglio');
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rows: Cell[][] = [];
  for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: Cell[] = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = c[1].match(/r="([A-Z]+\d*)"/)?.[1];
      const t = c[1].match(/t="(\w+)"/)?.[1];
      const body = c[2] ?? '';
      const val = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let cell: Cell = '';
      if (t === 'inlineStr') cell = unescape([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
      else if (t === 's') cell = shared[Number(val)] ?? '';
      else if (t === 'str' || t === 'b') cell = unescape(val ?? '');
      else if (val !== undefined) cell = Number(val);
      const i = ref ? colIndex(ref) : row.length;
      while (row.length < i) row.push('');
      row[i] = cell;
    }
    rows.push(row);
  }
  return rows;
}

/** Data seriale di Excel (giorni dal 30/12/1899) → ISO YYYY-MM-DD. */
/** Orario di una data Excel (HH:MM), assente se la cella ha solo la data. */
export function excelTime(n: number): string | undefined {
  const min = Math.round((n % 1) * 1440);
  if (!min || min >= 1440) return undefined;
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function excelDate(n: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
  return d.toISOString().slice(0, 10);
}
