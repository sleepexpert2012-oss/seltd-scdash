import { Fragment, useMemo, useState } from 'react'
import master from '../data/master'
import {
  MONTHS, pickRows, groupBy, comparePeriod, growth,
  SKU_MAP, CLASS_TREND, SKU_TREND, IS_MOCK,
} from '../lib/metrics'
import { trieu, num, pct } from '../lib/format'
import { useDrill } from '../app/drill'
import './matrix.css'

/* Bậc giá tuyệt đối, dùng chung cho mọi ngành — để nhìn ra khoảng giá công ty
   đang bỏ trống trên toàn danh mục, không chỉ trong nội bộ một ngành. */
const TIERS = [
  { id: 't1', label: '< 0,3 tr', lo: 0, hi: 0.3e6 },
  { id: 't2', label: '0,3 – 0,5 tr', lo: 0.3e6, hi: 0.5e6 },
  { id: 't3', label: '0,5 – 1 tr', lo: 0.5e6, hi: 1e6 },
  { id: 't4', label: '1 – 2 tr', lo: 1e6, hi: 2e6 },
  { id: 't5', label: '2 – 3 tr', lo: 2e6, hi: 3e6 },
  { id: 't6', label: '3 – 5 tr', lo: 3e6, hi: 5e6 },
  { id: 't7', label: '5 – 8 tr', lo: 5e6, hi: 8e6 },
  { id: 't8', label: '> 8 tr', lo: 8e6, hi: Infinity },
]
const tierOf = asp => TIERS.find(t => asp >= t.lo && asp < t.hi) || TIERS[TIERS.length - 1]

const TREND_LABEL = { new: 'Mới phát triển', up: 'Đang tăng trưởng', down: 'Đang suy giảm', flat: 'Ổn định' }
const TREND_SHORT = { new: 'Mới', up: 'Tăng', down: 'Giảm', flat: 'Ổn định' }
const NGANH = master.dims.nganh

export default function Matrix({ filters, setFilters }) {
  const { open: drill } = useDrill()
  const [scope, setScope] = useState('all')      // all = toàn kỳ · period = theo kỳ đang lọc
  const [pick, setPick] = useState(null)         // class đang mở chi tiết ngay dưới ma trận

  const d = useMemo(() => {
    const a = Math.max(0, MONTHS.indexOf(filters.from))
    const b = Math.max(0, MONTHS.indexOf(filters.to))
    const range = scope === 'all' ? [0, MONTHS.length - 1] : [a, b]
    const cmp = scope === 'all' ? null : comparePeriod(filters.from, filters.to, filters.compare)

    const f = { ...filters, nganh: filters.nganh || '' }
    const rows = pickRows(f, range)
    const prevRows = cmp ? pickRows(f, cmp) : []

    const key = s => `${s.nganh}||${s.brand}||${s.className}`
    const cells = groupBy(rows, key)
    const prevByClass = Object.fromEntries(groupBy(prevRows, s => s.className).map(g => [g.key, g]))

    const skuSet = {}
    for (const r of rows) {
      const s = SKU_MAP[r.sku]
      if (!s) continue
      ;(skuSet[key(s)] = skuSet[key(s)] || new Set()).add(r.sku)
    }

    // hàng = (ngành, nhà cung cấp), sắp theo doanh thu
    const rowMap = new Map()
    for (const c of cells) {
      const [nganh, brand, className] = c.key.split('||')
      const rk = `${nganh}||${brand}`
      const e = rowMap.get(rk) || { nganh, brand, rev: 0, items: [] }
      const asp = c.un > 0 ? c.rev / c.un : 0
      e.rev += c.rev
      e.items.push({ ...c, className, asp, tier: tierOf(asp).id, skus: skuSet[c.key]?.size || 0 })
      rowMap.set(rk, e)
    }
    const rowsOut = [...rowMap.values()].sort((x, y) =>
      x.nganh === y.nganh ? y.rev - x.rev : NGANH.indexOf(x.nganh) - NGANH.indexOf(y.nganh))

    const detail = pick
      ? groupBy(rows.filter(r => SKU_MAP[r.sku]?.className === pick), (s, r) => r.sku)
      : null

    const nganhOrder = [...new Set(rowsOut.map(r => r.nganh))]

    return { rowsOut, nganhOrder, prevByClass, detail, cmp, range, total: cells.reduce((s, c) => s + c.rev, 0) }
  }, [filters, scope, pick])

  const usedTiers = new Set(d.rowsOut.flatMap(r => r.items.map(i => i.tier)))

  return (
    <>
      <div className="section-lead">
        <div>
          <span>PRODUCT MATRIX · VỊ TRÍ THEO GIÁ BÁN BÌNH QUÂN</span>
          <h2>Ma trận sản phẩm</h2>
          <p>
            Mỗi ô là một loại hình sản phẩm, đặt đúng bậc giá theo ASP thực tế
            {scope === 'all' ? ' · tính trên toàn bộ lịch sử' : ` · tính trong kỳ ${filters.from} → ${filters.to}`}
            {IS_MOCK && ' · số liệu bán hàng hiện là dữ liệu giả'}
          </p>
        </div>
      </div>

      <div className="mx-toolbar">
        <div className="mx-scope">
          <span>Kỳ tính giá</span>
          <button className={'chip' + (scope === 'all' ? ' on' : '')} onClick={() => setScope('all')}>Toàn kỳ</button>
          <button className={'chip' + (scope === 'period' ? ' on' : '')} onClick={() => setScope('period')}>Theo kỳ đang lọc</button>
        </div>
        <div className="mx-legend">
          {Object.entries(TREND_LABEL).map(([k, v]) => (
            <span key={k}><i className={'sw t-' + k} />{v}</span>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Ngành × Nhà cung cấp × Bậc giá</h2>
            <p>
              Ô trống = khoảng giá công ty chưa có hàng bán. Mỗi ô ghi tên loại hình, ASP và GM%.
              Bấm vào ô để xem các SKU bên trong.
            </p>
          </div>
          {pick && <button className="link-btn" onClick={() => setPick(null)}>Đóng chi tiết</button>}
        </div>

        {!d.rowsOut.length ? <p className="empty">Không có dữ liệu trong phạm vi lọc hiện tại.</p> : (
          <div className="mx-scroll">
            <table className="mx-table">
              <thead>
                <tr>
                  <th className="h-ng">Ngành</th>
                  <th className="h-br">Nhà cung cấp</th>
                  {TIERS.map(t => (
                    <th key={t.id} className={usedTiers.has(t.id) ? '' : 'unused'}>{t.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rowsOut.map((r, i) => {
                  const first = i === 0 || d.rowsOut[i - 1].nganh !== r.nganh
                  const last = i === d.rowsOut.length - 1 || d.rowsOut[i + 1].nganh !== r.nganh
                  const span = d.rowsOut.filter(x => x.nganh === r.nganh).length
                  const alt = d.nganhOrder.indexOf(r.nganh) % 2 === 1
                  const cls = [first && 'ng-start', last && 'ng-end', alt && 'ng-alt']
                    .filter(Boolean).join(' ')
                  return (
                    <tr key={r.nganh + r.brand} className={cls}>
                      {first && <th className="c-ng" rowSpan={span}>{r.nganh}</th>}
                      <th className="c-br">{r.brand}<small>{trieu(r.rev)} triệu</small></th>
                      {TIERS.map(t => {
                        const items = r.items.filter(x => x.tier === t.id)
                        if (!items.length) return <td key={t.id} className="blank" />
                        return (
                          <td key={t.id} className="has">
                            {items.map(it => {
                              const tr = CLASS_TREND[it.className] || 'flat'
                              const p = d.prevByClass[it.className]
                              const g = d.cmp && p?.rev > 0 ? growth(it.rev, p.rev) : null
                              return (
                                <button key={it.className}
                                  className={'mx-cell t-' + tr + (pick === it.className ? ' on' : '')}
                                  onClick={() => setPick(pick === it.className ? null : it.className)}
                                  onDoubleClick={() => drill(it.className)}
                                  title="Bấm để xem SKU bên dưới · bấm đúp để mở phân tích sâu">
                                  <b>{it.className}</b>
                                  <span>{trieu(it.asp, 2)} tr · GM {pct(it.gm)}</span>
                                  <em>
                                    {trieu(it.rev)} tr · {it.skus} SKU
                                    {g != null && <i className={g >= 0 ? 'up' : 'down'}> · {g >= 0 ? '+' : ''}{(g * 100).toFixed(0)}%</i>}
                                  </em>
                                </button>
                              )
                            })}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pick && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Chi tiết loại hình: {pick}</h2>
              <p>Các SKU thuộc loại hình này trong phạm vi đang xem · đơn vị triệu đồng</p>
            </div>
            <button className="xls-btn" onClick={() => drill(pick)}>🔍 Mở phân tích sâu</button>
            <span className={'tagline t-' + (CLASS_TREND[pick] || 'flat')}>{TREND_LABEL[CLASS_TREND[pick]] || '—'}</span>
          </div>
          <div className="table-wrap">
            <table className="mx-detail">
              <thead>
                <tr>
                  <th>SKU</th><th>Xu hướng</th>
                  <th className="num">Doanh thu</th><th className="num">SL</th>
                  <th className="num">ASP</th><th className="num">COGS/unit</th><th className="num">GM%</th>
                </tr>
              </thead>
              <tbody>
                {d.detail.map(r => {
                  const info = SKU_MAP[r.key] || {}
                  return (
                    <tr key={r.key}>
                      <td><b>{info.name || r.key}</b><small>{r.key}</small></td>
                      <td><span className={'tag t-' + SKU_TREND[r.key]}>{TREND_SHORT[SKU_TREND[r.key]] || '—'}</span></td>
                      <td className="num strong">{trieu(r.rev)}</td>
                      <td className="num">{num(Math.round(r.un))}</td>
                      <td className="num">{trieu(r.un > 0 ? r.rev / r.un : 0, 2)}</td>
                      <td className="num">{trieu(r.un > 0 ? r.cogs / r.un : 0, 2)}</td>
                      <td className={'num ' + (r.gm >= 0.35 ? 'gm-hi' : r.gm >= 0.2 ? '' : 'gm-lo')}>{pct(r.gm)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
