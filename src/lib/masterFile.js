/* Đọc / ghi Master Data.xlsx ngay trong trình duyệt.
   Bám đúng cách đọc của scripts/extract_master.py để file nhập ở đây cho ra
   cùng một cấu trúc với bản đóng kèm — nếu lệch một tên cột là số sẽ sai lặng lẽ,
   nên hàm parse bên dưới báo lỗi rõ ràng khi thiếu cột thay vì bỏ qua. */

/* xlsx nặng ~400KB, chỉ nạp khi người dùng thực sự bấm nhập/kết xuất */
const lib = () => import('xlsx')

/* extract_master.py đọc từng sheet với header ở dòng khác nhau (0-based).
   Ở đây KHÔNG tin cứng vào chỉ số đó: dò trong 20 dòng đầu tìm dòng có chứa
   cột mốc. Lý do: nếu ai chèn/xoá một dòng phía trên trong Excel thì đọc theo
   chỉ số cứng sẽ lấy sai dòng tiêu đề và toàn bộ số sẽ lệch trong im lặng. */
const SHEETS = {
  md: { name: '1. Master Data', header: 6, marker: 'SKU' },
  sup: { name: '0. Mã Supplier', header: 4, marker: 'Supplier Code' },
  wh: { name: 'Mã Kho', header: 0, marker: 'Mã kho' },
  po: { name: '4. Purchasing', header: 0, marker: 'PO' },
}

const NAME_COL = 'Tên Sản Phẩm & kích thước (Cao x Rộng x Dài - cm)'

const num = v => {
  if (v === null || v === undefined || v === '') return null
  const f = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(f) ? f : null
}
const txt = v => (v === null || v === undefined ? '' : String(v).trim())

/* Excel lưu ngày dạng số serial; xlsx trả về Date khi cellDates=true */
const ymd = v => {
  if (!v) return null
  if (v instanceof Date && !isNaN(v)) {
    const p = n => String(n).padStart(2, '0')
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    /* serial ngày của Excel: mốc 1899-12-30 */
    const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5)
    const p = n => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
  }
  const s = txt(v)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

/* Tên cột: giữ NGUYÊN cả phần sau dấu xuống dòng, chỉ gộp khoảng trắng.
   Nếu cắt ở '\n' thì 'Total Cost' và 'Total Cost\n(VAT)' hoá cùng tên, cột VAT
   ghi đè cột không VAT và giá trị sai lặng lẽ ~8%. */
const cell = h => txt(h).replace(/\s+/g, ' ').trim()
const cellShort = h => txt(h).split('\n')[0].replace(/\s+/g, ' ').trim()

function sheetRows(XLSX, wb, cfg) {
  const ws = wb.Sheets[cfg.name]
  if (!ws) throw new Error(`Thiếu sheet "${cfg.name}"`)
  /* blankrows: true để chỉ số dòng khớp đúng dòng trong Excel — nếu bỏ dòng
     trống thì chỉ số tiêu đề sẽ lệch so với cách đọc của pandas */
  /* raw: true để lấy SỐ nguyên bản và NGÀY dạng Date. Nếu dùng raw:false thì
     xlsx trả về chuỗi đã định dạng: 15.278.690 bị làm tròn thành 15278690 và
     ngày thành "8/10/25" — parse ra null, mất sạch cột ngày nhận hàng. */
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true })

  let hi = -1
  /* Sheet NCC có tiêu đề dạng "Supplier Code\n(Mã nhà cung cấp)" nên phải khớp
     cả tên rút gọn tới trước dấu xuống dòng, không chỉ tên đầy đủ. */
  const has = row => (row || []).some(c => cell(c) === cfg.marker || cellShort(c) === cfg.marker)
  if (has(grid[cfg.header])) hi = cfg.header
  else {
    for (let i = 0; i < Math.min(grid.length, 20); i++) if (has(grid[i])) { hi = i; break }
  }
  if (hi < 0) {
    throw new Error(`Sheet "${cfg.name}": không tìm thấy dòng tiêu đề có cột "${cfg.marker}" trong 20 dòng đầu`)
  }

  const raw = grid[hi] || []
  const head = raw.map(cell)
  /* Ngoài tên đầy đủ, thêm cả tên rút gọn tới trước '\n' (extract_master.py đọc
     sheet NCC theo kiểu đó) — nhưng CHỈ khi tên rút gọn không đụng cột nào khác. */
  const shorts = raw.map(cellShort)
  const cnt = {}
  shorts.forEach(s => { if (s) cnt[s] = (cnt[s] || 0) + 1 })
  const alias = shorts.map((s, j) => (s && cnt[s] === 1 && s !== head[j] ? s : null))

  const out = []
  for (let i = hi + 1; i < grid.length; i++) {
    const r = grid[i] || []
    if (r.every(c => c === null || txt(c) === '')) continue
    const o = {}
    head.forEach((h, j) => { if (h) o[h] = r[j] })
    alias.forEach((a, j) => { if (a && !(a in o)) o[a] = r[j] })
    out.push(o)
  }
  return { head: [...new Set([...head, ...alias.filter(Boolean)])].filter(Boolean), rows: out }
}

function need(head, cols, sheet) {
  const miss = cols.filter(c => !head.includes(c))
  if (miss.length) throw new Error(`Sheet "${sheet}" thiếu cột: ${miss.join(', ')}`)
}

export async function parseMasterFile(file) {
  const XLSX = await lib()
  /* cellDates: false -> ngày về dạng SỐ serial, tự quy đổi bằng mốc UTC 1899-12-30.
     Nếu để xlsx tự tạo Date thì nó dựng theo múi giờ máy và bị lệch 1 ngày. */
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: false })

  const md = sheetRows(XLSX, wb, SHEETS.md)
  /* tên cột dài có thể đã bị rút gọn khi ai đó sửa file -> nhận cả 2 dạng */
  const nameCol = md.head.includes(NAME_COL) ? NAME_COL
    : md.head.find(h => h.startsWith('Tên Sản Phẩm')) || NAME_COL
  need(md.head, ['SKU', 'Mã sản phẩm', 'Subcategory name', 'Variation name', 'Category',
    'Ngành hàng', 'Supplier Code', 'Brand', 'Unit Cost (vnd)', 'Giá Vốn (+VAT)'],
    SHEETS.md.name)

  const skus = md.rows.filter(r => txt(r.SKU)).map(r => ({
    sku: txt(r.SKU),
    classCode: txt(r['Mã sản phẩm']),
    className: txt(r['Subcategory name']),
    name: txt(r[nameCol]),
    variant: txt(r['Variation name']),
    cat: txt(r.Category),
    nganh: txt(r['Ngành hàng']),
    supplierCode: txt(r['Supplier Code']),
    brand: txt(r.Brand),
    unitCost: num(r['Unit Cost (vnd)']) || 0,
    costVat: num(r['Giá Vốn (+VAT)']) || 0,
    salesPrice: num(r['Sales Price (vnd)']),
    w: num(r['Rộng']) || 0,
    l: num(r['Dài']) || 0,
    h: txt(r['Cao']),
    moq: num(r['Min. Order']) || 1,
    m3: num(r['M3']),
  }))
  if (!skus.length) throw new Error('Không đọc được dòng SKU nào từ sheet Master Data')

  const sup = sheetRows(XLSX, wb, SHEETS.sup)
  need(sup.head, ['Supplier Code', 'Supplier Name'], SHEETS.sup.name)
  const suppliers = sup.rows.filter(r => txt(r['Supplier Code'])).map(r => ({
    code: txt(r['Supplier Code']),
    name: txt(r['Supplier Name']),
    location: txt(r.Location),
    paymentTerms: num(r['Payment Terms']),
  }))

  const wh = sheetRows(XLSX, wb, SHEETS.wh)
  need(wh.head, ['Mã kho', 'Tên kho', 'Loại kho'], SHEETS.wh.name)
  const warehouses = wh.rows.filter(r => txt(r['Mã kho'])).map(r => ({
    code: txt(r['Mã kho']), name: txt(r['Tên kho']), type: txt(r['Loại kho']),
  }))

  const po = sheetRows(XLSX, wb, SHEETS.po)
  need(po.head, ['PO', 'Code', 'Supplier', 'Qty confirm', 'Cost', 'Total Cost'], SHEETS.po.name)
  const purchaseOrders = po.rows.filter(r => txt(r.PO)).map(r => ({
    po: txt(r.PO),
    sku: txt(r.Code),
    supplier: txt(r.Supplier),
    qtyOrder: num(r['Qty order']) || 0,
    qtyConfirm: num(r['Qty confirm']) || 0,
    cost: num(r.Cost) || 0,
    totalCost: num(r['Total Cost']) || 0,
    /* Ô VAT trống thì để 0, KHÔNG lấy Total Cost thay: hai cột là hai con số
       khác nhau, thay thế sẽ khai khống công nợ có VAT. */
    totalCostVat: num(r['Total Cost (VAT)']) || 0,
    dateReceive: ymd(r['Date Receive']),
    invoiceDate: ymd(r['Invoice Date']),
    dueDate: ymd(r['Due Date']),
    paymentTerms: num(r['Payment Terms']),
    daysOverdue: num(r['Days Overdue']) || 0,
    paid: num(r['Paid Amount']) || 0,
    paidFlag: txt(r['Payment status']),
    outstanding: num(r['Outstanding Amount']) || 0,
  }))

  /* danh mục lọc: xếp theo số SKU giảm dần, giống extract_master.py */
  const cats = key => {
    const m = new Map()
    for (const s of skus) if (s[key]) m.set(s[key], (m.get(s[key]) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }

  return {
    meta: {
      source: file.name,
      skuCount: skus.length,
      importedAt: new Date().toISOString(),
      note: 'Nạp từ file Excel qua màn Cơ sở hạ tầng (lưu trong trình duyệt này).',
    },
    dims: { nganh: cats('nganh'), loaiHinh: cats('className'), brand: cats('brand') },
    skus, suppliers, warehouses, purchaseOrders,
  }
}

/* So sánh bản nạp với bản đang dùng để người duyệt thấy đổi gì trước khi áp dụng */
export function diffMaster(cur, next) {
  const a = new Set(cur.skus.map(s => s.sku))
  const b = new Set(next.skus.map(s => s.sku))
  const added = [...b].filter(x => !a.has(x))
  const removed = [...a].filter(x => !b.has(x))
  const curBy = Object.fromEntries(cur.skus.map(s => [s.sku, s]))
  const costChanged = next.skus.filter(s => {
    const o = curBy[s.sku]
    return o && Math.abs((o.unitCost || 0) - (s.unitCost || 0)) > 0.5
  }).map(s => ({ sku: s.sku, from: curBy[s.sku].unitCost, to: s.unitCost }))
  return {
    added, removed, costChanged,
    skus: [cur.skus.length, next.skus.length],
    suppliers: [cur.suppliers.length, next.suppliers.length],
    warehouses: [cur.warehouses.length, next.warehouses.length],
    pos: [cur.purchaseOrders.length, next.purchaseOrders.length],
  }
}

export function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function exportJson(name, obj) {
  downloadBlob(name, new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }))
}

/* Kết xuất ra Excel nhiều sheet — để phòng mua hàng mở bằng Excel bình thường */
export async function exportMasterXlsx(master, name = 'Master Data (kết xuất).xlsx') {
  const XLSX = await lib()
  const wb = XLSX.utils.book_new()
  const add = (rows, sheet) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet)
  add(master.skus, 'SKU')
  add(master.suppliers, 'Nha cung cap')
  add(master.warehouses, 'Kho')
  add(master.purchaseOrders, 'Purchasing')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  downloadBlob(name, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}

export async function exportRowsXlsx(name, sheets) {
  const XLSX = await lib()
  const wb = XLSX.utils.book_new()
  for (const [sheet, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet.slice(0, 31))
  }
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  downloadBlob(name, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}
