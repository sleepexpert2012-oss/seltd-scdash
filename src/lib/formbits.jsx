import { useEffect, useMemo, useState } from 'react'
import master from '../data/master'
import { SKU_MAP } from './metrics'

/* Các ô nhập dùng chung cho màn Bán hàng, Phiếu xuất kho và Danh mục. */

export const vnd = n => (n ? new Intl.NumberFormat('vi-VN').format(Math.round(n)) : '')
export const parseVnd = s => {
  const n = Number(String(s ?? '').replace(/[^\d-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
export const today = () => new Date().toISOString().slice(0, 10)

/* Ô tiền có dấu chấm ngăn nghìn. Khi đang gõ thì giữ nguyên chữ người dùng gõ,
   chỉ định dạng lại lúc rời ô — nếu định dạng ngay từng phím thì con trỏ nhảy. */
export function Money({ value, onChange, ph = '0' }) {
  const [t, setT] = useState(vnd(value))
  const [f, setF] = useState(false)
  useEffect(() => { if (!f) setT(vnd(value)) }, [value, f])
  return (
    <input className="sl-in num" value={t} placeholder={ph} inputMode="numeric"
      onFocus={() => setF(true)} onBlur={() => { setF(false); setT(vnd(value)) }}
      onChange={e => { setT(e.target.value); onChange(parseVnd(e.target.value)) }} />
  )
}

/* Bộ chọn SKU có tìm kiếm — 143 SKU mà dùng <select> thì không tìm nổi. */
export function SkuPick({ value, onChange }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const s = SKU_MAP[value]
  const hit = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return master.skus.slice(0, 30)
    return master.skus.filter(x =>
      x.sku.toLowerCase().includes(k) || (x.name || '').toLowerCase().includes(k)).slice(0, 30)
  }, [q])
  return (
    <div className="sl-sku">
      <input className="sl-in" value={open ? q : (value ? `${value} — ${s?.name || ''}` : '')}
        placeholder="Gõ mã hoặc tên sản phẩm…"
        onFocus={() => { setOpen(true); setQ('') }}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        onChange={e => setQ(e.target.value)} />
      {open && (
        <div className="sl-drop">
          {hit.map(x => (
            <button key={x.sku} type="button" onMouseDown={() => { onChange(x.sku); setOpen(false) }}>
              <b>{x.sku}</b><span>{x.name}</span>
            </button>
          ))}
          {!hit.length && <div className="sl-empty">Không có SKU nào khớp “{q}”.</div>}
        </div>
      )}
    </div>
  )
}

/* Tên gọn để nhét vừa một cột bảng: ưu tiên thương hiệu trong ngoặc
   ("CÔNG TY ... (KHO NỆM TỔNG HỢP)" -> "KHO NỆM TỔNG HỢP"), nếu không có
   thì bỏ phần loại hình doanh nghiệp ở đầu. Tên đầy đủ vẫn ở tooltip. */
export function tenNgan(ten, ma = '') {
  if (!ten) return ma
  const m = ten.match(/[("“]([^)"”]{3,40})[)"”]/)
  if (m) return m[1].trim()
  return ten.replace(/^(CÔNG TY|CTY)\s+(TNHH|CỔ PHẦN|CP)?\s*/i, '').trim().slice(0, 30)
}
