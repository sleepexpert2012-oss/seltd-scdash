import { Fragment, useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Cell, Legend,
} from 'recharts'
import master from '../data/master'
import {
  MONTHS, pickRows, agg, monthlySeries, groupBy, skuCount, revByTrend,
  comparePeriod, growth, sizeOf, NO_SIZE, SKU_MAP, SKU_TREND, IS_MOCK,
} from '../lib/metrics'
import { trieu, num, pct } from '../lib/format'
import { useDrill } from '../app/drill'
import './category.css'

const C = { bar: '#353E99', bar2: '#5C67C4', bar3: '#A9AFE0', line: '#D97706', grid: '#E7E9F3', axis: '#8E93B5' }
const NGANH = master.dims.nganh

const LEG = {
  verticalAlign: 'top', align: 'left', height: 26, iconSize: 10,
  wrapperStyle: { fontSize: 10.5, color: '#6E739B', paddingLeft: 24, lineHeight: '15px' },
}

export default function Category({ filters, setFilters }) {
  // ngành đang xem: lấy từ bộ lọc toàn cục, mặc định ngành lớn nhất
  const nganh = filters.nganh || NGANH[0]
  const [sortKey, setSortKey] = useState('rev')
  const [sizeSort, setSizeSort] = useState('un')

  const d = useMemo(() => {
    const a = Math.max(0, MONTHS.indexOf(filters.from))
    const b = Math.max(0, MONTHS.indexOf(filters.to))
    const range = [a, b]
    const fN = { ...filters, nganh }

    const rows = pickRows(fN, range)
    const cur = agg(rows)
    const cmp = comparePeriod(filters.from, filters.to, filters.compare)
    const prevRows = cmp ? pickRows(fN, cmp) : []
    const prev = cmp ? agg(prevRows) : null

    // toàn công ty cùng kỳ (bỏ lọc ngành) để tính tỷ trọng đóng góp
    const all = agg(pickRows({ ...filters, nganh: '' }, range))

    const byType = groupBy(rows, s => s.className)
    const byTypePrev = Object.fromEntries(groupBy(prevRows, s => s.className).map(g => [g.key, g]))
    const bySup = groupBy(rows, s => s.brand)
    const bySku = groupBy(rows, (s, r) => r.sku)
    const bySkuPrev = Object.fromEntries(groupBy(prevRows, (s, r) => r.sku).map(g => [g.key, g]))

    // theo kích thước: tổng ngành + tách theo loại hình trong từng size
    const bySize = groupBy(rows, (s, r) => sizeOf(r.sku))
    const bySizePrev = Object.fromEntries(groupBy(prevRows, (s, r) => sizeOf(r.sku)).map(g => [g.key, g]))
    const sizeType = groupBy(rows, (s, r) => `${sizeOf(r.sku)}||${s.className}`)
    const sizeSkus = {}
    for (const r of rows) {
      const k = sizeOf(r.sku)
      ;(sizeSkus[k] = sizeSkus[k] || new Set()).add(r.sku)
    }

    return {
      cur, prev, all, cmp, rows,
      series: monthlySeries(rows, range),
      byType, byTypePrev, bySup, bySku, bySkuPrev,
      bySize, bySizePrev, sizeType, sizeSkus,
      skus: skuCount(rows),
      trendRev: revByTrend(rows),
      months: b - a + 1,
    }
  }, [filters, nganh])

  const { cur, prev, all } = d
  const share = all.rev > 0 ? cur.rev / all.rev : 0
  const newShare = cur.rev > 0 ? d.trendRev.new / cur.rev : 0
  const lead = d.byType[0]

  const KPI = [
    { k: 'Doanh thu', v: trieu(cur.rev), u: 'triệu', g: prev && growth(cur.rev, prev.rev), p: prev && trieu(prev.rev), tone: 'blue' },
    { k: 'Lợi nhuận gộp', v: trieu(cur.gp), u: 'triệu', g: prev && growth(cur.gp, prev.gp), p: prev && trieu(prev.gp), tone: 'blue' },
    { k: 'GM %', v: pct(cur.gm), u: 'GP ÷ doanh thu', d: prev && (cur.gm - prev.gm), p: prev && pct(prev.gm) },
    { k: 'COGS', v: trieu(cur.cogs), u: 'triệu', g: prev && growth(cur.cogs, prev.cogs), p: prev && trieu(prev.cogs), invert: true },
    { k: 'Số lượng bán', v: num(Math.round(cur.un)), u: 'unit thuần', g: prev && growth(cur.un, prev.un), p: prev && num(Math.round(prev.un)) },
    { k: 'AOV', v: trieu(cur.aov, 2), u: 'triệu/đơn', g: prev && growth(cur.aov, prev.aov), p: prev && trieu(prev.aov, 2) },
    { k: 'Tỷ lệ huỷ đơn', v: pct(cur.cancelRate), u: 'GMV huỷ ÷ GMV', d: prev && (cur.cancelRate - prev.cancelRate), p: prev && pct(prev.cancelRate), tone: 'amber', invert: true },
    { k: '% đóng góp công ty', v: pct(share), u: 'trên tổng doanh thu', tone: 'blue' },
  ]

  return (
    <>
      <div className="section-lead">
        <div>
          <span>DEEP-DIVE NGÀNH HÀNG</span>
          <h2>Ngành {nganh}</h2>
          <p>
            Kỳ {filters.from} → {filters.to} ({d.months} tháng)
            {d.cmp ? ` · so với ${MONTHS[d.cmp[0]]} → ${MONTHS[d.cmp[1]]}` : ' · không so sánh'}
            {IS_MOCK && ' · số liệu bán hàng hiện là dữ liệu giả'}
          </p>
        </div>
      </div>

      <div className="cat-tabs">
        {NGANH.map(n => (
          <button key={n} className={'cat-tab' + (n === nganh ? ' on' : '')}
            onClick={() => setFilters(f => ({ ...f, nganh: n }))}>{n}</button>
        ))}
        {filters.nganh && (
          <button className="link-btn" onClick={() => setFilters(f => ({ ...f, nganh: '' }))}>
            Bỏ chọn ngành ở bộ lọc
          </button>
        )}
      </div>

      <div className="kpi-grid kpi-8">
        {KPI.map(x => <Kpi key={x.k} {...x} />)}
      </div>

      <div className="panel insight-strip">
        <span className="strip-title">Nhìn nhanh ngành {nganh}</span>
        <div className="mini-kpis">
          <Mini k="Loại hình" v={d.byType.length} s="đang có doanh thu" />
          <Mini k="SKU đang bán" v={d.skus} s={`trên ${master.skus.filter(s => s.nganh === nganh).length} SKU danh mục`} />
          <Mini k="Nhà cung cấp" v={d.bySup.length} s="có phát sinh trong kỳ" />
          <Mini k="Loại hình dẫn đầu" v={lead ? lead.key : '—'} s={lead ? `${pct(lead.rev / cur.rev)} doanh thu ngành` : '—'} wide />
          <Mini k="% DT từ SP mới" v={pct(newShare)} s="nhóm mới phát triển" />
          <Mini k="Giá bán BQ / unit" v={trieu(cur.un > 0 ? cur.rev / cur.un : 0, 2)} s="triệu đồng" />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Xu hướng ngành theo tháng</h2>
            <p>Cột = doanh thu (triệu, trục trái) · đường = GM% (trục phải)</p>
          </div>
          <div className="chart-legend"><span><i />Doanh thu · triệu (trục trái)</span><span><i className="line" />GM% (trục phải)</span></div>
        </div>
        <div className="chart" style={{ height: 260 }}>
          <ResponsiveContainer>
            <ComposedChart data={d.series.map(r => ({ label: r.label.slice(2), bar: r.rev / 1e6, line: r.gm * 100 }))}
              margin={{ top: 8, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.axis }} tickLine={false}
                axisLine={{ stroke: C.grid }} interval={0} angle={-38} textAnchor="end" height={44} />
              <YAxis yAxisId="L" tick={{ fontSize: 9, fill: C.axis }} tickLine={false} axisLine={false} width={50}
                tickFormatter={v => num(Math.round(v))} />
              <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 9, fill: C.line }} tickLine={false}
                axisLine={false} width={46} tickFormatter={v => `${v.toFixed(0)}%`} />
              <Tooltip contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
                formatter={(v, n) => [n === 'GM%' ? `${v.toFixed(1)}%` : `${num(Math.round(v))} triệu`, n]} />
              <Bar yAxisId="L" dataKey="bar" name="Doanh thu · tr (trái)" fill={C.bar} radius={[3, 3, 0, 0]} maxBarSize={26} />
              <Line yAxisId="R" dataKey="line" name="GM% (phải)" stroke={C.line} strokeWidth={2}
                dot={{ r: 2.5, fill: C.line, strokeWidth: 0 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Loại hình — kỳ chọn vs kỳ so sánh</h2>
              <p>Doanh thu (triệu) · cột đậm = kỳ chọn, cột nhạt = kỳ so sánh</p>
            </div>
          </div>
          <PairBars rows={d.byType} prev={d.byTypePrev} hasPrev={!!d.cmp} />
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Nhà cung cấp trong ngành</h2>
              <p>Doanh thu (triệu) và GM% từng nhà cung cấp trong kỳ</p>
            </div>
          </div>
          <SupplierBars rows={d.bySup} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Phân tích theo kích thước — ngành {nganh}</h2>
            <p>
              Kích thước lấy từ Rộng × Dài (cm) trong Master Data · bấm một dòng để xem loại hình nào
              đang chạy trong kích thước đó
            </p>
          </div>
          <div className="sort-row">
            {[['un', 'Theo số lượng'], ['rev', 'Theo doanh thu']].map(([k, l]) => (
              <button key={k} className={'chip' + (sizeSort === k ? ' on' : '')} onClick={() => setSizeSort(k)}>{l}</button>
            ))}
          </div>
        </div>
        <SizeTable d={d} sort={sizeSort} hasPrev={!!d.cmp} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Toàn bộ sản phẩm trong ngành {nganh}</h2>
            <p>Gộp theo loại hình, có dòng tổng từng nhóm · bấm dòng nhóm để mở/đóng · cột “Xu hướng” xét trên toàn bộ lịch sử, không phụ thuộc kỳ đang chọn</p>
          </div>
          <div className="sort-row">
            {[['rev', 'Doanh thu'], ['delta', 'Δ vs kỳ SS'], ['gm', 'GM%'], ['un', 'Số lượng']].map(([k, l]) => (
              <button key={k} className={'chip' + (sortKey === k ? ' on' : '')} onClick={() => setSortKey(k)}>{l}</button>
            ))}
          </div>
        </div>
        <SkuTable byType={d.byType} byTypePrev={d.byTypePrev} bySku={d.bySku} bySkuPrev={d.bySkuPrev}
          hasPrev={!!d.cmp} sortKey={sortKey} />
      </div>
    </>
  )
}

function SizeTable({ d, sort, hasPrev }) {
  const { open: drill } = useDrill()
  const [open, setOpen] = useState(() => new Set())
  const toggle = k => setOpen(o => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n })
  const rows = [...d.bySize].sort((a, b) => (sort === 'un' ? b.un - a.un : b.rev - a.rev))
  if (!rows.length) return <p className="empty">Không có dữ liệu trong phạm vi lọc hiện tại.</p>

  const totUn = rows.reduce((s, r) => s + r.un, 0)
  const totRev = rows.reduce((s, r) => s + r.rev, 0)
  const maxVal = Math.max(...rows.map(r => (sort === 'un' ? r.un : r.rev)))

  return (
    <>
    <div className="group-ctrl">
      <button className="xls-btn" onClick={() => setOpen(new Set(rows.map(r => r.key)))}>▼ Mở tất cả</button>
      <button className="xls-btn" onClick={() => setOpen(new Set())}>▶ Đóng tất cả</button>
    </div>
    <div className="table-wrap size-table">
      <table>
        <thead>
          <tr>
            <th>Kích thước (R × D, cm)</th>
            <th className="num">SL bán</th>
            <th>Tỷ trọng</th>
            <th className="num">% SL</th>
            <th className="num">Doanh thu</th>
            <th className="num">% DT</th>
            <th className="num">ASP</th>
            <th className="num">GM%</th>
            <th className="num">Δ vs kỳ SS</th>
            <th>Loại hình dẫn đầu</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const kids = d.sizeType
              .filter(x => x.key.startsWith(r.key + '||'))
              .sort((a, b) => (sort === 'un' ? b.un - a.un : b.rev - a.rev))
            const lead = kids[0]
            const p = d.bySizePrev[r.key]
            const dv = r.rev - (p?.rev || 0)
            const isOpen = open.has(r.key)
            const val = sort === 'un' ? r.un : r.rev
            return (
              <Fragment key={r.key}>
                <tr className={'clickable' + (isOpen ? ' on' : '')} onClick={() => toggle(r.key)}>
                  <td>
                    <b>{isOpen ? '▾' : '▸'} {r.key === NO_SIZE ? NO_SIZE : r.key}</b>
                    <small>{i === 0 ? 'Bán chạy nhất · ' : ''}{d.sizeSkus[r.key]?.size || 0} SKU</small>
                  </td>
                  <td className="num strong">{num(Math.round(r.un))}</td>
                  <td className="barcell">
                    <i style={{ width: `${maxVal > 0 ? (val / maxVal) * 100 : 0}%` }} />
                  </td>
                  <td className="num">{pct(totUn > 0 ? r.un / totUn : 0)}</td>
                  <td className="num">{trieu(r.rev)}</td>
                  <td className="num">{pct(totRev > 0 ? r.rev / totRev : 0)}</td>
                  <td className="num">{trieu(r.un > 0 ? r.rev / r.un : 0, 2)}</td>
                  <td className={'num ' + (r.gm >= 0.35 ? 'gm-hi' : r.gm >= 0.2 ? '' : 'gm-lo')}>{pct(r.gm)}</td>
                  <td className="num">{hasPrev
                    ? <span className={dv >= 0 ? 'up' : 'down'}>{dv >= 0 ? '+' : ''}{trieu(dv)}</span>
                    : <span className="dim">—</span>}</td>
                  <td className="lead">{lead ? lead.key.split('||')[1] : '—'}</td>
                </tr>
                {isOpen && kids.map(k => (
                  <tr key={k.key} className="child drillable"
                    onClick={() => drill(k.key.split('||')[1])}>
                    <td>
                      <b>{k.key.split('||')[1]}</b>
                      <small>{pct(r.un > 0 ? k.un / r.un : 0)} số lượng của kích thước này</small>
                    </td>
                    <td className="num strong">{num(Math.round(k.un))}</td>
                    <td className="barcell">
                      <i className="sub" style={{ width: `${r.un > 0 ? (k.un / r.un) * 100 : 0}%` }} />
                    </td>
                    <td className="num">{pct(r.un > 0 ? k.un / r.un : 0)}</td>
                    <td className="num">{trieu(k.rev)}</td>
                    <td className="num">{pct(r.rev > 0 ? k.rev / r.rev : 0)}</td>
                    <td className="num">{trieu(k.un > 0 ? k.rev / k.un : 0, 2)}</td>
                    <td className={'num ' + (k.gm >= 0.35 ? 'gm-hi' : k.gm >= 0.2 ? '' : 'gm-lo')}>{pct(k.gm)}</td>
                    <td className="num dim">—</td>
                    <td />
                  </tr>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
    </>
  )
}

function Kpi({ k, v, u, g, d, p, tone, invert }) {
  let cls = '', txt = null
  if (g != null || d != null) {
    const raw = g != null ? g : d
    const good = invert ? raw < 0 : raw > 0
    cls = Math.abs(raw) < 0.0005 ? '' : good ? 'good' : 'bad'
    txt = g != null ? `${g >= 0 ? '▲ +' : '▼ '}${(g * 100).toFixed(1)}% vs kỳ SS`
      : `${d >= 0 ? '▲ +' : '▼ '}${(d * 100).toFixed(1)} điểm %`
  }
  return (
    <div className={'kpi' + (tone ? ' ' + tone : '')}>
      <span>{k}</span>
      <strong>{v}</strong>
      <small className="unit">{u}</small>
      {p != null && <small className="prev">Kỳ SS: {p}</small>}
      {txt && <div className={'kpi-compare ' + cls}>{txt}</div>}
    </div>
  )
}

function Mini({ k, v, s, wide }) {
  return (
    <div className={'mini' + (wide ? ' wide' : '')}>
      <span>{k}</span>
      <strong>{v}</strong>
      <small>{s}</small>
    </div>
  )
}

function PairBars({ rows, prev, hasPrev }) {
  if (!rows.length) return <p className="empty">Không có dữ liệu.</p>
  const data = rows.slice(0, 8).map(r => ({
    name: r.key.length > 24 ? r.key.slice(0, 23) + '…' : r.key,
    cur: r.rev / 1e6,
    prev: (prev[r.key]?.rev || 0) / 1e6,
  }))
  return (
    <div className="chart" style={{ height: Math.max(200, data.length * 34 + 34) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 52, bottom: 4, left: 0 }} barGap={2}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 9, fill: C.axis }} tickLine={false}
            axisLine={{ stroke: C.grid }} tickFormatter={v => num(Math.round(v))} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10, fill: '#4A5285' }}
            tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: '#F1F3FA' }} contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
            formatter={v => `${num(Math.round(v))} triệu`} />
          {hasPrev && <Legend {...LEG} />}
          {hasPrev && <Bar dataKey="prev" name="Kỳ so sánh" fill={C.bar3} radius={[0, 3, 3, 0]} maxBarSize={9} />}
          <Bar dataKey="cur" name="Kỳ đang chọn" fill={C.bar} radius={[0, 3, 3, 0]} maxBarSize={9}
            label={{ position: 'right', fontSize: 9, fill: '#4A5285', formatter: v => num(Math.round(v)) }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function SupplierBars({ rows }) {
  if (!rows.length) return <p className="empty">Không có dữ liệu.</p>
  const data = rows.map(r => ({ name: r.key, rev: r.rev / 1e6, gm: r.gm }))
  const Label = ({ x, y, width, height, index }) => {
    const r = data[index]
    if (!r || x == null || width == null) return null
    return (
      <text x={x + width + 9} y={y + height / 2 + 3.5} fontSize="10" fill="#4A5285">
        <tspan fontWeight="700" fill="#1B2050">{num(Math.round(r.rev))}</tspan>
        <tspan dx="3" fontSize="8.5" fill="#8E93B5">triệu</tspan>
        <tspan dx="7" fontWeight="700" fill={r.gm >= 0.35 ? '#1F7A45' : r.gm >= 0.2 ? '#4A5285' : '#B42318'}>
          GM {pct(r.gm)}
        </tspan>
      </text>
    )
  }
  return (
    <div className="chart" style={{ height: Math.max(200, data.length * 36 + 34) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 120, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 9, fill: C.axis }} tickLine={false}
            axisLine={{ stroke: C.grid }} tickFormatter={v => num(Math.round(v))} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10, fill: '#4A5285' }}
            tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: '#F1F3FA' }} contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
            formatter={v => `${num(Math.round(v))} triệu`} />
          <Bar dataKey="rev" radius={[0, 3, 3, 0]} maxBarSize={16} label={<Label />}>
            {data.map((r, i) => <Cell key={r.name} fill={i === 0 ? C.bar : C.bar2} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const TREND_LABEL = { new: 'Mới', up: 'Tăng', down: 'Giảm', flat: 'Ổn định' }

function SkuTable({ byType, byTypePrev, bySku, bySkuPrev, hasPrev, sortKey }) {
  const { open: drill } = useDrill()
  const [open, setOpen] = useState(() => new Set(byType.slice(0, 2).map(t => t.key)))
  if (!byType.length) return <p className="empty">Không có dữ liệu trong phạm vi lọc hiện tại.</p>

  const skuByType = new Map()
  for (const s of bySku) {
    const t = SKU_MAP[s.key]?.className || '—'
    if (!skuByType.has(t)) skuByType.set(t, [])
    skuByType.get(t).push(s)
  }

  const sortFn = (a, b) => {
    if (sortKey === 'gm') return b.gm - a.gm
    if (sortKey === 'un') return b.un - a.un
    if (sortKey === 'delta') {
      const da = a.rev - (bySkuPrev[a.key]?.rev ?? byTypePrev[a.key]?.rev ?? 0)
      const db = b.rev - (bySkuPrev[b.key]?.rev ?? byTypePrev[b.key]?.rev ?? 0)
      return db - da
    }
    return b.rev - a.rev
  }

  const toggle = k => setOpen(o => {
    const n = new Set(o)
    n.has(k) ? n.delete(k) : n.add(k)
    return n
  })

  const Delta = ({ cur, prev }) => {
    if (!hasPrev) return <span className="dim">—</span>
    const dv = cur - prev
    const g = prev > 0 ? dv / prev : null
    return (
      <span className={dv >= 0 ? 'up' : 'down'}>
        {dv >= 0 ? '+' : ''}{trieu(dv)}
        {g != null && <em> ({(g * 100).toFixed(0)}%)</em>}
      </span>
    )
  }

  return (
    <>
    <div className="group-ctrl">
      <button className="xls-btn" onClick={() => setOpen(new Set(byType.map(t => t.key)))}>▼ Mở tất cả</button>
      <button className="xls-btn" onClick={() => setOpen(new Set())}>▶ Đóng tất cả</button>
    </div>
    <div className="table-wrap sku-table">
      <table>
        <thead>
          <tr>
            <th>Loại hình / SKU</th>
            <th>Xu hướng</th>
            <th className="num">DT kỳ SS</th>
            <th className="num">DT kỳ chọn</th>
            <th className="num">Δ</th>
            <th className="num">GM%</th>
            <th className="num">ASP</th>
            <th className="num">SL (unit)</th>
          </tr>
        </thead>
        <tbody>
          {[...byType].sort(sortFn).map(t => {
            const isOpen = open.has(t.key)
            const kids = (skuByType.get(t.key) || []).slice().sort(sortFn)
            return (
              <Fragment key={t.key}>
                <tr className="grp" onClick={() => toggle(t.key)}>
                  <td>
                    <b>{isOpen ? '▾' : '▸'} {t.key}</b>
                    <small>
                      {kids.length} SKU ·{' '}
                      <i className="drill-link" onClick={e => { e.stopPropagation(); drill(t.key) }}>xem phân tích sâu →</i>
                    </small>
                  </td>
                  <td />
                  <td className="num">{hasPrev ? trieu(byTypePrev[t.key]?.rev || 0) : '—'}</td>
                  <td className="num strong">{trieu(t.rev)}</td>
                  <td className="num"><Delta cur={t.rev} prev={byTypePrev[t.key]?.rev || 0} /></td>
                  <td className="num">{pct(t.gm)}</td>
                  <td className="num">{trieu(t.un > 0 ? t.rev / t.un : 0, 2)}</td>
                  <td className="num">{num(Math.round(t.un))}</td>
                </tr>
                {isOpen && kids.map(s => {
                  const info = SKU_MAP[s.key] || {}
                  const tr = SKU_TREND[s.key]
                  return (
                    <tr key={s.key} className="child">
                      <td><b>{info.name || s.key}</b><small>{s.key}</small></td>
                      <td><span className={'tag t-' + tr}>{TREND_LABEL[tr] || '—'}</span></td>
                      <td className="num">{hasPrev ? trieu(bySkuPrev[s.key]?.rev || 0) : '—'}</td>
                      <td className="num strong">{trieu(s.rev)}</td>
                      <td className="num"><Delta cur={s.rev} prev={bySkuPrev[s.key]?.rev || 0} /></td>
                      <td className={'num ' + (s.gm >= 0.35 ? 'gm-hi' : s.gm >= 0.2 ? '' : 'gm-lo')}>{pct(s.gm)}</td>
                      <td className="num">{trieu(s.un > 0 ? s.rev / s.un : 0, 2)}</td>
                      <td className="num">{num(Math.round(s.un))}</td>
                    </tr>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
    </>
  )
}
