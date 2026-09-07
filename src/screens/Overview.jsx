import { useMemo } from 'react'
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Cell, ReferenceLine,
} from 'recharts'
import {
  MONTHS, pickRows, agg, monthlySeries, topSkus, comparePeriod, growth, IS_MOCK, PARTIAL,
  stockPlan, STATUS, STOCK_AS_OF,
} from '../lib/metrics'
import { trieu, num, pct } from '../lib/format'
import { useDrill } from '../app/drill'
import { SKU_MAP } from '../lib/metrics'
import './overview.css'

const C = { bar: '#353E99', bar2: '#5C67C4', line: '#D97706', line2: '#03406E', grid: '#E7E9F3', axis: '#8E93B5' }

export default function Overview({ filters }) {
  const d = useMemo(() => {
    const a = MONTHS.indexOf(filters.from), b = MONTHS.indexOf(filters.to)
    const range = [Math.max(0, a), Math.max(0, b)]
    const rows = pickRows(filters, range)
    const cur = agg(rows)

    const cmp = comparePeriod(filters.from, filters.to, filters.compare)
    const prev = cmp ? agg(pickRows(filters, cmp)) : null

    const stock = stockPlan(sk => {
      if (filters.nganh && sk.nganh !== filters.nganh) return false
      if (filters.loaiHinh && sk.className !== filters.loaiHinh) return false
      if (filters.supplier && sk.brand !== filters.supplier) return false
      if (filters.q) {
        const q = filters.q.toLowerCase()
        if (!(sk.sku.toLowerCase().includes(q) || sk.name.toLowerCase().includes(q))) return false
      }
      return true
    }).filter(r => r.ton > 0).sort((x, y) => y.value - x.value).slice(0, 10)

    return {
      cur, prev, cmp, stock,
      series: monthlySeries(rows, range),
      top: topSkus(rows, 10),
      months: range[1] - range[0] + 1,
    }
  }, [filters])

  const { cur, prev } = d

  const KPI = [
    { k: 'GMV', v: trieu(cur.gmv), u: 'triệu', sub: 'Giá thực bán × SL mua', g: prev && growth(cur.gmv, prev.gmv), p: prev && trieu(prev.gmv), tone: 'blue' },
    { k: 'Huỷ đơn', v: trieu(cur.cx), u: 'triệu', sub: 'GMV đơn đã huỷ', g: prev && growth(cur.cx, prev.cx), p: prev && trieu(prev.cx), tone: 'amber', invert: true },
    { k: 'Giảm giá', v: trieu(cur.dc), u: 'triệu', sub: 'Voucher + xu shop tự chịu', g: prev && growth(cur.dc, prev.dc), p: prev && trieu(prev.dc), invert: true },
    { k: 'Hoàn trả', v: trieu(cur.rt), u: 'triệu', sub: 'Giá trị hàng hoàn thực tế', g: prev && growth(cur.rt, prev.rt), p: prev && trieu(prev.rt), invert: true },
    { k: 'Doanh thu', v: trieu(cur.rev), u: 'triệu', sub: 'GMV − huỷ − giảm giá − hoàn', g: prev && growth(cur.rev, prev.rev), p: prev && trieu(prev.rev), tone: 'blue' },
    { k: 'COGS', v: trieu(cur.cogs), u: 'triệu', sub: 'SL bán thuần × giá vốn', g: prev && growth(cur.cogs, prev.cogs), p: prev && trieu(prev.cogs), invert: true },
    { k: 'GM %', v: pct(cur.gm), u: 'GP ÷ doanh thu', sub: `GP ${trieu(cur.gp)} triệu`, d: prev && (cur.gm - prev.gm), p: prev && pct(prev.gm), tone: 'blue' },
    { k: 'AOV', v: trieu(cur.aov, 2), u: 'triệu/đơn', sub: `${num(cur.o)} đơn thuần`, g: prev && growth(cur.aov, prev.aov), p: prev && trieu(prev.aov, 2) },
    { k: 'Tỷ lệ hoàn hàng', v: pct(cur.returnRate, 2), u: 'giá trị hoàn ÷ GMV', sub: `${num(Math.round(cur.u - cur.un))} unit không thành công`, d: prev && (cur.returnRate - prev.returnRate), p: prev && pct(prev.returnRate, 2), invert: true },
    { k: 'Tỷ lệ huỷ đơn', v: pct(cur.cancelRate), u: 'GMV huỷ ÷ GMV', sub: 'Cần theo dõi sát', d: prev && (cur.cancelRate - prev.cancelRate), p: prev && pct(prev.cancelRate), tone: 'amber', invert: true },
  ]

  return (
    <>
      <div className="section-lead">
        <div>
          <span>TOÀN CÔNG TY · 5 NGÀNH HÀNG</span>
          <h2>Tổng quan kinh doanh</h2>
          <p>
            Kỳ {filters.from} → {filters.to} ({d.months} tháng)
            {d.cmp ? ` · so với ${MONTHS[d.cmp[0]]} → ${MONTHS[d.cmp[1]]}` : ' · không so sánh'}
            {IS_MOCK && ' · số liệu bán hàng hiện là dữ liệu giả'}
            {PARTIAL && ` · ${PARTIAL.ym} mới có ${PARTIAL.have}/${PARTIAL.days} ngày`}
          </p>
        </div>
      </div>

      <div className="kpi-grid">
        {KPI.map(x => <Kpi key={x.k} {...x} />)}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Xu hướng doanh thu &amp; tỷ lệ huỷ</h2>
            <p>
              Cột chồng = GMV, tách thành doanh thu thực thu (đậm) và phần hao hụt do huỷ · giảm giá · hoàn (nhạt) ·
              đường cam = tỷ lệ huỷ đơn (%, trục phải)
            </p>
          </div>
          <div className="chart-legend">
            <span><i />Doanh thu thực thu · triệu (trục trái)</span>
            <span><i className="loss" />Hao hụt (huỷ · giảm giá · hoàn)</span>
            <span><i className="line" />Tỷ lệ huỷ đơn (trục phải)</span>
          </div>
        </div>
        <RevenueChart data={d.series} />
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Giá trị đơn hàng &amp; giá vốn bình quân</h2>
              <p>Vùng tô = AOV (triệu/đơn, trục trái) · đường cam = COGS bình quân trên một unit (triệu, trục phải) · nét đứt = mức COGS/unit bình quân kỳ</p>
            </div>
            <div className="chart-legend">
              <span><i className="area" />AOV · triệu/đơn (trục trái)</span><span><i className="line" />COGS bình quân/unit · triệu (trục phải)</span>
            </div>
          </div>
          <AovChart data={d.series} />
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Giá vốn &amp; biên gộp</h2>
              <p>Vùng tô = COGS (triệu, trục trái) · đường cam = GM% (trục phải) · nét đứt = GM% bình quân kỳ</p>
            </div>
            <div className="chart-legend">
              <span><i className="c-cogs" />COGS · triệu (trục trái)</span><span><i className="line" />GM% (trục phải)</span>
            </div>
          </div>
          <CogsChart data={d.series} />
        </div>
      </div>

      <div className="grid-2 top-pair">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Top 10 sản phẩm bán chạy</h2>
              <p>Xếp theo doanh thu thuần trong kỳ · kèm số lượng bán và GM% · bấm một thanh để mở phân tích sâu</p>
            </div>
          </div>
          <Top10 rows={d.top} />
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Top 10 sản phẩm tồn kho nhiều nhất</h2>
              <p>Xếp theo giá vốn tồn tại {STOCK_AS_OF} · kèm số lượng và số tháng bán còn · màu thanh theo trạng thái tồn</p>
            </div>
          </div>
          <TopStock rows={d.stock} />
        </div>
      </div>
    </>
  )
}

/* Top SKU tồn nhiều nhất — xếp theo giá vốn đọng, màu thanh theo trạng thái tồn kho */
const STT_FILL = ['#C0392B', '#E07B1A', '#353E99', '#B8860B', '#5C67C4', '#6B7280']

function TopStock({ rows }) {
  const { open: drill } = useDrill()
  if (!rows.length) return <p className="empty">Không có SKU nào còn tồn trong phạm vi lọc hiện tại.</p>

  const data = rows.map((r, i) => ({
    rank: i + 1, sku: r.sku, name: r.name, nganh: r.nganh, className: r.className,
    value: r.value / 1e6, ton: r.ton, ml: r.ml, stt: r.stt,
  }))
  const max = Math.max(...data.map(x => x.value))

  const ValueLabel = ({ x, y, width, height, index }) => {
    const r = data[index]
    if (!r || x == null || width == null) return null
    const slow = r.ml >= 6
    return (
      <text x={x + width + 9} y={y + height / 2 + 3.5} fontSize="10" fill="#4A5285">
        <tspan fontWeight="700" fill="#1B2050">{num(Math.round(r.value))}</tspan>
        <tspan dx="3" fontSize="8.5" fill="#8E93B5">triệu</tspan>
        <tspan dx="6" fill="#8E93B5">·</tspan>
        <tspan dx="6" fontWeight="600">{num(r.ton)}</tspan>
        <tspan dx="3" fontSize="8.5" fill="#8E93B5">u</tspan>
        <tspan dx="6" fill="#8E93B5">·</tspan>
        <tspan dx="6" fontWeight="700" fill={slow ? '#B42318' : '#4A5285'}>
          {r.ml >= 60 ? '60+' : r.ml.toFixed(1)} tháng
        </tspan>
      </text>
    )
  }

  const NameTick = ({ x, y, payload }) => {
    const r = data[payload?.index]
    if (!r) return null
    const nm = r.name.length > 30 ? r.name.slice(0, 29) + '…' : r.name
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={-8} y={-2} textAnchor="end" fontSize="10" fill="#1B2050" fontWeight="600">
          <tspan fill="#8E93B5" fontWeight="700">{r.rank}. </tspan>{nm}
        </text>
        <text x={-8} y={10} textAnchor="end" fontSize="8.5" fill="#8E93B5">
          {STATUS[r.stt].icon} {STATUS[r.stt].label} · {r.nganh}
        </text>
      </g>
    )
  }

  return (
    <div className="chart top10-chart" style={{ height: data.length * 42 + 44 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 168, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" domain={[0, max * 1.02]} tick={{ fontSize: 9, fill: C.axis }}
            tickLine={false} axisLine={{ stroke: C.grid }} tickFormatter={v => num(Math.round(v))} />
          <YAxis type="category" dataKey="sku" width={228} tickLine={false} axisLine={false} tick={NameTick} />
          <Tooltip cursor={{ fill: '#F1F3FA' }}
            contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
            formatter={(v, n, p) => [
              `${num(Math.round(v))} triệu · ${num(p.payload.ton)} unit · còn bán ${p.payload.ml.toFixed(1)} tháng`,
              p.payload.name,
            ]} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={20} label={<ValueLabel />}
            cursor="pointer" onClick={p => p?.payload?.className && drill(p.payload.className)}>
            {data.map(r => <Cell key={r.sku} fill={STT_FILL[r.stt] || C.bar2} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function Kpi({ k, v, u, sub, g, d, p, tone, invert }) {
  let cls = '', txt = null
  if (g != null || d != null) {
    const raw = g != null ? g : d
    const good = invert ? raw < 0 : raw > 0
    cls = Math.abs(raw) < 0.0005 ? '' : good ? 'good' : 'bad'
    txt = g != null
      ? `${g >= 0 ? '▲ +' : '▼ '}${(g * 100).toFixed(1)}% vs kỳ SS`
      : `${d >= 0 ? '▲ +' : '▼ '}${(d * 100).toFixed(1)} điểm %`
  }
  return (
    <div className={'kpi' + (tone ? ' ' + tone : '')}>
      <span>{k}</span>
      <strong>{v}</strong>
      <small className="unit">{u}</small>
      {p != null && <small className="prev">Kỳ SS: {p}</small>}
      {txt && <div className={'kpi-compare ' + cls}>{txt}</div>}
      <small>{sub}</small>
    </div>
  )
}

/* Cột chồng: doanh thu thực thu + phần hao hụt = GMV.
   Nhìn một cột là biết tháng đó bán được bao nhiêu và mất bao nhiêu trước khi về doanh thu. */
function RevenueChart({ data }) {
  const rows = data.map(r => ({
    label: r.label.slice(2),
    rev: r.rev / 1e6,
    loss: Math.max(0, r.gmv - r.rev) / 1e6,
    gmv: r.gmv / 1e6,
    cancel: r.cancelRate * 100,
    lossRate: r.gmv > 0 ? (1 - r.rev / r.gmv) * 100 : 0,
  }))

  const TipBox = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const r = payload[0].payload
    return (
      <div className="tip-card">
        <b>Tháng {label}</b>
        <div><span>GMV</span><i>{num(Math.round(r.gmv))} tr</i></div>
        <div className="hi"><span>Doanh thu thực thu · triệu (trục trái)</span><i>{num(Math.round(r.rev))} tr</i></div>
        <div className="lo"><span>Hao hụt</span><i>{num(Math.round(r.loss))} tr · {r.lossRate.toFixed(0)}%</i></div>
        <div className="cc"><span>Tỷ lệ huỷ đơn</span><i>{r.cancel.toFixed(1)}%</i></div>
      </div>
    )
  }

  return (
    <div className="chart" style={{ height: 288 }}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 12, right: 6, bottom: 4, left: 0 }} barCategoryGap="22%">
          <defs>
            <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3F49AD" />
              <stop offset="100%" stopColor="#2C3488" />
            </linearGradient>
            <linearGradient id="gLoss" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#CFD2E8" />
              <stop offset="100%" stopColor="#B9BDDD" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.axis }} tickLine={false}
            axisLine={{ stroke: C.grid }} interval={0} angle={-38} textAnchor="end" height={44} />
          <YAxis yAxisId="L" tick={{ fontSize: 9, fill: C.axis }} tickLine={false} axisLine={false}
            width={50} tickFormatter={v => num(Math.round(v))} />
          <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 9, fill: C.line }} tickLine={false}
            axisLine={false} width={44} domain={[0, dataMax => Math.ceil((dataMax + 12) / 10) * 10]}
            tickFormatter={v => `${v.toFixed(0)}%`} />
          <Tooltip content={<TipBox />} cursor={{ fill: 'rgba(53,62,153,.06)' }} />
          <Bar yAxisId="L" dataKey="rev" name="Doanh thu thực thu · tr (trái)" stackId="gmv"
            fill="url(#gRev)" maxBarSize={30} />
          <Bar yAxisId="L" dataKey="loss" name="Hao hụt: huỷ + giảm giá + hoàn · tr (trái)" stackId="gmv"
            fill="url(#gLoss)" maxBarSize={30} radius={[4, 4, 0, 0]} />
          <Line yAxisId="R" dataKey="cancel" name="Tỷ lệ huỷ đơn (phải)" stroke={C.line} strokeWidth={2.4}
            dot={{ r: 3, fill: '#fff', stroke: C.line, strokeWidth: 2 }} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/* AOV vẽ dạng vùng để tách khỏi biểu đồ cột phía trên;
   COGS bình quân trên một unit là đường cam ở trục phải — nhìn được giá bán
   và giá vốn cùng lúc mà không bị lệch thang. */
function AovChart({ data }) {
  const rows = data.map(r => ({
    label: r.label.slice(2),
    aov: r.aov / 1e6,
    cogsU: r.un > 0 ? r.cogs / r.un / 1e6 : null,
  }))
  const vals = rows.map(r => r.cogsU).filter(v => v != null)
  const avgCogs = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  return (
    <div className="chart" style={{ height: 268 }}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="gAov" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#353E99" stopOpacity={0.42} />
              <stop offset="100%" stopColor="#353E99" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.axis }} tickLine={false}
            axisLine={{ stroke: C.grid }} interval={0} angle={-38} textAnchor="end" height={44} />
          <YAxis yAxisId="L" tick={{ fontSize: 9, fill: C.axis }} tickLine={false} axisLine={false}
            width={50} tickFormatter={v => num(v, 2)} />
          <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 9, fill: C.line }} tickLine={false}
            axisLine={false} width={46} tickFormatter={v => num(v, 2)} />
          <Tooltip contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
            formatter={(v, n) => [v == null ? '—' : `${num(v, 2)} triệu`, n]} />
          <Area yAxisId="L" dataKey="aov" name="AOV · tr/đơn (trái)" stroke={C.bar} strokeWidth={2}
            fill="url(#gAov)" dot={{ r: 2.5, fill: C.bar, strokeWidth: 0 }} activeDot={{ r: 4 }} />
          <ReferenceLine yAxisId="R" y={avgCogs} stroke={C.line} strokeDasharray="4 4" strokeOpacity={0.65}
            label={{ value: `TB ${num(avgCogs, 2)}`, position: 'right', fontSize: 9, fill: C.line }} />
          <Line yAxisId="R" dataKey="cogsU" name="COGS bình quân/unit · tr (phải)" stroke={C.line} strokeWidth={2.2}
            dot={{ r: 2.5, fill: C.line, strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/* Chỉ còn COGS vẽ dạng vùng, GM% là đường trên trục phải kèm mức bình quân kỳ. */
function CogsChart({ data }) {
  const rows = data.map(r => ({
    label: r.label.slice(2),
    cogs: r.cogs / 1e6,
    gm: r.gm * 100,
  }))
  const avgGm = rows.length ? rows.reduce((a, r) => a + r.gm, 0) / rows.length : 0
  return (
    <div className="chart" style={{ height: 268 }}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="gCogs" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#353E99" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#353E99" stopOpacity={0.06} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.axis }} tickLine={false}
            axisLine={{ stroke: C.grid }} interval={0} angle={-38} textAnchor="end" height={44} />
          <YAxis yAxisId="L" tick={{ fontSize: 9, fill: C.axis }} tickLine={false} axisLine={false}
            width={50} tickFormatter={v => num(Math.round(v))} />
          <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 9, fill: C.line }} tickLine={false}
            axisLine={false} width={44} tickFormatter={v => `${v.toFixed(0)}%`} />
          <Tooltip contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
            formatter={(v, n) => [n === 'GM%' ? `${v.toFixed(1)}%` : `${num(Math.round(v))} triệu`, n]} />
          <Area yAxisId="L" dataKey="cogs" name="COGS · tr (trái)" stroke={C.bar} strokeWidth={2}
            fill="url(#gCogs)" dot={{ r: 2.5, fill: C.bar, strokeWidth: 0 }} activeDot={{ r: 4 }} />
          <ReferenceLine yAxisId="R" y={avgGm} stroke={C.line} strokeDasharray="4 4" strokeOpacity={0.65}
            label={{ value: `TB ${avgGm.toFixed(0)}%`, position: 'right', fontSize: 9, fill: C.line }} />
          <Line yAxisId="R" dataKey="gm" name="GM% (phải)" stroke={C.line} strokeWidth={2.2}
            dot={{ r: 2.5, fill: C.line, strokeWidth: 0 }} activeDot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function Top10({ rows }) {
  const { open: drill } = useDrill()
  if (!rows.length) return <p className="empty">Không có dữ liệu trong phạm vi lọc hiện tại.</p>

  const data = rows.map((r, i) => ({
    rank: i + 1,
    sku: r.sku,
    name: r.name,
    nganh: r.nganh,
    rev: r.rev / 1e6,
    un: Math.round(r.un),
    gm: r.gm,
  }))
  const max = Math.max(...data.map(d => d.rev))

  /* Nhãn cạnh mỗi thanh: doanh thu · số lượng · GM% — gộp luôn vào biểu đồ,
     GM% đổi màu theo ngưỡng để thấy ngay hàng bán chạy nhưng biên mỏng. */
  const ValueLabel = ({ x, y, width, height, index }) => {
    const d = data[index]
    if (!d || x == null || width == null) return null
    const gmColor = d.gm >= 0.35 ? '#1F7A45' : d.gm >= 0.2 ? '#4A5285' : '#B42318'
    return (
      <text x={x + width + 10} y={y + height / 2 + 3.5} fontSize="10" fill="#4A5285">
        <tspan fontWeight="700" fill="#1B2050">{num(Math.round(d.rev))}</tspan>
        <tspan dx="3" fontSize="8.5" fill="#8E93B5">triệu</tspan>
        <tspan dx="7" fill="#8E93B5">·</tspan>
        <tspan dx="7" fontWeight="600">{num(d.un)}</tspan>
        <tspan dx="3" fontSize="8.5" fill="#8E93B5">unit</tspan>
        <tspan dx="7" fill="#8E93B5">·</tspan>
        <tspan dx="7" fontWeight="700" fill={gmColor}>GM {pct(d.gm)}</tspan>
      </text>
    )
  }

  /* Nhãn trục: thứ hạng + tên sản phẩm + ngành */
  const NameTick = ({ x, y, payload }) => {
    const d = data[payload?.index]
    if (!d) return null
    const name = d.name.length > 30 ? d.name.slice(0, 29) + '…' : d.name
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={-8} y={-2} textAnchor="end" fontSize="10.5" fill="#1B2050" fontWeight="600">
          <tspan fill="#8E93B5" fontWeight="700">{d.rank}. </tspan>{name}
        </text>
        <text x={-8} y={10} textAnchor="end" fontSize="8.5" fill="#8E93B5">{d.sku} · {d.nganh}</text>
      </g>
    )
  }

  return (
    <div className="chart top10-chart" style={{ height: data.length * 42 + 44 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 178, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" domain={[0, max * 1.02]} tick={{ fontSize: 9, fill: C.axis }}
            tickLine={false} axisLine={{ stroke: C.grid }} tickFormatter={v => num(Math.round(v))} />
          <YAxis type="category" dataKey="sku" width={228} tickLine={false} axisLine={false} tick={NameTick} />
          <Tooltip cursor={{ fill: '#F1F3FA' }}
            contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
            formatter={(v, n, p) => [
              `${num(Math.round(v))} triệu · ${num(p.payload.un)} unit · GM ${pct(p.payload.gm)}`,
              p.payload.name,
            ]} />
          <Bar dataKey="rev" radius={[0, 3, 3, 0]} maxBarSize={20} label={<ValueLabel />}
            cursor="pointer"
            onClick={p => { const cn = SKU_MAP[p?.payload?.sku]?.className; if (cn) drill(cn) }}>
            {data.map((d, i) => <Cell key={d.sku} fill={i === 0 ? C.bar : C.bar2} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
