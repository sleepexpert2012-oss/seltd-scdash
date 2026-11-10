/* ============================================================
   BẢNG ĐỐI CHIẾU CÔNG NỢ ĐẠI LÝ
   Dựng đúng bố cục file Excel đang gửi khách: sheet "1. Công nợ"
   gồm ba phần A / B / C, sheet "2. Chi tiết hàng giao" liệt kê
   từng mã sản phẩm của mỗi phiếu xuất.

   Hai chỗ dễ sai, đã xử lý đúng:
   · VAT làm tròn TRÊN TỪNG PHIẾU rồi mới cộng, không cộng rồi mới
     làm tròn — cộng trước sai 1 đồng so với bảng khách đang giữ.
   · Tiền khách trả cấn trừ theo thứ tự phát sinh (nợ cũ trước),
     nên một phiếu có thể trả một phần.
   ============================================================ */
import { downloadBlob } from './masterFile'

const ngay = d => {
  if (!d) return ''
  const [y, m, dd] = String(d).slice(0, 10).split('-')
  return `${dd}/${m}/${y}`
}
/* Cộng/trừ ngày phải làm bằng UTC. Nếu dựng Date theo giờ máy rồi lấy
   toISOString() thì ở múi giờ +7 ngày bị lùi lại một: hạn 05/09 ra 04/09 và
   mọi số "quá hạn (ngày)" lệch 1 so với bảng khách đang giữ. */
const UTC = d => new Date(`${String(d).slice(0, 10)}T00:00:00Z`)
const congNgay = (d, n) => {
  const t = UTC(d)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
const soNgay = (a, b) => Math.round((UTC(b) - UTC(a)) / 86400000)

/* Số liệu đối chiếu của MỘT đại lý, tính đến ngày chốt. */
export function doiChieu(cust, { deliveries, deliveryLines, payments }, asOf) {
  const vatRate = cust.vat_rate ?? 0.08
  const term = cust.term_days ?? 30

  const rows = deliveries
    .filter(p => p.cust === cust.code)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.pxk < b.pxk ? -1 : 1))
    .map(p => {
      const vat = Math.round(p.amount * vatRate)
      const phai = p.amount + vat
      return {
        ...p, vat, phai, tra: 0,
        han: phai > 0 ? congNgay(p.d, term) : null,
      }
    })

  /* Cấn trừ nợ cũ trước — đúng như ghi chú trong bảng đang gửi khách */
  let con = payments.filter(x => x.cust === cust.code).reduce((a, x) => a + x.amount, 0)
  const daTra = con
  for (const r of rows) {
    if (con <= 0) break
    const t = Math.min(con, r.phai)
    r.tra = t; con -= t
  }

  for (const r of rows) {
    r.conLai = r.phai - r.tra
    r.quaHan = r.han && r.conLai > 0 ? Math.max(0, soNgay(r.han, asOf)) : 0
    r.tinhTrang = r.phai === 0 ? 'Không thu tiền'
      : r.conLai === 0 ? 'Đã thanh toán'
        : r.quaHan > 0 ? 'QUÁ HẠN' : 'Trong hạn'
  }

  const tong = {
    qty: rows.reduce((a, r) => a + (r.qty || 0), 0),
    amount: rows.reduce((a, r) => a + r.amount, 0),
    vat: rows.reduce((a, r) => a + r.vat, 0),
    phai: rows.reduce((a, r) => a + r.phai, 0),
    daTra,
  }
  tong.conLai = tong.phai - tong.daTra
  tong.quaHan = rows.filter(r => r.quaHan > 0).reduce((a, r) => a + r.conLai, 0)
  tong.trongHan = tong.conLai - tong.quaHan

  const lines = deliveryLines.filter(l => rows.some(r => r.pxk === l.pxk))
  return { rows, tong, vatRate, term, lines, asOf }
}

/* ============================================================
   KẾT XUẤT EXCEL — bám đúng mẫu đang gửi khách
   Dùng xlsx-js-style (không phải xlsx) vì bản cộng đồng của xlsx
   KHÔNG ghi được màu nền, viền hay định dạng số.
   Bảng màu lấy từ chính file mẫu: navy 1F3864 cho tiêu đề cột,
   D9E2F3 cho dải A/B/C, FFF2CC cho ô người dùng phải điền tay,
   FCE4E4 cho khối số dư, FBD5D5 cho dòng quá hạn.
   ============================================================ */
const K = {
  navy: '1F3864', dai: 'D9E2F3', xam: 'E8E8E8', vang: 'FFF2CC',
  doNen: 'FCE4E4', doChu: '9C0006', xanh: '1F6B35', doDong: 'FBD5D5',
  vach: 'F5F5F5', mo: '555555', vien: 'BFBFBF', xanhDuong: '0000FF',
}
const FONT = 'Arial'
const vien1 = { style: 'thin', color: { rgb: K.vien } }
const KHUNG = { top: vien1, bottom: vien1, left: vien1, right: vien1 }

function st({ sz = 9.5, b, i, mau, nen, ngang, doc = 'center', xuong, khung = true, fmt } = {}) {
  const o = {
    font: { name: FONT, sz, bold: !!b, italic: !!i, ...(mau ? { color: { rgb: mau } } : {}) },
    alignment: { horizontal: ngang, vertical: doc, wrapText: !!xuong },
  }
  if (nen) o.fill = { patternType: 'solid', fgColor: { rgb: nen } }
  if (khung) o.border = KHUNG
  if (fmt) o.numFmt = fmt
  return o
}

export async function xuatDoiChieu(cust, dc, congTy, skuName = {}) {
  const m = await import('xlsx-js-style')
  const XLSX = m.utils ? m : m.default
  const { rows, tong, vatRate, term, lines, asOf } = dc
  const pays = dc.payments || []

  /* --- bộ dựng sheet: ghi theo (dòng, cột), tự gom vùng và trộn ô --- */
  const to = (nc) => {
    const o = {}; const merges = []; const rowh = []; let maxR = 0
    const put = (r, c, v, s) => {
      const rong = v === null || v === undefined || v === ''
      o[XLSX.utils.encode_cell({ r, c })] =
        { v: rong ? '' : v, t: typeof v === 'number' ? 'n' : 's', s }
      if (r > maxR) maxR = r
    }
    return {
      put, merges, rowh,
      /* một dòng đủ cột, style theo từng cột */
      dong: (r, vals, sty) => vals.forEach((v, c) => put(r, c, v, typeof sty === 'function' ? sty(c, v) : sty)),
      /* dải tiêu đề trộn hết chiều ngang */
      dai: (r, v, sty) => {
        for (let c = 0; c < nc; c++) put(r, c, c === 0 ? v : '', sty)
        merges.push({ s: { r, c: 0 }, e: { r, c: nc - 1 } })
      },
      tron: (r, c1, c2) => merges.push({ s: { r, c: c1 }, e: { r, c: c2 } }),
      xong: (ws = {}) => ({
        ...o, ...ws,
        '!ref': XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: nc - 1 } }),
        '!merges': merges, '!rows': rowh,
      }),
    }
  }

  const tieuDe = (S, nc, ten, phu) => {
    const giua = (sz, b, i2, mau) => st({ sz, b, i: i2, mau, ngang: 'center', khung: false })
    S.dai(0, congTy.ten || '', giua(11, true))
    S.dai(1, `MST: ${congTy.mst || ''}  ·  ${congTy.diaChi || ''}`, giua(9, false, false, K.mo))
    S.dai(3, ten, giua(15, true))
    S.dai(4, `Đại lý: ${cust.name}${cust.mst ? `  ·  MST: ${cust.mst}` : ''}`, giua(9.5, false, true))
    S.dai(5, phu, giua(8.5, false, true, K.mo))
    S.rowh[3] = { hpt: 22 }
  }

  /* ============ SHEET 1 — CÔNG NỢ ============ */
  const NC = 14
  const S = to(NC)
  tieuDe(S, NC, 'BẢNG ĐỐI CHIẾU CÔNG NỢ',
    `Số liệu chốt đến ngày ${ngay(asOf)}  ·  Căn cứ ghi nợ: hàng thực giao theo Phiếu xuất kho`
    + `  ·  Thời hạn thanh toán: ${term} ngày kể từ ngày giao`)

  const nhan = st({ b: true, ngang: 'left', khung: false })
  const oNhap = st({ b: true, mau: K.xanhDuong, nen: K.vang, ngang: 'center' })
  /* Ghi SỐ THẬT rồi để Excel định dạng, không ghi chuỗi "8%": người nhận còn
     dùng mấy ô này để tự tính lại trong file. */
  const thamSo = [
    ['Thuế suất GTGT áp dụng:', vatRate, '0%'],
    ['Thời hạn công nợ (ngày):', term, '0'],
    ['Ngày chốt số liệu:', ngay(asOf), undefined],
  ]
  thamSo.forEach(([l, v, fmt], k) => {
    const r = 7 + k
    S.put(r, 0, l, nhan); S.put(r, 1, '', nhan); S.tron(r, 0, 1)
    S.put(r, 2, v, { ...oNhap, ...(fmt ? { numFmt: fmt } : {}) })
  })

  const daiMuc = st({ sz: 10, b: true, mau: K.navy, nen: K.dai, ngang: 'left' })
  const oTieu = st({ b: true, mau: 'FFFFFF', nen: K.navy, ngang: 'center', xuong: true })
  const oCong = (ngang, fmt) => st({ b: true, nen: K.xam, ngang, fmt })

  let r = 11
  S.dai(r++, 'A. HÀNG ĐÃ GIAO — PHÁT SINH PHẢI THU', daiMuc)
  S.rowh[r] = { hpt: 30 }
  S.dong(r++, ['Ngày giao', 'Số phiếu xuất', 'Thuộc đơn hàng', 'SL (sp)', 'Giá trị hàng (chưa VAT)',
    'Thuế GTGT', 'Phải thanh toán', 'Hạn thanh toán', 'Đã thanh toán', 'Còn phải trả',
    'Quá hạn (ngày)', 'Tình trạng', 'Số hóa đơn GTGT', 'Ghi chú'], oTieu)

  const TIEN = [4, 5, 6, 8, 9]
  for (const x of rows) {
    const do_ = x.quaHan > 0          /* quá hạn -> nền đỏ, đúng như ghi chú cuối bảng */
    const nenDong = do_ ? K.doDong : undefined
    S.dong(r++, [
      ngay(x.d), x.pxk, x.don || '', x.qty || 0, x.amount, x.vat, x.phai,
      x.han ? ngay(x.han) : '', x.tra, x.conLai, x.quaHan, x.tinhTrang,
      x.invoice_no || '', x.note || '',
    ], c => st({
      nen: c === 12 && !do_ ? K.vang : nenDong,
      ngang: TIEN.includes(c) ? 'right' : c === 13 ? 'left' : 'center',
      fmt: TIEN.includes(c) ? '#,##0' : c === 3 || c === 10 ? '0' : undefined,
      xuong: c === 13,
      b: do_ && c === 11,
      mau: do_ && c === 11 ? K.doChu : undefined,
    }))
  }
  S.dong(r, ['', 'CỘNG PHÁT SINH', '', tong.qty, tong.amount, tong.vat, tong.phai,
    '', tong.daTra, tong.conLai, '', '', '', ''],
    c => oCong(TIEN.includes(c) ? 'right' : c === 1 ? 'left' : 'center',
      TIEN.includes(c) ? '#,##0' : c === 3 ? '0' : undefined))
  S.tron(r, 1, 2)
  r += 2

  S.dai(r++, 'B. ĐẠI LÝ ĐÃ THANH TOÁN', daiMuc)
  S.rowh[r] = { hpt: 30 }
  S.dong(r++, ['Ngày thanh toán', 'Hình thức', 'Chứng từ', '', '', '', 'Số tiền',
    '', '', '', '', '', '', 'Ghi chú'], oTieu)
  for (const p of pays) {
    S.dong(r++, [ngay(p.d), p.method || 'Chuyển khoản', p.doc_no || '', '', '', '', p.amount,
      '', '', '', '', '', '', p.note || ''],
      c => st({ nen: c === 2 ? K.vang : undefined, ngang: c === 6 ? 'right' : c === 13 ? 'left' : 'center',
        fmt: c === 6 ? '#,##0' : undefined, xuong: c === 13 }))
  }
  if (!pays.length) {
    S.dong(r++, ['—', 'Chưa có khoản thanh toán nào', '', '', '', '', 0, '', '', '', '', '', '', ''],
      c => st({ ngang: c === 6 ? 'right' : 'center', fmt: c === 6 ? '#,##0' : undefined, mau: K.mo }))
  }
  S.dong(r, ['', 'CỘNG ĐÃ THANH TOÁN', '', '', '', '', tong.daTra, '', '', '', '', '', '', ''],
    c => oCong(c === 6 ? 'right' : c === 1 ? 'left' : 'center', c === 6 ? '#,##0' : undefined))
  S.tron(r, 1, 2)
  r += 2

  S.dai(r++, 'C. SỐ DƯ CÔNG NỢ VÀ CẢNH BÁO QUÁ HẠN', daiMuc)
  const dongC = (nhan2, so, o = {}) => {
    const sL = st({ sz: o.sz, b: o.b, mau: o.mau, nen: o.nen, ngang: 'left' })
    const sN = st({ sz: o.sz, b: o.b, mau: o.mau, nen: o.nen, ngang: 'right', fmt: '#,##0' })
    for (let c = 0; c <= 5; c++) S.put(r, c, c === 0 ? nhan2 : '', sL)
    S.tron(r, 0, 5)
    S.put(r, 6, so, sN)
    for (let c = 7; c < NC; c++) S.put(r, c, '', st({ nen: o.nen, khung: !!o.nen }))
    r++
  }
  dongC('Tổng phải thanh toán (đã gồm VAT)', tong.phai)
  dongC('Trừ: đã thanh toán', -tong.daTra)
  dongC('CÒN PHẢI THANH TOÁN', tong.conLai, { sz: 12, b: true, mau: K.doChu, nen: K.doNen })
  dongC('Trong đó — ĐÃ QUÁ HẠN, cần thu ngay', tong.quaHan, { b: true, mau: K.doChu, nen: K.doNen })
  dongC('Trong đó — còn trong hạn', tong.trongHan, { b: true, mau: K.xanh })
  r++

  const ghiChu = st({ sz: 8.5, i: true, mau: K.mo, ngang: 'left', khung: false, xuong: true })
  S.dai(r++, 'Ghi chú:', st({ b: true, ngang: 'left', khung: false }))
  for (const g of [
    `· Thời hạn thanh toán ${term} ngày kể từ ngày giao hàng, áp dụng cho từng phiếu xuất kho. `
    + `Cột "Hạn thanh toán" = ngày giao + ${term} ngày; cột "Quá hạn (ngày)" tính đến ngày chốt số liệu. `
    + 'Dòng nền đỏ là các đợt giao đã quá hạn thanh toán.',
    '· Khoản đã thanh toán được phân bổ theo thứ tự phát sinh, tức cấn trừ nợ cũ trước.',
    '· Bảng lập theo hàng thực giao trên các Phiếu xuất kho, chi tiết từng mã sản phẩm tại sheet "2. Chi tiết hàng giao".',
    '· Phiếu xuất chiết khấu 100% (hàng mẫu, quà tặng) không phát sinh công nợ; vẫn liệt kê để hai bên đối chiếu đủ số lượng hàng đã nhận.',
    `· Thuế GTGT tính theo thuế suất ${(vatRate * 100).toFixed(0)}%, làm tròn đến đồng trên từng phiếu. `
    + 'Cột "Số hóa đơn GTGT" để Sleep Expert bổ sung khi đối chiếu với sổ kế toán — số liệu chính thức để ghi sổ là hóa đơn GTGT đã phát hành.',
    '· Đề nghị Đại lý đối chiếu và xác nhận số dư. Mọi sai lệch vui lòng phản hồi trong 07 ngày kể từ ngày nhận bảng.',
  ]) { S.rowh[r] = { hpt: 15 }; S.dai(r++, g, ghiChu) }
  r++

  const ky = st({ b: true, ngang: 'center', khung: false })
  const kyPhu = st({ sz: 8.5, i: true, ngang: 'center', khung: false })
  for (const [lb, s2] of [['ĐẠI DIỆN ĐẠI LÝ', ky], ['(Ký, ghi rõ họ tên, đóng dấu)', kyPhu]]) {
    const lb2 = lb === 'ĐẠI DIỆN ĐẠI LÝ' ? 'ĐẠI DIỆN SLEEP EXPERT' : lb
    for (let c = 0; c < NC; c++) S.put(r, c, '', s2)
    S.put(r, 0, lb, s2); S.tron(r, 0, 3)
    S.put(r, 8, lb2, s2); S.tron(r, 8, NC - 1)
    r++
  }

  const ws1 = S.xong({
    '!cols': [11, 18, 13, 6, 15, 13, 15, 11, 14, 15, 9, 13, 11, 30].map(wch => ({ wch })),
  })

  /* ============ SHEET 2 — CHI TIẾT HÀNG GIAO ============ */
  const NC2 = 9
  const T = to(NC2)
  tieuDe(T, NC2, 'CHI TIẾT HÀNG ĐÃ GIAO THEO TỪNG PHIẾU XUẤT KHO',
    `Số liệu chốt đến ngày ${ngay(asOf)}  ·  Giá trị chưa bao gồm thuế GTGT`)

  let q = 7
  T.rowh[q] = { hpt: 30 }
  T.dong(q++, ['Ngày giao', 'Số phiếu xuất', 'Mã SP', 'Tên sản phẩm', 'ĐVT', 'SL',
    'Đơn giá (đồng)', 'Thành tiền (đồng)', 'Ghi chú'], oTieu)

  /* Tô xen kẽ THEO TỪNG PHIẾU, không theo dòng: mắt đọc theo cụm phiếu,
     tô theo dòng thì một phiếu 5 dòng bị cắt vụn thành 5 mảng. */
  let soc = false
  for (const x of rows) {
    const ln = lines.filter(l => l.pxk === x.pxk)
    if (!ln.length) continue
    const nen = soc ? K.vach : undefined
    soc = !soc
    ln.forEach((l, k) => {
      T.dong(q++, [
        k ? '' : ngay(x.d), k ? '' : x.pxk, l.sku, skuName[l.sku] || '', 'Cái',
        Number(l.qty) || 0, l.price || 0, l.amount || 0, l.note || '',
      ], c => st({
        nen,
        ngang: c === 3 || c === 8 ? 'left' : c >= 6 ? 'right' : 'center',
        fmt: c >= 6 ? '#,##0' : c === 5 ? '0' : undefined,
        xuong: c === 3 || c === 8,
      }))
    })
  }
  T.dong(q, ['', '', '', 'TỔNG CỘNG', '', tong.qty, '', tong.amount, ''],
    c => oCong(c === 3 || c === 8 ? 'left' : c >= 6 ? 'right' : 'center',
      c >= 6 ? '#,##0' : c === 5 ? '0' : undefined))
  q += 2
  T.dai(q++, 'Ghi chú:', st({ b: true, ngang: 'left', khung: false }))
  for (const g of [
    '· Cột Thành tiền là số tiền Đại lý phải thanh toán, chưa gồm thuế GTGT. Hàng mẫu và quà tặng '
    + 'chiết khấu 100% nên ghi 0 đồng; đơn giá chỉ dùng để ghi nhận giá trị hàng xuất kho.',
    '· Tổng cột Thành tiền khớp với dòng "Cộng phát sinh" tại sheet "1. Công nợ" trước khi cộng thuế GTGT.',
  ]) { T.rowh[q] = { hpt: 15 }; T.dai(q++, g, ghiChu) }

  const ws2 = T.xong({
    '!cols': [11, 18, 12, 44, 6, 13, 14, 15, 28].map(wch => ({ wch })),
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws1, '1. Công nợ')
  XLSX.utils.book_append_sheet(wb, ws2, '2. Chi tiết hàng giao')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  const ten = `DoiChieu-Cong-No-${cust.code}-${ngay(asOf).replace(/\//g, '.')}.xlsx`
  downloadBlob(ten, new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  return ten
}
