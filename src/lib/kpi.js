/* ============================================================
   KPI CẤP PHÒNG BAN — hàm thuần
   · KPI tự động gọi ĐÚNG hàm của màn nguồn (fin.js / metrics.js), không có
     định nghĩa thứ hai. Chỉ tính tháng đã kết thúc.
   · % đạt một tháng: chiều cao-là-tốt = thực tế ÷ mục tiêu; thấp-là-tốt =
     mục tiêu ÷ thực tế. Chặn trên 120% để một KPI không kéo cả điểm.
   · % đạt của kỳ = bình quân % đạt các tháng có cả mục tiêu lẫn thực tế.
   · Điểm phòng ban = bình quân có trọng số các KPI được giao (trọng số phải
     đủ 100% — chưa đủ thì cảnh báo, KHÔNG tự chuẩn hoá ngầm).
   · Tháng chưa có thực tế: "chưa có số", không phải 0%.
   ============================================================ */
import arFile from '../data/receivable.json'
import { revenueByMonth, autoActuals, adsBreakEven, platformMonthly, arHistory, LAST_FULL_YM } from './fin'
import { MONTHS, pickRows, monthlySeries } from './metrics'

export const CAP = 1.2
export const PERSPECTIVES = [
  ['tai_chinh', 'Tài chính'], ['khach_hang', 'Khách hàng'], ['quy_trinh', 'Quy trình nội bộ'], ['hoc_hoi', 'Học hỏi & phát triển'],
]
export const RATING = [
  [1, 'Xuất sắc', 'xs'], [0.8, 'Tốt', 'tot'], [0.6, 'Đạt', 'dat'], [0, 'Chưa đạt', 'chua'],
]
export const ratingOf = s => (s == null ? null : RATING.find(([t]) => s >= t))

/* Số thực tế của KPI tự động theo tháng — cùng đơn vị khai trong kpi_def (% ghi dạng 25 = 25%) */
export function autoValues(year, ar = arFile) {
  const yms = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
    .filter(ym => LAST_FULL_YM && ym <= LAST_FULL_YM)
  const rev = revenueByMonth(year, ar)
  const a = autoActuals(year, ar)
  const plat = Object.fromEntries(platformMonthly(year).map(p => [p.ym, p]))
  const hist = Object.fromEntries(arHistory(ar).map(h => [h.ym, h]))
  const out = { dt_cty: {}, bien_gop: {}, roas: {}, phi_san_pct: {}, ty_le_hoan: {}, don_shopee: {}, dso_ngoai: {} }
  for (const ym of yms) {
    const dt = rev[ym]?.tong
    const gv = (a.gv_san[ym] || 0) + (a.gv_ngoai[ym] || 0)
    out.dt_cty[ym] = dt ?? null
    out.bien_gop[ym] = dt > 0 ? ((dt - gv) / dt) * 100 : null
    out.roas[ym] = adsBreakEven([ym]).roas
    const p = plat[ym]
    out.phi_san_pct[ym] = p?.rev > 0 ? (p.fee / p.rev) * 100 : null
    out.ty_le_hoan[ym] = p?.gmv > 0 ? (p.hoan / p.gmv) * 100 : null
    const i = MONTHS.indexOf(ym.replace('-', '.'))
    out.don_shopee[ym] = i >= 0 ? monthlySeries(pickRows({ trend: [] }, [i, i]), [i, i])[0].o : null
    out.dso_ngoai[ym] = hist[ym]?.dso ?? null
  }
  return out
}

export function achieve(dir, target, actual) {
  if (target == null || actual == null) return null
  const t = Number(target), a = Number(actual)
  if (dir === 'down') {
    if (a <= 0) return t >= 0 ? CAP : null
    return Math.min(CAP, Math.max(0, t / a))
  }
  if (t <= 0) return null
  return Math.min(CAP, Math.max(0, a / t))
}

/* Tính toàn bộ: từng KPI được giao, từng phòng ban, từng mục tiêu, trong các tháng `yms` */
export function score(K, yms, auto) {
  const defOf = Object.fromEntries(K.defs.map(d => [d.code, d]))
  const vals = {}
  for (const v of K.values) (vals[v.assign_id] = vals[v.assign_id] || {})[v.ym] = v
  const rows = K.assigns.filter(a => a.active !== false).map(a => {
    const d = defOf[a.kpi] || { name: a.kpi, direction: 'up', unit: '' }
    const months = yms.map(ym => {
      const v = vals[a.id]?.[ym] || {}
      const actual = d.source === 'auto' ? (auto[d.auto_key]?.[ym] ?? null) : (v.actual == null ? null : Number(v.actual))
      const target = v.target == null ? null : Number(v.target)
      return { ym, target, actual, ach: achieve(d.direction, target, actual) }
    })
    const ok = months.filter(m => m.ach != null)
    return {
      ...a, def: d, months,
      ach: ok.length ? ok.reduce((s, m) => s + m.ach, 0) / ok.length : null,
      nMonths: ok.length, noTarget: months.every(m => m.target == null),
    }
  })
  const depts = K.depts.filter(d => d.active !== false).map(d => {
    const rs = rows.filter(r => r.dept === d.code)
    const wSum = rs.reduce((s, r) => s + Number(r.weight || 0), 0)
    const scored = rs.filter(r => r.ach != null && Number(r.weight) > 0)
    const w = scored.reduce((s, r) => s + Number(r.weight), 0)
    const sc = w > 0 ? scored.reduce((s, r) => s + r.ach * Number(r.weight), 0) / w : null
    return {
      ...d, rows: rs, nKpi: rs.length, wSum, wOk: Math.abs(wSum - 100) < 0.01, score: sc,
      /* Chỉ xếp hạng khi: ≥ 2 KPI, có điểm, và trọng số khai ĐỦ 100% — phòng khai 80%
         mà vẫn xếp hạng là ngầm coi 80% như 100% */
      rating: ratingOf(sc), coverW: w, rankable: rs.length >= 2 && sc != null && Math.abs(wSum - 100) < 0.01,
    }
  })
  const objs = K.objs.filter(o => o.active !== false).map(o => {
    const rs = rows.filter(r => r.objective_id === o.id)
    const scored = rs.filter(r => r.ach != null)
    const w = scored.reduce((s, r) => s + (Number(r.weight) || 1), 0)
    const ach = w > 0 ? scored.reduce((s, r) => s + r.ach * (Number(r.weight) || 1), 0) / w : null
    const cnt = { xs: 0, tot: 0, dat: 0, chua: 0 }
    for (const r of scored) cnt[ratingOf(r.ach)[2]]++
    return { ...o, rows: rs, ach, cnt, nKpi: rs.length }
  })
  const ranked = depts.filter(d => d.rankable).sort((a, b) => b.score - a.score)
  const all = rows.filter(r => r.ach != null)
  const tot = all.reduce((s, r) => s + Number(r.weight || 1), 0)
  return {
    rows, depts, objs, ranked,
    overall: tot ? all.reduce((s, r) => s + r.ach * Number(r.weight || 1), 0) / tot : null,
    avgDept: ranked.length ? ranked.reduce((s, d) => s + d.score, 0) / ranked.length : null,
    dist: RATING.map(([, lb, k]) => ({ k, lb, n: depts.filter(d => d.rating?.[2] === k).length })),
  }
}

/* Đọc số KPI (có thể lẻ): "1.250.000" → 1250000 · "12,5" → 12.5 · "12.5" → 12.5 · "3,25" → 3.25 */
export const parseNum = raw => {
  const t = String(raw ?? '').trim().replace(/[\s%]/g, '')
  if (t === '' || t === '-') return null
  if (!/^-?[\d.,]+$/.test(t)) return NaN
  const nD = (t.match(/\./g) || []).length, nC = (t.match(/,/g) || []).length
  let x = t
  if (nD && nC) x = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (nC === 1) x = t.replace(',', '.')
  else if (nC > 1) x = t.replace(/,/g, '')
  else if (nD > 1 || (nD === 1 && t.length - t.indexOf('.') - 1 === 3)) x = t.replace(/\./g, '')
  const n = Number(x)
  return Number.isFinite(n) ? n : NaN
}
