/* ============================================================
   LỚP SỐ TÀI CHÍNH: thực tế theo khoản mục × tháng, và ngân sách.
   Dùng chung cho Kế hoạch & Ngân sách, Kế hoạch vs Thực đạt, Định mức chi phí,
   Điểm hòa vốn. Toàn bộ là hàm THUẦN: nhận dữ liệu vào, trả số ra, không gọi mạng.

   Hai loại khoản mục (bảng fin_line):
   · 'auto' — app tự tính. Doanh thu và giá vốn trên sàn gọi ĐÚNG pickRows +
     monthlySeries mà màn Lãi lỗ đang dùng; phí sàn và quảng cáo đọc đúng các
     cột của platform.json. Không có cách tính thứ hai.
   · 'nhap' — người dùng nhập ở tab Chi phí thực tế (bảng fin_actual).

   Quy ước giá trị một ô:
     số   = có số (kể cả 0 thật)
     null = KHÔNG có số: tháng chưa tới, API không có lịch sử, hoặc chưa nhập.
   Không bao giờ đổi null thành 0 khi cộng mà không nói ra — xem coverage().
   ============================================================ */
import platform from '../data/platform.json'
import arFile from '../data/receivable.json'
import daily from '../data/sales_daily.json'
import debtFile from '../data/supplier_debt.json'
import { MONTHS, pickRows, monthlySeries, SKU_MAP, PARTIAL, LAST_DATA_DAY, STOCK_BY_SKU } from './metrics'
import { doiChieu } from './doiChieu'

/* Thứ tự nhóm trên mọi bảng; dấu = chiều cộng vào lợi nhuận */
export const GROUPS = [
  { id: 'doanh_thu', label: 'Doanh thu', sign: 1 },
  { id: 'gia_von', label: 'Giá vốn hàng bán', sign: -1 },
  { id: 'phi_san', label: 'Phí sàn', sign: -1 },
  { id: 'marketing', label: 'Marketing', sign: -1 },
  { id: 'opex', label: 'Chi phí hoạt động', sign: -1 },
  { id: 'tai_chinh', label: 'Chi phí tài chính', sign: -1 },
  { id: 'thue', label: 'Thuế TNDN', sign: -1 },
]
export const GROUP_OF = Object.fromEntries(GROUPS.map(g => [g.id, g]))
export const BEHAVIOR = { bien_doi: 'Biến đổi', co_dinh: 'Cố định' }

/* 6 khoản phí sàn — đúng danh sách FEES của màn Lãi lỗ, cộng lại = tong_phi_san */
export const PHI_SAN = ['phi_hoa_hong', 'phi_dich_vu', 'phi_giao_dich', 'phi_ams', 'phi_campaign', 'phi_ads_ktkt']

/* Mã các khoản app tự tính được. Khoản 'auto' nào không có trong đây là lỗi
   cấu hình — coverage() sẽ báo, không lặng lẽ cho bằng 0. */
export const AUTO_CODES = ['dt_san', 'dt_ngoai', 'gv_san', 'gv_ngoai', ...PHI_SAN, 'ads_shopee']

const FEE_BY_YM = Object.fromEntries(platform.fees.map(f => [f.ym, f]))
const ADS_BY_YM = Object.fromEntries(platform.ads.map(a => [a.ym, a]))

export const ymList = year => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
export const ymLabel = ym => `T${+ym.slice(5, 7)}`
const mIdx = ym => MONTHS.indexOf(ym.replace('-', '.'))

/* Tháng hiện tại theo giờ Việt Nam — dùng để biết tháng nào "đã tới" */
export function currentYm(now = new Date()) {
  const vn = new Date(now.getTime() + 7 * 3600e3)
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}`
}

/* Tháng có dữ liệu bán Shopee cuối cùng (có thể đang chạy dở) */
const LAST_YM = MONTHS.length ? MONTHS[MONTHS.length - 1].replace('.', '-') : null
export const PARTIAL_YM = PARTIAL ? PARTIAL.ym.replace('.', '-') : null

/* ------------------------------------------------------------
   Số THỰC TẾ của các khoản 'auto' cho một năm.
   ar: dữ liệu bán ngoài sàn — mặc định bản đóng kèm, màn nào đã tải bản mới
   từ Supabase (fetchSales) thì truyền vào để số khớp màn Bán hàng.
   ------------------------------------------------------------ */
export function autoActuals(year, ar = arFile) {
  const yms = ymList(year)
  const out = Object.fromEntries(AUTO_CODES.map(c => [c, {}]))

  /* Doanh thu và giá vốn trên sàn: cùng hàm, cùng bộ lọc rỗng như màn Lãi lỗ */
  for (const ym of yms) {
    const i = mIdx(ym)
    if (i < 0) {
      for (const c of ['dt_san', 'gv_san', ...PHI_SAN, 'ads_shopee']) out[c][ym] = null
      continue
    }
    const [s] = monthlySeries(pickRows({ trend: [] }, [i, i]), [i, i])
    out.dt_san[ym] = s.rev
    out.gv_san[ym] = s.cogs
    const f = FEE_BY_YM[ym]
    for (const k of PHI_SAN) out[k][ym] = f ? (f[k] || 0) : 0
    /* Ads: API chỉ giữ ~5 tháng. Tháng không có bản ghi = CHƯA CÓ SỐ, không phải 0 */
    out.ads_shopee[ym] = ADS_BY_YM[ym] ? (ADS_BY_YM[ym].chi_phi_ads || 0) : null
  }

  /* Bán ngoài sàn: theo tháng của ngày giao trên phiếu xuất kho. Doanh thu là
     thành tiền chưa VAT. Giá vốn = SL × giá vốn Master Data, gồm cả hàng
     tặng/hàng mẫu (thành tiền 0 nhưng hàng vẫn ra khỏi kho). */
  const cur = currentYm()
  const lastKnown = [cur, LAST_YM].filter(Boolean).sort().pop()
  const dOf = Object.fromEntries((ar.deliveries || []).map(p => [p.pxk, String(p.d).slice(0, 7)]))
  for (const ym of yms) {
    const known = ym <= lastKnown
    out.dt_ngoai[ym] = known ? 0 : null
    out.gv_ngoai[ym] = known ? 0 : null
  }
  for (const p of ar.deliveries || []) {
    const ym = String(p.d).slice(0, 7)
    if (ym in out.dt_ngoai && out.dt_ngoai[ym] !== null) out.dt_ngoai[ym] += Number(p.amount) || 0
  }
  for (const l of ar.deliveryLines || []) {
    const ym = dOf[l.pxk]
    if (!ym || !(ym in out.gv_ngoai) || out.gv_ngoai[ym] === null) continue
    out.gv_ngoai[ym] += Math.round((Number(l.qty) || 0) * (SKU_MAP[l.sku]?.unitCost || 0))
  }
  return out
}

/* ------------------------------------------------------------
   Thực tế đầy đủ: khoản 'auto' từ dữ liệu, khoản 'nhap' từ fin_actual.
   Trả về { [code]: { [ym]: số | null } } cho mọi khoản trong `lines`.
   ------------------------------------------------------------ */
export function actualByMonth(year, lines, actualRows = [], ar = arFile) {
  const yms = ymList(year)
  const auto = autoActuals(year, ar)
  const typed = {}
  for (const r of actualRows) (typed[r.line] = typed[r.line] || {})[r.ym] = Number(r.amount)
  const out = {}
  for (const l of lines) {
    out[l.code] = {}
    for (const ym of yms) {
      out[l.code][ym] = l.source === 'auto'
        ? (auto[l.code]?.[ym] ?? null)
        : (typed[l.code]?.[ym] ?? null)
    }
  }
  return out
}

/* Ngân sách của một phiên bản: { [code]: { [ym]: số } } — ô trống không có key */
export function planByMonth(version, planRows = []) {
  const out = {}
  for (const r of planRows) {
    if (r.version !== version) continue
    ;(out[r.line] = out[r.line] || {})[r.ym] = Number(r.amount)
  }
  return out
}

/* ------------------------------------------------------------
   Tổng theo nhóm và các dòng lợi nhuận cho một bảng giá trị.
   vals: { [code]: { [ym]: số|null } }. Ô null bị bỏ qua khi cộng, và được
   đếm vào `missing` để màn hiển thị biết tổng nào đang thiếu số.
   ------------------------------------------------------------ */
export function rollup(lines, vals, yms) {
  const grp = {}, missing = {}, filled = {}
  for (const g of GROUPS) { grp[g.id] = {}; missing[g.id] = {}; filled[g.id] = {} }
  for (const ym of [...yms, 'year']) {
    for (const g of GROUPS) { grp[g.id][ym] = 0; missing[g.id][ym] = 0; filled[g.id][ym] = 0 }
  }
  const lineYear = {}
  for (const l of lines) {
    if (!GROUP_OF[l.grp]) continue
    let y = 0, ny = 0
    for (const ym of yms) {
      const v = vals[l.code]?.[ym]
      if (v == null) { missing[l.grp][ym] += 1; continue }
      grp[l.grp][ym] += v; y += v; ny += 1
      filled[l.grp][ym] += 1; filled[l.grp].year += 1
    }
    lineYear[l.code] = ny ? y : null
    grp[l.grp].year += y
  }
  const at = (id, ym) => grp[id][ym]
  const derived = {}
  for (const ym of [...yms, 'year']) {
    const gp = at('doanh_thu', ym) - at('gia_von', ym)
    const lntt = gp - at('phi_san', ym) - at('marketing', ym) - at('opex', ym) - at('tai_chinh', ym)
    derived[ym] = { gp, lntt, lnst: lntt - at('thue', ym) }
  }
  /* any[ym] = số ô có số trong cả bảng — 0 nghĩa là tháng đó chưa có gì để cộng */
  const any = {}
  for (const ym of [...yms, 'year']) any[ym] = GROUPS.reduce((a, g) => a + filled[g.id][ym], 0)
  return { grp, missing, filled, any, derived, lineYear }
}

/* ------------------------------------------------------------
   Độ phủ dữ liệu — để màn nói thẳng chỗ nào số chưa đủ tin.
   ------------------------------------------------------------ */
export function coverage(year, lines, actualRows = [], ar = arFile) {
  const yms = ymList(year)
  const cur = currentYm()
  const typed = new Set(actualRows.map(r => `${r.line}|${r.ym}`))

  /* Giá vốn: SKU có bán trong năm mà Master Data chưa có giá vốn → giá vốn bị tính 0 */
  const idx = yms.map(mIdx).filter(i => i >= 0)
  let rev = 0, revNoCost = 0
  const noCost = new Set(), sold = new Set()
  if (idx.length) {
    for (const r of pickRows({ trend: [] }, [Math.min(...idx), Math.max(...idx)])) {
      if (!(r.un > 0) && !(r.rev > 0)) continue
      sold.add(r.sku)
      rev += r.rev || 0
      if (!(SKU_MAP[r.sku]?.unitCost > 0)) { noCost.add(r.sku); revNoCost += r.rev || 0 }
    }
  }
  const dOf = Object.fromEntries((ar.deliveries || []).map(p => [p.pxk, String(p.d).slice(0, 4)]))
  for (const l of ar.deliveryLines || []) {
    if (dOf[l.pxk] !== String(year)) continue
    sold.add(l.sku)
    if (!(SKU_MAP[l.sku]?.unitCost > 0)) noCost.add(l.sku)
  }

  /* Khoản nhập tay: tháng đã tới mà còn ô trống. Thuế TNDN không tính vào phép
     kiểm này: thuế tạm nộp theo quý, quyết toán theo năm — bắt nhập hằng tháng
     thì không tháng nào "đủ" được, và các so sánh lợi nhuận đều xét TRƯỚC thuế. */
  const nhap = lines.filter(l => l.source === 'nhap' && l.active !== false && l.grp !== 'thue')
  const months = yms.map(ym => {
    if (ym > cur) return { ym, state: 'future', missing: [] }
    const miss = nhap.filter(l => !typed.has(`${l.code}|${ym}`)).map(l => l.code)
    return {
      ym, missing: miss,
      state: miss.length === 0 ? 'full' : miss.length === nhap.length ? 'none' : 'part',
    }
  })

  return {
    cogs: {
      skuSold: sold.size, skuNoCost: noCost.size, noCostList: [...noCost].sort(),
      revShare: rev > 0 ? revNoCost / rev : 0,
    },
    months,
    adsMissing: yms.filter(ym => ym <= (LAST_YM || '') && mIdx(ym) >= 0 && !ADS_BY_YM[ym]),
    partialYm: PARTIAL_YM && PARTIAL_YM.startsWith(String(year)) ? PARTIAL_YM : null,
    unknownAuto: lines.filter(l => l.source === 'auto' && !AUTO_CODES.includes(l.code)).map(l => l.code),
  }
}

/* ------------------------------------------------------------
   Tiền CHI trong kế hoạch dòng tiền tuần, gộp theo tháng — chỉ để làm
   THAM CHIẾU cạnh ô chi phí thực tế (tiền chi ≠ chi phí dồn tích, không tự điền).
   Tuần ISO thuộc tháng chứa ngày thứ Năm của tuần đó.
   ------------------------------------------------------------ */
export function weekYm(wk) {
  const m = /^(\d{4})-W(\d{2})$/.exec(wk)
  if (!m) return null
  const y = +m[1], w = +m[2]
  const jan4 = new Date(Date.UTC(y, 0, 4))
  const thu = new Date(jan4)
  thu.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7 + 3)
  return thu.toISOString().slice(0, 7)
}

export function cashChiByMonth(weeks = {}, codes = []) {
  const out = {}
  for (const [wk, data] of Object.entries(weeks)) {
    const ym = weekYm(wk)
    if (!ym) continue
    for (const c of codes) {
      const v = Number(data?.chi?.[c]) || 0
      if (!v) continue
      ;(out[c] = out[c] || {})[ym] = (out[c]?.[ym] || 0) + v
    }
  }
  return out
}

/* ------------------------------------------------------------
   Đọc số người dùng gõ hoặc dán từ Excel, theo đơn vị đang chọn
   (unit = 1 đồng, 1e3 nghìn, 1e6 triệu). Trả về đồng, làm tròn.
   '' hoặc '-' → null (xoá ô). Chữ không đọc được → NaN.
   Quy tắc dấu (ưu tiên kiểu Việt Nam: chấm ngăn nghìn, phẩy thập phân):
   · có cả '.' và ','            → dấu xuất hiện SAU là thập phân ("1.250,5" / "1,250.5")
   · chỉ '.' nhiều lần           → ngăn nghìn ("1.250.000")
   · chỉ '.' một lần, sau đúng 3 số → ngăn nghìn ("1.250"); còn lại là thập phân ("12.5")
   · chỉ ',' nhiều lần           → ngăn nghìn ("1,250,000")
   · chỉ ',' một lần             → nhập theo đồng: sau đúng 3 số là ngăn nghìn, còn lại thập phân;
                                   nhập theo nghìn/triệu: luôn là thập phân ("12,5" triệu)
   Số âm: "-1.200" hoặc "(1.200)".
   ------------------------------------------------------------ */
export function parseAmount(raw, unit = 1) {
  let s = String(raw ?? '').trim().replace(/[\s\u00a0₫]/g, '').replace(/đ$/i, '')
  if (s === '' || s === '-' || s === '—') return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1) }
  if (!/^\d[\d.,]*$/.test(s)) return NaN
  const nDot = (s.match(/\./g) || []).length, nCom = (s.match(/,/g) || []).length
  const after = ch => s.length - s.lastIndexOf(ch) - 1
  let dec = null
  if (nDot && nCom) dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','
  else if (nDot === 1) dec = after('.') === 3 ? null : '.'
  else if (nCom === 1) dec = unit !== 1 ? ',' : (after(',') === 3 ? null : ',')
  let num
  if (dec) {
    const th = dec === '.' ? ',' : '.'
    num = Number(s.split(th).join('').replace(dec, '.'))
  } else {
    num = Number(s.replace(/[.,]/g, ''))
  }
  if (!Number.isFinite(num)) return NaN
  return Math.round((neg ? -num : num) * unit)
}

/* Bỏ dấu tiếng Việt để sinh mã phiên bản từ tên */
export function slug(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

/* ============================================================
   KẾ HOẠCH vs THỰC ĐẠT
   ============================================================ */

/* Tháng thực tế TRỌN VẸN cuối cùng và tháng có dữ liệu cuối cùng (có thể dở) */
const prevYm = ym => {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
export const LAST_DATA_YM = LAST_YM
export const LAST_FULL_YM = LAST_YM ? (PARTIAL_YM ? prevYm(PARTIAL_YM) : LAST_YM) : null

/* Chỉ số tháng (0..11) lũy kế đến, mặc định cho một năm. -1 = năm chưa có thực tế.
   withPartial = tính cả tháng đang chạy dở. */
export function defaultUpto(year, withPartial = false) {
  const ym = withPartial ? LAST_DATA_YM : LAST_FULL_YM
  if (!ym) return -1
  const y = +ym.slice(0, 4)
  if (y > year) return 11
  if (y < year) return -1
  return +ym.slice(5, 7) - 1
}

/* Dòng lợi nhuận suy ra. "Chi phí hoạt động" ở các màn so sánh = phí sàn +
   marketing + chi phí hoạt động (opex) — tức mọi chi phí vận hành trừ giá vốn. */
export const DERIVED = [
  { id: 'gp', label: 'Lợi nhuận gộp', sign: 1 },
  { id: 'vh', label: 'Chi phí vận hành (phí sàn + marketing + hoạt động)', sign: -1 },
  { id: 'lntt', label: 'Lợi nhuận trước thuế', sign: 1 },
]

/* So sánh lũy kế T1..T(upto+1) giữa thực tế và một phiên bản ngân sách.
   · Thực tế lũy kế của một khoản = cộng các tháng CÓ số. Tháng không có số được
     đếm vào missMonths để màn hiển thị nói rõ, không âm thầm coi là 0.
   · Dự báo cả năm = thực tế đến tháng chọn + ngân sách các tháng còn lại.
   · Đóng góp vào Δ lợi nhuận trước thuế = dấu nhóm × (thực tế − ngân sách).
     Thuế không tham gia. Cộng mọi khoản = đúng Δ lợi nhuận trước thuế. */
export function compare(lines, act, plan, year, upto) {
  const yms = ymList(year)
  const lk = yms.slice(0, upto + 1)
  const rest = yms.slice(upto + 1)
  const sum = (o, list) => list.reduce((a, ym) => a + (o?.[ym] ?? 0), 0)
  const rows = lines.filter(l => GROUP_OF[l.grp]).map(l => {
    const a = act[l.code] || {}, p = plan[l.code] || {}
    const actLK = sum(a, lk), planLK = sum(p, lk)
    /* Thuế TNDN không nộp theo tháng → không coi là "thiếu tháng" */
    const missMonths = l.grp === 'thue' ? [] : lk.filter(ym => a[ym] == null)
    const hasPlan = yms.some(ym => p[ym] != null)
    const planYear = sum(p, yms)
    const fcYear = actLK + sum(p, rest)
    const sign = GROUP_OF[l.grp].sign
    return {
      ...l, sign, actLK, planLK, missMonths, hasPlan, planYear, fcYear,
      d: actLK - planLK, dPct: planLK ? (actLK - planLK) / Math.abs(planLK) : null,
      dYear: fcYear - planYear,
      contrib: l.grp === 'thue' ? 0 : sign * (actLK - planLK),
    }
  })
  const grp = {}
  for (const g of GROUPS) {
    const rs = rows.filter(r => r.grp === g.id)
    const t = k => rs.reduce((a, r) => a + r[k], 0)
    grp[g.id] = {
      ...g, rows: rs, actLK: t('actLK'), planLK: t('planLK'), planYear: t('planYear'), fcYear: t('fcYear'),
      miss: rs.filter(r => r.missMonths.length).length,
    }
  }
  const v = (k, src) => {
    const G = id => grp[id][src]
    if (k === 'gp') return G('doanh_thu') - G('gia_von')
    if (k === 'vh') return G('phi_san') + G('marketing') + G('opex')
    return G('doanh_thu') - G('gia_von') - G('phi_san') - G('marketing') - G('opex') - G('tai_chinh')
  }
  const der = Object.fromEntries(DERIVED.map(x => [x.id, {
    ...x, actLK: v(x.id, 'actLK'), planLK: v(x.id, 'planLK'),
    fcYear: v(x.id, 'fcYear'), planYear: v(x.id, 'planYear'),
  }]))
  for (const x of Object.values(der)) {
    x.d = x.actLK - x.planLK
    x.dPct = x.planLK ? x.d / Math.abs(x.planLK) : null
    x.dYear = x.fcYear - x.planYear
  }
  const contribs = rows.filter(r => r.contrib).sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))
  return { yms, lk, rest, rows, grp, der, contribs }
}

/* Chuỗi theo tháng cho biểu đồ: doanh thu, giá vốn, các nhóm chi phí, lợi nhuận.
   Tháng không có số nào ở nhóm doanh thu → null (không vẽ, không vẽ 0). */
export function monthlyTotals(lines, vals, yms) {
  const R = rollup(lines, vals, yms)
  return yms.map(ym => {
    const has = R.filled.doanh_thu[ym] > 0
    const g = id => R.grp[id][ym]
    return {
      ym, has,
      dt: has ? g('doanh_thu') : null,
      gv: has ? g('gia_von') : null,
      san: has ? g('phi_san') : null,
      mkt: has ? g('marketing') : null,
      hd: has ? g('opex') + g('tai_chinh') : null,
      gp: has ? R.derived[ym].gp : null,
      lntt: has ? R.derived[ym].lntt : null,
    }
  })
}

/* ============================================================
   ĐỊNH MỨC CHI PHÍ
   Mẫu số của từng khoản = doanh thu của KÊNH sinh ra khoản đó:
   · phí sàn, quảng cáo Shopee → doanh thu thuần Shopee (đúng định nghĩa màn Lãi lỗ)
   · mọi khoản khác (chi phí chung của công ty) → doanh thu toàn công ty
   Chia phí sàn cho cả doanh thu ngoài sàn sẽ làm phí sàn trông rẻ đi một cách giả.

   Trạng thái:
   · khoản BIẾN ĐỔI xét theo trần % doanh thu (< 90% trần: trong trần; 90–100%: cần chú ý; > trần: vượt)
   · khoản CỐ ĐỊNH xét theo tiêu hao ngân sách (thực tế ÷ ngân sách, cùng ngưỡng 90/100%):
     % trên doanh thu của lương tăng khi doanh thu giảm, không phải vì chi tăng.
   Mỗi khoản chỉ tính trên các tháng CÓ số thực tế của chính nó — cả ngân sách lẫn
   doanh thu mẫu số cũng lấy đúng các tháng đó, để so cùng phạm vi.
   ============================================================ */
export const isSanBase = l => l.grp === 'phi_san' || l.code === 'ads_shopee' || l.code === 'gv_san'
/* Mẫu số doanh thu của một khoản: 'san' | 'ngoai' | 'tong' */
export const baseOf = l => (isSanBase(l) ? 'san' : l.code === 'gv_ngoai' ? 'ngoai' : 'tong')
export const NORM_WARN = 0.9

export function revenueByMonth(year, ar = arFile) {
  const a = autoActuals(year, ar)
  const out = {}
  for (const ym of ymList(year)) {
    const s = a.dt_san[ym], n = a.dt_ngoai[ym]
    out[ym] = { san: s, ngoai: n, tong: s == null && n == null ? null : (s || 0) + (n || 0) }
  }
  return out
}

export function costNorm(lines, act, plan, period, rev) {
  const costLines = lines.filter(l => GROUP_OF[l.grp] && l.grp !== 'doanh_thu' && l.grp !== 'thue')
  const rows = costLines.map(l => {
    const a = act[l.code] || {}, p = plan[l.code] || {}
    const months = period.filter(ym => a[ym] != null && rev[ym]?.tong != null)
    const miss = period.filter(ym => a[ym] == null)
    const base = baseOf(l)
    const actual = months.reduce((s, ym) => s + a[ym], 0)
    const hasPlan = months.some(ym => p[ym] != null)
    const budget = months.reduce((s, ym) => s + (p[ym] ?? 0), 0)
    const revBase = months.reduce((s, ym) => s + (rev[ym]?.[base] || 0), 0)
    const pct = revBase > 0 ? actual / revBase : null
    const cap = l.cap_pct == null ? null : Number(l.cap_pct) / 100
    const use = hasPlan && budget > 0 ? actual / budget : null
    let status, over = 0, overKind = null
    if (!months.length) status = 'none'
    else if (l.behavior === 'co_dinh') {
      if (use == null) status = 'noplan'
      else {
        status = use > 1 ? 'over' : use >= NORM_WARN ? 'warn' : 'ok'
        over = Math.max(0, actual - budget); overKind = 'ns'
      }
    } else {
      /* Biến đổi chưa đặt trần nhưng có ngân sách → tạm xét theo ngân sách,
         để khoản chi gấp đôi kế hoạch không trốn dưới nhãn "chưa đặt trần" */
      if (cap == null && use != null) {
        status = use > 1 ? 'over' : use >= NORM_WARN ? 'warn' : 'ok'
        over = Math.max(0, actual - budget); overKind = 'ns'
      } else if (cap == null) status = 'nocap'
      else if (pct == null) status = 'none'
      else {
        status = pct > cap ? 'over' : pct >= cap * NORM_WARN ? 'warn' : 'ok'
        over = Math.max(0, pct - cap) * revBase; overKind = 'tran'
      }
    }
    return {
      ...l, base, months, miss, actual, budget, hasPlan, remain: budget - actual, use,
      revBase, pct, cap, overPts: cap != null && pct != null ? pct - cap : null,
      over, overKind, status,
    }
  })
  const valid = rows.filter(r => r.months.length)
  const total = valid.reduce((s, r) => s + r.actual, 0)
  const withPlan = valid.filter(r => r.hasPlan)
  const budgetT = withPlan.reduce((s, r) => s + r.budget, 0)
  const actualP = withPlan.reduce((s, r) => s + r.actual, 0)
  /* Pareto: bao nhiêu khoản tạo ra 80% tổng chi phí */
  const sorted = [...valid].sort((a, b) => b.actual - a.actual)
  let acc = 0, nPareto = 0
  for (const r of sorted) { if (acc >= total * 0.8) break; acc += r.actual; nPareto++ }
  const revTong = period.reduce((s, ym) => s + (rev[ym]?.tong || 0), 0)
  return {
    rows: rows.sort((a, b) => b.over - a.over || b.actual - a.actual),
    total, budgetT, actualP, diff: actualP - budgetT, use: budgetT > 0 ? actualP / budgetT : null,
    nPareto, nValid: valid.length, revTong,
    overTotal: rows.reduce((s, r) => s + r.over, 0),
  }
}

/* 4 chỉ số riêng của bán trên sàn, theo tháng, đều chia cho doanh thu thuần Shopee.
   Voucher shop và tiền hoàn ĐÃ bị trừ khi tính doanh thu thuần → chỉ để theo dõi
   tỷ lệ, không cộng vào tổng chi phí (cộng là trừ hai lần). */
export function platformMonthly(year) {
  /* gồm cả 12 tháng năm trước để so "6 tháng trước kỳ" khi kỳ bắt đầu từ tháng 1 */
  return [...ymList(year - 1), ...ymList(year)].map(ym => {
    const i = mIdx(ym)
    if (i < 0) return { ym, rev: null }
    const [s] = monthlySeries(pickRows({ trend: [] }, [i, i]), [i, i])
    const f = FEE_BY_YM[ym]
    return {
      ym, rev: s.rev, gmv: s.gmv,
      fee: f ? f.tong_phi_san || 0 : 0,
      ads: ADS_BY_YM[ym] ? ADS_BY_YM[ym].chi_phi_ads || 0 : null,
      voucher: s.dc, hoan: s.rt,
    }
  })
}

/* ============================================================
   ĐIỂM HÒA VỐN
   Số dư đảm phí (CM) = doanh thu − chi phí BIẾN ĐỔI
   CM%               = CM ÷ doanh thu
   Doanh thu hòa vốn = chi phí CỐ ĐỊNH ÷ CM%   (chỉ có khi CM% > 0)
   Biên an toàn      = (doanh thu − doanh thu hòa vốn) ÷ doanh thu
   Biến đổi / cố định theo đúng phân loại người dùng đặt ở fin_line.behavior.
   Thuế không tham gia (hòa vốn tính trước thuế).
   ============================================================ */
export function beMonth(lines, vals, ym) {
  let dt = 0, vc = 0, fc = 0
  const vcBy = {}, fcBy = {}
  for (const l of lines) {
    const v = vals[l.code]?.[ym]
    if (v == null) continue
    if (l.grp === 'doanh_thu') dt += v
    else if (l.grp === 'thue') continue
    else if (l.behavior === 'co_dinh') { fc += v; fcBy[l.code] = (fcBy[l.code] || 0) + v }
    else { vc += v; vcBy[l.code] = (vcBy[l.code] || 0) + v }
  }
  return { ym, dt, vc, fc, vcBy, fcBy }
}

export function beCalc({ dt, vc, fc }) {
  const cm = dt - vc
  const cmPct = dt > 0 ? cm / dt : null
  const ok = cmPct != null && cmPct > 0
  const be = ok ? fc / cmPct : null
  return {
    dt, vc, fc, cm, cmPct, be, ok,
    profit: cm - fc,
    gap: be == null ? null : dt - be,
    mos: be == null || !dt ? null : (dt - be) / dt,
  }
}

export function beSum(list) {
  const t = { dt: 0, vc: 0, fc: 0, vcBy: {}, fcBy: {} }
  for (const m of list) {
    t.dt += m.dt; t.vc += m.vc; t.fc += m.fc
    for (const [k, v] of Object.entries(m.vcBy)) t.vcBy[k] = (t.vcBy[k] || 0) + v
    for (const [k, v] of Object.entries(m.fcBy)) t.fcBy[k] = (t.fcBy[k] || 0) + v
  }
  return { ...t, ...beCalc(t) }
}

/* Quảng cáo Shopee: ROAS hòa vốn và ROAS thật, cùng định nghĩa với màn Marketing:
   ROAS thật     = GMV quảng cáo × (doanh thu thuần ÷ GMV) ÷ chi quảng cáo
   ROAS hòa vốn  = 1 ÷ (biên gộp − phí sàn%)  — tức 1 ÷ CM% trên sàn TRƯỚC quảng cáo */
export function adsBreakEven(yms) {
  let rev = 0, gmv = 0, cogs = 0, fee = 0, exp = 0, adsGmv = 0, o = 0, nAds = 0
  for (const ym of yms) {
    const i = mIdx(ym)
    if (i < 0) continue
    const [s] = monthlySeries(pickRows({ trend: [] }, [i, i]), [i, i])
    rev += s.rev; gmv += s.gmv; cogs += s.cogs; o += s.o
    fee += FEE_BY_YM[ym]?.tong_phi_san || 0
    const a = ADS_BY_YM[ym]
    if (a) { exp += a.chi_phi_ads || 0; adsGmv += a.gmv_ads_rong || 0; nAds++ }
  }
  const cmPre = rev > 0 ? (rev - cogs - fee) / rev : null
  const netRate = gmv > 0 ? rev / gmv : null
  const roasBE = cmPre != null && cmPre > 0.02 ? 1 / cmPre : null
  const roas = exp > 0 && netRate != null ? (adsGmv * netRate) / exp : null
  return {
    rev, gmv, cogs, fee, exp, adsGmv, orders: o, nAds, cmPre, netRate, roasBE, roas,
    /* mỗi đồng quảng cáo mang về bao nhiêu đồng số dư đảm phí, trừ đi chính nó */
    perDong: roas != null && cmPre != null ? roas * cmPre - 1 : null,
    aov: o > 0 ? rev / o : null,
  }
}

/* ============================================================
   VỐN LƯU ĐỘNG & CHU KỲ TIỀN MẶT (CCC = DIO + DSO − DPO), cửa sổ 90 ngày
   · DIO = giá trị tồn (theo giá vốn) ÷ giá vốn hàng bán 90 ngày × 90
   · DSO = phải thu ÷ doanh thu 90 ngày × 90
       - ngoài sàn: phải thu khách (có VAT, cấn trừ nợ cũ trước — đúng doiChieu)
         ÷ doanh thu bán chịu có VAT 90 ngày
       - toàn công ty (dùng cho CCC): phải thu ÷ (doanh thu Shopee + bán chịu có VAT).
         Tiền Shopee chưa giải ngân CHƯA tính (app chưa có số escrow chờ giải ngân)
         → DSO toàn công ty đang THẤP hơn thật.
   · DPO = phải trả nhà cung cấp (số khai tay từ kế toán) ÷ giá vốn 90 ngày × 90
       (dùng giá vốn làm mẫu số vì số tiền mua hàng theo ngày không đáng tin:
        PO trong Master Data chưa cập nhật thanh toán)
   ============================================================ */
const isoAdd = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }

export function arAt(ar, asOf) {
  let phai = 0, tra = 0
  for (const c of ar.customers || []) {
    const dels = (ar.deliveries || []).filter(p => p.cust === c.code && p.d <= asOf)
    const pays = (ar.payments || []).filter(p => p.cust === c.code && p.d <= asOf)
    const dc = doiChieu(c, { deliveries: dels, deliveryLines: [], payments: pays }, asOf)
    phai += dc.tong.phai; tra += dc.tong.daTra
  }
  return Math.max(0, phai - tra)
}

function creditSales(ar, from, to) {
  const vat = Object.fromEntries((ar.customers || []).map(c => [c.code, c.vat_rate ?? 0.08]))
  let net = 0, gross = 0
  for (const p of ar.deliveries || []) {
    if (p.d < from || p.d > to) continue
    net += p.amount; gross += p.amount + Math.round(p.amount * (vat[p.cust] ?? 0.08))
  }
  return { net, gross }
}

export function workingCapital(ar = arFile, asOf = LAST_DATA_DAY) {
  const to = asOf, from = isoAdd(asOf, -89)
  /* giá vốn 90 ngày: bán Shopee theo ngày + hàng xuất kho ngoài sàn (gồm hàng tặng) */
  let cogsSan = 0, revSan = 0
  for (const r of daily.rows) if (r.d >= from && r.d <= to) { cogsSan += r.cogs || 0; revSan += r.rev || 0 }
  const dOf = Object.fromEntries((ar.deliveries || []).map(p => [p.pxk, p.d]))
  let cogsNgoai = 0
  for (const l of ar.deliveryLines || []) {
    const d = dOf[l.pxk]
    if (d && d >= from && d <= to) cogsNgoai += (Number(l.qty) || 0) * (SKU_MAP[l.sku]?.unitCost || 0)
  }
  const cogs90 = cogsSan + cogsNgoai

  /* Tồn: cùng cách tính giá trị tồn với màn Dòng tiền (gồm kho lưu trữ) */
  let inv = 0, qty = 0, qtyNoCost = 0
  const noCost = []
  for (const [sku, t] of Object.entries(STOCK_BY_SKU)) {
    const q = (t.total || 0) + (t.store || 0)
    if (q <= 0) continue
    qty += q
    const c = SKU_MAP[sku]?.unitCost || 0
    if (c > 0) inv += q * c
    else { qtyNoCost += q; noCost.push(sku) }
  }

  const arNgoai = arAt(ar, asOf)
  const cs = creditSales(ar, from, to)
  const ap = debtFile.meta?.total ?? (debtFile.rows || []).reduce((a, r) => a + (r.debt || 0), 0)

  const per = (num, den) => (den > 0 ? (num / den) * 90 : null)
  const dio = per(inv, cogs90)
  const dsoNgoai = per(arNgoai, cs.gross)
  const dso = per(arNgoai, revSan + cs.gross)
  const dpo = per(ap, cogs90)
  return {
    asOf, from, to,
    cogs90, cogsSan, cogsNgoai, revSan, credit: cs,
    inv, qty, qtyNoCost, noCost, skuStock: Object.values(STOCK_BY_SKU).filter(t => (t.total || 0) + (t.store || 0) > 0).length,
    arNgoai, ap, apAsOf: debtFile.meta?.as_of || null,
    dio, dso, dsoNgoai, dpo,
    ccc: dio != null && dso != null && dpo != null ? dio + dso - dpo : null,
    nwc: inv + arNgoai - ap,
    /* rút 1 ngày ở mỗi khâu giải phóng bao nhiêu tiền */
    perDay: { dio: cogs90 / 90, dso: (revSan + cs.gross) / 90, dpo: cogs90 / 90 },
  }
}

/* Phải thu ngoài sàn cuối mỗi tháng — dựng lại được từ ngày phiếu xuất & ngày thu tiền */
export function arHistory(ar = arFile) {
  const ds = (ar.deliveries || []).map(p => p.d).sort()
  if (!ds.length) return []
  const out = []
  let [y, m] = ds[0].slice(0, 7).split('-').map(Number)
  const endYm = (LAST_DATA_DAY || ds[ds.length - 1]).slice(0, 7)
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`
    if (ym > endYm) break
    const last = ym === endYm ? LAST_DATA_DAY : new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const a = arAt(ar, last)
    const cs = creditSales(ar, isoAdd(last, -89), last)
    out.push({ ym, asOf: last, ar: a, dso: cs.gross > 0 ? (a / cs.gross) * 90 : null })
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}
