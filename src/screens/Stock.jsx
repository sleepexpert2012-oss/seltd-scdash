import { Fragment, useMemo, useRef, useState } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import master from '../data/master'
import {
  stockPlan, STATUS, WAREHOUSES, STOCK_AS_OF, STOCK_AS_OF_DATE, STOCK_IS_MOCK, Z_SERVICE, VMIN,
  LAST_RECEIPT, setLeadTime, resetLeadTime, LT_OVERRIDE,
  STOCK_RAW_BY_SKU, PHANTOM, PHANTOM_SUMMARY, setPhantomBulk, resetPhantom, SKU_MAP,
} from '../lib/metrics'
import { exportRowsXlsx } from '../lib/masterFile'
import { trieu, num, pct } from '../lib/format'
import { useDrill } from '../app/drill'
import './stock.css'

const WH_COLOR = ['#353E99', '#5C67C4', '#8E96DC', '#C3C0D7']
const TABS = [
  ['overview', '▦', 'Tổng quan tồn kho'],
  ['detail', '≡', 'Chi tiết loại hình & SKU'],
  ['age', '◷', 'Tuổi tồn kho'],
  ['action', '⚑', 'Tổng hợp hành động'],
  ['phantom', '⚗', 'Tồn ảo trên Shopee'],
  ['setting', '⚙', 'Tham số tính toán'],
]

export default function Stock({ filters, setFilters }) {
  const [tab, setTab] = useState('overview')
  const [sttFilter, setSttFilter] = useState(null)
  const [tick, setTick] = useState(0)

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
    })

    const byStatus = STATUS.map(s => {
      const rs = rows.filter(r => r.stt === s.id)
      return {
        ...s, rows: rs, count: rs.length,
        classes: new Set(rs.map(r => r.className)).size,
        ton: rs.reduce((a, r) => a + r.ton, 0),
        value: rs.reduce((a, r) => a + r.value, 0),
        need: rs.reduce((a, r) => a + r.need, 0),
      }
    })

    const dim = keyFn => {
      const m = new Map()
      for (const r of rows) {
        const k = keyFn(r)
        const t = m.get(k) || { key: k, ton: 0, value: 0, wh: {}, skus: 0 }
        t.ton += r.ton; t.value += r.value; t.skus++
        for (const [w, q] of Object.entries(r.byWh)) t.wh[w] = (t.wh[w] || 0) + q
        m.set(k, t)
      }
      return [...m.values()].sort((a, b) => b.value - a.value)
    }
    const byNganh = dim(r => r.nganh)
    const byBrand = dim(r => r.brand).slice(0, 12)

    const whTotals = {}
    for (const w of WAREHOUSES) whTotals[w.code] = rows.reduce((a, r) => a + (r.byWh[w.code] || 0), 0)

    const asOf = new Date(STOCK_AS_OF_DATE)
    const aged = rows.filter(r => r.ton > 0).map(r => {
      const last = LAST_RECEIPT[r.sku]
      return { ...r, lastReceipt: last, days: last ? Math.round((asOf - new Date(last)) / 86400000) : null }
    })
    const AGE_BANDS = [
      { id: 'a', label: 'Dưới 3 tháng', lo: 0, hi: 90 },
      { id: 'b', label: '3 – 6 tháng', lo: 90, hi: 180 },
      { id: 'c', label: '6 – 12 tháng', lo: 180, hi: 365 },
      { id: 'd', label: 'Trên 12 tháng', lo: 365, hi: 1e9 },
      { id: 'x', label: 'Chưa có dữ liệu nhập', lo: null, hi: null },
    ].map(b => {
      const rs = b.lo == null ? aged.filter(r => r.days == null)
        : aged.filter(r => r.days != null && r.days >= b.lo && r.days < b.hi)
      return { ...b, count: rs.length, ton: rs.reduce((a, r) => a + r.ton, 0), value: rs.reduce((a, r) => a + r.value, 0) }
    })

    const needRows = rows.filter(r => r.need > 0)
    return {
      rows, byStatus, byNganh, byBrand, whTotals, aged, AGE_BANDS, needRows,
      ton: rows.reduce((a, r) => a + r.ton, 0),
      value: rows.reduce((a, r) => a + r.value, 0),
      need: needRows.reduce((a, r) => a + r.need, 0),
      needValue: needRows.reduce((a, r) => a + r.needValue, 0),
      clearValue: rows.filter(r => r.stt >= 4).reduce((a, r) => a + r.value, 0),
      clearTon: rows.filter(r => r.stt >= 4).reduce((a, r) => a + r.ton, 0),
    }
  }, [filters, tick])

  const listRows = sttFilter == null ? d.rows : d.rows.filter(r => r.stt === sttFilter)
  const salesWh = WAREHOUSES.filter(w => w.type === 'Kho bán hàng')
  const storeTon = salesWh.slice(1).reduce((a, w) => a + (d.whTotals[w.code] || 0), 0)
  const otherTon = WAREHOUSES.filter(w => w.type !== 'Kho bán hàng').reduce((a, w) => a + (d.whTotals[w.code] || 0), 0)

  return (
    <>
      <div className="scope-bar">
        INVENTORY PLANNING · {WAREHOUSES.length} KHO: {WAREHOUSES.map(w => w.name).join(' · ')} ·
        TỒN {STOCK_AS_OF} · DỰ BÁO THEO LỊCH SỬ + MÙA VỤ · SERVICE LEVEL 99%
      </div>

      <div className="m2-title">
        <span>Vận hành &amp; kế hoạch</span>
        <h2>Quản trị Tồn kho &amp; Kế hoạch đặt hàng</h2>
        <p>
          Sức bán và độ biến động lấy từ 12 tháng gần nhất · điểm đặt tính ở cấp SKU rồi cộng lên loại hình ·
          giá vốn chưa VAT{STOCK_IS_MOCK && ' · tồn kho hiện là dữ liệu giả'}
        </p>
      </div>

      <div className="m2-filter">
        <b>Phạm vi:</b>
        <label>
          Ngành hàng
          <select value={filters.nganh} onChange={e => setFilters(f => ({ ...f, nganh: e.target.value }))}>
            <option value="">Tất cả</option>
            {master.dims.nganh.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>
          Nhà cung cấp
          <select value={filters.supplier} onChange={e => setFilters(f => ({ ...f, supplier: e.target.value }))}>
            <option value="">Tất cả</option>
            {master.dims.brand.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="hint">— áp dụng cho toàn bộ trang: KPI, biểu đồ, kế hoạch đặt, bảng chi tiết</span>
      </div>

      {PHANTOM_SUMMARY.on && (
        <div className="ph-banner">
          <b>Đang trừ tồn ảo</b>
          <span>
            {num(PHANTOM_SUMMARY.count)} SKU khai bơm {num(PHANTOM_SUMMARY.declared)} unit ·
            tồn Shopee {num(PHANTOM_SUMMARY.raw)} → <b>tồn thật {num(PHANTOM_SUMMARY.real)}</b>.
            Mọi con số trên trang này, kế hoạch đặt hàng và màn Forecast đều đã tính trên tồn thật.
            {PHANTOM_SUMMARY.over > 0 && (
              <em> ⚠ {num(PHANTOM_SUMMARY.over)} unit khai nhiều hơn tồn Shopee đang có — cần soát lại.</em>
            )}
          </span>
          <button className="xls-btn" onClick={() => setTab('phantom')}>Xem &amp; sửa</button>
        </div>
      )}

      <div className="m2-kpis" style={{ gridTemplateColumns: 'repeat(5,minmax(0,1fr))' }}>
        <div><span>Tồn TỔNG</span><strong>{num(d.ton)}</strong><small>unit · {d.rows.length} SKU</small></div>
        <div><span>Giá vốn tồn kho</span><strong>{trieu(d.value)}</strong><small>triệu · đồng vốn đọng</small></div>
        <div><span>Kho tổng</span><strong>{num(d.whTotals[salesWh[0]?.code] || 0)}</strong><small>{salesWh[0]?.name}</small></div>
        <div><span>Cửa hàng</span><strong>{num(storeTon)}</strong><small>{salesWh.slice(1).map(w => w.name).join(' · ')}</small></div>
        <div><span>Kho lưu trữ</span><strong>{num(otherTon)}</strong><small>hàng lỗi / chưa xử lý</small></div>
      </div>

      <div className="stt-row">
        {d.byStatus.map(s => (
          <button key={s.id} className={'stt-box b' + s.id + (sttFilter === s.id ? ' on' : '')}
            onClick={() => { setSttFilter(sttFilter === s.id ? null : s.id); setTab('detail') }}>
            <span>{s.icon} {s.label}</span>
            <b>{s.count}</b>
          </button>
        ))}
      </div>

      <div className="m2-tabs">
        {TABS.map(([k, ic, l]) => (
          <button key={k} className={'m2-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
            <i className="tab-ic">{ic}</i>{l}
          </button>
        ))}
        <span className="spacer" />
        <button className="xls-btn" onClick={() => window.print()}>⬇ Xuất / In</button>
      </div>

      {tab === 'overview' && (
        <>
          <div className="stk-top">
            <DimTable rows={d.byNganh} whTotals={d.whTotals} totalTon={d.ton} totalValue={d.value} />
            <CoverPanel rows={d.byNganh} plan={d.rows} aged={d.aged} />
          </div>

          <div className="grid-2">
            <WarehouseDonut whTotals={d.whTotals} total={d.ton} byNganh={d.byNganh} />
            <SupplierStockChart rows={d.byBrand} />
          </div>
        </>
      )}

      {tab === 'detail' && (
        <div className="m2-panel">
          <div className="m2-head">
            <div>
              <h3>Chi tiết tồn kho theo loại hình &amp; SKU</h3>
              <p>
                {sttFilter != null ? `Đang lọc: ${STATUS[sttFilter].icon} ${STATUS[sttFilter].label} · ` : ''}
                SS = {Z_SERVICE} × σ × √(LT/30) · ROP = sức bán × LT/30 + SS · Mức đặt tới = ROP + 1 tháng nhu cầu
              </p>
            </div>
            {sttFilter != null && <div className="tools"><button className="link-btn" onClick={() => setSttFilter(null)}>Bỏ lọc</button></div>}
          </div>
          <DetailTable rows={listRows} />
        </div>
      )}

      {tab === 'age' && (
        <>
          <div className="m2-panel">
            <div className="m2-head">
              <div>
                <h3>Tuổi tồn kho</h3>
                <p>Tính từ lần nhận hàng gần nhất trong dữ liệu PO đến thời điểm chốt tồn {STOCK_AS_OF}</p>
              </div>
            </div>
            <div className="age-grid">
              {d.AGE_BANDS.map(b => (
                <div key={b.id} className={'age-card' + (b.id === 'd' ? ' warn' : '')}>
                  <span>{b.label}</span><strong>{b.count}</strong>
                  <small>{num(b.ton)} unit · {trieu(b.value)} triệu</small>
                </div>
              ))}
            </div>
          </div>
          <AgeGroups aged={d.aged} />
        </>
      )}

      {tab === 'action' && (
        <div className="m2-panel">
          <div className="m2-head">
            <div>
              <h3>Tổng hợp hành động theo trạng thái báo động</h3>
              <p>
                Ngưỡng “tháng bán còn” theo nhóm ngành — Nệm: khẩn &lt;0,5 · OK ≤1,5 · cao 1,5–3 · chậm 3–6 · báo động &gt;6
                {' '}| Chăn ga / Gối: khẩn &lt;1 · OK ≤2 · cao 2–4 · chậm 4–6 · báo động &gt;6 | Phụ kiện: báo động &gt;12
              </p>
            </div>
          </div>
          <div className="m2-tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Trạng thái</th><th className="num">SKU</th><th className="num">Loại hình</th>
                  <th className="num">Tồn (u)</th><th className="num">Giá vốn (triệu)</th>
                  <th className="num">Cần đặt (u)</th><th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {d.byStatus.map(s => (
                  <tr key={s.id}>
                    <td className={'stt-cell c' + s.id}><b>{s.icon} {s.label}</b></td>
                    <td className="num strong">{s.count}</td>
                    <td className="num">{s.classes}</td>
                    <td className="num">{num(s.ton)}</td>
                    <td className="num">{trieu(s.value)}</td>
                    <td className="num">{s.need > 0 ? <b className="need">{num(s.need)}</b> : <span className="dim">—</span>}</td>
                    <td className="act-txt">{s.act}</td>
                  </tr>
                ))}
                <tr className="tot sum-row">
                  <td><b>📦 Tổng cần đặt</b><small>SKU đang bán, sức bán ≥ {VMIN} u/tháng</small></td>
                  <td className="num">{d.needRows.length}</td><td className="num" /><td className="num" />
                  <td className="num">{trieu(d.needValue)}</td>
                  <td className="num strong need">{num(d.need)} u</td>
                  <td className="act-txt">Chi tiết ở màn Forecast &amp; Kế hoạch, tab “Kế hoạch đặt hàng”.</td>
                </tr>
                <tr className="tot sum-row">
                  <td><b>⛔ Giá vốn cần clear</b><small>nhóm bán chậm + tồn chết</small></td>
                  <td className="num" /><td className="num" />
                  <td className="num">{num(d.clearTon)}</td>
                  <td className="num strong need">{trieu(d.clearValue)}</td>
                  <td className="num" />
                  <td className="act-txt">Vốn đọng — ưu tiên khuyến mãi, điều chuyển kho hoặc thanh lý.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'phantom' && <PhantomPanel />}
      {tab === 'setting' && <SettingPanel onChange={() => setTick(t => t + 1)} rows={d.rows} />}
    </>
  )
}

/* Toàn bộ SKU đang tồn, gộp 3 cấp: Ngành → Sản phẩm (loại hình) → SKU */
const AGE_OF = days => {
  if (days == null) return { id: 'x', label: 'Chưa có dữ liệu nhập', cls: 'x' }
  if (days < 90) return { id: 'a', label: 'Dưới 3 tháng', cls: 'a' }
  if (days < 180) return { id: 'b', label: '3 – 6 tháng', cls: 'b' }
  if (days < 365) return { id: 'c', label: '6 – 12 tháng', cls: 'c' }
  return { id: 'd', label: 'Trên 12 tháng', cls: 'd' }
}

function AgeGroups({ aged }) {
  const { open: drillSafe } = useDrill()
  const [open, setOpen] = useState(null)
  const [sort, setSort] = useState('age')

  const tree = useMemo(() => {
    const ng = new Map()
    for (const r of aged) {
      const g = ng.get(r.nganh) || { key: r.nganh, ton: 0, value: 0, skus: 0, ageW: 0, ageT: 0, types: new Map() }
      g.ton += r.ton; g.value += r.value; g.skus++
      if (r.days != null) { g.ageW += r.days * r.ton; g.ageT += r.ton }
      const t = g.types.get(r.className) || { key: r.className, ton: 0, value: 0, skus: 0, ageW: 0, ageT: 0, rows: [] }
      t.ton += r.ton; t.value += r.value; t.skus++
      if (r.days != null) { t.ageW += r.days * r.ton; t.ageT += r.ton }
      t.rows.push(r)
      g.types.set(r.className, t)
      ng.set(r.nganh, g)
    }
    const fin = o => ({ ...o, age: o.ageT > 0 ? Math.round(o.ageW / o.ageT) : null })
    return [...ng.values()].map(g => fin({
      ...g,
      types: [...g.types.values()].map(fin).sort(cmp(sort)),
    })).sort(cmp(sort))
  }, [aged, sort])

  function cmp(key) {
    return (a, b) => {
      if (key === 'age') return (b.age ?? -1) - (a.age ?? -1)
      if (key === 'ton') return b.ton - a.ton
      return b.value - a.value
    }
  }

  const openSet = open ?? new Set(tree.slice(0, 1).map(g => g.key))
  const toggle = k => {
    const n = new Set(openSet)
    n.has(k) ? n.delete(k) : n.add(k)
    setOpen(n)
  }

  const totTon = aged.reduce((a, r) => a + r.ton, 0)
  const totVal = aged.reduce((a, r) => a + r.value, 0)

  return (
    <div className="m2-panel">
      <div className="m2-head">
        <div>
          <h3>Toàn bộ SKU đang tồn — theo tuổi kho</h3>
          <p>
            Gộp theo Ngành → Sản phẩm → SKU · tuổi tính từ lần nhận hàng gần nhất trong dữ liệu PO ·
            tuổi của nhóm là bình quân gia quyền theo lượng tồn
          </p>
        </div>
        <div className="tools">
          <div className="basis-switch">
            <span>Sắp theo</span>
            {[['age', 'Tuổi tồn'], ['value', 'Giá vốn'], ['ton', 'Số lượng']].map(([k, l]) => (
              <button key={k} className={'chip' + (sort === k ? ' on' : '')} onClick={() => setSort(k)}>{l}</button>
            ))}
          </div>
          <button className="xls-btn" onClick={() => setOpen(new Set(tree.map(g => g.key)))}>▼ Mở tất cả</button>
          <button className="xls-btn" onClick={() => setOpen(new Set())}>▶ Đóng tất cả</button>
        </div>
      </div>

      <div className="m2-tablewrap tall">
        <table>
          <thead>
            <tr>
              <th>Ngành / Sản phẩm / SKU</th>
              <th className="num">SKU</th>
              <th className="num">Tồn (u)</th>
              <th className="num">Giá vốn (tr)</th>
              <th className="num">Nhập gần nhất</th>
              <th className="num">Tuổi tồn (ngày)</th>
              <th>Nhóm tuổi</th>
              <th className="num">Tháng bán còn</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {tree.map(g => (
              <Fragment key={g.key}>
                <tr className="grp" onClick={() => toggle(g.key)}>
                  <td><b>{openSet.has(g.key) ? '▾' : '▸'} {g.key}</b><small>{g.types.length} sản phẩm</small></td>
                  <td className="num">{g.skus}</td>
                  <td className="num strong">{num(g.ton)}</td>
                  <td className="num strong">{trieu(g.value)}</td>
                  <td className="num dim">—</td>
                  <td className="num"><b>{g.age == null ? '—' : num(g.age)}</b></td>
                  <td><span className={'age-tag t' + AGE_OF(g.age).cls}>{AGE_OF(g.age).label}</span></td>
                  <td className="num dim">—</td>
                  <td />
                </tr>

                {openSet.has(g.key) && g.types.map(t => (
                  <Fragment key={g.key + t.key}>
                    <tr className="sub" onClick={() => toggle(g.key + '|' + t.key)}>
                      <td>
                        <b>{openSet.has(g.key + '|' + t.key) ? '▾' : '▸'} {t.key}</b>
                        <small>
                          {t.rows.length} SKU ·{' '}
                          <i className="drill-link" onClick={e => { e.stopPropagation(); drillSafe(t.key) }}>phân tích sâu →</i>
                        </small>
                      </td>
                      <td className="num">{t.skus}</td>
                      <td className="num strong">{num(t.ton)}</td>
                      <td className="num">{trieu(t.value)}</td>
                      <td className="num dim">—</td>
                      <td className="num"><b>{t.age == null ? '—' : num(t.age)}</b></td>
                      <td><span className={'age-tag t' + AGE_OF(t.age).cls}>{AGE_OF(t.age).label}</span></td>
                      <td className="num dim">—</td>
                      <td />
                    </tr>

                    {openSet.has(g.key + '|' + t.key) && [...t.rows]
                      .sort((a, b) => (b.days ?? -1) - (a.days ?? -1))
                      .map(r => (
                        <tr key={r.sku} className="child">
                          <td><b>{r.name}</b><small>{r.sku}</small></td>
                          <td className="num dim">—</td>
                          <td className="num strong">{num(r.ton)}</td>
                          <td className="num">{trieu(r.value)}</td>
                          <td className="num">{r.lastReceipt || <span className="dim">—</span>}</td>
                          <td className="num">
                            {r.days == null ? <span className="dim">—</span>
                              : <b className={r.days > 365 ? 'need' : ''}>{num(r.days)}</b>}
                          </td>
                          <td><span className={'age-tag t' + AGE_OF(r.days).cls}>{AGE_OF(r.days).label}</span></td>
                          <td className="num">{r.ml >= 60 ? '60+' : r.ml.toFixed(1)}</td>
                          <td><span className={'pri p' + r.stt}>{STATUS[r.stt].icon} {STATUS[r.stt].label}</span></td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </Fragment>
            ))}

            <tr className="tot">
              <td><b>TỔNG</b><small>{aged.length} SKU đang có tồn</small></td>
              <td className="num">{aged.length}</td>
              <td className="num strong">{num(totTon)}</td>
              <td className="num strong">{trieu(totVal)}</td>
              <td className="num" /><td className="num" /><td /><td className="num" /><td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* Cơ cấu tồn theo kho: donut gọn + bảng chú giải có số liệu, tổng đặt ở tâm */
function WarehouseDonut({ whTotals, total, byNganh }) {
  const data = WAREHOUSES.map((w, i) => ({
    code: w.code, name: w.name, type: w.type,
    value: whTotals[w.code] || 0,
    share: total > 0 ? (whTotals[w.code] || 0) / total : 0,
    fill: WH_COLOR[i % WH_COLOR.length],
  })).filter(x => x.value > 0)

  const lead = byNganh[0]

  return (
    <div className="m2-panel">
      <div className="m2-head">
        <div>
          <h3>Cơ cấu tồn theo kho</h3>
          <p>Số lượng unit đang nằm ở từng kho · tỷ trọng trên tổng tồn</p>
        </div>
      </div>

      <div className="donut-wrap">
        <div className="donut-chart">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="code" innerRadius="62%" outerRadius="88%"
                paddingAngle={2} stroke="#fff" strokeWidth={2} startAngle={90} endAngle={-270}>
                {data.map(x => <Cell key={x.code} fill={x.fill} />)}
              </Pie>
              <Tooltip contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
                formatter={(v, n, p) => [`${num(v)} unit · ${pct(p.payload.share, 0)}`, p.payload.name]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-center">
            <b>{num(total)}</b>
            <span>unit tồn</span>
          </div>
        </div>

        <ul className="donut-legend">
          {data.map(x => (
            <li key={x.code}>
              <i style={{ background: x.fill }} />
              <div className="dl-name">
                <b>{x.code}</b>
                <small>{x.name}</small>
              </div>
              <div className="dl-num">
                <b>{num(x.value)}</b>
                <small>{pct(x.share, 0)}</small>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="donut-note">
        {data[0] && <>Tập trung {pct(data[0].share, 0)} tại {data[0].name}</>}
        {lead && <> · ngành chiếm nhiều vốn nhất là {lead.key} với {trieu(lead.value)} triệu</>}
      </p>
    </div>
  )
}

/* Tồn theo nhà cung cấp: bar ngang để tên đọc thẳng, giá trị ghi cạnh thanh */
function SupplierStockChart({ rows }) {
  if (!rows.length) return null
  const data = rows.map((r, i) => ({
    rank: i + 1, name: r.key, ton: r.ton, value: r.value / 1e6, skus: r.skus,
  }))
  const max = Math.max(...data.map(x => x.ton))

  const Label = ({ x, y, width, height, index }) => {
    const r = data[index]
    if (!r || x == null || width == null) return null
    return (
      <text x={x + width + 9} y={y + height / 2 + 3.5} fontSize="10" fill="#4A5285">
        <tspan fontWeight="700" fill="#1B2050">{num(r.ton)}</tspan>
        <tspan dx="3" fontSize="8.5" fill="#8E93B5">unit</tspan>
        <tspan dx="7" fill="#8E93B5">·</tspan>
        <tspan dx="7" fontWeight="700" fill="#D97706">{num(Math.round(r.value))}</tspan>
        <tspan dx="3" fontSize="8.5" fill="#8E93B5">triệu</tspan>
      </text>
    )
  }

  const NameTick = ({ x, y, payload }) => {
    const r = data[payload?.index]
    if (!r) return null
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={-8} y={-1} textAnchor="end" fontSize="10" fill="#1B2050" fontWeight="600">{r.name}</text>
        <text x={-8} y={10} textAnchor="end" fontSize="8.5" fill="#8E93B5">{r.skus} SKU còn tồn</text>
      </g>
    )
  }

  return (
    <div className="m2-panel">
      <div className="m2-head">
        <div>
          <h3>Tồn theo nhà cung cấp</h3>
          <p>Thanh = số lượng unit · số cam bên phải = giá vốn tồn tương ứng (triệu, chưa VAT)</p>
        </div>
      </div>
      <div className="chart" style={{ height: Math.max(200, data.length * 40 + 34) }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 132, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#E7E9F3" horizontal={false} />
            <XAxis type="number" domain={[0, max * 1.02]} tick={{ fontSize: 9, fill: '#8E93B5' }}
              tickLine={false} axisLine={{ stroke: '#E7E9F3' }} tickFormatter={v => num(v)} />
            <YAxis type="category" dataKey="name" width={150} tickLine={false} axisLine={false} tick={NameTick} />
            <Tooltip cursor={{ fill: '#F1F3FA' }}
              contentStyle={{ border: '1px solid #DEE0EC', borderRadius: 8, fontSize: 11 }}
              formatter={(v, n, p) => [`${num(v)} unit · ${num(Math.round(p.payload.value))} triệu`, p.payload.name]} />
            <Bar dataKey="ton" radius={[0, 3, 3, 0]} maxBarSize={18} label={<Label />}>
              {data.map((r, i) => <Cell key={r.name} fill={i === 0 ? '#353E99' : '#5C67C4'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* Bảng gộp: mỗi ô kho hiển thị số lượng ở dòng trên, giá vốn và tỷ trọng ở dòng dưới */
function DimTable({ rows, whTotals, totalTon, totalValue }) {
  const [basis, setBasis] = useState('value')
  const valOf = r => (basis === 'value' ? r.value : r.ton)
  const total = basis === 'value' ? totalValue : totalTon
  const whValue = (r, w) => (r.ton > 0 ? (r.value * (r.wh[w] || 0)) / r.ton : 0)

  return (
    <div className="m2-panel">
      <div className="m2-head">
        <div>
          <h3>Tồn kho theo ngành hàng &amp; kho</h3>
          <p>Mỗi ô: số lượng unit ở dòng trên · giá vốn quy đổi và tỷ trọng trong nội bộ ngành ở dòng dưới</p>
        </div>
        <div className="tools basis-switch">
          <span>Tỷ trọng theo</span>
          <button className={'chip' + (basis === 'value' ? ' on' : '')} onClick={() => setBasis('value')}>Giá vốn</button>
          <button className={'chip' + (basis === 'ton' ? ' on' : '')} onClick={() => setBasis('ton')}>Số lượng</button>
        </div>
      </div>
      <div className="m2-tablewrap">
        <table className="dim-tb">
          <thead>
            <tr>
              <th>Ngành</th>
              {WAREHOUSES.map(w => <th key={w.code} className="num">{w.code}</th>)}
              <th className="num">Tổng (u)</th>
              <th className="num">Giá vốn (tr)</th>
              <th>Tỷ trọng {basis === 'value' ? 'vốn' : 'SL'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key}>
                <td><b>{r.key}</b><small>{r.skus} SKU</small></td>
                {WAREHOUSES.map(w => {
                  const q = r.wh[w.code] || 0
                  const share = r.ton > 0 ? q / r.ton : 0
                  if (!q) return <td key={w.code} className="num"><span className="dim">0</span></td>
                  return (
                    <td key={w.code} className="num heat">
                      <i style={{ '--h': Math.min(0.28, share * 0.32) }} />
                      <span>{num(q)}</span>
                      <em>{trieu(whValue(r, w.code))} tr · {pct(share, 0)}</em>
                    </td>
                  )
                })}
                <td className="num strong">{num(r.ton)}</td>
                <td className="num strong">{trieu(r.value)}</td>
                <td className="share-cell">
                  <i style={{ width: `${total > 0 ? (valOf(r) / total) * 100 : 0}%` }} />
                  <em>{pct(total > 0 ? valOf(r) / total : 0, 0)}</em>
                </td>
              </tr>
            ))}
            <tr className="tot">
              <td><b>TỔNG</b></td>
              {WAREHOUSES.map(w => {
                const q = whTotals[w.code] || 0
                const v = rows.reduce((a, r) => a + whValue(r, w.code), 0)
                return (
                  <td key={w.code} className="num">
                    {num(q)}
                    <em>{trieu(v)} tr · {pct(totalTon > 0 ? q / totalTon : 0, 0)}</em>
                  </td>
                )
              })}
              <td className="num strong">{num(totalTon)}</td>
              <td className="num strong">{trieu(totalValue)}</td>
              <td className="wh-share">
                {WAREHOUSES.map(w => {
                  const v = basis === 'value'
                    ? rows.reduce((a, r) => a + whValue(r, w.code), 0)
                    : whTotals[w.code] || 0
                  return <span key={w.code}>{w.code} {pct(total > 0 ? v / total : 0, 0)}</span>
                })}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* Thời gian tồn kho theo ngành: còn bán được bao lâu, và đã nằm kho bao lâu */
function CoverPanel({ rows, plan, aged }) {
  const data = rows.map(r => {
    const rs = plan.filter(x => x.nganh === r.key && x.ton > 0)
    const vel = rs.reduce((a, x) => a + x.vel3, 0)
    const cover = vel > 0 ? r.ton / vel : null
    const ag = aged.filter(x => x.nganh === r.key && x.days != null)
    const wAge = ag.reduce((a, x) => a + x.days * x.ton, 0)
    const wTon = ag.reduce((a, x) => a + x.ton, 0)
    const limit = r.key === 'Nệm' ? 3 : r.key === 'Phụ Kiện' ? 12 : 4
    return {
      key: r.key, ton: r.ton, value: r.value,
      cover: cover == null ? null : Math.min(cover, 36),
      coverRaw: cover,
      age: wTon > 0 ? Math.round(wAge / wTon) : null,
      limit,
      over: cover != null && cover > limit,
    }
  }).sort((a, b) => (b.coverRaw ?? 0) - (a.coverRaw ?? 0))

  const max = Math.max(6, ...data.map(x => x.cover ?? 0))

  return (
    <div className="m2-panel">
      <div className="m2-head">
        <div>
          <h3>Thời gian tồn kho theo ngành</h3>
          <p>
            Thanh = số tháng còn bán được với sức bán 3 tháng gần nhất · vạch đứt = ngưỡng an toàn của ngành ·
            cột phải = số ngày trung bình kể từ lần nhập gần nhất
          </p>
        </div>
      </div>

      <div className="cover-list">
        {data.map(r => (
          <div key={r.key} className={'cover-row' + (r.over ? ' over' : '')}>
            <div className="cv-name">
              <b>{r.key}</b>
              <small>{num(r.ton)} u · {trieu(r.value)} tr</small>
            </div>
            <div className="cv-bar">
              <i style={{ width: `${r.cover == null ? 0 : (r.cover / max) * 100}%` }} />
              <u style={{ left: `${Math.min(100, (r.limit / max) * 100)}%` }} title={`Ngưỡng ${r.limit} tháng`} />
              <span>{r.coverRaw == null ? '—' : `${r.coverRaw >= 36 ? '36+' : r.coverRaw.toFixed(1)} tháng`}</span>
            </div>
            <div className="cv-age">
              {r.age == null ? <span className="dim">—</span> : <><b>{num(r.age)}</b><small>ngày</small></>}
            </div>
          </div>
        ))}
      </div>

      <p className="cover-note">
        Ngưỡng an toàn: Nệm 3 tháng · Chăn ga, Gối, Bộ chăn ga 4 tháng · Phụ kiện 12 tháng.
        Ngành vượt ngưỡng được tô cam — đó là nơi vốn đang nằm lâu hơn mức cần thiết.
      </p>
    </div>
  )
}

function DetailTable({ rows }) {
  if (!rows.length) return <p className="empty">Không có SKU nào trong phạm vi này.</p>
  const byType = new Map()
  for (const r of rows) {
    const t = byType.get(r.className) || { key: r.className, nganh: r.nganh, rows: [], ton: 0, value: 0, need: 0 }
    t.rows.push(r); t.ton += r.ton; t.value += r.value; t.need += r.need
    byType.set(r.className, t)
  }
  const groups = [...byType.values()].sort((a, b) => b.value - a.value)
  return <TypeGroups groups={groups} />
}

function TypeGroups({ groups }) {
  const { open: drill } = useDrill()
  const [open, setOpen] = useState(() => new Set(groups.slice(0, 3).map(g => g.key)))
  const toggle = k => setOpen(o => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n })
  return (
    <>
    <div className="group-ctrl">
      <button className="xls-btn" onClick={() => setOpen(new Set(groups.map(g => g.key)))}>▼ Mở tất cả</button>
      <button className="xls-btn" onClick={() => setOpen(new Set())}>▶ Đóng tất cả</button>
    </div>
    <div className="m2-tablewrap tall">
      <table>
        <thead>
          <tr>
            <th>Loại hình / SKU</th><th>Trạng thái</th><th className="num">Tồn</th><th className="num">Giá vốn</th>
            <th className="num">Sức bán 3T</th><th className="num">σ tháng</th><th className="num">Tháng bán còn</th>
            <th className="num">SS</th><th className="num">ROP</th><th className="num">Cần đặt</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <Fragment key={g.key}>
              <tr className="grp" onClick={() => toggle(g.key)}>
                <td>
                  <b>{open.has(g.key) ? '▾' : '▸'} {g.key}</b>
                  <small>
                    {g.nganh} · {g.rows.length} SKU ·{' '}
                    <i className="drill-link" onClick={e => { e.stopPropagation(); drill(g.key) }}>phân tích sâu →</i>
                  </small>
                </td>
                <td />
                <td className="num strong">{num(g.ton)}</td>
                <td className="num">{trieu(g.value)}</td>
                <td className="num" colSpan={5} />
                <td className="num">{g.need > 0 ? <b className="need">{num(g.need)}</b> : <span className="dim">—</span>}</td>
              </tr>
              {open.has(g.key) && g.rows.sort((a, b) => a.stt - b.stt || b.value - a.value).map(r => (
                <tr key={r.sku} className="child">
                  <td><b>{r.name}</b><small>{r.sku} · LT {r.LT} ngày</small></td>
                  <td><span className={'pri p' + r.stt}>{STATUS[r.stt].icon} {STATUS[r.stt].label}</span></td>
                  <td className="num strong">{num(r.ton)}</td>
                  <td className="num">{trieu(r.value)}</td>
                  <td className="num">{r.vel3.toFixed(1)}</td>
                  <td className="num">{r.sd.toFixed(1)}</td>
                  <td className="num">{r.ml >= 60 ? '60+' : r.ml.toFixed(1)}</td>
                  <td className="num">{num(r.ss)}</td>
                  <td className="num">{num(r.rop)}</td>
                  <td className="num">{r.need > 0 ? <b className="need">{num(r.need)}</b> : <span className="dim">—</span>}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
    </>
  )
}

function SettingPanel({ onChange, rows }) {
  const [, force] = useState(0)
  const sups = master.suppliers.map(s => s.name)
  const usedBy = s => rows.filter(r => r.brand === s).length
  return (
    <div className="m2-panel">
      <div className="m2-head">
        <div>
          <h3>Tham số tính toán</h3>
          <p>Master Data chưa khai lead time nên hệ thống tạm dùng 30 ngày. Sửa ở đây thì SS, ROP, mức đặt tới tính lại ngay và lưu tại máy.</p>
        </div>
        <div className="tools">
          <button className="xls-btn" onClick={() => { resetLeadTime(); onChange(); force(x => x + 1) }}>Về mặc định</button>
        </div>
      </div>
      <div className="lt-grid">
        {sups.map(s => (
          <label key={s} className="lt-item">
            <span>{s}</span>
            <input type="number" min="1" max="365" value={LT_OVERRIDE[s] ?? 30}
              onChange={e => { setLeadTime(s, Math.max(1, +e.target.value || 1)); onChange(); force(x => x + 1) }} />
            <small>{usedBy(s)} SKU đang tính theo mức này</small>
          </label>
        ))}
      </div>
      <div className="formula">
        <b>Công thức đang áp dụng</b>
        <ul>
          <li>Safety stock = {Z_SERVICE} × σ × √(LT ÷ 30) — hệ số {Z_SERVICE} ứng với mức phục vụ 99%</li>
          <li>Điểm đặt lại (ROP) = sức bán 3 tháng × (LT ÷ 30) + Safety stock</li>
          <li>Mức đặt tới = ROP + một tháng nhu cầu</li>
          <li>Cần đặt = mức đặt tới − tồn hiện có, làm tròn lên bội số MOQ</li>
          <li>Chỉ đề xuất đặt khi sức bán 3 tháng ≥ {VMIN} unit/tháng</li>
        </ul>
      </div>
    </div>
  )
}

/* ============================================================
   TỒN ẢO TRÊN SHOPEE
   Shopee được bơm thêm tồn để chạy chiến dịch nên số API trả về cao hơn thực tế.
   Khai số đã bơm ở đây, hệ thống trừ ra tại nguồn nên toàn bộ ROP, mức đặt tới,
   số tháng bán còn, giá vốn tồn và tồn chết đều tính trên tồn thật.
   ============================================================ */
function PhantomPanel() {
  const [draft, setDraft] = useState(() => {
    const o = {}
    for (const [k, v] of Object.entries(PHANTOM)) o[k] = String(v)
    return o
  })
  const [view, setView] = useState('stock')   // stock | declared | all
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const fileRef = useRef(null)

  const all = useMemo(() => {
    const skus = new Set([...Object.keys(STOCK_RAW_BY_SKU), ...Object.keys(PHANTOM)])
    return [...skus].map(sku => {
      const s = SKU_MAP[sku] || {}
      return {
        sku,
        name: s.name || '(không có trong Master Data)',
        nganh: s.nganh || '—',
        className: s.className || '—',
        raw: STOCK_RAW_BY_SKU[sku]?.total || 0,
      }
    }).sort((a, b) => b.raw - a.raw || a.sku.localeCompare(b.sku))
  }, [])

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return all.filter(r => {
      if (view === 'stock' && r.raw <= 0 && !draft[r.sku]) return false
      if (view === 'declared' && !(+draft[r.sku] > 0)) return false
      if (kw && !(r.sku.toLowerCase().includes(kw) || r.name.toLowerCase().includes(kw))) return false
      return true
    })
  }, [all, view, q, draft])

  /* xem trước tác động ngay khi gõ, chưa cần lưu */
  const prev = useMemo(() => {
    let declared = 0, cut = 0, over = 0, n = 0
    for (const r of all) {
      const ph = Math.max(0, Math.round(+draft[r.sku] || 0))
      if (!ph) continue
      n++; declared += ph
      cut += Math.min(ph, r.raw)
      over += Math.max(0, ph - r.raw)
    }
    const raw = all.reduce((a, r) => a + r.raw, 0)
    return { n, declared, cut, over, raw, real: raw - cut }
  }, [all, draft])

  const dirty = useMemo(() => {
    const cur = Object.fromEntries(Object.entries(PHANTOM).map(([k, v]) => [k, String(v)]))
    const clean = Object.fromEntries(
      Object.entries(draft).filter(([, v]) => +v > 0).map(([k, v]) => [k, String(Math.round(+v))]))
    return JSON.stringify(cur) !== JSON.stringify(clean)
  }, [draft])

  const set = (sku, v) => setDraft(d => ({ ...d, [sku]: v.replace(/[^\d]/g, '') }))

  const apply = () => {
    setPhantomBulk(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, +v || 0])))
    location.reload()
  }
  const clearAll = () => { resetPhantom(); location.reload() }

  async function onPick(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setMsg('')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: false })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false })
      /* Nhận file linh hoạt: dò cột SKU và cột số lượng theo tên tiêu đề.
         Nếu không có tiêu đề thì lấy cột 1 = SKU, cột 2 = số lượng. */
      const norm = s => String(s ?? '').trim().toLowerCase()
      let hi = -1, ci = 0, cq = 1
      for (let i = 0; i < Math.min(grid.length, 10); i++) {
        const r = (grid[i] || []).map(norm)
        const a = r.findIndex(x => x === 'sku' || x === 'mã sku' || x === 'ma sku')
        if (a >= 0) {
          const b = r.findIndex(x => x.includes('ảo') || x.includes('ao') || x.includes('bơm')
            || x.includes('bom') || x.includes('qty') || x.includes('số lượng') || x.includes('so luong'))
          hi = i; ci = a; cq = b >= 0 ? b : a + 1
          break
        }
      }
      const body = hi >= 0 ? grid.slice(hi + 1) : grid
      const next = {}
      let bad = 0, unknown = []
      for (const r of body) {
        const sku = String(r?.[ci] ?? '').trim()
        if (!sku) continue
        const n = Math.round(Number(String(r?.[cq] ?? '').replace(/[^\d.-]/g, '')))
        if (!Number.isFinite(n) || n <= 0) { bad++; continue }
        if (!SKU_MAP[sku] && !STOCK_RAW_BY_SKU[sku]) unknown.push(sku)
        next[sku] = n
      }
      if (!Object.keys(next).length) throw new Error('Không đọc được dòng nào có SKU và số lượng > 0')
      setDraft(Object.fromEntries(Object.entries(next).map(([k, v]) => [k, String(v)])))
      setView('declared')
      setMsg(`Đã nạp ${Object.keys(next).length} SKU từ ${f.name}`
        + (bad ? ` · bỏ qua ${bad} dòng không có số hợp lệ` : '')
        + (unknown.length ? ` · ⚠ ${unknown.length} SKU không có trong Master Data lẫn tồn Shopee: ${unknown.slice(0, 6).join(', ')}` : '')
        + '. Kiểm lại rồi bấm Lưu & áp dụng.')
    } catch (err) {
      setMsg('Lỗi đọc file: ' + (err.message || err))
    }
  }

  const K = [
    ['Tồn Shopee trả về', prev.raw, 'unit · số đã bơm'],
    ['Khai bơm ảo', prev.declared, `unit · ${prev.n} SKU`],
    ['Trừ được', prev.cut, 'unit'],
    ['Tồn thật dùng để tính', prev.real, 'unit'],
  ]

  return (
    <>
      <div className="m2-panel">
        <div className="m2-head">
          <div>
            <h3>⚗ Tồn ảo trên Shopee</h3>
            <p>
              Trên Shopee có bơm thêm số lượng tồn để chạy chiến dịch, nên con số API trả về
              là tồn <b>đã bơm</b>. Khai số đã bơm theo SKU ở đây, hệ thống trừ ra ngay tại
              nguồn — <b>ROP, mức đặt tới, số tháng bán còn, giá vốn tồn và phân loại tồn chết
              đều tính lại trên tồn thật</b>, kể cả ở màn Tổng quan và Forecast.
            </p>
          </div>
          <div className="tools">
            <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls,.csv" hidden onChange={onPick} />
            <button className="xls-btn" onClick={() => fileRef.current?.click()}>⬆ Nhập Excel</button>
            <button className="xls-btn" onClick={() => exportRowsXlsx('Ton ao theo SKU.xlsx', {
              'Ton ao': all.map(r => ({
                SKU: r.sku, 'Tên sản phẩm': r.name, 'Ngành hàng': r.nganh,
                'Tồn Shopee': r.raw,
                'Số lượng ảo': Math.round(+draft[r.sku] || 0),
                'Tồn thật': Math.max(0, r.raw - Math.round(+draft[r.sku] || 0)),
              })),
            })}>⬇ Kết xuất Excel</button>
          </div>
        </div>

        <div className="ph-kpis">
          {K.map(([k, v, u], i) => (
            <div key={k} className={i === 3 ? 'hi' : ''}>
              <span>{k}</span><strong>{num(v)}</strong><small>{u}</small>
            </div>
          ))}
        </div>

        {prev.over > 0 && (
          <p className="ph-warn">
            ⚠ Có <b>{num(prev.over)} unit</b> khai bơm nhiều hơn tồn Shopee đang có
            (ở {all.filter(r => Math.round(+draft[r.sku] || 0) > r.raw).length} SKU).
            Phần vượt không trừ được nên tồn thật của các SKU đó về 0 — kiểm lại số khai
            hoặc kéo lại tồn mới.
          </p>
        )}
        {msg && <p className="ph-msg">{msg}</p>}

        <div className="ph-bar">
          <div className="group-ctrl">
            {[['stock', 'Có tồn'], ['declared', 'Đã khai'], ['all', 'Tất cả']].map(([k, l]) => (
              <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
            ))}
          </div>
          <input className="ph-q" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Tìm SKU hoặc tên sản phẩm..." />
          <span className="ph-count">{rows.length} SKU</span>
          <span className="spacer" />
          <button className="btn-primary" disabled={!dirty} onClick={apply}>
            {dirty ? 'Lưu & áp dụng' : 'Đã lưu'}
          </button>
          <button className="xls-btn" disabled={!PHANTOM_SUMMARY.on} onClick={clearAll}>
            Xoá hết khai báo
          </button>
        </div>

        <div className="m2-tablewrap tall">
          <table className="ph-table">
            <thead>
              <tr>
                <th>SKU</th><th>Sản phẩm</th><th>Ngành</th>
                <th className="num">Tồn Shopee</th>
                <th className="num">Số lượng ảo đã bơm</th>
                <th className="num">Tồn thật</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const ph = Math.round(+draft[r.sku] || 0)
                const real = Math.max(0, r.raw - ph)
                const over = ph > r.raw
                return (
                  <tr key={r.sku} className={over ? 'over' : ph ? 'has' : ''}>
                    <td className="mono">{r.sku}</td>
                    <td className="nm" title={r.name}>{r.name}</td>
                    <td>{r.nganh}</td>
                    <td className="num">{num(r.raw)}</td>
                    <td className="num">
                      <input value={draft[r.sku] ?? ''} onChange={e => set(r.sku, e.target.value)}
                        inputMode="numeric" placeholder="0" className={over ? 'bad' : ''} />
                    </td>
                    <td className={`num b ${over ? 'bad' : ''}`}>
                      {num(real)}{over && <em> (khai vượt {num(ph - r.raw)})</em>}
                    </td>
                  </tr>
                )
              })}
              {!rows.length && <tr><td colSpan={6} className="empty">Không có SKU nào khớp</td></tr>}
            </tbody>
          </table>
        </div>

        <p className="ph-note">
          Số khai lưu tại máy này (giống lead time), không đẩy lên server — nên mỗi người
          dùng tự khai. Cần cả tổ chức dùng chung thì kết xuất Excel rồi nhập lại ở máy khác.
          Khi một SKU nằm ở nhiều kho, phần ảo được trừ dần từ kho đang nhiều nhất — vì API
          không cho biết kho nào bị bơm.
        </p>
      </div>
    </>
  )
}
