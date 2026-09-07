import { Fragment, useMemo, useState } from 'react'
import master from '../data/master.json'
import {
  MONTHS, pickRows, agg, groupBy, comparePeriod, growth, gmDecomp, paretoTop,
  SKU_MAP, SKU_TREND, SKU_BAND, SKU_ASP, BANDS, bandRange, IS_MOCK,
} from '../lib/metrics'
import { trieu, num, pct } from '../lib/format'
import { useDrill } from '../app/drill'
import './range.css'

const NGANH = master.dims.nganh
const TREND_LABEL = { new: 'Mới', up: 'Tăng', down: 'Giảm', flat: 'Ổn định' }

export default function Range({ filters, setFilters }) {
  const [cell, setCell] = useState(null)   // ô ma trận đang chọn: {type, band}

  const d = useMemo(() => {
    const a = Math.max(0, MONTHS.indexOf(filters.from))
    const b = Math.max(0, MONTHS.indexOf(filters.to))
    const range = [a, b]
    const cmp = comparePeriod(filters.from, filters.to, filters.compare)

    const rowsAll = pickRows({ ...filters, nganh: '' }, range)
    const prevAll = cmp ? pickRows({ ...filters, nganh: '' }, cmp) : []
    const totalCur = agg(rowsAll)

    // bảng tổng quan theo ngành
    const byNganh = groupBy(rowsAll, s => s.nganh)
    const byNganhPrev = Object.fromEntries(groupBy(prevAll, s => s.nganh).map(g => [g.key, g]))
    const skuCountByNganh = {}
    for (const r of rowsAll) {
      const ng = SKU_MAP[r.sku]?.nganh
      if (!ng) continue
      ;(skuCountByNganh[ng] = skuCountByNganh[ng] || new Set()).add(r.sku)
    }

    // ma trận trong phạm vi ngành đang lọc (nếu chưa chọn thì lấy ngành lớn nhất)
    const nganh = filters.nganh || byNganh[0]?.key || NGANH[0]
    const rows = pickRows({ ...filters, nganh }, range)
    const prevRows = cmp ? pickRows({ ...filters, nganh }, cmp) : []

    const cellKey = (s, r) => `${s.className}||${SKU_BAND[r.sku] || 'mid'}`
    const cells = Object.fromEntries(groupBy(rows, cellKey).map(g => [g.key, g]))
    const cellsPrev = Object.fromEntries(groupBy(prevRows, cellKey).map(g => [g.key, g]))
    const cellSkus = {}
    for (const r of rows) {
      const k = cellKey(SKU_MAP[r.sku] || {}, r)
      ;(cellSkus[k] = cellSkus[k] || new Set()).add(r.sku)
    }

    const types = [...new Set(rows.map(r => SKU_MAP[r.sku]?.className).filter(Boolean))]
      .sort((x, y) => {
        const rx = BANDS.reduce((s, b) => s + (cells[`${x}||${b.id}`]?.rev || 0), 0)
        const ry = BANDS.reduce((s, b) => s + (cells[`${y}||${b.id}`]?.rev || 0), 0)
        return ry - rx
      })

    // bảng SKU + nhóm trọng tâm
    const bySku = groupBy(rows, (s, r) => r.sku)
    const bySkuPrev = Object.fromEntries(groupBy(prevRows, (s, r) => r.sku).map(g => [g.key, g]))
    const focusSet = new Set([
      ...paretoTop(bySku).map(r => r.key),
      ...bySku.filter(r => SKU_TREND[r.key] === 'new').map(r => r.key),
    ])

    return {
      nganh, cmp, totalCur, byNganh, byNganhPrev, skuCountByNganh,
      types, cells, cellsPrev, cellSkus, bySku, bySkuPrev, focusSet,
      months: b - a + 1,
    }
  }, [filters])

  const sel = cell && d.types.includes(cell.type) ? cell : null
  const tableRows = sel
    ? d.bySku.filter(r => SKU_MAP[r.key]?.className === sel.type && (SKU_BAND[r.key] || 'mid') === sel.band)
    : d.bySku

  return (
    <>
      <div className="section-lead">
        <div>
          <span>MA TRẬN DANH MỤC · KỲ CHÍNH VS KỲ SO SÁNH</span>
          <h2>Range Review</h2>
          <p>
            Kỳ {filters.from} → {filters.to} ({d.months} tháng)
            {d.cmp ? ` · so với ${MONTHS[d.cmp[0]]} → ${MONTHS[d.cmp[1]]}` : ' · không so sánh'}
            {IS_MOCK && ' · số liệu bán hàng hiện là dữ liệu giả'}
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Tổng quan theo ngành hàng</h2>
            <p>Toàn bộ SKU có doanh thu trong kỳ · bấm một dòng để mở review chi tiết ngành đó</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="rng-table">
            <thead>
              <tr>
                <th>Ngành hàng</th>
                <th className="num">SKU có bán</th>
                <th className="num">Doanh thu</th>
                <th className="num">% DT công ty</th>
                <th className="num">GP</th>
                <th className="num">GM%</th>
                <th className="num">Δ vs kỳ SS</th>
              </tr>
            </thead>
            <tbody>
              {d.byNganh.map(g => {
                const p = d.byNganhPrev[g.key]
                const dv = g.rev - (p?.rev || 0)
                return (
                  <tr key={g.key} className={'clickable' + (g.key === d.nganh ? ' on' : '')}
                    onClick={() => { setFilters(f => ({ ...f, nganh: g.key })); setCell(null) }}>
                    <td><b>{g.key}</b></td>
                    <td className="num">{d.skuCountByNganh[g.key]?.size || 0}</td>
                    <td className="num strong">{trieu(g.rev)}</td>
                    <td className="num">{pct(d.totalCur.rev > 0 ? g.rev / d.totalCur.rev : 0)}</td>
                    <td className="num">{trieu(g.gp)}</td>
                    <td className="num">{pct(g.gm)}</td>
                    <td className="num">{d.cmp
                      ? <span className={dv >= 0 ? 'up' : 'down'}>{dv >= 0 ? '+' : ''}{trieu(dv)}</span>
                      : <span className="dim">—</span>}</td>
                  </tr>
                )
              })}
              <tr className="total">
                <td><b>Tổng công ty</b></td>
                <td className="num">{new Set(Object.values(d.skuCountByNganh).flatMap(s => [...s])).size}</td>
                <td className="num strong">{trieu(d.totalCur.rev)}</td>
                <td className="num">100%</td>
                <td className="num">{trieu(d.totalCur.gp)}</td>
                <td className="num">{pct(d.totalCur.gm)}</td>
                <td className="num" />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Ma trận Loại hình × Phân khúc giá — ngành {d.nganh}</h2>
            <p>
              Mỗi ô: doanh thu · GM% · số SKU · thay đổi so kỳ SS. Ô trống = khoảng danh mục chưa có hàng bán.
              Phân khúc chia theo phân vị giá bán bình quân trong nội bộ ngành, tính trên toàn bộ lịch sử.
            </p>
          </div>
          {sel && <button className="link-btn" onClick={() => setCell(null)}>Bỏ chọn ô</button>}
        </div>
        <Matrix d={d} sel={sel} onPick={setCell} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>
              {sel ? `Chi tiết ô: ${sel.type} · ${BANDS.find(b => b.id === sel.band)?.label}` : `Toàn bộ SKU ngành ${d.nganh}`}
            </h2>
            <p>★ = thuộc nhóm trọng tâm (top 80% doanh thu hoặc sản phẩm mới) · đơn vị triệu đồng</p>
          </div>
        </div>
        <SkuList rows={tableRows} prev={d.bySkuPrev} focus={d.focusSet} hasPrev={!!d.cmp} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Kết luận & hành động — nhóm trọng tâm ngành {d.nganh}</h2>
            <p>
              Gồm SKU thuộc top 80% doanh thu kỳ chọn và toàn bộ sản phẩm mới đang bán.
              Quy tắc: doanh thu giảm ≥5% → điều tra · GM giảm ≥3 điểm % → cảnh báo biên · SP mới tăng → cân nhắc scale.
            </p>
          </div>
        </div>
        <ActionTable rows={d.bySku.filter(r => d.focusSet.has(r.key))} prev={d.bySkuPrev}
          total={d.bySku.reduce((s, r) => s + r.rev, 0)} hasPrev={!!d.cmp} />
      </div>
    </>
  )
}

function Matrix({ d, sel, onPick }) {
  if (!d.types.length) return <p className="empty">Ngành này chưa có doanh thu trong kỳ đang chọn.</p>

  const colTotal = b => d.types.reduce((s, t) => s + (d.cells[`${t}||${b}`]?.rev || 0), 0)
  const grand = BANDS.reduce((s, b) => s + colTotal(b.id), 0)

  return (
    <div className="matrix-scroll">
      <table className="matrix">
        <thead>
          <tr>
            <th className="corner">Loại hình \ Phân khúc</th>
            {BANDS.map(b => {
              const r = bandRange(d.nganh, b.id)
              return (
                <th key={b.id}>
                  {b.label}
                  {r && <small>{trieu(r[0], 1)} – {trieu(r[1], 1)} tr</small>}
                </th>
              )
            })}
            <th className="tot">Tổng loại hình</th>
          </tr>
        </thead>
        <tbody>
          {d.types.map(t => {
            const rowTotal = BANDS.reduce((s, b) => s + (d.cells[`${t}||${b.id}`]?.rev || 0), 0)
            return (
              <tr key={t}>
                <th className="rowh">{t}</th>
                {BANDS.map(b => {
                  const k = `${t}||${b.id}`
                  const c = d.cells[k]
                  if (!c) return <td key={b.id} className="blank">—</td>
                  const p = d.cellsPrev[k]
                  const dv = c.rev - (p?.rev || 0)
                  const on = sel && sel.type === t && sel.band === b.id
                  const heat = grand > 0 ? Math.min(1, (c.rev / grand) * 3) : 0
                  return (
                    <td key={b.id} className={'cell' + (on ? ' on' : '')}
                      style={{ background: on ? undefined : `rgba(53,62,153,${0.05 + heat * 0.22})` }}
                      onClick={() => onPick(on ? null : { type: t, band: b.id })}>
                      <b>{trieu(c.rev)}</b>
                      <span>GM {pct(c.gm)} · {d.cellSkus[k]?.size || 0} SKU</span>
                      {d.cmp && (
                        <em className={dv >= 0 ? 'up' : 'down'}>{dv >= 0 ? '+' : ''}{trieu(dv)} vs SS</em>
                      )}
                    </td>
                  )
                })}
                <td className="tot"><b>{trieu(rowTotal)}</b></td>
              </tr>
            )
          })}
          <tr className="foot">
            <th className="rowh">Tổng phân khúc</th>
            {BANDS.map(b => <td key={b.id} className="tot"><b>{trieu(colTotal(b.id))}</b></td>)}
            <td className="tot"><b>{trieu(grand)}</b></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function SkuList({ rows, prev, focus, hasPrev }) {
  const { open: drill } = useDrill()
  if (!rows.length) return <p className="empty">Không có SKU nào trong phạm vi này.</p>
  const sorted = [...rows].sort((a, b) => b.rev - a.rev)
  return (
    <div className="table-wrap rng-list">
      <table className="rng-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Xu hướng</th>
            <th>Phân khúc</th>
            <th className="num">DT kỳ SS</th>
            <th className="num">DT kỳ chọn</th>
            <th className="num">%Δ</th>
            <th className="num">GM%</th>
            <th className="num">ASP</th>
            <th className="num">SL</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => {
            const info = SKU_MAP[r.key] || {}
            const p = prev[r.key]
            const g = hasPrev ? growth(r.rev, p?.rev || 0) : null
            const band = BANDS.find(b => b.id === (SKU_BAND[r.key] || 'mid'))
            return (
              <tr key={r.key} className="drillable" onClick={() => drill(info.className)}>
                <td>
                  <b>{focus.has(r.key) && <i className="star">★</i>}{info.name || r.key}</b>
                  <small>{r.key} · {info.className}</small>
                </td>
                <td><span className={'tag t-' + SKU_TREND[r.key]}>{TREND_LABEL[SKU_TREND[r.key]] || '—'}</span></td>
                <td className="band">{band?.label}</td>
                <td className="num">{hasPrev ? trieu(p?.rev || 0) : '—'}</td>
                <td className="num strong">{trieu(r.rev)}</td>
                <td className="num">{g == null
                  ? <span className="dim">{hasPrev ? 'Mới' : '—'}</span>
                  : <span className={g >= 0 ? 'up' : 'down'}>{g >= 0 ? '+' : ''}{(g * 100).toFixed(0)}%</span>}</td>
                <td className={'num ' + (r.gm >= 0.35 ? 'gm-hi' : r.gm >= 0.2 ? '' : 'gm-lo')}>{pct(r.gm)}</td>
                <td className="num">{trieu(SKU_ASP[r.key] || 0, 2)}</td>
                <td className="num">{num(Math.round(r.un))}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* Sinh hành động theo quy tắc — mọi kết luận đều kèm căn cứ số */
function decide(r, p, hasPrev) {
  const trend = SKU_TREND[r.key]
  const g = hasPrev && p?.rev > 0 ? r.rev / p.rev - 1 : null
  const dec = hasPrev && p ? gmDecomp(r, p) : null
  const dGm = dec?.dGm ?? null

  if (trend === 'new' && (g == null || g >= 0.15))
    return ['scale', 'Scale — tăng phân bổ', g == null ? 'SP mới, chưa có kỳ so sánh để đối chiếu' : `SP mới, doanh thu +${(g * 100).toFixed(0)}% vs kỳ SS`]
  if (trend === 'new')
    return ['watch', 'Theo dõi sát — SP mới chững', `SP mới nhưng doanh thu ${(g * 100).toFixed(0)}% vs kỳ SS`]
  if (r.gm < 0.15)
    return ['price', 'Rà pricing / đàm phán giá mua', `GM chỉ ${pct(r.gm)} — thấp hơn ngưỡng an toàn 15%`]
  if (dGm != null && dGm <= -0.03) {
    const by = Math.abs(dec.costEffect) > Math.abs(dec.priceEffect) ? 'giá vốn' : 'giá bán'
    return ['margin', 'Cảnh báo biên — kiểm tra nguyên nhân', `ΔGM ${(dGm * 100).toFixed(1)} điểm %, chủ yếu do ${by}`]
  }
  if (g != null && g <= -0.05)
    return ['investigate', 'Điều tra — doanh thu giảm', `Doanh thu ${(g * 100).toFixed(0)}% vs kỳ SS`]
  if (g != null && g >= 0.15)
    return ['keep', 'Duy trì — đang tăng tốt', `Doanh thu +${(g * 100).toFixed(0)}% vs kỳ SS`]
  return ['keep', 'Duy trì', hasPrev ? 'Biến động trong biên độ ±15%, GM ổn định' : 'Không có kỳ so sánh']
}

function ActionTable({ rows, prev, total, hasPrev }) {
  const { open: drill } = useDrill()
  if (!rows.length) return <p className="empty">Chưa xác định được nhóm trọng tâm trong kỳ này.</p>
  const sorted = [...rows].sort((a, b) => b.rev - a.rev)
  return (
    <div className="table-wrap">
      <table className="rng-table act-table">
        <thead>
          <tr>
            <th>Nhóm</th>
            <th>SKU</th>
            <th className="num">DT kỳ chọn</th>
            <th className="num">% ngành</th>
            <th className="num">GM%</th>
            <th>Action đề xuất</th>
            <th>Căn cứ</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => {
            const info = SKU_MAP[r.key] || {}
            const [tone, action, why] = decide(r, prev[r.key], hasPrev)
            return (
              <tr key={r.key} className="drillable" onClick={() => drill(info.className)}>
                <td><span className={'tag t-' + (SKU_TREND[r.key] === 'new' ? 'new' : 'flat')}>
                  {SKU_TREND[r.key] === 'new' ? 'SP mới' : 'Top 80%'}
                </span></td>
                <td><b>{info.name || r.key}</b><small>{r.key} · {info.className}</small></td>
                <td className="num strong">{trieu(r.rev)}</td>
                <td className="num">{pct(total > 0 ? r.rev / total : 0)}</td>
                <td className={'num ' + (r.gm >= 0.35 ? 'gm-hi' : r.gm >= 0.2 ? '' : 'gm-lo')}>{pct(r.gm)}</td>
                <td><span className={'act a-' + tone}>{action}</span></td>
                <td className="why">{why}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
