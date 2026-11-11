/* ============================================================
   XUẤT BẢNG EXCEL CÓ ĐỊNH DẠNG — dùng chung cho các màn tài chính.
   Cùng bảng màu với bản đối chiếu công nợ (src/lib/doiChieu.js) để mọi file
   xuất ra từ app nhìn như một bộ.

   Phải dùng xlsx-js-style: thư viện xlsx thường bỏ HẾT định dạng khi ghi file
   mà không báo lỗi gì.

   sheets = [{
     name, title, sub,                 // tiêu đề và dòng mô tả (tuỳ chọn)
     cols: [{ h: 'Tiêu đề', w: 14, fmt: '#,##0' | '0.0%' | undefined, align }],
     rows: [{ cells: [...], kind: 'group'|'total'|'bad'|'good'|'note'|undefined,
              tone: { [chỉ số cột]: 'bad'|'good' } }],
     notes: ['dòng ghi chú cuối bảng', ...],
   }]
   Số tiền luôn ghi bằng ĐỒNG đầy đủ (số thật để người nhận tự tính lại),
   tỷ lệ ghi dạng thập phân và để Excel định dạng %.
   ============================================================ */
const K = {
  navy: '1F3864', dai: 'D9E2F3', xam: 'E8E8E8', doNen: 'FCE4E4', doChu: '9C0006',
  xanh: '1F6B35', xanhNen: 'E2EFDA', vien: 'BFBFBF', mo: '555555',
}
const FONT = 'Arial'
const vien = { style: 'thin', color: { rgb: K.vien } }

function st({ b, sz = 9.5, mau, nen, ngang = 'left', fmt, xuong, khung = true, i } = {}) {
  return {
    font: { name: FONT, sz, bold: !!b, italic: !!i, color: { rgb: mau || '000000' } },
    ...(nen ? { fill: { patternType: 'solid', fgColor: { rgb: nen } } } : {}),
    alignment: { horizontal: ngang, vertical: 'center', wrapText: !!xuong },
    ...(khung ? { border: { top: vien, bottom: vien, left: vien, right: vien } } : {}),
    ...(fmt ? { numFmt: fmt } : {}),
  }
}

export async function xuatBang(fileName, sheets) {
  const m = await import('xlsx-js-style')
  const XLSX = m.utils ? m : m.default
  const wb = XLSX.utils.book_new()

  for (const sh of sheets) {
    const ws = {}
    const merges = []
    const rowh = []
    const nc = sh.cols.length
    const put = (r, c, v, s) => {
      const isNum = typeof v === 'number' && Number.isFinite(v)
      ws[XLSX.utils.encode_cell({ r, c })] = { v: v ?? '', t: isNum ? 'n' : 's', s }
    }
    let r = 0
    if (sh.title) {
      put(r, 0, sh.title, st({ b: true, sz: 14, mau: K.navy, khung: false }))
      merges.push({ s: { r, c: 0 }, e: { r, c: nc - 1 } }); r++
    }
    if (sh.sub) {
      put(r, 0, sh.sub, st({ sz: 9, mau: K.mo, khung: false, i: true }))
      merges.push({ s: { r, c: 0 }, e: { r, c: nc - 1 } }); r++
    }
    if (sh.title || sh.sub) r++

    rowh[r] = { hpt: 30 }
    sh.cols.forEach((c, j) => put(r, j, c.h, st({ b: true, mau: 'FFFFFF', nen: K.navy, ngang: 'center', xuong: true })))
    r++

    for (const row of sh.rows) {
      const k = row.kind
      const nen = k === 'group' ? K.dai : k === 'total' ? K.xam : k === 'bad' ? K.doNen : k === 'good' ? K.xanhNen : undefined
      row.cells.forEach((v0, j) => {
        const col = sh.cols[j] || {}
        /* Cột tiền: ghi số nguyên đồng (giá vốn tính ra có phần lẻ) */
        const v = typeof v0 === 'number' && col.fmt === '#,##0' ? Math.round(v0) : v0
        const tone = row.tone?.[j]
        put(r, j, v, st({
          b: k === 'group' || k === 'total',
          nen,
          mau: tone === 'bad' ? K.doChu : tone === 'good' ? K.xanh : k === 'note' ? K.mo : undefined,
          ngang: col.align || (typeof v === 'number' ? 'right' : 'left'),
          fmt: typeof v === 'number' ? col.fmt : undefined,
          xuong: col.wrap,
        }))
      })
      r++
    }

    if (sh.notes?.length) {
      r++
      for (const n of sh.notes) {
        put(r, 0, n, st({ sz: 9, mau: K.mo, khung: false, i: true }))
        merges.push({ s: { r, c: 0 }, e: { r, c: nc - 1 } }); r++
      }
    }

    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, r - 1), c: nc - 1 } })
    ws['!cols'] = sh.cols.map(c => ({ wch: c.w || 14 }))
    ws['!merges'] = merges
    ws['!rows'] = rowh
    XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31))
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const url = URL.createObjectURL(new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const a = document.createElement('a')
  a.href = url; a.download = fileName
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
