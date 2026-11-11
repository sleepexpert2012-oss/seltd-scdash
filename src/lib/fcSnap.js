/* ============================================================
   BẢN DỰ BÁO CHỐT & ĐO SAI SỐ — hàm thuần
   · KHÔNG có thuật toán dự báo mới: số lượng lấy nguyên từ forecastNext6()
     (cùng hàm tab "Dự báo 6 tháng tới" đang dùng), chỉ nhân hệ số kịch bản.
   · Phạm vi thực tế để đối chiếu = bán trên SHOPEE (sales.json), đúng phạm vi
     dữ liệu mà forecastNext6 học từ đó. Đem so với cả bán ngoài sàn là lệch
     phạm vi → sai số giả.
   ============================================================ */
import sales from '../data/sales.json'
import master from '../data/master'
import { MONTHS, SKU_MAP, SKU_DEMAND, LAST_FULL_M, forecastNext6, stockPlan } from './metrics'

export const SCENARIOS = { thap: ['Thấp', 0.85], co_so: ['Cơ sở', 1], cao: ['Cao', 1.15] }
export const HIT_BAND = 0.2
const toYm = lb => `20${lb.slice(0, 2)}-${lb.slice(3, 5)}`        // '26.12' → '2026-12'
const mOf = ym => MONTHS.indexOf(ym.replace('-', '.'))
export const LAST_FULL_YM = MONTHS[LAST_FULL_M]?.replace('.', '-') || null

/* Giá bán thuần bình quân 3 tháng đủ gần nhất của SKU (doanh thu thuần ÷ SL thuần) */
function aspOf(sku) {
  let rev = 0, un = 0
  for (const r of sales.rows) {
    if (r.sku !== sku || r.m > LAST_FULL_M || r.m < LAST_FULL_M - 2) continue
    rev += r.rev || 0; un += r.un || 0
  }
  if (un > 0) return rev / un
  const sp = SKU_MAP[sku]?.salesPrice
  return sp > 0 ? sp : 0
}

/* Dòng của một bản mới: mọi SKU có trong SKU_DEMAND (kể cả dự báo 0 — SKU dự báo 0 mà
   vẫn bán là sai số thật, phải được đo) */
export function buildLines(factor = 1) {
  const out = []
  let labels = null
  for (const sku of Object.keys(SKU_DEMAND)) {
    const f = forecastNext6(sku)
    if (!f) continue
    labels = labels || f.labels
    const price = Math.round(aspOf(sku))
    const cost = Math.round(SKU_MAP[sku]?.unitCost || 0)
    f.labels.forEach((lb, i) => {
      const q = Math.round(f.values[i] * factor)
      out.push({ sku, ym: toYm(lb), qty_calc: q, qty: q, price, cost })
    })
  }
  const yms = (labels || []).map(toYm)
  return { lines: out, from: yms[0], to: yms[yms.length - 1], yms }
}

/* Tổng hợp một bản: doanh thu, giá vốn, theo tháng, theo ngành, top SKU */
export function summarize(lines) {
  const byM = {}, byNg = {}, bySku = {}
  let rev = 0, cogs = 0, edited = 0
  for (const l of lines) {
    const r = l.qty * l.price, c = l.qty * l.cost
    rev += r; cogs += c
    if (Number(l.qty) !== Number(l.qty_calc)) edited++
    const m = (byM[l.ym] = byM[l.ym] || { ym: l.ym, rev: 0, cogs: 0, qty: 0 })
    m.rev += r; m.cogs += c; m.qty += Number(l.qty)
    const ng = SKU_MAP[l.sku]?.nganh || 'Khác'
    byNg[ng] = (byNg[ng] || 0) + r
    const s = (bySku[l.sku] = bySku[l.sku] || { sku: l.sku, rev: 0, qty: 0 })
    s.rev += r; s.qty += Number(l.qty)
  }
  const months = Object.values(byM).sort((a, b) => a.ym.localeCompare(b.ym))
  const pos = months.filter(m => m.rev > 0)
  const peak = pos.reduce((a, b) => (!a || b.rev > a.rev ? b : a), null)
  const low = pos.reduce((a, b) => (!a || b.rev < a.rev ? b : a), null)
  return {
    rev, cogs, gp: rev - cogs, gm: rev > 0 ? (rev - cogs) / rev : null, edited,
    months, peak, low,
    nganh: Object.entries(byNg).map(([k, v]) => ({ k, v })).filter(x => x.v > 0).sort((a, b) => b.v - a.v),
    top: Object.values(bySku).sort((a, b) => b.rev - a.rev).slice(0, 7),
    noPrice: [...new Set(lines.filter(l => l.qty > 0 && !(l.price > 0)).map(l => l.sku))],
    noCost: [...new Set(lines.filter(l => l.qty > 0 && !(l.cost > 0)).map(l => l.sku))],
  }
}

/* Lead time bình quân (theo SL dự báo) của các SKU đóng góp vào tháng đỉnh */
export function leadTimeFor(lines, ym) {
  const lt = Object.fromEntries(stockPlan().map(r => [r.sku, r.LT]))
  let w = 0, s = 0
  for (const l of lines) if (l.ym === ym && l.qty > 0 && lt[l.sku]) { w += l.qty; s += l.qty * lt[l.sku] }
  return w > 0 ? s / w : null
}

/* SL bán thuần trên Shopee của SKU trong tháng */
function actualMap() {
  const out = {}
  for (const r of sales.rows) {
    const ym = MONTHS[r.m].replace('.', '-')
    out[`${r.sku}|${ym}`] = (out[`${r.sku}|${ym}`] || 0) + (r.un || 0)
  }
  return out
}

/* ------------------------------------------------------------
   Đo sai số một bản ĐÃ CHỐT trên các tháng đã có thực tế trọn vẹn.
   WAPE  = Σ|thực tế − dự báo| ÷ Σ thực tế, tính ở cấp SKU × tháng rồi cộng
           (tính trên tổng thì thừa SKU này bù thiếu SKU kia, che mất sai số)
   Bias  = Σ(dự báo − thực tế) ÷ Σ thực tế   (dương = dự báo cao hơn thực tế)
   Trúng = % SKU có |tổng dự báo − tổng thực tế| ≤ 20% tổng thực tế
   Ngây thơ = mỗi tháng bằng bình quân 3 tháng đủ trước ngày chốt
   ------------------------------------------------------------ */
export function accuracy(snap, lines) {
  const act = actualMap()
  const months = [...new Set(lines.map(l => l.ym))].sort().filter(ym => LAST_FULL_YM && ym <= LAST_FULL_YM)
  if (!months.length) return { months, ready: false }
  const lockM = mOf((snap.locked_at || snap.created_at).slice(0, 7))
  const baseEnd = (lockM >= 0 ? lockM : MONTHS.length) - 1          // tháng đủ cuối cùng trước tháng chốt
  const naiveOf = sku => {
    let s = 0, n = 0
    for (let m = baseEnd - 2; m <= baseEnd; m++) { if (m < 0) continue; s += act[`${sku}|${MONTHS[m].replace('.', '-')}`] || 0; n++ }
    return n ? s / n : 0
  }
  const skus = {}
  for (const l of lines) {
    if (!months.includes(l.ym)) continue
    const a = act[`${l.sku}|${l.ym}`] || 0
    const t = (skus[l.sku] = skus[l.sku] || { sku: l.sku, f: 0, a: 0, abs: 0, nv: 0, price: l.price, cost: l.cost })
    t.f += Number(l.qty); t.a += a; t.abs += Math.abs(a - l.qty)
    t.nv += Math.abs(a - naiveOf(l.sku))
  }
  const rows = Object.values(skus).map(t => {
    const d = t.f - t.a
    const ng = SKU_MAP[t.sku]?.nganh || 'Khác'
    return {
      ...t, nganh: ng, name: SKU_MAP[t.sku]?.name || t.sku, d,
      dPct: t.a > 0 ? d / t.a : (t.f > 0 ? null : 0),
      hit: t.a > 0 ? Math.abs(d) / t.a <= HIT_BAND : t.f === 0,
      /* Hậu quả quy ra tiền: dự báo thừa → vốn nằm trong tồn dư; dự báo thiếu →
         doanh thu có thể đã mất (CHỈ "có thể": app chưa có lịch sử hết hàng để xác minh) */
      thuaVon: d > 0 ? d * t.cost : 0,
      thieuDt: d < 0 ? -d * t.price : 0,
    }
  })
  const sum = k => rows.reduce((s, r) => s + r[k], 0)
  const A = sum('a'), F = sum('f')
  /* SKU có bán trong các tháng này nhưng KHÔNG có trong bản chốt (SKU mới) */
  const inSnap = new Set(lines.map(l => l.sku))
  const moi = {}
  for (const [k, v] of Object.entries(act)) {
    const [sku, ym] = k.split('|')
    if (!months.includes(ym) || inSnap.has(sku) || !v) continue
    moi[sku] = (moi[sku] || 0) + v
  }
  const wape = A > 0 ? sum('abs') / A : null
  const wapeNaive = A > 0 ? sum('nv') / A : null
  const byNg = {}
  for (const r of rows) {
    const g = (byNg[r.nganh] = byNg[r.nganh] || { k: r.nganh, f: 0, a: 0, abs: 0, thuaVon: 0, thieuDt: 0, rows: [] })
    g.f += r.f; g.a += r.a; g.abs += r.abs; g.thuaVon += r.thuaVon; g.thieuDt += r.thieuDt; g.rows.push(r)
  }
  return {
    ready: true, months, A, F,
    wape, bias: A > 0 ? (F - A) / A : null, wapeNaive,
    fva: wape != null && wapeNaive != null ? wapeNaive - wape : null,
    hit: rows.length ? rows.filter(r => r.hit).length / rows.length : null, nSku: rows.length,
    rows, byNg: Object.values(byNg).sort((a, b) => b.a - a.a),
    worst: [...rows].sort((a, b) => (b.thuaVon + b.thieuDt) - (a.thuaVon + a.thieuDt)).slice(0, 5),
    moi: Object.entries(moi).map(([sku, q]) => ({ sku, q, name: SKU_MAP[sku]?.name || sku })).sort((a, b) => b.q - a.q),
  }
}

export const nganhList = () => [...new Set(master.skus.map(s => s.nganh).filter(Boolean))]
