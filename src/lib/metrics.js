import master from '../data/master'
import sales from '../data/sales.json'
import stock from '../data/stock.json'
import phantomFile from '../data/phantom.json'
import daily from '../data/sales_daily.json'

export const MONTHS = sales.months
export const SKU_MAP = Object.fromEntries(master.skus.map(s => [s.sku, s]))
export const IS_MOCK = sales.meta.kind === 'MOCK'

/* Ngày cuối cùng có dữ liệu và THÁNG CUỐI CÙNG ĐỦ 100% NGÀY.
   Dữ liệu thật luôn có tháng hiện tại chạy dở (hôm nay mới mùng 7 thì tháng 9
   chỉ có 7/30 ngày). Nếu để tháng dở vào cửa sổ tính vel3 / YoY / dự báo thì
   mọi con số tốc độ bán và dự báo đều bị hụt khoảng 2/3 — nên tách riêng. */
export const LAST_DATA_DAY = daily.rows.reduce((a, r) => (r.d > a ? r.d : a), '0000-00-00')
export const PARTIAL = (() => {
  const ym = LAST_DATA_DAY.slice(0, 7).replace('-', '.')
  const m = MONTHS.indexOf(ym)
  if (m < 0) return null
  const [y, mo] = ym.split('.').map(Number)
  const days = new Date(y, mo, 0).getDate()
  const have = +LAST_DATA_DAY.slice(8, 10)
  return have >= days ? null : { m, ym, have, days, pct: have / days }
})()
/* Chỉ số tháng đủ dữ liệu cuối cùng — dùng cho MỌI phép tính tốc độ & dự báo */
export const LAST_FULL_M = PARTIAL ? Math.max(0, PARTIAL.m - 1) : MONTHS.length - 1

const idx = m => MONTHS.indexOf(m)

/* Khoảng kỳ so sánh theo lựa chọn trên thanh lọc */
export function comparePeriod(from, to, mode) {
  const a = idx(from), b = idx(to)
  if (mode === 'none' || a < 0 || b < 0) return null
  const len = b - a + 1
  const [ca, cb] = mode === 'yoy' ? [a - 12, b - 12] : [a - len, b - len]
  if (ca < 0) return null
  return [ca, cb]
}

/* Phân loại xu hướng từng SKU trên toàn bộ lịch sử — dùng cho chips lọc.
   new  : phát sinh bán lần đầu trong 6 tháng gần nhất
   up   : doanh thu 3 tháng gần nhất tăng ≥15% so 3 tháng liền trước
   down : giảm ≥15%, hoặc đã ngừng bán trên 2 tháng
   flat : còn lại */
export const TRENDS = [
  { id: 'new', label: 'Mới phát triển' },
  { id: 'up', label: 'Đang tăng trưởng' },
  { id: 'down', label: 'Đang suy giảm' },
  { id: 'flat', label: 'Ổn định' },
]

export const SKU_TREND = (() => {
  const maxM = MONTHS.length - 1
  const by = new Map()
  for (const r of sales.rows) {
    const t = by.get(r.sku) || { first: 99, last: -1, a: 0, b: 0 }
    t.first = Math.min(t.first, r.m)
    t.last = Math.max(t.last, r.m)
    if (r.m > maxM - 3) t.a += r.rev
    else if (r.m > maxM - 6) t.b += r.rev
    by.set(r.sku, t)
  }
  const out = {}
  for (const [sku, t] of by) {
    if (t.last < maxM - 2) out[sku] = 'down'
    else if (t.first >= maxM - 5) out[sku] = 'new'
    else {
      const g = t.b > 0 ? t.a / t.b - 1 : null
      out[sku] = g == null ? 'flat' : g >= 0.15 ? 'up' : g <= -0.15 ? 'down' : 'flat'
    }
  }
  return out
})()

/* Phân loại xu hướng ở cấp CLASS (loại hình) — cùng quy tắc như cấp SKU */
export const CLASS_TREND = (() => {
  const maxM = MONTHS.length - 1
  const by = new Map()
  for (const r of sales.rows) {
    const cls = SKU_MAP[r.sku]?.className
    if (!cls) continue
    const t = by.get(cls) || { first: 99, last: -1, a: 0, b: 0 }
    t.first = Math.min(t.first, r.m)
    t.last = Math.max(t.last, r.m)
    if (r.m > maxM - 3) t.a += r.rev
    else if (r.m > maxM - 6) t.b += r.rev
    by.set(cls, t)
  }
  const out = {}
  for (const [cls, t] of by) {
    if (t.last < maxM - 2) out[cls] = 'down'
    else if (t.first >= maxM - 5) out[cls] = 'new'
    else {
      const g = t.b > 0 ? t.a / t.b - 1 : null
      out[cls] = g == null ? 'flat' : g >= 0.15 ? 'up' : g <= -0.15 ? 'down' : 'flat'
    }
  }
  return out
})()

export function trendCounts() {
  const c = Object.fromEntries(TRENDS.map(t => [t.id, 0]))
  for (const v of Object.values(SKU_TREND)) if (c[v] != null) c[v]++
  return c
}

function matchSku(s, f) {
  if (!s) return false
  if (f.nganh && s.nganh !== f.nganh) return false
  if (f.loaiHinh && s.className !== f.loaiHinh) return false
  if (f.supplier && s.brand !== f.supplier) return false
  if (f.trend?.length && !f.trend.includes(SKU_TREND[s.sku])) return false
  if (f.q) {
    const q = f.q.toLowerCase()
    if (!(s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))) return false
  }
  return true
}

export function pickRows(f, range) {
  const [a, b] = range
  return sales.rows.filter(r => {
    if (r.m < a || r.m > b) return false
    if (f.kenh && r.ch !== f.kenh) return false
    return matchSku(SKU_MAP[r.sku], f)
  })
}

const EMPTY = { gmv: 0, cx: 0, dc: 0, rt: 0, rev: 0, cogs: 0, u: 0, un: 0, o: 0 }

export function agg(rows) {
  const t = { ...EMPTY }
  for (const r of rows) for (const k in t) t[k] += r[k] || 0
  return derive(t)
}

export function derive(t) {
  const gp = t.rev - t.cogs
  return {
    ...t,
    gp,
    gm: t.rev > 0 ? gp / t.rev : 0,
    aov: t.o > 0 ? t.rev / t.o : 0,
    cancelRate: t.gmv > 0 ? t.cx / t.gmv : 0,
    returnRate: t.gmv > 0 ? t.rt / t.gmv : 0,
    discountRate: t.gmv > 0 ? t.dc / t.gmv : 0,
  }
}

/* Chuỗi theo tháng cho các biểu đồ xu hướng */
export function monthlySeries(rows, range) {
  const [a, b] = range
  const buckets = new Map()
  for (let i = a; i <= b; i++) buckets.set(i, { ...EMPTY, m: i })
  for (const r of rows) {
    const t = buckets.get(r.m)
    if (!t) continue
    for (const k in EMPTY) t[k] += r[k] || 0
  }
  return [...buckets.values()].map(t => ({ ...derive(t), label: MONTHS[t.m] }))
}

/* Top SKU theo doanh thu — kèm số lượng bán thuần và GM% */
export function topSkus(rows, n = 10) {
  const by = new Map()
  for (const r of rows) {
    const t = by.get(r.sku) || { ...EMPTY, sku: r.sku }
    for (const k in EMPTY) t[k] += r[k] || 0
    by.set(r.sku, t)
  }
  return [...by.values()]
    .map(t => {
      const s = SKU_MAP[t.sku] || {}
      return { ...derive(t), sku: t.sku, name: s.name || t.sku, nganh: s.nganh || '—', className: s.className || '—' }
    })
    .sort((x, y) => y.rev - x.rev)
    .slice(0, n)
}

/* Gộp theo một chiều bất kỳ (loại hình, NCC, SKU...) */
export function groupBy(rows, keyFn) {
  const by = new Map()
  for (const r of rows) {
    const k = keyFn(SKU_MAP[r.sku] || {}, r)
    if (k == null) continue
    const t = by.get(k) || { ...EMPTY, key: k }
    for (const kk in EMPTY) t[kk] += r[kk] || 0
    by.set(k, t)
  }
  return [...by.values()].map(t => ({ ...derive(t), key: t.key })).sort((a, b) => b.rev - a.rev)
}

/* Kích thước chuẩn hoá của SKU: Rộng x Dài (cm). SKU không có kích thước
   (bộ chăn ga bán theo hoạ tiết) gom vào một nhóm riêng. */
export const NO_SIZE = '(không phân size)'
export const sizeOf = sku => {
  const s = SKU_MAP[sku]
  if (!s || !(s.w > 0) || !(s.l > 0)) return NO_SIZE
  return `${Math.round(s.w)} x ${Math.round(s.l)}`
}

/* Đếm SKU có phát sinh bán trong tập dòng */
export function skuCount(rows) {
  return new Set(rows.map(r => r.sku)).size
}

/* Doanh thu của nhóm SKU theo phân loại xu hướng */
export function revByTrend(rows) {
  const out = { new: 0, up: 0, down: 0, flat: 0 }
  for (const r of rows) {
    const t = SKU_TREND[r.sku]
    if (out[t] != null) out[t] += r.rev
  }
  return out
}

/* ---- Phân khúc giá ----
   Ngưỡng tính MỘT LẦN trên toàn bộ lịch sử, theo phân vị ASP trong NỘI BỘ từng ngành
   (nệm và gối không thể chung thang giá). Nhờ vậy đổi kỳ thì ô ma trận không nhảy nhóm. */
export const BANDS = [
  { id: 'low', label: 'Thấp' },
  { id: 'mid', label: 'Trung' },
  { id: 'midhigh', label: 'Trung cao' },
  { id: 'high', label: 'Cao' },
]

const bandInfo = (() => {
  const aspBySku = new Map()
  for (const r of sales.rows) {
    const t = aspBySku.get(r.sku) || { rev: 0, un: 0 }
    t.rev += r.rev; t.un += r.un
    aspBySku.set(r.sku, t)
  }
  const asp = {}
  for (const [sku, t] of aspBySku) if (t.un > 0) asp[sku] = t.rev / t.un

  const byNganh = {}
  for (const [sku, v] of Object.entries(asp)) {
    const ng = SKU_MAP[sku]?.nganh
    if (!ng) continue
    ;(byNganh[ng] = byNganh[ng] || []).push(v)
  }

  const cuts = {}, bandOf = {}
  for (const [ng, arr] of Object.entries(byNganh)) {
    arr.sort((a, b) => a - b)
    const q = p => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]
    cuts[ng] = { q1: q(0.25), q2: q(0.5), q3: q(0.75), min: arr[0], max: arr[arr.length - 1] }
  }
  for (const [sku, v] of Object.entries(asp)) {
    const ng = SKU_MAP[sku]?.nganh
    const c = cuts[ng]
    if (!c) continue
    bandOf[sku] = v <= c.q1 ? 'low' : v <= c.q2 ? 'mid' : v <= c.q3 ? 'midhigh' : 'high'
  }
  return { cuts, bandOf, asp }
})()

export const SKU_BAND = bandInfo.bandOf
export const SKU_ASP = bandInfo.asp
export const bandCuts = ng => bandInfo.cuts[ng]

/* Khoảng giá thực tế của một phân khúc trong một ngành (triệu đồng) */
export function bandRange(nganh, band) {
  const vals = Object.entries(bandInfo.asp)
    .filter(([sku]) => SKU_MAP[sku]?.nganh === nganh && SKU_BAND[sku] === band)
    .map(([, v]) => v)
  if (!vals.length) return null
  return [Math.min(...vals), Math.max(...vals)]
}

/* Nhóm trọng tâm: các SKU chiếm 80% doanh thu đầu tiên (Pareto) */
export function paretoTop(rows, share = 0.8) {
  const sorted = [...rows].sort((a, b) => b.rev - a.rev)
  const total = sorted.reduce((s, r) => s + r.rev, 0)
  const out = []
  let cum = 0
  for (const r of sorted) {
    if (total > 0 && cum / total >= share) break
    out.push(r)
    cum += r.rev
  }
  return out
}

/* Phân rã chênh lệch GM: do giá vốn hay do giá bán */
export function gmDecomp(cur, prev) {
  const aspC = cur.un > 0 ? cur.rev / cur.un : 0
  const aspP = prev.un > 0 ? prev.rev / prev.un : 0
  const cogsC = cur.un > 0 ? cur.cogs / cur.un : 0
  const cogsP = prev.un > 0 ? prev.cogs / prev.un : 0
  if (!aspC || !aspP) return null
  const dGm = cur.gm - prev.gm
  const costEffect = -(cogsC - cogsP) / aspC     // giá vốn/unit tăng thì kéo GM xuống
  const priceEffect = dGm - costEffect            // phần còn lại quy cho giá bán & mix
  return { dGm, costEffect, priceEffect, aspC, aspP, cogsC, cogsP }
}

export const growth = (cur, prev) => (prev > 0 ? cur / prev - 1 : null)


/* ============================================================
   TỒN KHO & ĐIỂM ĐẶT HÀNG
   Công thức theo chuẩn đã thống nhất (service level 99% → z = 2,33):
     SS  = 2,33 × σ × √(LT/30)
     ROP = vel3 × (LT/30) + SS
     OUP = vel3 × ((LT+30)/30) + SS      (mức đặt tới = ROP + 1 tháng nhu cầu)
     Cần đặt = max(0, OUP − tồn), làm tròn lên bội số MOQ
   Tính ở cấp SKU rồi cộng lên, không tính thẳng ở cấp loại hình.
   ============================================================ */
export const STOCK_AS_OF = stock.meta.asOf
export const STOCK_AS_OF_DATE = stock.meta.asOfDate || (stock.meta.asOf.replace('.', '-') + '-01')
export const WAREHOUSES = stock.warehouses
export const STOCK_IS_MOCK = stock.meta.kind === 'MOCK'
export const Z_SERVICE = 2.33
export const VMIN = 10          // dưới mức này coi như bán chậm, không replenish
export const DEFAULT_LT = 30    // ngày, khi nhà cung cấp chưa khai lead time

/* Sức bán và độ biến động theo SKU — tính trên 12 tháng gần nhất */
export const SKU_DEMAND = (() => {
  const maxM = LAST_FULL_M                 // bỏ tháng chạy dở khỏi cửa sổ
  const from12 = Math.max(0, maxM - 11)
  const byS = new Map()
  for (const r of sales.rows) {
    if (r.m < from12 || r.m > maxM) continue
    const t = byS.get(r.sku) || new Array(maxM - from12 + 1).fill(0)
    t[r.m - from12] += r.un
    byS.set(r.sku, t)
  }
  const out = {}
  for (const [sku, arr] of byS) {
    const n = arr.length
    const mean = arr.reduce((a, b) => a + b, 0) / n
    const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
    const last3 = arr.slice(-3).reduce((a, b) => a + b, 0) / 3
    const prev3 = arr.slice(-6, -3).reduce((a, b) => a + b, 0) / 3
    const g = prev3 >= 1 ? Math.max(-0.4, Math.min(0.6, last3 / prev3 - 1)) : 0
    out[sku] = { u12: arr, mean, sd, vel3: last3, vel12: mean, g }
  }
  return out
})()

/* Tồn theo SKU và theo kho */
/* Tồn NGUYÊN BẢN theo Shopee — chưa trừ phần bơm ảo */
/* Kho bán hàng vs kho lưu trữ: "Kho hàng lỗi" (WH04, type 'Kho lưu trữ') KHÔNG
   phải hàng bán được. Trước đây nó được cộng vào tồn khả dụng nên chạy vào cả
   điểm đặt hàng, số tháng bán còn, tồn chết và vốn tồn — tức hàng lỗi được coi
   như hàng bán được. Hiện chỉ 2 unit nên sai số nhỏ, nhưng sai nguyên tắc.
   Từ đây `total` chỉ gồm kho bán hàng; hàng ở kho lưu trữ đếm riêng ở `store`. */
export const SELL_WH = new Set(
  stock.warehouses.filter(w => w.type === 'Kho bán hàng').map(w => w.code)
)

export const STOCK_RAW_BY_SKU = (() => {
  const out = {}
  for (const r of stock.rows) {
    const t = out[r.sku] || { total: 0, store: 0, byWh: {} }
    if (SELL_WH.has(r.wh)) t.total += r.qty
    else t.store += r.qty
    t.byWh[r.wh] = (t.byWh[r.wh] || 0) + r.qty
    out[r.sku] = t
  }
  return out
})()

/* Tổng hàng nằm ở kho lưu trữ — để màn Tồn kho nói rõ đã loại khỏi tồn khả dụng */
export const STORE_ONLY = (() => {
  let qty = 0, value = 0
  for (const [sku, t] of Object.entries(STOCK_RAW_BY_SKU)) {
    qty += t.store
    value += t.store * (SKU_MAP[sku]?.unitCost || 0)
  }
  return { qty, value }
})()

/* ============================================================
   TỒN ẢO
   Trên Shopee có bơm thêm số lượng tồn để chạy chiến dịch, nên con số API trả
   về là tồn ĐÃ BƠM. Lấy nguyên số đó đi lập kế hoạch thì hệ thống tưởng còn
   nhiều hàng và sẽ không đề xuất đặt thêm — đúng lúc thực tế đang cạn.
   Người dùng khai số đã bơm theo SKU, ở đây trừ ra ngay tại nguồn để MỌI
   phép tính phía sau (ROP, mức đặt tới, số tháng bán còn, giá vốn tồn, tồn chết)
   đều chạy trên tồn thật. Lưu tại máy như lead time.
   ============================================================ */
const PH_KEY = 'seltd_phantom'

const clean = o => {
  const out = {}
  for (const [k, v] of Object.entries(o || {})) {
    const n = Math.round(Number(v))
    if (Number.isFinite(n) && n > 0) out[k] = n
  }
  return out
}

/* BẢN CHUNG: nằm trong repo, đóng kèm bản build -> mọi máy thấy cùng con số.
   Đây mới là nguồn dùng chung cho cả tổ chức. */
export const PHANTOM_SHARED = clean(phantomFile.items)
export const PHANTOM_SHARED_META = phantomFile.meta || {}

/* localStorage 'seltd_phantom' vừa là CACHE của bản trên đám mây (main.jsx ghi
   vào trước khi mount), vừa là chỗ giữ số khi mất mạng. Có giá trị thì dùng,
   không có (chưa từng đồng bộ được) thì rơi về file phantom.json trong repo. */
const loadPh = () => {
  try {
    const raw = localStorage.getItem(PH_KEY)
    return raw ? clean(JSON.parse(raw)) : null
  } catch { return null }
}
export let PHANTOM_LOCAL = loadPh()
export const PHANTOM_HAS_LOCAL = PHANTOM_LOCAL !== null
export let PHANTOM = PHANTOM_LOCAL || PHANTOM_SHARED

export function setPhantomBulk(map) {
  const out = clean(map)
  PHANTOM_LOCAL = out
  PHANTOM = out
  try { localStorage.setItem(PH_KEY, JSON.stringify(out)) } catch { /* bỏ qua */ }
}
/* Bỏ bản nháp tại máy -> quay về dùng bản chung của tổ chức */
export function resetPhantom() {
  PHANTOM_LOCAL = null
  PHANTOM = PHANTOM_SHARED
  try { localStorage.removeItem(PH_KEY) } catch { /* bỏ qua */ }
}

/* Tồn dùng cho MỌI tính toán = tồn Shopee − số đã bơm ảo.
   Trừ dần từ kho đang nhiều nhất: không biết được kho nào bị bơm, mà trừ theo
   tỷ lệ thì ra số lẻ nên chọn cách này và ghi rõ trong tài liệu. */
export const STOCK_BY_SKU = (() => {
  const out = {}
  for (const [sku, t] of Object.entries(STOCK_RAW_BY_SKU)) {
    const ph = PHANTOM[sku] || 0
    if (!ph) {
      out[sku] = { total: t.total, store: t.store, byWh: { ...t.byWh },
                   raw: t.total, phantom: 0, over: 0 }
      continue
    }
    /* Trừ tồn ảo chỉ trên kho BÁN HÀNG (hàng ở kho lỗi không bao giờ được
       bơm lên Shopee), trừ dần từ kho nhiều hàng nhất. */
    let left = ph
    const byWh = { ...t.byWh }
    for (const [wh, q] of Object.entries(t.byWh)
      .filter(([wh]) => SELL_WH.has(wh))
      .sort((a, b) => b[1] - a[1])) {
      const cut = Math.min(q, left)
      byWh[wh] = q - cut
      left -= cut
    }
    out[sku] = {
      total: Math.max(0, t.total - ph), store: t.store, byWh,
      raw: t.total, phantom: ph,
      over: left,   // khai nhiều hơn tồn thực có -> cần soát lại
    }
  }
  /* SKU khai ảo nhưng Shopee không còn tồn: vẫn giữ để màn Tồn ảo cảnh báo */
  for (const [sku, ph] of Object.entries(PHANTOM)) {
    if (!out[sku]) out[sku] = { total: 0, store: 0, byWh: {}, raw: 0, phantom: ph, over: ph }
  }
  return out
})()

export const PHANTOM_SUMMARY = (() => {
  const skus = Object.keys(PHANTOM)
  let declared = 0, cut = 0, over = 0
  for (const sku of skus) {
    const s = STOCK_BY_SKU[sku]
    declared += PHANTOM[sku]
    cut += Math.min(PHANTOM[sku], s?.raw || 0)
    over += s?.over || 0
  }
  const raw = Object.values(STOCK_RAW_BY_SKU).reduce((a, s) => a + s.total, 0)
  return { count: skus.length, declared, cut, over, raw, real: raw - cut, on: skus.length > 0 }
})()

/* Lead time mặc định theo nhà cung cấp; người dùng chỉnh được và lưu tại máy */
const LT_KEY = 'seltd_lt'
const loadLT = () => {
  try { return JSON.parse(localStorage.getItem(LT_KEY) || '{}') } catch { return {} }
}
export let LT_OVERRIDE = loadLT()
export function setLeadTime(supplier, days) {
  LT_OVERRIDE = { ...LT_OVERRIDE, [supplier]: days }
  try { localStorage.setItem(LT_KEY, JSON.stringify(LT_OVERRIDE)) } catch { /* bỏ qua */ }
}
export function resetLeadTime() {
  LT_OVERRIDE = {}
  try { localStorage.removeItem(LT_KEY) } catch { /* bỏ qua */ }
}
export function leadTimeOf(sku) {
  const sup = SKU_MAP[sku]?.brand
  if (sup && LT_OVERRIDE[sup] != null) return LT_OVERRIDE[sup]
  const info = master.suppliers.find(s => s.name === sup)
  const raw = info?.leadTime
  return raw > 0 ? raw : DEFAULT_LT
}

/* Ngưỡng "tháng bán còn" theo nhóm ngành — nệm quay vòng chậm hơn hàng vải */
const GROUP = ng => (ng === 'Nệm' ? 'nem' : ng === 'Phụ Kiện' ? 'sup' : 'g2')
export const STATUS = [
  { id: 0, label: 'Đặt khẩn', icon: '🔴', act: 'Dưới ngưỡng khẩn — rủi ro hết hàng ngay, cần PO gấp.' },
  { id: 1, label: 'Nên đặt', icon: '🟠', act: 'Đã chạm điểm đặt lại. Gộp vào PO kỳ này.' },
  { id: 2, label: 'Đủ hàng', icon: '🟢', act: 'Trong khoảng an toàn.' },
  { id: 3, label: 'Tồn hơi cao', icon: '🟡', act: 'Cao hơn bình thường — theo dõi, giảm nhập kỳ sau.' },
  { id: 4, label: 'Bán chậm', icon: '🔵', act: 'Quay vòng chậm — khuyến mãi hoặc điều chuyển kho.' },
  { id: 5, label: 'Tồn chết', icon: '⚫', act: 'Ưu tiên clear để giải phóng vốn.' },
]

function statusByCover(ng, ml, ton) {
  if (ton <= 0) return 0
  const g = GROUP(ng)
  if (g === 'sup') return ml > 12 ? 5 : 2
  if (g === 'nem') {
    if (ml < 0.5) return 0
    if (ml < 1.5) return 2
    if (ml <= 3) return 3
    if (ml <= 6) return 4
    return 5
  }
  if (ml < 1) return 0
  if (ml < 2) return 2
  if (ml <= 4) return 3
  if (ml <= 6) return 4
  return 5
}

/* Tháng bán còn: mô phỏng tiêu thụ theo mùa vụ 12 tháng, có nhân đà tăng trưởng */
function monthsLeft(u12, vel3, g, stockQty) {
  if (stockQty <= 0) return 0
  const h1 = u12.slice(0, 6).reduce((a, b) => a + b, 0)
  if (h1 <= 0) {
    const f = vel3 * (1 + g)
    return f > 0 ? stockQty / f : 99
  }
  const avg = u12.reduce((a, b) => a + b, 0) / 12
  if (avg <= 0) return 99
  let rem = stockQty
  for (let t = 1; t <= 60; t++) {
    const d = u12[(11 + t) % 12] * (1 + g)
    if (d < 0.01) continue
    if (rem <= d) return (t - 1) + rem / d
    rem -= d
  }
  return 60
}

/* Ngày nhận hàng gần nhất theo SKU — lấy từ PO thật, dùng để tính tuổi tồn */
export const LAST_RECEIPT = (() => {
  const o = {}
  for (const r of master.purchaseOrders) {
    if (!r.dateReceive) continue
    if (!o[r.sku] || r.dateReceive > o[r.sku]) o[r.sku] = r.dateReceive
  }
  return o
})()

/* Bảng tính tồn kho cho từng SKU — trái tim của màn Tồn kho & Đặt hàng */
export function stockPlan(filterFn) {
  const out = []
  for (const s of master.skus) {
    if (filterFn && !filterFn(s)) continue
    const st = STOCK_BY_SKU[s.sku]
    const dm = SKU_DEMAND[s.sku]
    const ton = st?.total || 0
    const vel3 = dm?.vel3 || 0
    const sd = dm?.sd || 0
    const g = dm?.g || 0
    if (ton <= 0 && vel3 <= 0) continue

    const LT = leadTimeOf(s.sku)
    const ss = Math.round(Z_SERVICE * sd * Math.sqrt(LT / 30))
    const rop = Math.round(vel3 * (LT / 30) + ss)
    const oup = Math.round(vel3 * ((LT + 30) / 30) + ss)
    const moq = Math.max(1, Math.round(s.moq || 1))
    const canOrder = vel3 >= VMIN
    const rawNeed = canOrder && ton <= rop ? Math.max(0, oup - ton) : 0
    const need = rawNeed > 0 ? Math.ceil(rawNeed / moq) * moq : 0
    const ml = monthsLeft(dm?.u12 || new Array(12).fill(0), vel3, g, ton)

    let stt = statusByCover(s.nganh, ml, ton)
    if (!canOrder && ton > 0) stt = Math.max(stt, 3)
    if (need > 0 && stt !== 0) stt = 1

    out.push({
      sku: s.sku, name: s.name, nganh: s.nganh, className: s.className, brand: s.brand,
      ton, byWh: st?.byWh || {}, vel3, sd, g, ml, LT, moq, ss, rop, oup, need, canOrder, stt,
      cost: s.unitCost || 0, value: ton * (s.unitCost || 0),
      needValue: need * (s.unitCost || 0),
    })
  }
  return out
}


/* ============================================================
   DỰ BÁO
   Hai công thức, dùng cho hai mục đích khác nhau:
   1) Ngắn hạn 6 tháng tới (đặt hàng): theo mùa vụ 12 tháng × đà tăng trưởng
   2) Phần còn lại của năm (kế hoạch): theo hệ số YoY của chính class,
      thiếu lịch sử thì rơi về mùa vụ ngành.
   ============================================================ */
export const YEARS = [...new Set(MONTHS.map(m => +m.split('.')[0]))].sort()
export const CUR_YEAR = YEARS[YEARS.length - 1]
export const PREV_YEAR = CUR_YEAR - 1

const monthIdx = (y, mo) => MONTHS.indexOf(`${y}.${String(mo).padStart(2, '0')}`)

/* Tháng cuối cùng thực sự có dữ liệu bán của năm hiện tại */
export const LAST_ACTUAL_MONTH = (() => {
  let last = 0
  for (const r of sales.rows) {
    if (r.m > LAST_FULL_M) continue          // tháng chạy dở không tính là thực tế
    const [y, mo] = MONTHS[r.m].split('.').map(Number)
    if (y === CUR_YEAR && r.rev > 0) last = Math.max(last, mo)
  }
  return last
})()

/* Gom sản lượng & doanh thu theo (năm, tháng) cho một tập dòng */
function byYearMonth(rows) {
  const o = {}
  for (const r of rows) {
    const [y, mo] = MONTHS[r.m].split('.').map(Number)
    const t = (o[y] = o[y] || {})
    const c = (t[mo] = t[mo] || { un: 0, rev: 0, cogs: 0 })
    c.un += r.un; c.rev += r.rev; c.cogs += r.cogs
  }
  return o
}

/* Chỉ số mùa vụ của một tập dòng, tính trên năm trước */
function seasonalIndex(um) {
  const prev = um[PREV_YEAR]
  if (!prev) return null
  const vals = Object.values(prev).map(v => v.un)
  const avg = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)
  if (avg <= 0) return null
  const idx = {}
  for (let mo = 1; mo <= 12; mo++) idx[mo] = prev[mo] ? prev[mo].un / avg : 1
  return idx
}

/* Dự báo các tháng còn lại của năm hiện tại (mặc định theo sản lượng) */
export function forecastRestOfYear(rows, fallbackIdx = null) {
  const um = byYearMonth(rows)
  const cur = um[CUR_YEAR] || {}
  const prev = um[PREV_YEAR] || {}

  const rat = []
  for (let mo = 1; mo <= LAST_ACTUAL_MONTH; mo++) {
    if ((prev[mo]?.un || 0) > 0 && (cur[mo]?.un || 0) > 0) rat.push(cur[mo].un / prev[mo].un)
  }
  const useYoY = rat.length >= 3
  /* Dùng TRUNG VỊ thay vì trung bình: những tháng đầu khi sản phẩm mới ramp-up
     cho tỷ lệ rất lớn và sẽ kéo lệch cả dự báo. Vẫn kẹp trong 0,3 – 3,0. */
  const sortedRat = [...rat].sort((a, b) => a - b)
  const median = sortedRat.length
    ? (sortedRat.length % 2
      ? sortedRat[(sortedRat.length - 1) / 2]
      : (sortedRat[sortedRat.length / 2 - 1] + sortedRat[sortedRat.length / 2]) / 2)
    : 1
  const mean = rat.length ? rat.reduce((a, b) => a + b, 0) / rat.length : 1
  const gY = useYoY ? Math.max(0.3, Math.min(3.0, median)) : 1

  const lastU = cur[LAST_ACTUAL_MONTH]?.un || 0
  const idx = fallbackIdx || seasonalIndex(um)

  const out = []
  for (let mo = LAST_ACTUAL_MONTH + 1; mo <= 12; mo++) {
    let u
    if (useYoY && (prev[mo]?.un || 0) > 0) u = Math.round(prev[mo].un * gY)
    else u = Math.max(0, Math.round(lastU * Math.max(0.5, Math.min(2.0, idx?.[mo] ?? 1))))
    out.push({ mo, un: u })
  }
  return {
    months: out,
    gY, gMean: mean, gMedian: median, ratios: rat, useYoY,
    skewed: useYoY && mean > 0 && Math.abs(mean - median) / median > 0.25,
    source: useYoY ? 'Hệ số YoY của chính nhóm' : 'Mùa vụ ngành năm trước (thiếu lịch sử)',
    actual: cur, prevYear: prev,
  }
}

/* Dự báo 6 tháng tới ở cấp SKU — phục vụ đặt hàng.
   MỨC HIỆN TẠI × HÌNH MÙA VỤ × ĐÀ, thay vì lấy thẳng sản lượng cùng kỳ năm trước.
   Lý do: dữ liệu thật có nhiều SKU đã ngừng bán hẳn (sức bán 3T = 0) nhưng năm
   trước từng bán mạnh — nếu lấy thẳng số năm trước thì hệ thống sẽ "hồi sinh"
   SKU chết và đẩy ra đơn đặt hàng sai. Neo vào mức hiện tại thì SKU chết cho 0. */
export function forecastNext6(sku) {
  const dm = SKU_DEMAND[sku]
  if (!dm) return null
  const { u12, vel3, g } = dm
  const mean12 = u12.reduce((a, b) => a + b, 0) / Math.max(1, u12.length)
  const hasSeason = mean12 > 0
  /* u12 kết thúc ở LAST_FULL_M, còn nhãn bắt đầu sau tháng cuối của MONTHS,
     nên phải bù đúng số tháng lệch (tháng chạy dở). */
  const gap = (MONTHS.length - 1) - LAST_FULL_M
  const labels = []
  const last = MONTHS[MONTHS.length - 1].split('.').map(Number)
  let y = last[0], mo = last[1]
  const out = []
  for (let t = 1; t <= 6; t++) {
    mo++; if (mo > 12) { mo = 1; y++ }
    labels.push(`${String(y).slice(2)}.${String(mo).padStart(2, '0')}`)
    /* chỉ số mùa vụ của tháng đích, kẹp 0,4–2,5 để một tháng bất thường
       năm trước không kéo lệch cả kế hoạch */
    const si = hasSeason
      ? Math.max(0.4, Math.min(2.5, u12[(11 + gap + t) % 12] / mean12))
      : 1
    out.push(Math.max(0, Math.round(vel3 * (1 + g) * si)))
  }
  const dead = vel3 <= 0
  return { labels, values: out, total: out.reduce((a, b) => a + b, 0), g, vel3, mean12, dead }
}

/* Giá vốn và giá bán bình quân trên một unit của tập dòng */
export function unitEconomics(rows) {
  const t = rows.reduce((a, r) => ({ un: a.un + r.un, rev: a.rev + r.rev, cogs: a.cogs + r.cogs }),
    { un: 0, rev: 0, cogs: 0 })
  return {
    ...t,
    asp: t.un > 0 ? t.rev / t.un : 0,
    cogsU: t.un > 0 ? t.cogs / t.un : 0,
    gm: t.rev > 0 ? (t.rev - t.cogs) / t.rev : 0,
  }
}


/* ============================================================
   DỮ LIỆU CHO MÀN PHỤ CLASS DASHBOARD
   ============================================================ */

/* Thứ hạng theo doanh thu lũy kế 3 tháng trượt — trong ngành và toàn công ty */
export function classRankSeries(className) {
  const target = className
  const nganh = master.skus.find(s => s.className === className)?.nganh
  const byMonth = []          // [{m, ranks}]
  const cum = (rows, m) => rows
    .filter(r => r.m <= m && r.m > m - 3)
    .reduce((a, r) => a + r.rev, 0)

  for (let m = 2; m < MONTHS.length; m++) {
    const scoreOf = filterFn => {
      const map = new Map()
      for (const r of sales.rows) {
        const s = SKU_MAP[r.sku]
        if (!s || !filterFn(s)) continue
        if (r.m > m || r.m <= m - 3) continue
        map.set(s.className, (map.get(s.className) || 0) + r.rev)
      }
      const sorted = [...map.entries()].sort((a, b) => b[1] - a[1])
      const idx = sorted.findIndex(([k]) => k === target)
      return { rank: idx < 0 ? null : idx + 1, total: sorted.length }
    }
    const inNganh = scoreOf(s => s.nganh === nganh)
    const inAll = scoreOf(() => true)
    byMonth.push({
      label: MONTHS[m].slice(2),
      rankNganh: inNganh.rank, totalNganh: inNganh.total,
      rankAll: inAll.rank, totalAll: inAll.total,
    })
  }
  return byMonth
}

/* Toàn bộ dữ liệu một class cần cho màn phụ */
export function classDetail(className, filters) {
  const skus = master.skus.filter(s => s.className === className)
  const skuSet = new Set(skus.map(s => s.sku))
  const nganh = skus[0]?.nganh || '—'
  const brand = skus[0]?.brand || '—'

  const allRows = sales.rows.filter(r => skuSet.has(r.sku))
  const a = Math.max(0, MONTHS.indexOf(filters.from))
  const b = Math.max(0, MONTHS.indexOf(filters.to))
  const cmp = comparePeriod(filters.from, filters.to, filters.compare)

  const curRows = allRows.filter(r => r.m >= a && r.m <= b)
  const prevRows = cmp ? allRows.filter(r => r.m >= cmp[0] && r.m <= cmp[1]) : []
  const cur = agg(curRows)
  const prev = cmp ? agg(prevRows) : null

  /* chuỗi theo tháng trên toàn bộ lịch sử */
  const series = monthlySeries(allRows, [0, MONTHS.length - 1])

  /* tồn kho & điểm đặt của các SKU trong class */
  const plan = stockPlan(s => s.className === className)
  const stock = {
    ton: plan.reduce((x, r) => x + r.ton, 0),
    value: plan.reduce((x, r) => x + r.value, 0),
    ss: plan.reduce((x, r) => x + r.ss, 0),
    rop: plan.reduce((x, r) => x + r.rop, 0),
    oup: plan.reduce((x, r) => x + r.oup, 0),
    need: plan.reduce((x, r) => x + r.need, 0),
    needValue: plan.reduce((x, r) => x + r.needValue, 0),
    vel3: plan.reduce((x, r) => x + r.vel3, 0),
    byWh: WAREHOUSES.reduce((o, w) => {
      o[w.code] = plan.reduce((x, r) => x + (r.byWh[w.code] || 0), 0)
      return o
    }, {}),
    rows: plan,
    worst: plan.length ? Math.min(...plan.map(r => r.stt)) : 2,
  }

  /* PO của class */
  const po = master.purchaseOrders.filter(r => skuSet.has(r.sku))
  const poAgg = {
    value: po.reduce((x, r) => x + r.totalCost, 0),
    qty: po.reduce((x, r) => x + r.qtyConfirm, 0),
    last: po.reduce((x, r) => (r.dateReceive && (!x || r.dateReceive > x) ? r.dateReceive : x), null),
    bySup: [...po.reduce((m, r) => {
      const t = m.get(r.supplier) || { name: r.supplier, value: 0, qty: 0 }
      t.value += r.totalCost; t.qty += r.qtyConfirm
      m.set(r.supplier, t)
      return m
    }, new Map()).values()].sort((x, y) => y.value - x.value),
  }
  poAgg.avgPrice = poAgg.qty > 0 ? poAgg.value / poAgg.qty : 0

  /* dự báo */
  const fcYear = forecastRestOfYear(allRows)
  const ecoYear = unitEconomics(allRows.filter(r => MONTHS[r.m].startsWith(String(CUR_YEAR))))
  const fcSku = skus.map(s => ({ sku: s.sku, name: s.name, ...(forecastNext6(s.sku) || { labels: [], values: [], total: 0 }) }))
    .filter(x => x.total > 0)
    .sort((x, y) => y.total - x.total)

  /* theo SKU trong kỳ */
  const bySku = groupBy(curRows, (s, r) => r.sku)
  const bySkuPrev = Object.fromEntries(groupBy(prevRows, (s, r) => r.sku).map(g => [g.key, g]))
  const topSku = [...bySku].sort((x, y) => y.un - x.un).slice(0, 2)

  /* vị trí & tỷ trọng theo các phạm vi so sánh */
  const scope = (label, filterFn) => {
    const rows = sales.rows.filter(r => {
      const s = SKU_MAP[r.sku]
      return s && filterFn(s) && r.m >= a && r.m <= b
    })
    const t = agg(rows)
    const byClass = groupBy(rows, s => s.className)
    const rank = byClass.findIndex(g => g.key === className)
    return {
      label, rev: t.rev, gp: t.gp, gm: t.gm,
      shareRev: t.rev > 0 ? cur.rev / t.rev : 0,
      shareGp: t.gp > 0 ? cur.gp / t.gp : 0,
      rank: rank < 0 ? null : rank + 1, total: byClass.length,
    }
  }
  const scopes = [
    scope(`Nhà cung cấp ${brand} · ngành ${nganh}`, s => s.brand === brand && s.nganh === nganh),
    scope(`Ngành ${nganh}`, s => s.nganh === nganh),
    scope('Toàn công ty', () => true),
  ]

  return {
    className, nganh, brand, skus, skuCount: skus.length,
    cur, prev, cmp, series, stock, po: poAgg, fcYear, ecoYear, fcSku,
    bySku, bySkuPrev, topSku, scopes,
    trend: CLASS_TREND[className] || 'flat',
    band: SKU_BAND[skus[0]?.sku] || 'mid',
    firstSale: (() => {
      const m = allRows.reduce((x, r) => Math.min(x, r.m), 99)
      return m < 99 ? MONTHS[m] : '—'
    })(),
    gmDec: prev ? gmDecomp(cur, prev) : null,
    rankSeries: classRankSeries(className),
  }
}


/* ============================================================
   DỮ LIỆU NGÀY — cho màn Calendar
   ============================================================ */
export const DAILY_IS_MOCK = daily.meta.kind === 'MOCK'
export const DOW_LABEL = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']

/* Danh sách tháng có dữ liệu ngày */
export const DAILY_MONTHS = [...new Set(daily.rows.map(r => r.d.slice(0, 7)))].sort()

function matchSkuDaily(sku, f) {
  const s = SKU_MAP[sku]
  if (!s) return false
  if (f.nganh && s.nganh !== f.nganh) return false
  if (f.loaiHinh && s.className !== f.loaiHinh) return false
  if (f.supplier && s.brand !== f.supplier) return false
  if (f.trend?.length && !f.trend.includes(SKU_TREND[sku])) return false
  if (f.q) {
    const q = f.q.toLowerCase()
    if (!(sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))) return false
  }
  return true
}

/* Tổng hợp theo từng ngày trong một tháng (ym dạng "2026-09") */
export function dailyOfMonth(ym, filters) {
  const [y, m] = ym.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const buckets = new Map()
  for (let d = 1; d <= days; d++) {
    const key = `${ym}-${String(d).padStart(2, '0')}`
    buckets.set(key, { date: key, day: d, dow: (new Date(y, m - 1, d).getDay() + 6) % 7, ...EMPTY })
  }
  const skuSet = new Map()
  for (const r of daily.rows) {
    if (!r.d.startsWith(ym)) continue
    if (!skuSet.has(r.sku)) skuSet.set(r.sku, matchSkuDaily(r.sku, filters))
    if (!skuSet.get(r.sku)) continue
    const t = buckets.get(r.d)
    if (!t) continue
    t.un += r.un; t.u += r.u; t.rev += r.rev; t.gmv += r.gmv; t.cogs += r.cogs; t.o += r.o
  }
  return [...buckets.values()].map(t => ({ ...t, ...derive(t) }))
}

/* Gộp theo thứ trong tuần trên toàn bộ lịch sử (hoặc một tháng) */
export function byDayOfWeek(filters, ym = null) {
  const out = DOW_LABEL.map((label, i) => ({ dow: i, label, rev: 0, un: 0, o: 0, days: new Set() }))
  const cache = new Map()
  for (const r of daily.rows) {
    if (ym && !r.d.startsWith(ym)) continue
    if (!cache.has(r.sku)) cache.set(r.sku, matchSkuDaily(r.sku, filters))
    if (!cache.get(r.sku)) continue
    const [y, m, d] = r.d.split('-').map(Number)
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7
    const t = out[dow]
    t.rev += r.rev; t.un += r.un; t.o += r.o
    t.days.add(r.d)
  }
  return out.map(t => ({
    ...t, dayCount: t.days.size,
    avgRev: t.days.size > 0 ? t.rev / t.days.size : 0,
  }))
}

/* Top SKU bán chạy trong một ngày */
export function topSkuOfDay(date, filters, n = 8) {
  const by = new Map()
  for (const r of daily.rows) {
    if (r.d !== date) continue
    if (!matchSkuDaily(r.sku, filters)) continue
    const t = by.get(r.sku) || { sku: r.sku, rev: 0, un: 0 }
    t.rev += r.rev; t.un += r.un
    by.set(r.sku, t)
  }
  return [...by.values()].sort((a, b) => b.rev - a.rev).slice(0, n)
    .map(t => ({ ...t, name: SKU_MAP[t.sku]?.name || t.sku, nganh: SKU_MAP[t.sku]?.nganh }))
}
