import { useEffect, useMemo, useState } from 'react'
import arFile from '../data/receivable.json'
import { num } from '../lib/format'
import { Money, SkuPick, vnd, today, tenNgan } from '../lib/formbits'
import { fetchSales, saveOrder, delOrder, addPayment, delPayment, deviceName } from '../lib/cloud'
import './sales.css'

/* ============================================================
   BÁN HÀNG (ngoài sàn Shopee)
   Chỉ phần BÁN: đơn hàng khách đặt và tiền khách trả.
   · Hàng rời kho  -> màn Phiếu xuất kho (nhóm Cung ứng)
   · Khách / NCC   -> màn Danh mục (nhóm Tài liệu & Hệ thống)
   Hiện phục vụ kênh đại lý; kênh ngoài sàn khác dùng chung màn này.
   ============================================================ */

const TABS = [
  ['don', '▤', 'Đơn hàng'],
  ['thu', '₫', 'Thanh toán'],
]

export default function Sales() {
  const [tab, setTab] = useState('don')
  const [db, setDb] = useState(() => ({
    customers: arFile.customers || [], deliveries: arFile.deliveries || [],
    deliveryLines: arFile.deliveryLines || [], payments: arFile.payments || [],
    orders: arFile.orders || [], orderLines: arFile.orderLines || [],
    suppliersExtra: arFile.suppliersExtra || [],
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
    () => Object.fromEntries(db.customers.map(c => [c.code, c.name])), [db.customers])
  const vatOf = useMemo(
    () => Object.fromEntries(db.customers.map(c => [c.code, c.vat_rate ?? 0.08])), [db.customers])

  const linesOf = useMemo(() => {
    const m = {}
    for (const l of db.deliveryLines) (m[l.pxk] = m[l.pxk] || []).push(l)
    return m
  }, [db.deliveryLines])

  const olinesOf = useMemo(() => {
    const m = {}
    for (const l of db.orderLines) (m[l.code] = m[l.code] || []).push(l)
    return m
  }, [db.orderLines])

  async function lam(fn, ok) {
    setBusy(true); setMsg(null)
    try { await fn(); await nap(); setForm(null); setMsg({ t: 'ok', s: ok }) }
    catch (e) { setMsg({ t: 'bad', s: `CHƯA lưu được: ${e.message}` }) }
    finally { setBusy(false) }
  }

  return (
    <div className="sl-page">
      <div className="m2-title">
        <div>
          <h2>Bán hàng</h2>
          <p>
            Bán hàng ngoài sàn Shopee: đơn khách đặt và tiền khách trả. Hàng thực giao ghi ở
            màn Phiếu xuất kho — đơn là cam kết, xuất kho mới là hàng đi và công nợ bắt đầu chạy.
          </p>
        </div>
        <div className="sl-stamp">
          <span>Đơn chưa giao hết</span>
          <b>{db.orders.filter(o => o.status === 'open').length}</b>
          <i>xem cột “Còn lại” bên dưới</i>
        </div>
      </div>

      <div className="mk-tabbar">
        <div className="mk-tabs">
          {TABS.map(([id, ic, lb]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setForm(null) }}>
              <span className="ic" aria-hidden>{ic}</span>{lb}
              <em>{id === 'pxk' ? db.deliveries.length : id === 'don' ? db.orders.length
                : db.payments.length}</em>
            </button>
          ))}
        </div>
        <div className="sl-acts">
          <button className="btn-ghost" onClick={nap} disabled={busy}>⟳ Tải lại</button>
          <span className="sl-dev">Máy: {deviceName()}</span>
        </div>
      </div>

      {msg && <div className={`cf-msg t-${msg.t}`}>{msg.s}</div>}

      {tab === 'don' && (
        <DonTab db={db} olinesOf={olinesOf} custName={custName} linesOf={linesOf}
          form={form} setForm={setForm} busy={busy}
          onSave={(p, lines) => lam(() => saveOrder(p, lines), `Đã lưu đơn ${p.code}.`)}
          onDel={code => lam(() => delOrder(code), `Đã xoá đơn ${code}.`)} />
      )}
      {tab === 'thu' && (
        <ThuTab db={db} custName={custName} form={form} setForm={setForm} busy={busy}
          onSave={p => lam(() => addPayment(p.cust, p.d, p.amount, p.note), 'Đã ghi nhận thanh toán.')}
          onDel={id => lam(() => delPayment(id), 'Đã xoá khoản thanh toán.')} />
      )}
    </div>
  )
}

/* ================= ĐƠN HÀNG ================= */
function DonTab({ db, olinesOf, custName, linesOf, form, setForm, busy, onSave, onDel }) {
  const moi = () => setForm({
    code: '', cust: db.customers[0]?.code || '', d: today(), note: '', status: 'open',
    lines: [{ sku: '', qty: 1, price: 0, disc: 0 }],
  })
  const sua = o => setForm({
    ...o, note: o.note || '',
    lines: (olinesOf[o.code] || []).map(l => ({ ...l, disc: Math.round((l.disc || 0) * 100) })),
  })

  /* Đã giao bao nhiêu phần của đơn — nối qua cột `don` của phiếu xuất */
  const daGiao = useMemo(() => {
    const m = {}
    for (const p of db.deliveries) if (p.don) m[p.don] = (m[p.don] || 0) + p.amount
    return m
  }, [db.deliveries])

  if (form) {
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
    const setLine = (i, k, v) => setForm(f => ({
      ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)),
    }))
    const amtOf = l => Math.round((+l.qty || 0) * (+l.price || 0) * (1 - (+l.disc || 0) / 100))
    const tong = form.lines.reduce((a, l) => a + amtOf(l), 0)
    const hopLe = form.code.trim() && form.cust && form.d && form.lines.some(l => l.sku)
    return (
      <section className="m2-panel">
        <div className="m2-head">
          <h3>{form.code ? `Sửa đơn ${form.code}` : 'Đơn hàng mới'}</h3>
          <div className="group-ctrl">
            <button onClick={() => setForm(null)}>Huỷ</button>
            <button className="primary" disabled={!hopLe || busy}
              onClick={() => onSave(
                { code: form.code.trim(), cust: form.cust, d: form.d, note: form.note || null, status: form.status },
                form.lines.filter(l => l.sku).map(l => ({
                  sku: l.sku, qty: +l.qty || 0, price: +l.price || 0,
                  disc: (+l.disc || 0) / 100, amount: amtOf(l), note: l.note || null,
                })),
              )}>{busy ? 'Đang lưu…' : 'Lưu đơn'}</button>
          </div>
        </div>
        <div className="sl-form">
          <label>Mã đơn hàng
            <input className="sl-in" value={form.code} placeholder="DH004-KNTH"
              onChange={e => set('code', e.target.value)} /></label>
          <label>Ngày đặt
            <input className="sl-in" type="date" value={form.d} onChange={e => set('d', e.target.value)} /></label>
          <label>Khách hàng
            <select className="sl-in" value={form.cust} onChange={e => set('cust', e.target.value)}>
              {db.customers.map(c => <option key={c.code} value={c.code}>{c.code} — {tenNgan(c.name, c.code)}</option>)}
            </select></label>
          <label>Tình trạng
            <select className="sl-in" value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="open">Đang giao</option><option value="done">Đã giao xong</option>
              <option value="cancel">Huỷ</option>
            </select></label>
          <label className="wide">Ghi chú
            <input className="sl-in" value={form.note} onChange={e => set('note', e.target.value)} /></label>
        </div>
        <div className="m2-tablewrap">
          <table className="sl-tb">
            <thead><tr><th style={{ minWidth: 240 }}>Sản phẩm</th><th className="num">SL đặt</th>
              <th className="num">Đơn giá</th><th className="num">% CK</th>
              <th className="num">Thành tiền</th><th /></tr></thead>
            <tbody>
              {form.lines.map((l, i) => (
                <tr key={i}>
                  <td><SkuPick value={l.sku} onChange={v => setLine(i, 'sku', v)} /></td>
                  <td className="num"><input className="sl-in num sm" type="number" min="0" value={l.qty}
                    onChange={e => setLine(i, 'qty', +e.target.value)} /></td>
                  <td className="num"><Money value={l.price} onChange={v => setLine(i, 'price', v)} /></td>
                  <td className="num"><input className="sl-in num sm" type="number" min="0" max="100"
                    value={l.disc ?? 0} onChange={e => setLine(i, 'disc', +e.target.value)} /></td>
                  <td className="num b">{amtOf(l) ? vnd(amtOf(l))
                    : <span className="sl-tag mid" title="Chiết khấu 100% — hàng mẫu / quà tặng">tặng</span>}</td>
                  <td className="sl-row-act"><button className="del"
                    onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}>×</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td><button className="sl-add"
                onClick={() => setForm(f => ({ ...f, lines: [...f.lines, { sku: '', qty: 1, price: 0, disc: 0 }] }))}>
                + Thêm dòng</button></td>
              <td className="num b">{num(form.lines.reduce((a, l) => a + (+l.qty || 0), 0))}</td>
              <td colSpan={2} /><td className="num b">{vnd(tong)}</td><td />
            </tr></tfoot>
          </table>
        </div>
      </section>
    )
  }

  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Đơn hàng</h3>
        <span>Phiếu xuất gắn vào đơn nào thì phần đã giao của đơn đó tự cộng lên</span>
        <div className="group-ctrl"><button className="primary" onClick={moi}>+ Đơn hàng mới</button></div>
      </div>
      <div className="m2-tablewrap">
        <table className="sl-tb">
          <thead><tr><th>Mã đơn</th><th>Ngày</th><th>Khách</th><th className="num">Giá trị đơn</th>
            <th className="num">Đã giao</th><th className="num">Còn lại</th><th>Tình trạng</th><th /></tr></thead>
          <tbody>
            {db.orders.map(o => {
              const gt = (olinesOf[o.code] || []).reduce(
                (a, l) => a + (l.amount ?? Math.round(l.qty * l.price * (1 - (l.disc || 0)))), 0)
              const giao = daGiao[o.code] || 0
              return (
                <tr key={o.code}>
                  <td><b>{o.code}</b>{o.note && <small>{o.note}</small>}</td>
                  <td className="sm">{o.d}</td>
                  <td className="sm" title={custName[o.cust]}>{tenNgan(custName[o.cust], o.cust)}</td>
                  <td className="num">{vnd(gt)}</td>
                  <td className="num">{vnd(giao)}</td>
                  <td className="num b">{vnd(Math.max(0, gt - giao))}</td>
                  <td className="sm">
                    <span className={`sl-tag ${o.status === 'done' ? 'on' : o.status === 'cancel' ? 'off' : 'mid'}`}>
                      {o.status === 'done' ? 'đã giao xong' : o.status === 'cancel' ? 'huỷ' : 'đang giao'}
                    </span>
                  </td>
                  <td className="sl-row-act">
                    <button onClick={() => sua(o)}>Sửa</button>
                    <button className="del" disabled={busy}
                      onClick={() => confirm(`Xoá đơn ${o.code}?`) && onDel(o.code)}>Xoá</button>
                  </td>
                </tr>
              )
            })}
            {!db.orders.length && (
              <tr><td colSpan={8} className="sl-empty">
                Chưa có đơn hàng nào. Phiếu xuất vẫn dùng được mà không cần gắn đơn.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ================= THANH TOÁN ================= */
function ThuTab({ db, custName, form, setForm, busy, onSave, onDel }) {
  if (form) {
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
    return (
      <section className="m2-panel">
        <div className="m2-head">
          <h3>Ghi nhận thanh toán</h3>
          <div className="group-ctrl">
            <button onClick={() => setForm(null)}>Huỷ</button>
            <button className="primary" disabled={!form.amount || busy}
              onClick={() => onSave(form)}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
          </div>
        </div>
        <div className="sl-form">
          <label>Khách hàng
            <select className="sl-in" value={form.cust} onChange={e => set('cust', e.target.value)}>
              {db.customers.map(c => <option key={c.code} value={c.code}>{c.code} — {tenNgan(c.name, c.code)}</option>)}
            </select></label>
          <label>Ngày thanh toán
            <input className="sl-in" type="date" value={form.d} onChange={e => set('d', e.target.value)} /></label>
          <label>Số tiền
            <Money value={form.amount} onChange={v => set('amount', v)} /></label>
          <label className="wide">Hình thức / chứng từ / ghi chú
            <input className="sl-in" value={form.note} placeholder="Chuyển khoản · UNC 123 · đợt 2"
              onChange={e => set('note', e.target.value)} /></label>
        </div>
      </section>
    )
  }
  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Thanh toán của khách</h3>
        <span>Tiền thu được trừ vào khoản có hạn cũ nhất trước, ở màn Dòng tiền</span>
        <div className="group-ctrl">
          <button className="primary"
            onClick={() => setForm({ cust: db.customers[0]?.code || '', d: today(), amount: 0, note: '' })}>
            + Ghi nhận thanh toán</button>
        </div>
      </div>
      <table className="sl-tb">
        <thead><tr><th>Ngày</th><th>Khách</th><th className="num">Số tiền</th><th>Ghi chú</th><th /></tr></thead>
        <tbody>
          {db.payments.map(p => (
            <tr key={p.id}>
              <td className="sm">{p.d}</td>
              <td className="sm" title={custName[p.cust]}>{tenNgan(custName[p.cust], p.cust)}</td>
              <td className="num b">{vnd(p.amount)}</td>
              <td className="sm">{p.note || '—'}</td>
              <td className="sl-row-act">
                <button className="del" disabled={busy}
                  onClick={() => confirm('Xoá khoản thanh toán này?') && onDel(p.id)}>Xoá</button></td>
            </tr>
          ))}
          {!db.payments.length && <tr><td colSpan={5} className="sl-empty">Chưa ghi nhận khoản nào.</td></tr>}
        </tbody>
      </table>
    </section>
  )
}
