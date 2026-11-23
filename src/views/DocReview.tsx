import { useEffect, useMemo, useRef, useState } from 'react';
import { Award, Briefcase, ChevronLeft, Receipt, Ticket, ChevronRight, ExternalLink, Eye, FileText, Link2, Loader2, RefreshCw, X } from 'lucide-react';
import { useStore } from '../data/store';
import { useDocInbox, type DocChoice } from '../docs/inbox';
import type { DocRefund, Proposal } from '../docs/scan';
import { TEMPLATES, templateById } from '../docs/templates';
import { Sheet, AmountInput, Toggle } from '../components/ui';
import { Badge } from '../components/Icon';
import { RefundLinks } from '../components/RefundLinks';
import { downloadFile } from '../sync/drive';
import { loadPdfjs } from '../import/pdf';
import { formatDate } from '../lib/dates';
import { amountToInput, money, parseAmount } from '../lib/format';
import { myShare, refundOf as refundValue } from '../lib/stats';
import type { Movement } from '../types';

/** Elenco dei documenti trovati nelle cartelle monitorate, da confermare uno per uno o tutti insieme. */
type RefundSel = { on: boolean; amt: string };
type R730Sel = { on: boolean; amt: string };
type BonusSel = { on: boolean; amt: string };

/**
 * Uscite da collegare al rimborso letto in busta: la somma esatta se possibile, altrimenti la più vicina per difetto
 * (in busta ci possono essere spese non registrate). Candidate dalla più recente: di solito si rimborsa il mese prima.
 */
function pickRefunds(cands: Movement[], target: number): string[] {
  const goal = Math.round(target * 100);
  if (goal <= 0 || goal > 1_000_000) return [];
  const reach = new Map<number, { prev: number; id: string }>([[0, { prev: -1, id: '' }]]);
  for (const m of cands.slice(0, 40)) {
    const v = Math.round(refundValue(m) * 100);
    if (v <= 0) continue;
    for (const s0 of [...reach.keys()]) {
      const s1 = s0 + v;
      if (s1 <= goal && !reach.has(s1)) reach.set(s1, { prev: s0, id: m.id });
    }
    if (reach.has(goal)) break;
  }
  const best = Math.max(...reach.keys());
  const ids: string[] = [];
  for (let s1 = best; s1 > 0; s1 = reach.get(s1)!.prev) ids.push(reach.get(s1)!.id);
  return ids;
}

export function DocReview({ onClose }: { onClose: () => void }) {
  const { state } = useStore();
  const inbox = useDocInbox();
  const [preview, setPreview] = useState<Proposal | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [refunds, setRefunds] = useState<Record<string, RefundSel>>({});
  const [links, setLinks] = useState<Record<string, string[]>>({});
  const [r730s, setR730s] = useState<Record<string, R730Sel>>({});
  const [bonuses, setBonuses] = useState<Record<string, BonusSel>>({});
  const recognized = inbox.proposals.filter((p) => p.parsed);
  const key = (p: Proposal) => p.file.id + p.recId;

  const recs = new Map(state.recurrences.map((r) => [r.id, r]));
  // rimborso di ogni voce: proposto quello della ricorrenza (o del movimento già esistente), modificabile
  const refundOf = (p: Proposal) => {
    const set = refunds[key(p)];
    if (set) return set;
    const m = p.match && p.match.refund !== 'none' ? p.match : undefined;
    const r = recs.get(p.recId);
    return m ? { on: true, amt: amountToInput(m.refundAmount) }
      : { on: !!r && r.kind === 'uscita' && !!r.refundable, amt: amountToInput(r?.refundAmount) };
  };
  const m0 = (p: Proposal) => p.match;
  const docRefund = (p: Proposal, amount: number): DocRefund => {
    const { on, amt } = refundOf(p);
    if (!on) return { refund: 'none', refundAmount: undefined };
    const v = parseAmount(amt);
    // vuoto o non inferiore all'importo = rimborso totale
    // "rimborsata" solo collegandola all'entrata che la rimborsa (es. busta paga)
    return { refund: m0(p)?.refund === 'reimbursed' ? 'reimbursed' : 'pending', refundAmount: amt.trim() && Number.isFinite(v) && v >= 0 && !(Number.isFinite(amount) && v >= amount) ? v : undefined };
  };
  // uscite in attesa di rimborso: le buste paga le rimborsano
  const pending = useMemo(() => state.movements.filter((m) => !m.deleted && m.kind === 'uscita' && m.refund === 'pending')
    .sort((a, b) => a.date.localeCompare(b.date)), [state.movements]);
  // proposta automatica: per ogni busta (dalla più vecchia) le uscite che tornano esattamente col rimborso letto
  const auto = useMemo(() => {
    const out = new Map<string, string[]>();
    const taken = new Set<string>();
    const withRefund = inbox.proposals.filter((p) => p.parsed?.refundExpenses).sort((a, b) => a.date.localeCompare(b.date));
    for (const p of withRefund) {
      // prima le spese di prima del mese della busta (di solito la busta di aprile rimborsa marzo), dalla più recente
      const free = pending.filter((m) => !taken.has(m.id) && m.date <= p.date).reverse();
      const from = p.parsed!.periodFrom ?? p.date;
      const ids = pickRefunds([...free.filter((m) => m.date < from), ...free.filter((m) => m.date >= from)], p.parsed!.refundExpenses!);
      ids.forEach((id) => taken.add(id));
      out.set(key(p), ids);
    }
    return out;
  }, [inbox.proposals, pending]);
  const linksOf = (p: Proposal) => links[key(p)] ?? auto.get(key(p)) ?? [];
  const r730Of = (p: Proposal): R730Sel => r730s[key(p)] ?? { on: !!p.parsed?.refund730, amt: amountToInput(p.parsed?.refund730) };
  const r730Value = (p: Proposal) => { const x = r730Of(p), v = parseAmount(x.amt); return x.on && Number.isFinite(v) && v > 0 ? v : undefined; };
  const bonusOf = (p: Proposal): BonusSel => bonuses[key(p)] ?? { on: !!p.parsed?.bonus, amt: amountToInput(p.parsed?.bonus) };
  const bonusValue = (p: Proposal) => { const x = bonusOf(p), v = parseAmount(x.amt); return x.on && Number.isFinite(v) && v > 0 ? v : undefined; };
  const choice = (p: Proposal, amount: number): DocChoice => {
    const r = recs.get(p.recId);
    if (r?.kind === 'uscita') return { refund: docRefund(p, amount) };
    return { links: linksOf(p), meal: p.parsed?.mealVouchers, r730: r730Value(p), bonus: bonusValue(p) };
  };
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  const supplyLabel = (p: Proposal) => {
    const r = recs.get(p.recId);
    if (!p.parsed) return p.locked ? 'Protetto da password' : 'Documento non riconosciuto';
    const t = templateById(r?.docTemplate) ?? TEMPLATES.find((x) => x.supplies.some((s) => s.id === p.parsed!.supply));
    return t?.supplies.find((s) => s.id === p.parsed!.supply)?.label ?? p.parsed.supply;
  };

  return (
    <Sheet title="Documenti da confermare" onClose={onClose} footer={recognized.length > 1 ? (
      <button className="btn primary grow" onClick={() => inbox.confirmAll(recognized, (p) => choice(p, p.parsed!.amount))}>
        Conferma tutti i riconosciuti ({recognized.length}) con gli importi letti
      </button>
    ) : undefined}>
      <div className="doc-head">
        <p className="muted small">Importi letti in automatico dai PDF delle cartelle monitorate. Controllali (anche con l'anteprima) e conferma.</p>
        <button className="btn small ghost" onClick={inbox.scan} disabled={!!inbox.busy}>
          {inbox.busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Ricontrolla
        </button>
      </div>
      {inbox.busy && <p className="muted small">{inbox.busy}</p>}
      {inbox.error && <div className="error-msg">{inbox.error}</div>}
      {!inbox.busy && inbox.proposals.length === 0 && <p className="muted">Nessun documento nuovo da confermare.</p>}

      <div className="doc-list">
        {inbox.proposals.map((p) => {
          const r = recs.get(p.recId);
          const c = r ? cats.get(r.categoryId) : undefined;
          const value = amounts[key(p)] ?? (p.parsed ? amountToInput(p.parsed.amount) : '');
          const amount = parseAmount(value);
          const date = dates[key(p)] ?? p.date;
          const rf = refundOf(p);
          const setRf = (v: Partial<RefundSel>) => setRefunds({ ...refunds, [key(p)]: { ...rf, ...v } });
          const rfAmount = docRefund(p, amount);
          const changed = !!p.parsed && Number.isFinite(amount) && Math.abs(amount - p.parsed.amount) > 0.005;
          return (
            <div key={key(p)} className="doc-card">
              <div className="doc-top">
                <Badge icon={c?.icon ?? 'FileText'} color={c?.color ?? '#64748b'} size={36} />
                <span className="doc-title">
                  <strong>{r?.name ?? 'Ricorrenza'}</strong>
                  <small className={p.parsed ? '' : 'warn-text'}>{supplyLabel(p)}{p.parsed?.periodFrom && p.parsed?.periodTo ? ` · dal ${formatDate(p.parsed.periodFrom)} al ${formatDate(p.parsed.periodTo)}` : ''}</small>
                  <small><FileText size={12} /> {p.file.name}</small>
                </span>
              </div>
              <div className="doc-fields">
                <label><span>Importo</span><AmountInput value={value} onChange={(v) => setAmounts({ ...amounts, [key(p)]: v })} /></label>
                <label><span>{p.parsed?.dueDate ? 'Scadenza' : 'Data'}</span><input type="date" value={date} onChange={(e) => setDates({ ...dates, [key(p)]: e.target.value })} /></label>
              </div>
              {r?.kind === 'uscita' && (
                <div className="doc-refund">
                  <Toggle checked={rf.on} onChange={(v) => setRf({ on: v })} icon={<Briefcase size={20} />} label="Rimborsabile"
                    hint={rf.on ? "Resta da rimborsare finché non la colleghi all'entrata che la rimborsa" : 'Non rimborsabile'} />
                  {rf.on && (
                    <label className="doc-refund-amount"><span>Importo rimborsato</span>
                      <div className="refund-amount">
                        <AmountInput value={rf.amt} onChange={(v) => setRf({ amt: v })} placeholder={Number.isFinite(amount) && amount > 0 ? amountToInput(amount) : 'Tutto'} />
                        {rf.amt && <button type="button" className="btn small ghost" onClick={() => setRf({ amt: '' })}>Tutto</button>}
                      </div>
                      <small className="muted">{rfAmount.refundAmount === undefined ? 'Rimborso totale' : `${money(Math.max(0, (Number.isFinite(amount) ? myShare(amount, r.split) : 0) - rfAmount.refundAmount))} restano a tuo carico`}</small>
                    </label>
                  )}
                </div>
              )}
              {r?.kind === 'entrata' && p.parsed && (() => {
                const sel = linksOf(p);
                const others = new Set(inbox.proposals.filter((q) => key(q) !== key(p)).flatMap(linksOf));
                const cands = pending.filter((m) => !others.has(m.id) && (m.date <= date || sel.includes(m.id))).reverse();
                const read = p.parsed.refundExpenses ?? 0;
                const x7 = r730Of(p), v7 = r730Value(p);
                const xb = bonusOf(p), vb = bonusValue(p);
                const salary = Number.isFinite(amount) ? Math.max(0, amount - (v7 ?? 0) - (vb ?? 0)) : NaN;
                const setSel = (ids: string[]) => setLinks({ ...links, [key(p)]: ids });
                return (<>
                  {(read > 0 || sel.length > 0) && (
                    <div className="doc-links">
                      <p className="doc-links-head"><Briefcase size={14} /><span>Rimborsato <strong>{money(read)}</strong></span></p>
                      <RefundLinks selected={sel} candidates={cands} categories={state.categories} target={read} near={date} onChange={setSel} />
                    </div>
                  )}
                  <div className="doc-refund">
                    <Toggle checked={x7.on} onChange={(v) => setR730s({ ...r730s, [key(p)]: { ...x7, on: v } })} icon={<Receipt size={20} />} label="Contiene rimborso 730"
                      hint={x7.on ? (v7 !== undefined && Number.isFinite(amount) ? `Stipendio ${money(salary)} + Rimborso 730 ${money(v7)} come voce a parte` : "Inserisci l'importo del 730") : 'Tutto il netto è stipendio'} />
                    {x7.on && (
                      <label className="doc-refund-amount"><span>Rimborso 730</span>
                        <AmountInput value={x7.amt} onChange={(v) => setR730s({ ...r730s, [key(p)]: { ...x7, amt: v } })} />
                      </label>
                    )}
                  </div>
                  <div className="doc-refund">
                    <Toggle checked={xb.on} onChange={(v) => setBonuses({ ...bonuses, [key(p)]: { ...xb, on: v } })} icon={<Award size={20} />} label="Contiene premio risultato"
                      hint={xb.on ? (vb !== undefined && Number.isFinite(amount) ? `Stipendio ${money(salary)} + Premio ${money(vb)} come voce a parte` : "Inserisci l'importo netto del premio") : 'Nessun premio in questa busta'} />
                    {xb.on && (
                      <label className="doc-refund-amount"><span>Premio netto{p.parsed.bonusGross ? ` (stimato da ${money(p.parsed.bonusGross)} lordi)` : ''}</span>
                        <AmountInput value={xb.amt} onChange={(v) => setBonuses({ ...bonuses, [key(p)]: { ...xb, amt: v } })} />
                      </label>
                    )}
                  </div>
                  {!!p.parsed.mealVouchers && <small className="muted doc-meal"><Ticket size={14} /> Buoni pasto {money(p.parsed.mealVouchers)}: non registrati, li conti al controllo dei buoni</small>}
                </>);
              })()}
              {p.match && (
                <p className="doc-match"><Link2 size={14} />
                  {p.match.importId
                    ? `Completa il movimento della banca del ${formatDate(p.match.date)} (${money(p.match.amount)})`
                    : `Aggiorna il movimento previsto del ${formatDate(p.match.date)} (${money(p.match.amount)})`}
                  {p.match.importId && Math.abs(p.match.amount - amount) > 0.005 && <strong className="neg"> · importo diverso dalla banca</strong>}
                </p>
              )}
              {!p.parsed && p.locked && <p className="muted small">Il file è protetto da password e non si può leggere. Aprilo con l'anteprima (ti chiede la password) e inserisci importo e data, oppure scartalo.</p>}
              {!p.parsed && !p.locked && <p className="muted small">Il modello non ha letto questo file (scansione, sollecito, contratto…). Guarda l'anteprima e inserisci importo e data, oppure scartalo.</p>}
              {changed && <p className="muted small">Hai corretto l'importo letto ({money(p.parsed!.amount)}).</p>}
              <div className="doc-actions">
                <button className="btn small ghost" onClick={() => setPreview(p)}><Eye size={16} /> Anteprima</button>
                <button className="btn small ghost" onClick={() => inbox.ignore(p)}>Scarta</button>
                <button className="btn small primary" disabled={!Number.isFinite(amount) || amount < 0 || !date} onClick={() => inbox.confirm(p, amount, date, choice(p, amount))}>Conferma</button>
              </div>
            </div>
          );
        })}
      </div>
      {preview && <PdfPreview fileId={preview.file.id} name={preview.file.name} link={preview.file.webViewLink} onClose={() => setPreview(null)} />}
    </Sheet>
  );
}

/** Anteprima di un PDF del Drive, disegnata con pdf.js (funziona anche su telefono). */
export function PdfPreview({ fileId, name, link, onClose }: { fileId: string; name: string; link?: string; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<any>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [pwdAsk, setPwdAsk] = useState<'' | 'need' | 'wrong'>('');
  const [pwd, setPwd] = useState('');
  const [tryPwd, setTryPwd] = useState<string | undefined>();
  const dataRef = useRef<ArrayBuffer | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (!dataRef.current) dataRef.current = await downloadFile(fileId);
        // copia: pdf.js si prende il buffer
        const doc = await pdfjs.getDocument({ data: new Uint8Array(dataRef.current.slice(0)), password: tryPwd }).promise;
        if (off) { doc.destroy(); return; }
        docRef.current = doc;
        setPwdAsk('');
        setPages(doc.numPages);
      } catch (e: any) {
        if (off) return;
        if (e?.name === 'PasswordException') { setPwdAsk(tryPwd === undefined ? 'need' : 'wrong'); setLoading(false); return; }
        setErr(e?.message || String(e)); setLoading(false);
      }
    })();
    return () => { off = true; docRef.current?.destroy(); docRef.current = null; };
  }, [fileId, tryPwd]);

  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !canvas.current) return;
    let task: any;
    (async () => {
      setLoading(true);
      const p = await doc.getPage(page);
      const width = Math.min(window.innerWidth - 32, 820);
      const base = p.getViewport({ scale: 1 });
      const scale = (width / base.width) * (window.devicePixelRatio || 1);
      const vp = p.getViewport({ scale });
      const c = canvas.current!;
      c.width = vp.width; c.height = vp.height;
      c.style.width = `${width}px`;
      task = p.render({ canvasContext: c.getContext('2d')!, viewport: vp });
      await task.promise.catch(() => {});
      setLoading(false);
    })();
    return () => task?.cancel();
  }, [page, pages]);

  return (
    <div className="preview-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="preview">
        <header>
          <strong title={name}>{name}</strong>
          {link && <a className="icon-btn" href={link} target="_blank" rel="noreferrer" aria-label="Apri in Drive"><ExternalLink size={18} /></a>}
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi anteprima"><X size={20} /></button>
        </header>
        <div className="preview-body">
          {err ? <div className="error-msg">{err}</div> : pwdAsk ? (
            <form className="preview-pwd" onSubmit={(e) => { e.preventDefault(); setLoading(true); setTryPwd(pwd); }}>
              <p>{pwdAsk === 'wrong' ? 'Password errata, riprova.' : 'Il file è protetto da password.'}</p>
              <input type="password" autoFocus value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Password del PDF" />
              <button className="btn primary" type="submit" disabled={!pwd}>Apri</button>
            </form>
          ) : <canvas ref={canvas} />}
          {loading && !err && !pwdAsk && <Loader2 className="spin preview-spin" />}
        </div>
        {pages > 1 && (
          <footer>
            <button className="icon-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Pagina precedente"><ChevronLeft /></button>
            <span>Pagina {page} di {pages}</span>
            <button className="icon-btn" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Pagina successiva"><ChevronRight /></button>
          </footer>
        )}
      </div>
    </div>
  );
}
