/* ============================================================
   NHẬN XÉT TỰ ĐỘNG — BỘ QUY TẮC TẤT ĐỊNH
   Không gọi mô hình ngôn ngữ: trang là web tĩnh công khai (không có chỗ giấu
   khoá API) và số trong báo cáo điều hành phải tái lập được — cùng dữ liệu
   luôn ra cùng câu.

   Mỗi quy tắc là một hàm riêng, gọi lại ĐÚNG hàm tính của màn nguồn (fin.js,
   metrics.js, doiChieu.js, fcSnap.js) để không có hai con số cho một chuyện.
   Quy tắc thiếu dữ liệu → vào `bo_qua` kèm lý do, KHÔNG ra phát hiện "0%".

   Phát hiện: { id, nhom, muc_do: 'canh_bao'|'luu_y'|'tot', tieu_de,
                bang_chung: [{nhan, gia_tri}], vay_thi_sao, hanh_dong, man_nguon }
   ============================================================ */
import sales from '../data/sales.json'
import platform from '../data/platform.json'
import {
  ymList, actualByMonth, planByMonth, rollup, coverage, costNorm, revenueByMonth, platformMonthly,
  adsBreakEven, GROUP_OF, LAST_FULL_YM,
} from './fin'
import { MONTHS, stockPlan, SKU_MAP } from './metrics'
import { doiChieu } from './doiChieu'
import { accuracy } from './fcSnap'

/* ---------------- NGƯỠNG (sửa ở đây, kèm lý do) ----------------
   Chọn theo quy mô hiện tại của SELTD: doanh thu vài chục đến vài trăm triệu/tháng,
   một kênh sàn chính, một đại lý. Ngưỡng thấp quá thì quy tắc luôn bật và mất tác dụng. */
export const NGUONG = {
  thangChiemTo: 0.35,      // 1 tháng > 35% doanh thu kỳ: kỳ ≥ 3 tháng mà 1 tháng chiếm hơn 1/3 là phụ thuộc mùa vụ/đợt sale
  top5Sku: 0.5,            // 5 SKU > 50% doanh thu: rủi ro tập trung danh mục
  khachChiemTo: 0.5,       // 1 khách > 50% phải thu: rủi ro tập trung tín dụng
  lechKeHoach: 0.05,       // lợi nhuận lệch kế hoạch > 5%: dưới mức này là nhiễu
  phiSanTang: 0.01,        // phí sàn % doanh thu tăng > 1 điểm: tương đương ~1% lợi nhuận biên
  hoanTang: 0.01,          // tỷ lệ hoàn tăng > 1 điểm
  biasDuBao: 0.15,         // bias dự báo vượt ±15%: lệch hệ thống, không phải nhiễu
}

const nf = d => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d })
const tr = v => `${v < 0 ? '−' : ''}${nf(1).format(Math.abs(v || 0) / 1e6)} tr`
const pc = (v, d = 1) => `${nf(d).format((v || 0) * 100)}%`
const thang = ym => `T${+ym.slice(5)}/${ym.slice(2, 4)}`
const ky = yms => (yms.length === 1 ? thang(yms[0]) : `${thang(yms[0])}–${thang(yms[yms.length - 1])}`)
const sumBy = (yms, f) => yms.reduce((s, ym) => s + (f(ym) || 0), 0)

/* Kỳ so sánh: 'prev' = cùng số tháng liền trước; 'yoy' = cùng các tháng năm trước */
export function compareMonths(yms, mode) {
  if (mode === 'yoy') return yms.map(ym => `${+ym.slice(0, 4) - 1}${ym.slice(4)}`)
  if (mode === 'prev') {
    const n = yms.length
    const [y, m] = yms[0].split('-').map(Number)
    return Array.from({ length: n }, (_, i) => {
      const t = new Date(Date.UTC(y, m - 1 - n + i, 1))
      return t.toISOString().slice(0, 7)
    })
  }
  return null
}

/* Số liệu dùng chung cho mọi quy tắc trong một lần chạy */
function boiCanh(ctx) {
  const years = [...new Set([...ctx.yms, ...(ctx.cmp || [])].map(ym => +ym.slice(0, 4)))]
  const lines = (ctx.fin?.lines || []).filter(l => l.active !== false)
  const act = {}, rev = {}, plat = {}
  for (const y of years) {
    const a = actualByMonth(y, lines, ctx.fin?.actual || [], ctx.ar)
    for (const [k, v] of Object.entries(a)) act[k] = { ...(act[k] || {}), ...v }
    Object.assign(rev, revenueByMonth(y, ctx.ar))
    for (const p of platformMonthly(y)) plat[p.ym] = p
  }
  const y0 = +ctx.yms[0].slice(0, 4)
  const ver = (ctx.fin?.versions || []).filter(v => v.year === y0).sort((a, b) => b.is_current - a.is_current)[0]
  const plan = ver ? planByMonth(ver.version, ctx.fin.plan || []) : {}
  const cov = {}
  for (const y of years) for (const m of coverage(y, ctx.fin?.lines || [], ctx.fin?.actual || [], ctx.ar).months) cov[m.ym] = m
  return { lines, act, rev, plat, ver, plan, cov }
}

/* Lợi nhuận trên sàn kiểu màn Lãi lỗ: doanh thu − giá vốn − phí sàn − quảng cáo */
const lnSan = yms => { const A = adsBreakEven(yms); return { rev: A.rev, ln: A.rev - A.cogs - A.fee - A.exp, A } }

/* =================== CÁC QUY TẮC =================== */
const R = {}

R.tap_trung_thang = (c, ctx) => {
  if (ctx.yms.length < 3) return { skip: 'kỳ dưới 3 tháng — không xét tập trung theo tháng' }
  const tot = sumBy(ctx.yms, ym => c.rev[ym]?.tong)
  if (!tot) return { skip: 'kỳ chưa có doanh thu' }
  const top = ctx.yms.map(ym => ({ ym, v: c.rev[ym]?.tong || 0 })).sort((a, b) => b.v - a.v)[0]
  const sh = top.v / tot
  if (sh <= NGUONG.thangChiemTo) return null
  return {
    nhom: 'doanh_thu', muc_do: 'luu_y',
    tieu_de: `Doanh thu dồn vào ${thang(top.ym)}: riêng tháng này ${tr(top.v)}, chiếm ${pc(sh)} doanh thu kỳ`,
    bang_chung: [{ nhan: 'Doanh thu kỳ', gia_tri: tr(tot) }, { nhan: thang(top.ym), gia_tri: `${tr(top.v)} (${pc(sh)})` }],
    vay_thi_sao: 'Kết quả kỳ phụ thuộc một thời điểm — trượt đợt đó là hụt cả kỳ.',
    hanh_dong: 'Xem lại vì sao tháng đó cao (đợt sale, đơn đại lý lớn) và có lặp lại được không; lên lịch bán đều hơn.',
    man_nguon: 'overview',
  }
}

R.tap_trung_sku = (c, ctx) => {
  const idx = ctx.yms.map(ym => MONTHS.indexOf(ym.replace('-', '.'))).filter(i => i >= 0)
  const by = {}
  for (const r of sales.rows) if (idx.includes(r.m)) by[r.sku] = (by[r.sku] || 0) + (r.rev || 0)
  const dOf = Object.fromEntries((ctx.ar.deliveries || []).map(p => [p.pxk, String(p.d).slice(0, 7)]))
  for (const l of ctx.ar.deliveryLines || []) if (ctx.yms.includes(dOf[l.pxk])) by[l.sku] = (by[l.sku] || 0) + (Number(l.amount) || 0)
  const list = Object.entries(by).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const tot = list.reduce((s, [, v]) => s + v, 0)
  if (!tot || list.length < 6) return { skip: 'kỳ có dưới 6 SKU có doanh thu' }
  const t5 = list.slice(0, 5).reduce((s, [, v]) => s + v, 0)
  if (t5 / tot <= NGUONG.top5Sku) return null
  return {
    nhom: 'doanh_thu', muc_do: 'luu_y',
    tieu_de: `5 SKU tạo ra ${pc(t5 / tot)} doanh thu (${list.length} SKU có bán)`,
    bang_chung: list.slice(0, 5).map(([s, v]) => ({ nhan: s, gia_tri: `${tr(v)} · ${(SKU_MAP[s]?.name || '').slice(0, 34)}` })),
    vay_thi_sao: 'Một SKU đứt hàng hoặc bị đối thủ hạ giá là doanh thu rơi mạnh.',
    hanh_dong: 'Ưu tiên tồn an toàn cho 5 SKU này; tìm SKU thứ 6–10 để kéo lên.',
    man_nguon: 'range',
  }
}

R.tap_trung_khach = (c, ctx) => {
  const cs = (ctx.ar.customers || []).map(k => ({ k, con: doiChieu(k, ctx.ar, ctx.today).tong.conLai }))
  const tot = cs.reduce((s, x) => s + x.con, 0)
  if (tot <= 0) return { skip: 'không có công nợ phải thu' }
  const top = cs.sort((a, b) => b.con - a.con)[0]
  const sh = top.con / tot
  if (sh <= NGUONG.khachChiemTo) return null
  return {
    nhom: 'dong_tien', muc_do: 'luu_y',
    tieu_de: cs.length === 1
      ? `Toàn bộ phải thu ${tr(tot)} nằm ở một khách (${top.k.code})`
      : `${top.k.code} chiếm ${pc(sh)} phải thu (${tr(top.con)}/${tr(tot)})`,
    bang_chung: cs.slice(0, 3).map(x => ({ nhan: x.k.code, gia_tri: tr(x.con) })),
    vay_thi_sao: 'Khách này trả chậm là dòng tiền thủng ngay — không có khoản khác bù.',
    hanh_dong: 'Theo sát lịch thu của khách này; cân nhắc hạn mức công nợ tối đa trước khi giao thêm.',
    man_nguon: 'cashflow',
  }
}

R.ln_lech_ke_hoach = (c, ctx) => {
  if (!c.ver) return { skip: `năm ${ctx.yms[0].slice(0, 4)} chưa có phiên bản ngân sách` }
  const ms = ctx.yms.filter(ym => LAST_FULL_YM && ym <= LAST_FULL_YM)
  if (!ms.length) return { skip: 'kỳ chưa có tháng nào kết thúc' }
  const thieu = ms.filter(ym => c.cov[ym]?.state !== 'full')
  if (thieu.length) return { skip: `chưa nhập đủ chi phí thực tế ${thieu.map(thang).join(', ')} — so lợi nhuận sẽ lạc quan giả` }
  const A = rollup(c.lines, c.act, ms).derived.year.lntt
  const P = rollup(c.lines, c.plan, ms).derived.year.lntt
  if (!P) return { skip: 'kế hoạch lợi nhuận kỳ này bằng 0' }
  const d = A - P
  if (Math.abs(d) / Math.abs(P) <= NGUONG.lechKeHoach) return null
  const top = c.lines.filter(l => GROUP_OF[l.grp] && l.grp !== 'thue').map(l => {
    const s = GROUP_OF[l.grp].sign
    const a = sumBy(ms, ym => c.act[l.code]?.[ym]), p = sumBy(ms, ym => c.plan[l.code]?.[ym])
    return { l, v: s * (a - p) }
  }).sort((x, y) => Math.abs(y.v) - Math.abs(x.v))[0]
  return {
    nhom: 'loi_nhuan', muc_do: d < 0 ? 'canh_bao' : 'tot',
    tieu_de: `Lợi nhuận trước thuế ${d < 0 ? 'hụt' : 'vượt'} kế hoạch ${tr(Math.abs(d))} (${pc(Math.abs(d / P))})`,
    bang_chung: [{ nhan: 'Thực tế', gia_tri: tr(A) }, { nhan: 'Kế hoạch', gia_tri: tr(P) },
      ...(top ? [{ nhan: 'Khoản gây lệch nhiều nhất', gia_tri: `${top.l.name} ${top.v >= 0 ? '+' : '−'}${tr(Math.abs(top.v))}` }] : [])],
    vay_thi_sao: d < 0 ? 'Giữ nhịp này cả năm sẽ không đạt kế hoạch lợi nhuận.' : 'Đang tốt hơn kế hoạch — xem có bền không hay do một khoản chưa phát sinh.',
    hanh_dong: `Xem chi tiết ở màn Lãi lỗ → tab Kế hoạch vs Thực đạt (ngân sách "${c.ver.name}").`,
    man_nguon: 'pnl',
  }
}

R.bien_doi_chieu = (c, ctx) => {
  if (!ctx.cmp) return { skip: 'so với kế hoạch — quy tắc này cần kỳ thực tế để so' }
  const now = lnSan(ctx.yms), bef = lnSan(ctx.cmp)
  if (!now.rev || !bef.rev) return { skip: 'kỳ so sánh không có doanh thu Shopee' }
  const dRev = now.rev - bef.rev, dLn = now.ln - bef.ln
  if (Math.sign(dRev) === Math.sign(dLn) || !dRev || !dLn) return null
  const xau = dLn < 0
  return {
    nhom: 'loi_nhuan', muc_do: xau ? 'canh_bao' : 'tot',
    tieu_de: `Doanh thu Shopee ${dRev > 0 ? 'tăng' : 'giảm'} ${pc(Math.abs(dRev / bef.rev), 0)} nhưng lãi sau phí & quảng cáo ${dLn > 0 ? 'tăng' : 'giảm'} ${tr(Math.abs(dLn))}`,
    bang_chung: [{ nhan: `Doanh thu ${ky(ctx.cmp)} → ${ky(ctx.yms)}`, gia_tri: `${tr(bef.rev)} → ${tr(now.rev)}` },
      { nhan: 'Lãi sau phí & quảng cáo', gia_tri: `${tr(bef.ln)} → ${tr(now.ln)}` }],
    vay_thi_sao: xau ? 'Bán nhiều hơn mà lãi ít đi: giá vốn, phí sàn hoặc quảng cáo đang ăn hết phần tăng thêm.'
      : 'Bán ít hơn mà lãi hơn: đang bỏ được phần doanh thu lỗ — tốt nếu có chủ đích.',
    hanh_dong: 'Xem màn Lãi lỗ → tab "Vì sao lãi đổi" để biết phần nào (biên gộp, phí sàn, quảng cáo) gây ra.',
    man_nguon: 'pnl',
  }
}

R.phi_san_tang = (c, ctx) => {
  if (!ctx.cmp) return { skip: 'so với kế hoạch — quy tắc này cần kỳ thực tế để so' }
  const f = yms => { const r = sumBy(yms, ym => c.plat[ym]?.rev); return r ? sumBy(yms, ym => c.plat[ym]?.fee) / r : null }
  const a = f(ctx.yms), b = f(ctx.cmp)
  if (a == null || b == null) return { skip: 'thiếu doanh thu Shopee ở một trong hai kỳ' }
  if (a - b <= NGUONG.phiSanTang) return null
  return {
    nhom: 'chi_phi', muc_do: 'canh_bao',
    tieu_de: `Phí sàn tăng từ ${pc(b)} lên ${pc(a)} doanh thu Shopee (+${nf(1).format((a - b) * 100)} điểm)`,
    bang_chung: [{ nhan: ky(ctx.cmp), gia_tri: pc(b) }, { nhan: ky(ctx.yms), gia_tri: pc(a) },
      { nhan: 'Tương đương', gia_tri: tr((a - b) * sumBy(ctx.yms, ym => c.plat[ym]?.rev)) }],
    vay_thi_sao: 'Mỗi điểm % phí sàn là một điểm % biên lợi nhuận mất đi.',
    hanh_dong: 'Xem màn Lãi lỗ → tab Phí sàn: khoản nào tăng (hoa hồng, dịch vụ Freeship/Hoàn xu, chiến dịch)? Cân nhắc rút khỏi gói không đáng.',
    man_nguon: 'pnl',
  }
}

R.roas_duoi_hoa_von = (c, ctx) => {
  const A = adsBreakEven(ctx.yms)
  if (!A.exp) return { skip: 'kỳ chưa có số quảng cáo Shopee (API chỉ giữ ~5 tháng)' }
  if (A.roasBE == null) {
    return { nhom: 'chi_phi', muc_do: 'canh_bao', tieu_de: 'Biên trên sàn trước quảng cáo gần như bằng 0 — không mức ROAS nào hòa vốn được',
      bang_chung: [{ nhan: 'Biên gộp − phí sàn', gia_tri: pc(A.cmPre) }, { nhan: 'Chi quảng cáo', gia_tri: tr(A.exp) }],
      vay_thi_sao: 'Mọi đồng quảng cáo đều lỗ.', hanh_dong: 'Sửa giá bán / giá vốn trước khi chạy tiếp quảng cáo.', man_nguon: 'breakeven' }
  }
  const lo = A.roas < A.roasBE
  return {
    nhom: 'chi_phi', muc_do: lo ? 'canh_bao' : 'tot',
    tieu_de: `ROAS thật ${nf(2).format(A.roas)} ${lo ? 'DƯỚI' : 'trên'} mức hòa vốn ${nf(2).format(A.roasBE)} — mỗi đồng quảng cáo ${lo ? 'lỗ' : 'lãi'} ${nf(2).format(Math.abs(A.perDong))}đ`,
    bang_chung: [{ nhan: 'Chi quảng cáo', gia_tri: tr(A.exp) }, { nhan: 'ROAS thật / hòa vốn', gia_tri: `${nf(2).format(A.roas)} / ${nf(2).format(A.roasBE)}` }],
    vay_thi_sao: lo ? `Kỳ này quảng cáo làm mất khoảng ${tr(-A.perDong * A.exp)} lợi nhuận.` : 'Quảng cáo đang sinh lời.',
    hanh_dong: lo ? 'Hạ giá thầu/CPC, tắt chiến dịch ROAS thấp ở màn Marketing.' : 'Có thể tăng ngân sách từng bước 20%.',
    man_nguon: 'marketing',
  }
}

R.vuot_tran = (c, ctx) => {
  const ms = ctx.yms.filter(ym => LAST_FULL_YM && ym <= LAST_FULL_YM)
  if (!ms.length) return { skip: 'kỳ chưa có tháng nào kết thúc' }
  const hasNorm = c.lines.some(l => l.cap_pct != null) || Object.keys(c.plan).length
  if (!hasNorm) return { skip: 'chưa đặt trần % và chưa có ngân sách — không có định mức để so' }
  const N = costNorm(c.lines, c.act, c.plan, ms, c.rev)
  const top = N.rows.filter(r => r.over > 0).slice(0, 3)
  if (!top.length) return null
  return {
    nhom: 'chi_phi', muc_do: 'canh_bao',
    tieu_de: `Chi vượt định mức ${tr(N.overTotal)}; nhiều nhất: ${top.map(r => r.name.replace(/^Phí sàn · /, 'phí sàn ')).join(', ')}`,
    bang_chung: top.map(r => ({ nhan: r.name, gia_tri: `${tr(r.over)} ${r.overKind === 'tran' ? `(${pc(r.pct)} so trần ${pc(r.cap)})` : '(vượt ngân sách)'}` })),
    vay_thi_sao: `Đưa ${top.length} khoản này về định mức thì biên lợi nhuận tăng khoảng ${nf(1).format(top.reduce((s, r) => s + r.over, 0) / (N.revTong || 1) * 100)} điểm %.`,
    hanh_dong: 'Xem màn Định mức chi phí để biết khoản nào vượt từ tháng nào.',
    man_nguon: 'costnorm',
  }
}

R.quy_duoi_nguong = (c, ctx) => {
  if (!ctx.weeks?.length) return { skip: 'chưa có kế hoạch dòng tiền tuần' }
  if (!(ctx.quyMin > 0)) return { skip: 'chưa đặt quỹ tối thiểu (màn Dòng tiền → tab Theo tháng)' }
  const tu = ctx.weeks.filter(k => k.sun.toISOString().slice(0, 10) >= ctx.today)
  const k = tu.find(w => w.close < ctx.quyMin)
  if (!k) return { nhom: 'dong_tien', muc_do: 'tot', tieu_de: `Không tuần nào tới đây quỹ xuống dưới mức tối thiểu ${tr(ctx.quyMin)}`, bang_chung: [], vay_thi_sao: '', hanh_dong: '', man_nguon: 'cashflow' }
  return {
    nhom: 'dong_tien', muc_do: 'canh_bao',
    tieu_de: `Tuần ${k.w} (${k.mon.toISOString().slice(8, 10)}/${k.mon.toISOString().slice(5, 7)}) quỹ xuống ${tr(k.close)} — dưới mức tối thiểu ${tr(ctx.quyMin)}`,
    bang_chung: [{ nhan: 'Thiếu so với mức tối thiểu', gia_tri: tr(ctx.quyMin - k.close) }],
    vay_thi_sao: 'Không đủ tiền chi trả đúng hạn nếu kế hoạch không đổi.',
    hanh_dong: 'Đòi nợ sớm, giãn khoản chi lớn của tuần đó, hoặc chuẩn bị nguồn bù.',
    man_nguon: 'cashflow',
  }
}

R.no_qua_han = (c, ctx) => {
  const ds = (ctx.ar.customers || []).map(k => ({ k, dc: doiChieu(k, ctx.ar, ctx.today) })).filter(x => x.dc.tong.quaHan > 0)
  if (!(ctx.ar.customers || []).length) return { skip: 'chưa có khách ngoài sàn' }
  if (!ds.length) return null
  const tong = ds.reduce((s, x) => s + x.dc.tong.quaHan, 0)
  const dai = Math.max(...ds.flatMap(x => x.dc.rows.map(r => r.quaHan || 0)))
  return {
    nhom: 'dong_tien', muc_do: 'canh_bao',
    tieu_de: `Nợ quá hạn ${tr(tong)}, lâu nhất ${dai} ngày`,
    bang_chung: ds.map(x => ({ nhan: x.k.code, gia_tri: `${tr(x.dc.tong.quaHan)} quá hạn / ${tr(x.dc.tong.conLai)} còn nợ` })),
    vay_thi_sao: 'Tiền đã giao hàng mà chưa về — kế hoạch dòng tiền đang tính là sẽ thu.',
    hanh_dong: 'Gửi bản đối chiếu công nợ (màn Dòng tiền → Theo khách hàng → ⬇ Đối chiếu) và hẹn lịch thu.',
    man_nguon: 'cashflow',
  }
}

R.dat_chua_giao = (c, ctx) => {
  let v = 0
  for (const o of ctx.ar.orders || []) {
    const dat = (ctx.ar.orderLines || []).filter(l => l.code === o.code)
      .reduce((x, l) => x + (l.amount ?? Math.round(l.qty * l.price * (1 - (l.disc || 0)))), 0)
    const giao = (ctx.ar.deliveries || []).filter(d => d.don === o.code).reduce((x, d) => x + d.amount, 0)
    v += Math.max(0, dat - giao)
  }
  if (!(ctx.ar.orders || []).length) return { skip: 'chưa có đơn hàng ngoài sàn' }
  if (v <= 0) return null
  return {
    nhom: 'dong_tien', muc_do: 'luu_y',
    tieu_de: `Đơn đã đặt chưa giao: ${tr(v)} (chưa VAT)`,
    bang_chung: [],
    vay_thi_sao: 'Đây là doanh thu và tiền sắp thu — nhưng chỉ khi kịp có hàng để giao.',
    hanh_dong: 'Đối chiếu với tồn kho; lên lịch giao để đưa vào kế hoạch dòng tiền.',
    man_nguon: 'sales',
  }
}

R.sap_dut_hang = () => {
  const rows = stockPlan().filter(r => r.stt === 0 && r.vel3 > 0).sort((a, b) => b.vel3 - a.vel3)
  if (!rows.length) return null
  return {
    nhom: 'ton_kho', muc_do: 'canh_bao',
    tieu_de: `${rows.length} SKU đang bán chạy ở mức "đặt khẩn" — sắp hết hàng`,
    bang_chung: rows.slice(0, 5).map(r => ({ nhan: r.sku, gia_tri: `tồn ${nf(0).format(r.ton)} · bán ${nf(1).format(r.vel3)}/tháng · lead time ${r.LT} ngày` })),
    vay_thi_sao: 'Hết hàng là mất doanh thu và tụt hạng tìm kiếm trên sàn.',
    hanh_dong: 'Đặt PO gấp ở màn Tồn kho & Đặt hàng.',
    man_nguon: 'stock',
  }
}

R.ton_cham = () => {
  const rows = stockPlan().filter(r => r.stt === 4 || r.stt === 5)
  const v = rows.reduce((s, r) => s + (r.value || 0), 0)
  if (!rows.length || v <= 0) return null
  return {
    nhom: 'ton_kho', muc_do: 'luu_y',
    tieu_de: `${tr(v)} vốn nằm ở ${rows.length} SKU bán chậm / tồn chết`,
    bang_chung: [...rows].sort((a, b) => b.value - a.value).slice(0, 5).map(r => ({ nhan: r.sku, gia_tri: `${tr(r.value)} · ${r.ml > 99 ? 'không bán' : `${nf(0).format(r.ml)} tháng mới bán hết`}` })),
    vay_thi_sao: 'Tiền mắc trong hàng không quay vòng — kéo dài chu kỳ tiền mặt.',
    hanh_dong: 'Khuyến mãi, bán combo hoặc điều chuyển; ngừng nhập các SKU này.',
    man_nguon: 'stock',
  }
}

R.ty_le_hoan = (c, ctx) => {
  if (!ctx.cmp) return { skip: 'so với kế hoạch — quy tắc này cần kỳ thực tế để so' }
  const f = yms => { const g = sumBy(yms, ym => c.plat[ym]?.gmv); return g ? sumBy(yms, ym => c.plat[ym]?.hoan) / g : null }
  const a = f(ctx.yms), b = f(ctx.cmp)
  if (a == null || b == null) return { skip: 'thiếu GMV ở một trong hai kỳ' }
  if (a - b <= NGUONG.hoanTang) return null
  const ly = {}
  for (const r of platform.returns) if (ctx.yms.includes(r.ym) && r.status !== 'CANCELLED') ly[r.reason] = (ly[r.reason] || 0) + (r.tien_hoan || 0)
  const top = Object.entries(ly).sort((x, y) => y[1] - x[1])[0]
  return {
    nhom: 'doanh_thu', muc_do: 'luu_y',
    tieu_de: `Tỷ lệ hoàn tăng từ ${pc(b)} lên ${pc(a)} GMV`,
    bang_chung: top ? [{ nhan: 'Lý do nhiều tiền nhất', gia_tri: `${top[0]} · ${tr(top[1])}` }] : [],
    vay_thi_sao: 'Hàng hoàn mất cả phí vận chuyển hai chiều và có thể không bán lại được.',
    hanh_dong: 'Xem mô tả/ảnh sản phẩm của SKU hoàn nhiều; kiểm khâu đóng gói.',
    man_nguon: 'pnl',
  }
}

R.du_bao_lech = (c, ctx) => {
  if (!ctx.fc) return { skip: 'chưa có bản dự báo đã chốt (hoặc chưa tạo bảng lưu bản dự báo)' }
  const A = accuracy(ctx.fc.snap, ctx.fc.lines)
  if (!A.ready) return { skip: `bản "${ctx.fc.snap.name}" chưa có tháng thực tế để đo` }
  if (Math.abs(A.bias) <= NGUONG.biasDuBao) return null
  return {
    nhom: 'ton_kho', muc_do: 'luu_y',
    tieu_de: `Dự báo "${ctx.fc.snap.name}" lệch hệ thống ${A.bias > 0 ? 'CAO' : 'THẤP'} ${pc(Math.abs(A.bias), 0)} so thực tế (WAPE ${pc(A.wape, 0)})`,
    bang_chung: A.worst.slice(0, 3).map(w => ({ nhan: w.sku, gia_tri: `dự báo ${w.f} / thực tế ${w.a}` })),
    vay_thi_sao: A.bias > 0 ? 'Đặt hàng theo dự báo này sẽ dư tồn, giam vốn.' : 'Đặt hàng theo dự báo này sẽ thiếu hàng.',
    hanh_dong: 'Xem màn Forecast → Đối chiếu dự báo; chỉnh hệ số ở tab Phương pháp & hệ số.',
    man_nguon: 'forecast',
  }
}

export const NHOM = {
  doanh_thu: 'Doanh thu', chi_phi: 'Chi phí', loi_nhuan: 'Lợi nhuận & biên', dong_tien: 'Dòng tiền & công nợ', ton_kho: 'Tồn kho',
}
const MUC = { canh_bao: 0, luu_y: 1, tot: 2 }

/* ctx = { yms, cmpMode: 'prev'|'yoy'|'kh', fin, ar, weeks, quyMin, fc, today } */
export function runInsights(ctx0) {
  const ctx = { ...ctx0, cmp: compareMonths(ctx0.yms, ctx0.cmpMode) }
  const c = boiCanh(ctx)
  const out = [], bo_qua = []
  for (const [id, fn] of Object.entries(R)) {
    let r
    try { r = fn(c, ctx) } catch (e) { r = { skip: `lỗi khi tính: ${e.message}` } }
    if (!r) continue
    if (r.skip) bo_qua.push({ id, ly_do: r.skip })
    else out.push({ id, ...r })
  }
  out.sort((a, b) => MUC[a.muc_do] - MUC[b.muc_do])

  /* Thẻ chỉ số chính của kỳ */
  const ms = ctx.yms
  const dt = sumBy(ms, ym => c.rev[ym]?.tong)
  const done = ms.filter(ym => LAST_FULL_YM && ym <= LAST_FULL_YM)
  const full = done.length && done.every(ym => c.cov[ym]?.state === 'full')
  const R2 = rollup(c.lines, c.act, ms)
  const san = lnSan(ms)
  const ln = full ? R2.derived.year.lntt : san.ln
  /* tuần thuộc tháng chứa ngày thứ Năm của tuần — cùng quy ước tab Theo tháng */
  const thuOf = w => { const t = new Date(w.mon); t.setUTCDate(t.getUTCDate() + 3); return t.toISOString().slice(0, 7) }
  const k = ctx.weeks?.length ? [...ctx.weeks].reverse().find(w => thuOf(w) <= ms[ms.length - 1]) : null
  const the = {
    dt, ln, lnNhan: full ? 'Lợi nhuận trước thuế' : 'Lãi sau phí & QC (Shopee)',
    lnRev: full ? dt : san.rev,
    quy: k ? k.close : null, quyTuan: k ? k.w : null,
  }
  return { phat_hien: out, bo_qua, the, ky: ky(ms), cmp: ctx.cmp ? ky(ctx.cmp) : 'kế hoạch' }
}

export { thang, ky }
