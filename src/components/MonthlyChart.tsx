import { useEffect, useRef, useState } from 'react';
import type { MonthPoint } from '../lib/stats';
import { monthLabel, monthShort } from '../lib/dates';
import { money, money0 } from '../lib/format';

/** Barre affiancate Entrate / Uscite per mese, con tooltip al passaggio o al tocco. */
export function MonthlyChart({ data }: { data: MonthPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const h = 200, padL = 44, padB = 24, padT = 8;
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const plotW = w - padL - 4;
  const col = plotW / data.length;
  const bw = Math.max(3, Math.min(16, (col - 8) / 2));
  const y = (v: number) => padT + (h - padT - padB) * (1 - v / top);
  const bar = (x: number, v: number) => {
    const y0 = y(0), y1 = y(v), r = Math.min(4, bw / 2, y0 - y1);
    if (v <= 0) return '';
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + bw - r}Q${x + bw},${y1} ${x + bw},${y1 + r}V${y0}Z`;
  };
  const hd = hover !== null ? data[hover] : null;

  return (
    <div className="chart" ref={ref}>
      <div className="legend">
        <span><i style={{ background: 'var(--series-in)' }} /> Entrate</span>
        <span><i style={{ background: 'var(--series-out)' }} /> Uscite</span>
      </div>
      <div className="chart-plot">
        <svg width={w} height={h} role="img" aria-label="Entrate e uscite degli ultimi 12 mesi">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="tick">{compact(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = padL + col * i + col / 2;
            return (
              <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)}>
                <rect x={padL + col * i} y={padT} width={col} height={h - padT - padB} className={`hit ${hover === i ? 'on' : ''}`} />
                <path d={bar(cx - bw - 1, d.income)} fill="var(--series-in)" />
                <path d={bar(cx + 1, d.expense)} fill="var(--series-out)" />
                <text x={cx} y={h - 6} textAnchor="middle" className="tick">{monthShort(d.month)}</text>
              </g>
            );
          })}
        </svg>
        {hd && hover !== null && (
          <div className="tooltip" style={{ left: Math.min(w - 170, Math.max(0, padL + col * hover + col / 2 - 85)) }}>
            <strong>{monthLabel(hd.month)}</strong>
            <span><i style={{ background: 'var(--series-in)' }} />Entrate <b>{money(hd.income)}</b></span>
            <span><i style={{ background: 'var(--series-out)' }} />Uscite <b>{money(hd.expense)}</b></span>
            <span className="tt-total">Risparmio <b>{money(hd.income - hd.expense)}</b></span>
          </div>
        )}
      </div>
      <details className="table-view">
        <summary>Mostra tabella</summary>
        <table>
          <thead><tr><th>Mese</th><th>Entrate</th><th>Uscite</th><th>Risparmio</th></tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.month}><td>{monthLabel(d.month)}</td><td>{money0(d.income)}</td><td>{money0(d.expense)}</td><td>{money0(d.income - d.expense)}</td></tr>
          ))}</tbody>
        </table>
      </details>
    </div>
  );
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const compact = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })}k` : String(v));
