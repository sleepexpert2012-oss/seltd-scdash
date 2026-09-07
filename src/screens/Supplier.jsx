import { Fragment, useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Cell, Legend,
} from 'recharts'
import master from '../data/master'
import { SKU_MAP } from '../lib/metrics'
import { trieu, num, pct } from '../lib/format'
import './supplier.css'

const C = { bar: '#353E99', bar2: '#5C67C4', line: '#D97706', grid: '#E7E9F3', axis: '#8E93B5' }
const PO = master.purchaseOrders
const SUP = Object.fromEntries(master.suppliers.map(s => [s.name, s]))

const ym = d => (d ? d.slice(0, 7).replace('-', '.') : null)
const MONTHS_PO = [...new Set(PO.map(r => ym(r.dateReceive)).filter(Boolean))].sort()

const LEG = {
  verticalAlign: 'top', align: 'left', height: 26, iconSize: 10,
  wrapperStyle: { fontSize: 10.5, color: '#6E739B', paddingLeft: 24, lineHeight: '15px' },
}

export default function Supplier({ filters, setFilters }) {
  const [tab, setTab] = useState('overview')     // overview | price | debt
  const [openSup, setOpenSup] = useState(() => new Set())
  const toggleSup = k => setOpenSup(o => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n })

  const d = useMemo(() => {
    const rows = PO.filter(r => {
      const s = SKU_MAP[r.sku]
      if (filters.nganh && s?.nganh !== filters.nganh) return false
      if (filters.supplier && r.supplier !== filters.supplier) return false
      if (filters.loaiHinh && s?.className !== filters.loaiHinh) return false
      if (filters.q) {
        const q = filters.q.toLowerCase()
        if (!(r.sku.toLowerCase().includes(q) || (s?.name || '').toLowerCase().includes(q) ||
          r.supplier.toLowerCase().includes(q))) return false
      }
      return true
    })

    const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0)
    const poCount = new Set(rows.map(r => r.po)).size
    const skuCount = new Set(rows.map(r => r.sku)).size

    // theo nhà cung cấp
    const bySupMap = new Map()
    for (const r of rows) {
      const t = bySupMap.get(r.supplier) || {
        name: r.supplier, value: 0, vat: 0, qty: 0, outstanding: 0, paid: 0,
        pos: new Set(), skus: new Set(), last: null, overdue: 0,
      }
      t.value += r.totalCost; t.vat += r.totalCostVat; t.qty += r.qtyConfirm
      t.outstanding += r.outstanding; t.paid += r.paid
      t.pos.add(r.po); t.skus.add(r.sku)
      if (!t.last || (r.dateReceive || '') > t.last) t.last = r.dateReceive
      if (r.outstanding > 0 && r.daysOverdue > 0) t.overdue = Math.max(t.overdue, r.daysOverdue)
      bySupMap.set(r.supplier, t)
    }
    const bySup = [...bySupMap.values()].sort((a, b) => b.value - a.value)
    const total = bySup.reduce((s, x) => s + x.value, 0)

    // theo ngành
    const byNganhMap = new Map()
    for (const r of rows) {
      const ng = SKU_MAP[r.sku]?.nganh || '(chưa gán)'
      byNganhMap.set(ng, (byNganhMap.get(ng) || 0) + r.totalCost)
    }
    const byNganh = [...byNganhMap.entries()].map(([k, v]) => ({ key: k, value: v }))
      .sort((a, b) => b.value - a.value)

    // nhịp đặt hàng theo tháng
    const byMonth = MONTHS_PO.map(m => {
      const rs = rows.filter(r => ym(r.dateReceive) === m)
      return { label: m.slice(2), value: rs.reduce((s, r) => s + r.totalCost, 0), pos: new Set(rs.map(r => r.po)).size }
    })

    // biến động giá mua theo SKU
    const priceMap = new Map()
    for (const r of rows) {
      const t = priceMap.get(r.sku) || { sku: r.sku, buys: [], qty: 0, value: 0, sups: new Set() }
      t.buys.push({ date: r.dateReceive, cost: r.cost, qty: r.qtyConfirm, sup: r.supplier, po: r.po })
      t.qty += r.qtyConfirm; t.value += r.totalCost; t.sups.add(r.supplier)
      priceMap.set(r.sku, t)
    }
    const prices = [...priceMap.values()].map(t => {
      const costs = t.buys.map(b => b.cost)
      const sorted = [...t.buys].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      const first = sorted[0], last = sorted[sorted.length - 1]
      const masterCost = SKU_MAP[t.sku]?.unitCost || 0
      return {
        ...t,
        avg: t.qty > 0 ? t.value / t.qty : 0,
        min: Math.min(...costs), max: Math.max(...costs),
        first, last,
        drift: first.cost > 0 ? last.cost / first.cost - 1 : null,
        masterCost,
        gapMaster: masterCost > 0 ? (t.qty > 0 ? t.value / t.qty : 0) / masterCost - 1 : null,
      }
    }).sort((a, b) => b.value - a.value)

    // NCC theo từng ngành chính
    const supByNganh = new Map()
    for (const r of rows) {
      const ng = SKU_MAP[r.sku]?.nganh || '(chưa gán)'
      const m = supByNganh.get(ng) || new Map()
      const t = m.get(r.supplier) || { name: r.supplier, value: 0, qty: 0, skus: new Set(), last: null }
      t.value += r.totalCost; t.qty += r.qtyConfirm; t.skus.add(r.sku)
      if (!t.last || (r.dateReceive || '') > t.last) t.last = r.dateReceive
      m.set(r.supplier, t)
      supByNganh.set(ng, m)
    }
    const supNganh = [...supByNganh.entries()]
      .map(([ng, m]) => ({ nganh: ng, sups: [...m.values()].sort((a, b) => b.value - a.value) }))
      .sort((a, b) => b.sups.reduce((s, x) => s + x.value, 0) - a.sups.reduce((s, x) => s + x.value, 0))

    const needRepricing = prices.filter(p => p.gapMaster != null && Math.abs(p.gapMaster) > 0.05).length

    return {
      rows, total, vat: sum('totalCostVat'), outstanding: sum('outstanding'), paid: sum('paid'),
      poCount, skuCount, bySup, byNganh, byMonth, prices, supNganh, needRepricing,
      top2: total > 0 ? bySup.slice(0, 2).reduce((s, x) => s + x.value, 0) / total : 0,
      overdueValue: rows.filter(r => r.daysOverdue > 0).reduce((s, r) => s + r.outstanding, 0),
    }
  }, [filters])

  const supSkus = sup => d.prices.filter(p => p.sups.has(sup))

  return (
    <>
      <div className="m2-title">
        <span>Vận hành &amp; kế hoạch</span>
        <h3>Quản lý Nhà cung cấp (NCC)</h3>
        <p>
          Dữ liệu PO thật trong Master Data · nhận hàng {MONTHS_PO[0]} → {MONTHS_PO[MONTHS_PO.length - 1]} ·
          giá mua = Σ PO value ÷ Σ PO qty · giá trị chưa VAT trừ khi ghi khác ·
          <b> công nợ lấy trên giá có VAT</b> nên không trừ trực tiếp với cột giá trị PO
        </p>
      </div>

      <div className="m2-tabs">
        {[['overview', '📊', 'Tổng quan NCC'], ['price', '⚖', 'So sánh giá theo SKU'], ['debt', '💳', 'Công nợ nhà cung cấp']].map(([k, ic, l]) => (
          <button key={k} className={'m2-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
            <i className="tab-ic">{ic}</i>{l}
          </button>
        ))}
      </div>

      <div className="m2-filter">
        <label>
          Ngành hàng
          <select value={filters.nganh} onChange={e => setFilters(f => ({ ...f, nganh: e.target.value }))}>
            <option value="">Tất cả ngành</option>
            {master.dims.nganh.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>
          Nhà cung cấp
          <select value={filters.supplier} onChange={e => setFilters(f => ({ ...f, supplier: e.target.value }))}>
            <option value="">Tất cả NCC</option>
            {master.dims.brand.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="hint">— nguồn: PO trong Master Data, gồm toàn bộ đơn đã nhận hàng</span>
      </div>

      <div className="m2-kpis" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
        <div>
          <span>Σ PO value</span><strong>{trieu(d.total)}</strong>
          <small>triệu · chưa VAT · {d.poCount} đơn · {d.skuCount} SKU</small>
        </div>
        <div>
          <span>NCC đang hiển thị</span><strong>{d.bySup.length}</strong>
          <small>trên {master.suppliers.length} NCC trong danh mục</small>
        </div>
        <div>
          <span>Top 2 NCC tập trung</span><strong>{pct(d.top2)}</strong>
          <small>% PO của 2 NCC lớn nhất</small>
        </div>
        <div className={d.needRepricing > 0 ? 'warn' : ''}>
          <span>SKU cần cập nhật giá</span><strong>{d.needRepricing} ⚠</strong>
          <small>giá mua lệch giá vốn Master &gt; 5% · xem tab So sánh giá</small>
        </div>
      </div>

      {tab === 'overview' && (
        <>
          <div className="m2-panel">
            <div className="m2-head">
              <div>
                <h3>Top NCC theo giá trị PO</h3>
                <p>Toàn bộ đơn đã nhận trong phạm vi lọc · đơn vị triệu đồng · kèm tỷ trọng</p>
              </div>
            </div>
            <HBars rows={d.bySup.map(s2 => ({ name: s2.name, value: s2.value }))} total={d.total} />
          </div>

          <div className="grid-2">
            <div className="m2-panel">
              <div className="m2-head">
                <div>
                  <h3>PO value theo ngành hàng</h3>
                  <p>Phân bổ tổng giá trị PO theo ngành · triệu đồng</p>
                </div>
              </div>
              <HBars rows={d.byNganh.map(s2 => ({ name: s2.key, value: s2.value }))} total={d.total} />
            </div>

            <div className="m2-panel">
              <div className="m2-head">
                <div>
                  <h3>Nhịp đặt hàng PO theo tháng</h3>
                  <p>Σ giá trị PO nhận trong tháng (cột, trục trái) · số đơn mua (đường, trục phải)</p>
                </div>
              </div>
              <div className="chart" style={{ height: 250 }}>
                <ResponsiveContainer>
                  <ComposedChart data={d.byMonth.map(m => ({ ...m, value: m.value / 1e6 }))}
                    margin={{ top: 8, right: 4, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
                    <YAxis yAxisId="L" tick={{ fontSize: 9, fill: C.axis }} tickLine={false} axisLine={false} width={46}
                      tickFormatter={v => num(Math.round(v))} />
                    <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 9, fill: C.line }} tickLine={false}
                      axisLine={false} width={30} allowDecimals={false} />
                    <Tooltip contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
                      formatter={(v, n) => [n === 'Số đơn' ? num(v) : `${num(Math.round(v))} triệu`, n]} />
                    <Legend {...LEG} />
                    <Bar yAxisId="L" dataKey="value" name="Giá trị PO · tr (trái)" fill={C.bar} radius={[3, 3, 0, 0]} maxBarSize={26} />
                    <Line yAxisId="R" dataKey="pos" name="Số đơn mua (phải)" stroke={C.line} strokeWidth={2}
                      dot={{ r: 2.5, fill: C.line, strokeWidth: 0 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="m2-panel">
            <div className="m2-head">
              <div>
                <h3>Danh sách NCC</h3>
                <p>Bấm một dòng để xem các SKU đang cung cấp, giá mua bình quân và độ lệch so với giá vốn Master</p>
              </div>
              <div className="tools">
                <button className="xls-btn" onClick={() => setOpenSup(new Set(d.bySup.map(x => x.name)))}>▼ Mở tất cả</button>
                <button className="xls-btn" onClick={() => setOpenSup(new Set())}>▶ Đóng tất cả</button>
              </div>
            </div>
            <div className="m2-tablewrap sup-table">
              <table>
                <thead>
                  <tr>
                    <th>NCC</th><th className="num">Số PO</th><th className="num">SKU cung cấp</th>
                    <th className="num">PO qty (u)</th><th className="num">PO value (triệu)</th>
                    <th className="num">% tổng</th><th className="num">Giá TB/u (tr)</th>
                    <th className="num">Công nợ còn</th><th className="num">PO gần nhất</th><th>Điều khoản</th>
                  </tr>
                </thead>
                <tbody>
                  {d.bySup.map(s2 => {
                    const isOpen = openSup.has(s2.name)
                    const kids = isOpen ? supSkus(s2.name) : []
                    return (
                      <Fragment key={s2.name}>
                        <tr className={'clickable' + (isOpen ? ' on' : '')} onClick={() => toggleSup(s2.name)}>
                          <td><b>{isOpen ? '▾' : '▸'} {s2.name}</b><small>{SUP[s2.name]?.code || '—'} · {SUP[s2.name]?.location || '—'}</small></td>
                          <td className="num">{s2.pos.size}</td>
                          <td className="num">{s2.skus.size}</td>
                          <td className="num">{num(Math.round(s2.qty))}</td>
                          <td className="num strong">{trieu(s2.value)}</td>
                          <td className="num">{pct(d.total > 0 ? s2.value / d.total : 0)}</td>
                          <td className="num">{trieu(s2.qty > 0 ? s2.value / s2.qty : 0, 2)}</td>
                          <td className="num">{s2.outstanding > 0
                            ? <span className="warn">{trieu(s2.outstanding)}</span> : <span className="dim">—</span>}</td>
                          <td className="num">{s2.last || '—'}</td>
                          <td>{SUP[s2.name]?.paymentTerms != null ? `${SUP[s2.name].paymentTerms} ngày` : '—'}</td>
                        </tr>
                        {kids.map(k => {
                          const info = SKU_MAP[k.sku] || {}
                          return (
                            <tr key={s2.name + k.sku} className="child">
                              <td><b>{info.name || k.sku}</b><small>{k.sku} · {info.nganh || '—'}</small></td>
                              <td className="num">{k.buys.length}</td>
                              <td className="num dim">—</td>
                              <td className="num">{num(Math.round(k.qty))}</td>
                              <td className="num strong">{trieu(k.value)}</td>
                              <td className="num">{pct(d.total > 0 ? k.value / d.total : 0)}</td>
                              <td className="num">{trieu(k.avg, 2)}</td>
                              <td className="num dim">—</td>
                              <td className="num">{k.last.date || '—'}</td>
                              <td>{k.gapMaster == null ? <span className="dim">—</span>
                                : <span className={Math.abs(k.gapMaster) < 0.02 ? 'dim' : k.gapMaster > 0 ? 'down' : 'up'}>
                                  {k.gapMaster >= 0 ? '+' : ''}{(k.gapMaster * 100).toFixed(1)}% vs Master
                                </span>}</td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="m2-panel">
            <div className="m2-head">
              <div>
                <h3>NCC theo từng ngành chính</h3>
                <p>Top NCC của mỗi ngành — cùng bộ lọc ở trên · xếp theo giá trị PO</p>
              </div>
            </div>
            <div className="sup-by-ng">
              {d.supNganh.map(g => (
                <div key={g.nganh} className="ng-card">
                  <span className="ng-title">🏷 {g.nganh}</span>
                  <div className="m2-tablewrap">
                    <table>
                      <thead>
                        <tr><th>NCC</th><th className="num">PO (triệu)</th><th className="num">QTY (u)</th><th className="num">SKU</th><th className="num">PO gần nhất</th></tr>
                      </thead>
                      <tbody>
                        {g.sups.map(s3 => (
                          <tr key={s3.name}>
                            <td>{s3.name}</td>
                            <td className="num strong">{trieu(s3.value)}</td>
                            <td className="num">{num(Math.round(s3.qty))}</td>
                            <td className="num">{s3.skus.size}</td>
                            <td className="num">{s3.last || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'price' && (
        <div className="m2-panel">
          <div className="m2-head">
            <div>
              <h3>Biến động giá mua theo SKU</h3>
              <p>
                So sánh lần mua đầu và lần mua gần nhất trong phạm vi lọc · cột cuối đối chiếu giá mua bình quân
                với giá vốn đang ghi trong Master Data
              </p>
            </div>
          </div>
          <div className="m2-tablewrap price-table">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th className="num">Số lần mua</th>
                  <th className="num">SL nhập</th>
                  <th className="num">Giá đầu kỳ</th>
                  <th className="num">Giá gần nhất</th>
                  <th className="num">Thay đổi</th>
                  <th className="num">Thấp / cao nhất</th>
                  <th className="num">Giá mua BQ</th>
                  <th className="num">Lệch giá vốn Master</th>
                </tr>
              </thead>
              <tbody>
                {d.prices.map(p => {
                  const info = SKU_MAP[p.sku] || {}
                  return (
                    <tr key={p.sku}>
                      <td><b>{info.name || p.sku}</b><small>{p.sku} · {[...p.sups].join(', ')}</small></td>
                      <td className="num">{p.buys.length}</td>
                      <td className="num">{num(Math.round(p.qty))}</td>
                      <td className="num">{trieu(p.first.cost, 2)}<small>{p.first.date}</small></td>
                      <td className="num">{trieu(p.last.cost, 2)}<small>{p.last.date}</small></td>
                      <td className="num">{p.drift == null || p.buys.length < 2
                        ? <span className="dim">chỉ mua 1 lần</span>
                        : <span className={p.drift > 0.001 ? 'down' : p.drift < -0.001 ? 'up' : 'dim'}>
                          {p.drift >= 0 ? '+' : ''}{(p.drift * 100).toFixed(1)}%
                        </span>}</td>
                      <td className="num">{trieu(p.min, 2)} / {trieu(p.max, 2)}</td>
                      <td className="num strong">{trieu(p.avg, 2)}</td>
                      <td className="num">{p.gapMaster == null
                        ? <span className="dim">Master chưa có giá</span>
                        : <span className={Math.abs(p.gapMaster) < 0.02 ? 'dim' : p.gapMaster > 0 ? 'down' : 'up'}>
                          {p.gapMaster >= 0 ? '+' : ''}{(p.gapMaster * 100).toFixed(1)}%
                        </span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'debt' && (
        <>
          <div className="m2-panel note-panel">
            <b>Lưu ý khi đọc số công nợ</b>
            <p>
              Cột <i>Outstanding</i> trong Master Data tính trên giá <b>có VAT</b>, còn <i>Total Cost</i> là giá
              <b> chưa VAT</b> — nên không trừ trực tiếp hai cột cho nhau. Ngoài ra <i>Payment status</i> mới chỉ
              có giá trị “Yes” hoặc bỏ trống, chưa phân biệt được “chưa tới hạn” và “đã quá hạn nhưng chưa trả”.
              Bảng dưới đây hiển thị đúng những gì file đang ghi; cần đối chiếu với Kế toán trước khi dùng để đòi nợ.
            </p>
          </div>

          <div className="m2-panel">
            <div className="m2-head">
              <div>
                <h3>Công nợ theo nhà cung cấp</h3>
                <p>Giá trị có VAT · số ngày quá hạn lấy theo cột Days Overdue trong file</p>
              </div>
            </div>
            <div className="m2-tablewrap sup-table">
              <table>
                <thead>
                  <tr>
                    <th>Nhà cung cấp</th>
                    <th className="num">Giá trị PO (có VAT)</th>
                    <th className="num">Đã trả</th>
                    <th className="num">Còn lại</th>
                    <th className="num">% chưa trả</th>
                    <th className="num">Quá hạn tối đa</th>
                    <th>Điều khoản</th>
                  </tr>
                </thead>
                <tbody>
                  {[...d.bySup].sort((a, b) => b.outstanding - a.outstanding).map(s => (
                    <tr key={s.name}>
                      <td><b>{s.name}</b><small>{s.pos.size} đơn mua</small></td>
                      <td className="num">{trieu(s.vat)}</td>
                      <td className="num">{trieu(s.paid)}</td>
                      <td className="num strong">{s.outstanding > 0
                        ? <span className="warn">{trieu(s.outstanding)}</span> : '—'}</td>
                      <td className="num">{pct(s.vat > 0 ? s.outstanding / s.vat : 0)}</td>
                      <td className="num">{s.overdue > 0
                        ? <span className="down">{num(s.overdue)} ngày</span> : <span className="dim">—</span>}</td>
                      <td>{SUP[s.name]?.paymentTerms != null ? `${SUP[s.name].paymentTerms} ngày` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function Kpi({ k, v, u, s, tone }) {
  return (
    <div className={'kpi' + (tone ? ' ' + tone : '')}>
      <span>{k}</span>
      <strong>{v}</strong>
      <small className="unit">{u}</small>
      <small>{s}</small>
    </div>
  )
}

function HBars({ rows, total }) {
  if (!rows.length) return <p className="empty">Không có dữ liệu.</p>
  const data = rows.map(r => ({ ...r, v: r.value / 1e6 }))
  const Label = ({ x, y, width, height, index }) => {
    const r = data[index]
    if (!r || x == null || width == null) return null
    return (
      <text x={x + width + 9} y={y + height / 2 + 3.5} fontSize="10" fill="#4A5285">
        <tspan fontWeight="700" fill="#1B2050">{num(Math.round(r.v))}</tspan>
        <tspan dx="3" fontSize="8.5" fill="#8E93B5">triệu</tspan>
        <tspan dx="7" fontWeight="600">{pct(total > 0 ? r.value / total : 0)}</tspan>
      </text>
    )
  }
  return (
    <div className="chart" style={{ height: Math.max(190, data.length * 36 + 34) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 108, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 9, fill: C.axis }} tickLine={false}
            axisLine={{ stroke: C.grid }} tickFormatter={v => num(Math.round(v))} />
          <YAxis type="category" dataKey="name" width={148} tick={{ fontSize: 10, fill: '#4A5285' }}
            tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: '#F1F3FA' }} contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
            formatter={v => `${num(Math.round(v))} triệu`} />
          <Bar dataKey="v" radius={[0, 3, 3, 0]} maxBarSize={16} label={<Label />}>
            {data.map((r, i) => <Cell key={r.name} fill={i === 0 ? C.bar : C.bar2} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
