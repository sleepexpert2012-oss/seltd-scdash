import { Fragment, useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Cell, Legend,
} from 'recharts'
import master from '../data/master.json'
import {
  MONTHS, pickRows, groupBy, forecastRestOfYear, forecastNext6, unitEconomics,
  CUR_YEAR, PREV_YEAR, LAST_ACTUAL_MONTH, SKU_MAP, SKU_DEMAND, VMIN, STOCK_BY_SKU, IS_MOCK,
  stockPlan, STATUS,
} from '../lib/metrics'
import { trieu, num, pct } from '../lib/format'
import { useDrill } from '../app/drill'
import './forecast.css'

const C = { act: '#353E99', fc: '#A9AFE0', line: '#8E93B5', grid: '#E7E9F3', axis: '#8E93B5' }
const ALL = [0, MONTHS.length - 1]

const LEG = {
  verticalAlign: 'top', align: 'left', height: 26, iconSize: 10,
  wrapperStyle: { fontSize: 10.5, color: '#6E739B', paddingLeft: 24, lineHeight: '15px' },
}

export default function Forecast({ filters }) {
  const [tab, setTab] = useState('order')

  const d = useMemo(() => {
    const f = { ...filters, from: undefined, to: undefined }
    const rows = pickRows(f, ALL)                      // dự báo luôn dùng toàn bộ lịch sử
    const fc = forecastRestOfYear(rows)
    const eco = unitEconomics(rows.filter(r => MONTHS[r.m].startsWith(String(CUR_YEAR))))

    // ---- cả năm hiện tại theo tháng ----
    const monthly = []
    for (let mo = 1; mo <= 12; mo++) {
      const a = fc.actual[mo]
      const p = fc.prevYear[mo]
      const f2 = fc.months.find(x => x.mo === mo)
      monthly.push({
        label: `${String(CUR_YEAR).slice(2)}.${String(mo).padStart(2, '0')}`,
        actual: a ? a.rev / 1e6 : null,
        forecast: f2 ? (f2.un * eco.asp) / 1e6 : null,
        prev: p ? p.rev / 1e6 : null,
      })
    }

    // ---- theo ngành ----
    const byNganh = groupBy(rows, s => s.nganh).map(g => {
      const rs = rows.filter(r => SKU_MAP[r.sku]?.nganh === g.key)
      const gf = forecastRestOfYear(rs)
      const e = unitEconomics(rs.filter(r => MONTHS[r.m].startsWith(String(CUR_YEAR))))
      const actUn = Object.entries(gf.actual).reduce((a, [, v]) => a + v.un, 0)
      const actRev = Object.entries(gf.actual).reduce((a, [, v]) => a + v.rev, 0)
      const fcUn = gf.months.reduce((a, x) => a + x.un, 0)
      const fcRev = fcUn * e.asp
      // cùng kỳ năm trước cho phần dự báo
      const prevSameUn = gf.months.reduce((a, x) => a + (gf.prevYear[x.mo]?.un || 0), 0)
      const prevYearUn = Object.values(gf.prevYear).reduce((a, v) => a + v.un, 0)
      return {
        key: g.key, actUn, actRev, fcUn, fcRev,
        yearRev: actRev + fcRev, yearUn: actUn + fcUn,
        prevYearUn, prevSameUn,
        growthTail: prevSameUn > 0 ? fcUn / prevSameUn - 1 : null,
        growthYear: prevYearUn > 0 ? (actUn + fcUn) / prevYearUn - 1 : null,
        gY: gf.gY, gMean: gf.gMean, skewed: gf.skewed, useYoY: gf.useYoY, source: gf.source,
        asp: e.asp, cogsU: e.cogsU, gm: e.gm,
      }
    }).sort((a, b) => b.yearRev - a.yearRev)

    // ---- dự báo 6 tháng tới theo SKU (chỉ SKU đủ điều kiện replenish) ----
    const skuFc = []
    for (const s of master.skus) {
      if (filters.nganh && s.nganh !== filters.nganh) continue
      if (filters.loaiHinh && s.className !== filters.loaiHinh) continue
      if (filters.supplier && s.brand !== filters.supplier) continue
      if (filters.q) {
        const q = filters.q.toLowerCase()
        if (!(s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))) continue
      }
      const f6 = forecastNext6(s.sku)
      if (!f6 || f6.total <= 0) continue
      skuFc.push({ ...s, ...f6, ton: STOCK_BY_SKU[s.sku]?.total || 0 })
    }
    skuFc.sort((a, b) => b.total - a.total)

    const labels = skuFc[0]?.labels || []
    const groupsMap = new Map()
    for (const r of skuFc) {
      const g = groupsMap.get(r.nganh) || { key: r.nganh, total: 0, values: new Array(6).fill(0), types: new Map() }
      g.total += r.total
      r.values.forEach((v, i) => { g.values[i] += v })
      const t = g.types.get(r.className) || { key: r.className, total: 0, values: new Array(6).fill(0), skus: [] }
      t.total += r.total
      r.values.forEach((v, i) => { t.values[i] += v })
      t.skus.push(r)
      g.types.set(r.className, t)
      groupsMap.set(r.nganh, g)
    }

    const totalFcUn = byNganh.reduce((a, g) => a + g.fcUn, 0)
    const totalActRev = byNganh.reduce((a, g) => a + g.actRev, 0)
    const totalFcRev = byNganh.reduce((a, g) => a + g.fcRev, 0)
    const prevYearRev = Object.values(fc.prevYear).reduce((a, v) => a + v.rev, 0)

    return {
      fc, eco, monthly, byNganh, labels,
      groups: [...groupsMap.values()].sort((a, b) => b.total - a.total),
      skuFcCount: skuFc.length,
      totalFcUn, totalActRev, totalFcRev, prevYearRev,
      yearRev: totalActRev + totalFcRev,
      capacity: Math.ceil((totalFcUn / Math.max(1, 12 - LAST_ACTUAL_MONTH)) * 1.15),
      next6Total: skuFc.reduce((a, r) => a + r.total, 0),
    }
  }, [filters])

  const growthYear = d.prevYearRev > 0 ? d.yearRev / d.prevYearRev - 1 : null
  const remain = 12 - LAST_ACTUAL_MONTH

  return (
    <>
      <div className="m2-title">
        <h3>📈 Forecast &amp; Kế hoạch đặt hàng</h3>
        <p>
          Dự báo bán phần còn lại của năm {CUR_YEAR} + kế hoạch đặt hàng (cấp SKU → cộng lên loại hình)
          + hoạch định cung ứng S&amp;OP. Forecast theo mùa vụ {PREV_YEAR}+{CUR_YEAR} × sức bán hiện tại.
          {IS_MOCK && ' Số liệu bán hàng hiện là dữ liệu giả.'}
        </p>
      </div>

      <div className="m2-group">
        <div className="gtitle">
          <b>📊 Tổng quan dự báo cả năm {CUR_YEAR}</b>
          <span>
            Thực tế T1–T{LAST_ACTUAL_MONTH} · dự báo {remain} tháng còn lại (YoY: hệ số trung vị {CUR_YEAR}/{PREV_YEAR} × mùa vụ {PREV_YEAR})
            — giúp nhìn bức tranh doanh thu &amp; tăng trưởng từng ngành cả năm
          </span>
        </div>
      <>
          <div className="grid-2">
            <div className="m2-panel">
              <div className="m2-head">
                <div><h3>Doanh thu cả năm theo ngành</h3><p>Cột đậm = thực tế · cột nhạt = phần dự báo · triệu đồng</p></div>
              </div>
              <div className="chart" style={{ height: Math.max(200, d.byNganh.length * 40 + 34) }}>
                <ResponsiveContainer>
                  <BarChart data={d.byNganh.map(g => ({ name: g.key, act: g.actRev / 1e6, fc: g.fcRev / 1e6 }))}
                    layout="vertical" margin={{ top: 4, right: 60, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke={C.grid} horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 9, fill: C.axis }} tickLine={false}
                      axisLine={{ stroke: C.grid }} tickFormatter={v => num(Math.round(v))} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: '#4A5285' }}
                      tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: '#F1F3FA' }} contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
                      formatter={v => `${num(Math.round(v))} triệu`} />
                    <Legend {...LEG} />
                    <Bar dataKey="act" name="Thực tế" stackId="a" fill={C.act} maxBarSize={18} />
                    <Bar dataKey="fc" name="Dự báo" stackId="a" fill={C.fc} radius={[0, 3, 3, 0]} maxBarSize={18}
                      label={{ position: 'right', fontSize: 9, fill: '#4A5285', formatter: () => '' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="m2-panel">
              <div className="m2-head">
                <div>
                  <h3>Tăng trưởng phần dự báo theo ngành</h3>
                  <p>Sản lượng {remain} tháng cuối {CUR_YEAR} so với cùng kỳ {PREV_YEAR}</p>
                </div>
              </div>
              <div className="chart" style={{ height: Math.max(200, d.byNganh.length * 40 + 34) }}>
                <ResponsiveContainer>
                  <BarChart data={d.byNganh.map(g => ({ name: g.key, v: g.growthTail == null ? 0 : g.growthTail * 100 }))}
                    layout="vertical" margin={{ top: 4, right: 60, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke={C.grid} horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 9, fill: C.axis }} tickLine={false}
                      axisLine={{ stroke: C.grid }} tickFormatter={v => `${Math.round(v)}%`} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: '#4A5285' }}
                      tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: '#F1F3FA' }} contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
                      formatter={v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`} />
                    <Bar dataKey="v" radius={[0, 3, 3, 0]} maxBarSize={18}
                      label={{ position: 'right', fontSize: 9, fill: '#4A5285', formatter: v => `${v >= 0 ? '+' : ''}${Math.round(v)}%` }}>
                      {d.byNganh.map(g => (
                        <Cell key={g.key} fill={(g.growthTail ?? 0) >= 0 ? '#1F7A45' : '#B42318'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="m2-panel">
            <div className="m2-head">
              <div>
                <h3>Doanh thu theo tháng — cả năm {CUR_YEAR}</h3>
                <p>Cột đậm = thực tế · cột nhạt = dự báo · đường xám = cùng kỳ {PREV_YEAR} · đơn vị triệu đồng</p>
              </div>
              <div className="chart-legend">
                <span><i />Thực tế</span><span><i className="fc" />Dự báo</span><span><i className="ln" />Cùng kỳ {PREV_YEAR}</span>
              </div>
            </div>
            <div className="chart" style={{ height: 280 }}>
              <ResponsiveContainer>
                <ComposedChart data={d.monthly} margin={{ top: 8, right: 6, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.axis }} tickLine={false}
                    axisLine={{ stroke: C.grid }} interval={0} angle={-38} textAnchor="end" height={44} />
                  <YAxis tick={{ fontSize: 9, fill: C.axis }} tickLine={false} axisLine={false} width={50}
                    tickFormatter={v => num(Math.round(v))} />
                  <Tooltip contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
                    formatter={(v, n) => [v == null ? '—' : `${num(Math.round(v))} triệu`, n]} />
                  <Bar dataKey="actual" name="Thực tế" fill={C.act} radius={[3, 3, 0, 0]} maxBarSize={26} stackId="a" />
                  <Bar dataKey="forecast" name="Dự báo" fill={C.fc} radius={[3, 3, 0, 0]} maxBarSize={26} stackId="a" />
                  <Line dataKey="prev" name={`Cùng kỳ ${PREV_YEAR}`} stroke={C.line} strokeWidth={1.8}
                    strokeDasharray="5 4" dot={{ r: 2, fill: C.line, strokeWidth: 0 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

      </>
      </div>

      <div className="m2-tabs">
        {[['order', '📦', 'Kế hoạch đặt hàng'], ['sop', '⚖', 'Hoạch định cung ứng (S&OP)'], ['next6', '📈', 'Dự báo 6 tháng tới'], ['method', 'ⓘ', 'Phương pháp & hệ số']].map(([k, ic, l]) => (
          <button key={k} className={'m2-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
            <i className="tab-ic">{ic}</i>{l}
          </button>
        ))}
      </div>

      {tab === 'sop' && (
        <>
          {d.byNganh.some(g => g.skewed) && (
            <div className="m2-panel note-panel">
              <b>Hệ số YoY của một số ngành đang bị lệch</b>
              <p>
                Ở những ngành này, tỷ lệ {CUR_YEAR}/{PREV_YEAR} của các tháng đầu năm cao bất thường —
                thường do năm trước sản phẩm mới bắt đầu bán nên nền quá thấp. Hệ thống đã dùng
                <b> trung vị</b> thay cho trung bình để hạn chế méo, nhưng phần dự báo của các ngành
                {' '}<b>{d.byNganh.filter(g => g.skewed).map(g => g.key).join(', ')}</b> vẫn nên được thẩm định tay
                trước khi đưa vào kế hoạch mua hàng.
              </p>
            </div>
          )}

          <div className="m2-panel">
            <div className="m2-head">
              <div>
                <h3>Kế hoạch cung ứng & doanh thu cả năm {CUR_YEAR}</h3>
                <p>
                  Doanh thu phần dự báo = sản lượng dự báo × giá bán bình quân {CUR_YEAR};
                  giá vốn nhập = sản lượng × giá vốn/unit của chính ngành đó
                </p>
              </div>
            </div>
            <div className="m2-tablewrap fc-table">
              <table>
                <thead>
                  <tr>
                    <th>Ngành hàng</th>
                    <th className="num">SL thực</th>
                    <th className="num">SL dự báo</th>
                    <th className="num">SL cả năm</th>
                    <th className="num">vs {PREV_YEAR}</th>
                    <th className="num">DT thực</th>
                    <th className="num">DT dự báo</th>
                    <th className="num">DT cả năm</th>
                    <th className="num">Giá vốn nhập</th>
                    <th className="num">GM%</th>
                    <th>Nguồn hệ số</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byNganh.map(g => (
                    <tr key={g.key}>
                      <td>
                        <b>{g.key}</b>
                        <small>
                          hệ số YoY {g.useYoY ? g.gY.toFixed(2) : '—'}
                          {g.skewed && <i className="skew"> · TB {g.gMean.toFixed(2)}, đã dùng trung vị</i>}
                        </small>
                      </td>
                      <td className="num">{num(Math.round(g.actUn))}</td>
                      <td className="num fcnum">{num(g.fcUn)}</td>
                      <td className="num strong">{num(Math.round(g.actUn + g.fcUn))}</td>
                      <td className="num">{g.growthYear == null ? <span className="dim">—</span>
                        : <span className={g.growthYear >= 0 ? 'up' : 'down'}>
                          {g.growthYear >= 0 ? '+' : ''}{(g.growthYear * 100).toFixed(0)}%</span>}</td>
                      <td className="num">{trieu(g.actRev)}</td>
                      <td className="num fcnum">{trieu(g.fcRev)}</td>
                      <td className="num strong">{trieu(g.yearRev)}</td>
                      <td className="num">{trieu(g.fcUn * g.cogsU)}</td>
                      <td className="num">{pct(g.gm)}</td>
                      <td className="src">{g.useYoY ? 'YoY của ngành' : 'Mùa vụ năm trước'}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td><b>Tổng công ty</b></td>
                    <td className="num">{num(Math.round(d.byNganh.reduce((a, g) => a + g.actUn, 0)))}</td>
                    <td className="num">{num(d.totalFcUn)}</td>
                    <td className="num strong">{num(Math.round(d.byNganh.reduce((a, g) => a + g.actUn + g.fcUn, 0)))}</td>
                    <td className="num">{growthYear == null ? '—'
                      : <span className={growthYear >= 0 ? 'up' : 'down'}>{growthYear >= 0 ? '+' : ''}{(growthYear * 100).toFixed(0)}%</span>}</td>
                    <td className="num">{trieu(d.totalActRev)}</td>
                    <td className="num">{trieu(d.totalFcRev)}</td>
                    <td className="num strong">{trieu(d.yearRev)}</td>
                    <td className="num">{trieu(d.byNganh.reduce((a, g) => a + g.fcUn * g.cogsU, 0))}</td>
                    <td className="num" />
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'order' && <OrderPlan filters={filters} />}

      {tab === 'next6' && (
        <div className="m2-panel">
          <div className="m2-head">
            <div>
              <h3>Dự báo bán 6 tháng tới — cấp SKU</h3>
              <p>
                Công thức: sản lượng tháng tương ứng năm trước × (1 + đà tăng trưởng 3 tháng gần nhất),
                đà bị chặn trong khoảng −40% đến +60%. SKU không có mùa vụ dùng sức bán 3 tháng làm nền.
              </p>
            </div>
          </div>
          {!d.groups.length ? <p className="empty">Không có SKU nào có dự báo trong phạm vi lọc.</p> : (
            <Next6Table groups={d.groups} labels={d.labels} />
          )}
        </div>
      )}

      {tab === 'method' && <Method d={d} remain={remain} />}
    </>
  )
}

/* Kế hoạch đặt hàng theo loại hình — bố cục theo mẫu 2:
   nhóm Ngành → Loại hình → SKU, có nút mở/đóng tất cả và dòng tổng cuối bảng. */
function OrderPlan({ filters }) {
  const { open: drill } = useDrill()
  const [open, setOpen] = useState(null)   // null = mặc định mở nhóm đầu

  const d = useMemo(() => {
    const rows = stockPlan(s => {
      if (filters.nganh && s.nganh !== filters.nganh) return false
      if (filters.loaiHinh && s.className !== filters.loaiHinh) return false
      if (filters.supplier && s.brand !== filters.supplier) return false
      if (filters.q) {
        const q = filters.q.toLowerCase()
        if (!(s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))) return false
      }
      return true
    }).filter(r => r.need > 0)

    const m = new Map()
    for (const r of rows) {
      const g = m.get(r.nganh) || { key: r.nganh, need: 0, value: 0, types: new Map() }
      g.need += r.need; g.value += r.needValue
      const t = g.types.get(r.className) || { key: r.className, need: 0, value: 0, skus: [], brand: r.brand }
      t.need += r.need; t.value += r.needValue; t.skus.push(r)
      g.types.set(r.className, t)
      m.set(r.nganh, g)
    }
    const groups = [...m.values()].sort((a, b) => b.value - a.value)
    return {
      groups,
      need: rows.reduce((a, r) => a + r.need, 0),
      value: rows.reduce((a, r) => a + r.needValue, 0),
      urgent: rows.filter(r => r.stt === 0).length,
    }
  }, [filters])

  const openSet = open ?? new Set(d.groups.map(g => g.key))
  const toggle = k => {
    const n = new Set(openSet)
    n.has(k) ? n.delete(k) : n.add(k)
    setOpen(n)
  }

  if (!d.groups.length) {
    return (
      <div className="m2-panel">
        <p className="empty">Không có loại hình nào chạm điểm đặt lại trong phạm vi lọc hiện tại.</p>
      </div>
    )
  }

  return (
    <div className="m2-panel">
      <div className="m2-head">
        <div>
          <h3>📦 Kế hoạch đặt hàng theo loại hình</h3>
          <p>
            Chỉ gồm SKU được phép replenish (đang bán, sức bán 3 tháng ≥ {VMIN} u/tháng).
            Công thức: SS = {'{'}2,33 × σ × √(LT÷30){'}'} · ROP = sức bán × (LT÷30) + SS ·
            Cần đặt = (mức đặt tới − tồn) làm tròn theo MOQ · Giá trị ước tính = cần đặt × giá vốn/unit.
            Lead time chỉnh ở màn Tồn kho, tab Tham số.
          </p>
        </div>
        <div className="open-ctrl">
          <button className="link-btn" onClick={() => setOpen(new Set(d.groups.map(g => g.key)))}>▼ Mở tất cả</button>
          <button className="link-btn" onClick={() => setOpen(new Set())}>▶ Đóng tất cả</button>
        </div>
      </div>

      <div className="m2-tablewrap fc-table">
        <table>
          <thead>
            <tr>
              <th>Ngành / Loại hình / SKU</th>
              <th>Nhà cung cấp</th>
              <th className="num">Sức bán 3T</th>
              <th className="num">Tồn</th>
              <th className="num">ROP</th>
              <th className="num">Mức đặt tới</th>
              <th className="num">Cần đặt (u)</th>
              <th className="num">Giá trị đặt ước (triệu)</th>
              <th>Ưu tiên</th>
            </tr>
          </thead>
          <tbody>
            {d.groups.map(g => (
              <Fragment key={g.key}>
                <tr className="grp" onClick={() => toggle(g.key)}>
                  <td><b>{openSet.has(g.key) ? '▼' : '▶'} {g.key}</b><small>{g.types.size} loại hình</small></td>
                  <td /><td className="num" colSpan={4} />
                  <td className="num strong">{num(g.need)}</td>
                  <td className="num strong">{trieu(g.value)}</td>
                  <td />
                </tr>
                {openSet.has(g.key) && [...g.types.values()].sort((a, b) => b.value - a.value).map(t => (
                  <Fragment key={t.key}>
                    <tr className="sub drillable" onClick={() => drill(t.key)}>
                      <td><b>{t.key}</b><small>{t.skus.length} SKU · bấm để phân tích sâu</small></td>
                      <td>{t.brand}</td>
                      <td className="num" colSpan={4} />
                      <td className="num strong">{num(t.need)}</td>
                      <td className="num">{trieu(t.value)}</td>
                      <td />
                    </tr>
                    {t.skus.sort((a, b) => b.needValue - a.needValue).map(r => (
                      <tr key={r.sku} className="child">
                        <td><b>{r.name}</b><small>{r.sku} · LT {r.LT} ngày · MOQ {r.moq}</small></td>
                        <td>{r.brand}</td>
                        <td className="num">{r.vel3.toFixed(1)}</td>
                        <td className="num">{num(r.ton)}</td>
                        <td className="num">{num(r.rop)}</td>
                        <td className="num">{num(r.oup)}</td>
                        <td className="num strong">{num(r.need)}</td>
                        <td className="num">{trieu(r.needValue)}</td>
                        <td><span className={'pri p' + r.stt}>{STATUS[r.stt].icon} {r.stt === 0 ? 'Đặt gấp' : 'Kỳ này'}</span></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </Fragment>
            ))}
            <tr className="total">
              <td><b>Tổng kế hoạch đặt</b>{d.urgent > 0 && <small>{d.urgent} SKU thuộc nhóm đặt gấp</small>}</td>
              <td /><td className="num" colSpan={4} />
              <td className="num strong">{num(d.need)} u</td>
              <td className="num strong">{trieu(d.value)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Kpi({ k, v, u, s, tone }) {
  return (
    <div className={'kpi' + (tone ? ' ' + tone : '')}>
      <span>{k}</span><strong>{v}</strong>
      <small className="unit">{u}</small><small>{s}</small>
    </div>
  )
}

function Next6Table({ groups, labels }) {
  const [open, setOpen] = useState(() => new Set(groups.map(g => g.key)))
  const toggle = k => setOpen(o => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n })
  const totals = labels.map((_, i) => groups.reduce((a, g) => a + g.values[i], 0))
  return (
    <>
    <div className="group-ctrl">
      <button className="xls-btn" onClick={() => setOpen(new Set(groups.map(g => g.key)))}>▼ Mở tất cả</button>
      <button className="xls-btn" onClick={() => setOpen(new Set())}>▶ Đóng tất cả</button>
    </div>
    <div className="m2-tablewrap fc-table">
      <table>
        <thead>
          <tr>
            <th>Ngành / Loại hình / SKU</th>
            <th className="num">Sức bán 3T</th>
            <th className="num">Tồn hiện có</th>
            {labels.map(l => <th key={l} className="num">{l}</th>)}
            <th className="num">Tổng 6T</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <Fragment key={g.key}>
              <tr className="grp" onClick={() => toggle(g.key)}>
                <td><b>{open.has(g.key) ? '▾' : '▸'} {g.key}</b><small>{g.types.size} loại hình</small></td>
                <td className="num" /><td className="num" />
                {g.values.map((v, i) => <td key={i} className="num">{num(v)}</td>)}
                <td className="num strong">{num(g.total)}</td>
              </tr>
              {open.has(g.key) && [...g.types.values()].sort((a, b) => b.total - a.total).map(t => (
                <Fragment key={t.key}>
                  <tr className="sub">
                    <td><b>{t.key}</b><small>{t.skus.length} SKU</small></td>
                    <td className="num" /><td className="num" />
                    {t.values.map((v, i) => <td key={i} className="num">{num(v)}</td>)}
                    <td className="num strong">{num(t.total)}</td>
                  </tr>
                  {t.skus.map(r => (
                    <tr key={r.sku} className="child">
                      <td><b>{r.name}</b><small>{r.sku} · đà {(r.g * 100).toFixed(0)}%</small></td>
                      <td className="num">{r.vel3.toFixed(1)}</td>
                      <td className="num">{num(r.ton)}</td>
                      {r.values.map((v, i) => <td key={i} className="num">{num(v)}</td>)}
                      <td className="num strong">{num(r.total)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              </Fragment>
          ))}
          <tr className="total">
            <td><b>Tổng dự báo</b></td>
            <td className="num" /><td className="num" />
            {totals.map((v, i) => <td key={i} className="num strong">{num(v)}</td>)}
            <td className="num strong">{num(totals.reduce((a, b) => a + b, 0))}</td>
          </tr>
        </tbody>
      </table>
    </div>
    </>
  )
}

function Method({ d, remain }) {
  return (
    <div className="m2-panel">
      <div className="m2-head">
        <div>
          <h3>Phương pháp dự báo & hệ số đang dùng</h3>
          <p>Mọi con số dự báo trên màn hình này đều sinh ra từ hai công thức dưới đây, không có tham số ẩn</p>
        </div>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <span>1 · Phần còn lại của năm {CUR_YEAR}</span>
          <p>
            Với mỗi tháng còn lại: <b>sản lượng = sản lượng cùng tháng {PREV_YEAR} × hệ số YoY</b>.
            Hệ số YoY là <b>trung vị</b> tỷ lệ {CUR_YEAR}/{PREV_YEAR} của các tháng đã có số, kẹp trong khoảng 0,3 – 3,0.
            Dùng trung vị thay trung bình vì những tháng đầu của sản phẩm mới cho tỷ lệ rất lớn
            và sẽ kéo lệch dự báo cả năm.
          </p>
          <p className="fallback">
            Nếu có dưới 3 tháng đối chiếu được, hệ thống chuyển sang: <b>sản lượng tháng gần nhất × chỉ số mùa vụ
            năm trước</b> (kẹp 0,5 – 2,0). Cột “Nguồn hệ số” trong bảng cả năm ghi rõ ngành nào đang dùng cách nào.
          </p>
        </div>

        <div className="method-card">
          <span>2 · Sáu tháng tới, cấp SKU</span>
          <p>
            <b>Sản lượng = sản lượng tháng tương ứng của 12 tháng gần nhất × (1 + đà tăng trưởng)</b>.
            Đà tăng trưởng = sản lượng 3 tháng gần nhất ÷ 3 tháng liền trước − 1, chặn trong khoảng −40% đến +60%.
          </p>
          <p className="fallback">
            SKU chưa đủ 12 tháng lịch sử thì lấy sức bán 3 tháng gần nhất làm nền thay cho mùa vụ.
            Dự báo này dùng để đặt hàng, nên cố ý bám sát hiện tại hơn là bám YoY.
          </p>
        </div>

        <div className="method-card">
          <span>3 · Quy từ sản lượng ra tiền</span>
          <p>
            <b>Doanh thu dự báo = sản lượng × giá bán bình quân {CUR_YEAR}</b> của chính ngành đó;
            <b> giá vốn nhập = sản lượng × giá vốn/unit</b> cùng nguồn. Không dự báo giá — nếu giá thay đổi
            thì điều chỉnh ở bước lập PO, không sửa mô hình.
          </p>
          <p className="fallback">
            Năng lực nhà cung cấp cần = sản lượng dự báo ÷ {remain} tháng × 1,15 (đệm 15%).
            Hiện là <b>{num(d.capacity)} unit/tháng</b>.
          </p>
        </div>
      </div>

      <div className="method-note">
        <b>Giới hạn cần biết khi đọc</b>
        <ul>
          <li>Dự báo bỏ qua bộ lọc thời gian ở thanh trên — nó luôn dùng toàn bộ lịch sử, vì cắt kỳ sẽ làm hỏng mùa vụ.</li>
          <li>Mô hình không biết trước khuyến mãi, mở kênh mới hay đứt hàng — những việc đó phải chỉnh tay ở bước duyệt PO.</li>
          <li>Chỉ SKU bán từ {VMIN} unit/tháng trở lên mới được đề xuất đặt ở màn Tồn kho; dự báo ở đây thì hiển thị cho mọi SKU còn bán.</li>
        </ul>
      </div>
    </div>
  )
}
