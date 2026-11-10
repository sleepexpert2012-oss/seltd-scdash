import { useEffect, useMemo, useState } from 'react'
import arFile from '../data/receivable.json'
import { SKU_MAP, BASE_AS_OF } from '../lib/metrics'
import { num } from '../lib/format'
import { Money, SkuPick, vnd, today, tenNgan } from '../lib/formbits'
import { fetchSales, saveDelivery, delDelivery, deviceName } from '../lib/cloud'
import { exportRowsXlsx } from '../lib/masterFile'
import './sales.css'

/* ============================================================
   PHIẾU XUẤT KHO
   Hàng thực sự rời kho. Đây là chứng từ gốc của hai thứ khác:
   · TỒN KHO  — phiếu sau mốc kiểm kho tự trừ vào tồn khả dụng.
   · CÔNG NỢ  — mỗi phiếu có tiền sinh một khoản phải thu, hạn thu
                = ngày giao + số ngày công nợ khai ở Danh mục.
   Vì vậy phiếu xuất nằm ở nhóm kho chứ không nằm trong màn Bán hàng:
   bán là cam kết, xuất kho mới là hàng đi và tiền bắt đầu chạy.
   ============================================================ */

export default function Delivery() {
  const [db, setDb] = useState(() => ({
    customers: arFile.customers || [], deliveries: arFile.deliveries || [],
    deliveryLines: arFile.deliveryLines || [], orders: arFile.orders || [],
  }))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [form, setForm] = useState(null)

  async function nap() {
    setBusy(true)
    try { setDb(await fetchSales()) }
    catch (e) { setMsg({ t: 'warn', s: `Không tải được từ đám mây (${e.message}). Đang dùng bản đóng kèm.` }) }
    finally { setBusy(false) }
  }
  useEffect(() => { nap() }, [])

  const custName = useMemo(
    () => Object.fromEntries((db.customers || []).map(c => [c.code, c.name])), [db.customers])
  const vatOf = useMemo(
    () => Object.fromEntries((db.customers || []).map(c => [c.code, c.vat_rate ?? 0.08])), [db.customers])
  const linesOf = useMemo(() => {
    const m = {}
    for (const l of db.deliveryLines || []) (m[l.pxk] = m[l.pxk] || []).push(l)
    return m
  }, [db.deliveryLines])

  async function lam(fn, ok) {
    setBusy(true); setMsg(null)
    try { await fn(); await nap(); setForm(null); setMsg({ t: 'ok', s: ok }) }
    catch (e) { setMsg({ t: 'bad', s: `CHƯA lưu được: ${e.message}` }) }
    finally { setBusy(false) }
  }

  const sauMoc = (db.deliveries || []).filter(p => BASE_AS_OF && p.d > BASE_AS_OF)
  const slTru = sauMoc.reduce((a, p) => a + (p.qty || 0), 0)

  return (
    <div className="sl-page">
      <div className="m2-title">
        <div>
          <h2>Phiếu xuất kho</h2>
          <p>
            Chứng từ gốc cho cả tồn kho và công nợ: phiếu sau mốc kiểm kho tự trừ tồn,
            phiếu có tiền tự sinh khoản phải thu theo hạn công nợ của khách.
          </p>
        </div>
        <div className="sl-stamp">
          <span>Mốc kiểm kho</span><b>{BASE_AS_OF || '—'}</b>
          <i>{sauMoc.length} phiếu sau mốc · đang trừ {num(slTru)} sp</i>
        </div>
      </div>

      <div className="mk-tabbar">
        <div className="mk-tabs">
          <button className="on"><span className="ic" aria-hidden>⇥</span>Phiếu xuất kho
            <em>{(db.deliveries || []).length}</em></button>
        </div>
        <div className="sl-acts">
          <button className="btn-ghost" onClick={nap} disabled={busy}>⟳ Tải lại</button>
          <span className="sl-dev">Máy: {deviceName()}</span>
        </div>
      </div>

      {msg && <div className={`cf-msg t-${msg.t}`}>{msg.s}</div>}

      <PxkTab db={db} linesOf={linesOf} custName={custName} vatOf={vatOf}
        form={form} setForm={setForm} busy={busy}
        onSave={(p, lines) => lam(() => saveDelivery(p, lines), `Đã lưu phiếu ${p.pxk}.`)}
        onDel={pxk => lam(() => delDelivery(pxk), `Đã xoá phiếu ${pxk}.`)} />
    </div>
  )
}

/* ================= PHIẾU XUẤT KHO ================= */
function PxkTab({ db, linesOf, custName, vatOf, form, setForm, busy, onSave, onDel }) {
  const moi = () => setForm({
    pxk: '', cust: db.customers[0]?.code || '', d: today(), don: '', invoice_no: '', note: '',
    lines: [{ sku: '', qty: 1, price: 0, amount: 0, note: '' }],
  })
  const sua = p => setForm({
    ...p, don: p.don || '', invoice_no: p.invoice_no || '', note: p.note || '',
    lines: (linesOf[p.pxk] || []).map(l => ({ ...l })),
  })

  function xuat() {
    exportRowsXlsx('Phieu xuat kho.xlsx', {
      'Phieu xuat': db.deliveries.map(p => ({
        'Số phiếu': p.pxk, 'Ngày giao': p.d, 'Khách': custName[p.cust] || p.cust,
        'Thuộc đơn': p.don || '', 'Số HĐ GTGT': p.invoice_no || '',
        'SL': p.qty || 0, 'Chưa VAT': p.amount,
        'VAT': Math.round(p.amount * (vatOf[p.cust] ?? 0.08)),
        'Phải thanh toán': p.amount + Math.round(p.amount * (vatOf[p.cust] ?? 0.08)),
        'Ghi chú': p.note || '',
      })),
      'Dong hang': db.deliveryLines.map(l => ({
        'Số phiếu': l.pxk, 'Mã SP': l.sku, 'Tên': SKU_MAP[l.sku]?.name || '',
        'SL': l.qty, 'Đơn giá': l.price, 'Thành tiền': l.amount, 'Ghi chú': l.note || '',
      })),
    })
  }

  if (form) return <PxkForm db={db} form={form} setForm={setForm} busy={busy} onSave={onSave} />

  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Phiếu xuất kho</h3>
        <span>
          Phiếu sau <b>{BASE_AS_OF}</b> tự trừ vào tồn kho. Phiếu trước mốc đó không trừ —
          hàng đã ra khỏi kho rồi nên không nằm trong số kiểm kho.
        </span>
        <div className="group-ctrl">
          <button className="primary" onClick={moi}>+ Phiếu xuất mới</button>
          <button onClick={xuat}>⬇ Xuất Excel</button>
        </div>
      </div>
      <div className="m2-tablewrap">
        <table className="sl-tb">
          <thead>
            <tr><th>Số phiếu</th><th>Ngày</th><th>Khách</th><th>Đơn</th><th>Số HĐ</th>
              <th className="num">SL</th><th className="num">Chưa VAT</th>
              <th className="num">Phải thu</th><th>Trừ tồn</th><th /></tr>
          </thead>
          <tbody>
            {db.deliveries.map(p => {
              const vat = Math.round(p.amount * (vatOf[p.cust] ?? 0.08))
              const truTon = BASE_AS_OF && p.d > BASE_AS_OF
              return (
                <tr key={p.pxk}>
                  <td><b>{p.pxk}</b>{p.note && <small>{p.note}</small>}</td>
                  <td className="sm">{p.d}</td>
                  <td className="sm" title={custName[p.cust]}>{tenNgan(custName[p.cust], p.cust)}</td>
                  <td className="sm">{p.don || '—'}</td>
                  <td className="sm">{p.invoice_no || '—'}</td>
                  <td className="num">{num(p.qty || 0)}</td>
                  <td className="num">{p.amount ? vnd(p.amount) : <span className="dim">0</span>}</td>
                  <td className="num b">{p.amount ? vnd(p.amount + vat) : <span className="dim">0</span>}</td>
                  <td className="sm">
                    {truTon ? <span className="sl-tag on">có</span>
                      : <span className="sl-tag off" title="Giao trước mốc kiểm kho">không</span>}
                  </td>
                  <td className="sl-row-act">
                    <button onClick={() => sua(p)}>Sửa</button>
                    <button className="del" disabled={busy}
                      onClick={() => confirm(`Xoá phiếu ${p.pxk}?`) && onDel(p.pxk)}>Xoá</button>
                  </td>
                </tr>
              )
            })}
            {!db.deliveries.length && (
              <tr><td colSpan={10} className="sl-empty">Chưa có phiếu xuất nào.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PxkForm({ db, form, setForm, busy, onSave }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setLine = (i, k, v) => setForm(f => {
    const lines = f.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l))
    /* Thành tiền tự tính = SL x đơn giá, nhưng CHO PHÉP sửa tay: hàng mẫu và
       quà tặng có đơn giá nhưng thành tiền 0 (chiết khấu 100%). */
    if (k === 'qty' || k === 'price') {
      lines[i].amount = Math.round((lines[i].qty || 0) * (lines[i].price || 0))
    }
    return { ...f, lines }
  })
  const them = () => setForm(f => ({ ...f, lines: [...f.lines, { sku: '', qty: 1, price: 0, amount: 0, note: '' }] }))
  const bo = i => setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))

  const tong = form.lines.reduce((a, l) => a + (l.amount || 0), 0)
  const sl = form.lines.reduce((a, l) => a + (+l.qty || 0), 0)
  const vat = Math.round(tong * (db.customers.find(c => c.code === form.cust)?.vat_rate ?? 0.08))
  const hopLe = form.pxk.trim() && form.cust && form.d && form.lines.some(l => l.sku)

  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>{form.pxk ? `Sửa phiếu ${form.pxk}` : 'Phiếu xuất kho mới'}</h3>
        <span>Thành tiền tự tính từ SL × đơn giá — sửa tay được, để nhập hàng mẫu / quà tặng (thành tiền 0)</span>
        <div className="group-ctrl">
          <button onClick={() => setForm(null)}>Huỷ</button>
          <button className="primary" disabled={!hopLe || busy}
            onClick={() => onSave({
              pxk: form.pxk.trim(), cust: form.cust, d: form.d,
              don: form.don || null, invoice_no: form.invoice_no || null, note: form.note || null,
            }, form.lines.filter(l => l.sku).map(l => ({
              sku: l.sku, qty: +l.qty || 0, price: +l.price || 0,
              amount: +l.amount || 0, note: l.note || null,
            })))}>{busy ? 'Đang lưu…' : 'Lưu phiếu'}</button>
        </div>
      </div>

      <div className="sl-form">
        <label>Số phiếu xuất
          <input className="sl-in" value={form.pxk} placeholder="PXK008-KNTH/2026"
            onChange={e => set('pxk', e.target.value)} /></label>
        <label>Ngày giao
          <input className="sl-in" type="date" value={form.d} onChange={e => set('d', e.target.value)} /></label>
        <label>Khách hàng
          <select className="sl-in" value={form.cust} onChange={e => set('cust', e.target.value)}>
            {db.customers.map(c => <option key={c.code} value={c.code}>{c.code} — {tenNgan(c.name, c.code)}</option>)}
          </select></label>
        <label>Thuộc đơn hàng
          <select className="sl-in" value={form.don} onChange={e => set('don', e.target.value)}>
            <option value="">— không gắn đơn —</option>
            {db.orders.filter(o => o.cust === form.cust).map(o => <option key={o.code} value={o.code}>{o.code}</option>)}
          </select></label>
        <label>Số hoá đơn GTGT
          <input className="sl-in" value={form.invoice_no} placeholder="để trống nếu chưa xuất"
            onChange={e => set('invoice_no', e.target.value)} /></label>
        <label className="wide">Ghi chú
          <input className="sl-in" value={form.note} onChange={e => set('note', e.target.value)} /></label>
      </div>

      <div className="m2-tablewrap">
        <table className="sl-tb">
          <thead>
            <tr><th style={{ minWidth: 260 }}>Sản phẩm</th><th className="num">SL</th>
              <th className="num">Đơn giá</th><th className="num">Thành tiền</th><th>Ghi chú</th><th /></tr>
          </thead>
          <tbody>
            {form.lines.map((l, i) => (
              <tr key={i}>
                <td><SkuPick value={l.sku} onChange={v => setLine(i, 'sku', v)} /></td>
                <td className="num"><input className="sl-in num sm" type="number" min="0" value={l.qty}
                  onChange={e => setLine(i, 'qty', +e.target.value)} /></td>
                <td className="num"><Money value={l.price} onChange={v => setLine(i, 'price', v)} /></td>
                <td className="num"><Money value={l.amount} onChange={v => setLine(i, 'amount', v)} /></td>
                <td><input className="sl-in" value={l.note || ''}
                  onChange={e => setLine(i, 'note', e.target.value)} /></td>
                <td className="sl-row-act">
                  <button className="del" onClick={() => bo(i)}>×</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td><button className="sl-add" onClick={them}>+ Thêm dòng</button></td>
              <td className="num b">{num(sl)}</td><td />
              <td className="num b">{vnd(tong)}</td>
              <td colSpan={2} className="sm">
                VAT {vnd(vat)} · <b>phải thu {vnd(tong + vat)}</b>
              </td></tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
