import { useEffect, useMemo, useState } from 'react'
import master from '../data/master'
import arFile from '../data/receivable.json'
import { saveCustomer, saveSupplier, fetchSales, deviceName } from '../lib/cloud'
import './sales.css'

/* ============================================================
   DANH MỤC KHÁCH HÀNG & NHÀ CUNG CẤP
   Hai bảng nền dùng chung cho màn Bán hàng và màn Dòng tiền.
   Số ngày công nợ và thuế suất khai ở đây quyết định hạn thu và
   số phải thu của MỌI phiếu xuất — sửa ở đây là đổi toàn hệ thống.
   ============================================================ */

const TABS = [['kh', '◉', 'Khách hàng'], ['ncc', '⌂', 'Nhà cung cấp']]

export default function Catalog() {
  const [tab, setTab] = useState('kh')
  const [db, setDb] = useState(() => ({
    customers: arFile.customers || [], deliveries: arFile.deliveries || [],
    payments: arFile.payments || [], suppliersExtra: arFile.suppliersExtra || [],
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
          <h2>Danh mục khách hàng &amp; nhà cung cấp</h2>
          <p>
            Hai bảng nền của hệ thống. Khai ở đây một lần, màn Bán hàng và màn Dòng tiền
            dùng lại — khỏi gõ tên và điều khoản công nợ lặp lại từng phiếu.
          </p>
        </div>
        <div className="sl-acts">
          <button className="btn-ghost" onClick={nap} disabled={busy}>⟳ Tải lại</button>
          <span className="sl-dev">Máy: {deviceName()}</span>
        </div>
      </div>

      <div className="mk-tabbar">
        <div className="mk-tabs">
          {TABS.map(([id, ic, lb]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setForm(null) }}>
              <span className="ic" aria-hidden>{ic}</span>{lb}
              <em>{id === 'kh' ? db.customers.length
                : master.suppliers.length + (db.suppliersExtra || []).length}</em>
            </button>
          ))}
        </div>
      </div>

      {msg && <div className={`cf-msg t-${msg.t}`}>{msg.s}</div>}

      {tab === 'kh' && (
        <KhTab db={db} form={form} setForm={setForm} busy={busy}
          onSave={p => lam(() => saveCustomer(p), `Đã lưu khách ${p.code}.`)} />
      )}
      {tab === 'ncc' && (
        <NccTab db={db} form={form} setForm={setForm} busy={busy}
          onSave={p => lam(() => saveSupplier(p), `Đã lưu NCC ${p.code}.`)} />
      )}
    </div>
  )
}

/* ================= DANH MỤC KHÁCH ================= */
function KhTab({ db, form, setForm, busy, onSave }) {
  /* Công nợ hiện tại của từng khách — để biết khách nào đang nợ trước khi sửa
     điều khoản thanh toán của họ. */
  const no = useMemo(() => {
    const m = {}
    for (const c of db.customers || []) {
      const v = (db.deliveries || []).filter(x => x.cust === c.code)
      const phai = v.reduce((a, x) => a + x.amount + Math.round(x.amount * (c.vat_rate ?? 0.08)), 0)
      const tra = (db.payments || []).filter(x => x.cust === c.code).reduce((a, x) => a + x.amount, 0)
      m[c.code] = { sophieu: v.length, con: phai - tra }
    }
    return m
  }, [db])

  if (form) {
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
    return (
      <section className="m2-panel">
        <div className="m2-head">
          <h3>{form.moi ? 'Khách hàng mới' : `Sửa ${form.code}`}</h3>
          <div className="group-ctrl">
            <button onClick={() => setForm(null)}>Huỷ</button>
            <button className="primary" disabled={!form.code?.trim() || !form.name?.trim() || busy}
              onClick={() => onSave({
                code: form.code.trim(), name: form.name.trim(), mst: form.mst || null,
                addr: form.addr || null, phone: form.phone || null, email: form.email || null,
                term_days: +form.term_days || 30, vat_rate: (+form.vat_pct || 8) / 100,
                note: form.note || null, active: form.active !== false,
              })}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
          </div>
        </div>
        <div className="sl-form">
          <label>Mã khách<input className="sl-in" value={form.code || ''} disabled={!form.moi}
            placeholder="KNTH" onChange={e => set('code', e.target.value)} /></label>
          <label className="wide">Tên công ty<input className="sl-in" value={form.name || ''}
            onChange={e => set('name', e.target.value)} /></label>
          <label>Mã số thuế<input className="sl-in" value={form.mst || ''}
            onChange={e => set('mst', e.target.value)} /></label>
          <label>Số ngày công nợ<input className="sl-in num" type="number" min="0" value={form.term_days ?? 30}
            onChange={e => set('term_days', e.target.value)} /></label>
          <label>Thuế GTGT (%)<input className="sl-in num" type="number" min="0" max="20" step="0.5"
            value={form.vat_pct ?? 8} onChange={e => set('vat_pct', e.target.value)} /></label>
          <label>Điện thoại<input className="sl-in" value={form.phone || ''}
            onChange={e => set('phone', e.target.value)} /></label>
          <label>Email<input className="sl-in" value={form.email || ''}
            onChange={e => set('email', e.target.value)} /></label>
          <label className="wide">Địa chỉ<input className="sl-in" value={form.addr || ''}
            onChange={e => set('addr', e.target.value)} /></label>
          <label className="wide">Ghi chú<input className="sl-in" value={form.note || ''}
            onChange={e => set('note', e.target.value)} /></label>
        </div>
      </section>
    )
  }
  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Danh mục khách hàng</h3>
        <span>Số ngày công nợ và thuế suất ở đây quyết định hạn thu và số phải thu của mọi phiếu xuất</span>
        <div className="group-ctrl">
          <button className="primary" onClick={() => setForm({ moi: true, term_days: 30, vat_pct: 8, active: true })}>
            + Khách hàng mới</button>
        </div>
      </div>
      <table className="sl-tb">
        <thead><tr><th>Mã</th><th>Tên công ty</th><th>MST</th>
          <th className="num">Điều khoản</th><th className="num">VAT</th>
          <th className="num">Phiếu xuất</th><th className="num">Đang nợ</th><th /></tr></thead>
        <tbody>
          {db.customers.map(c => (
            <tr key={c.code}>
              <td><b>{c.code}</b></td>
              <td className="sm">{c.name}</td>
              <td className="sm">{c.mst || '—'}</td>
              <td className="num">{c.term_days} ngày</td>
              <td className="num">{((c.vat_rate ?? 0.08) * 100).toFixed(0)}%</td>
              <td className="num">{no[c.code]?.sophieu || 0}</td>
              <td className="num b">{no[c.code]?.con
                ? new Intl.NumberFormat('vi-VN').format(no[c.code].con)
                : <span className="dim">0</span>}</td>
              <td className="sl-row-act">
                <button onClick={() => setForm({ ...c, vat_pct: (c.vat_rate ?? 0.08) * 100 })}>Sửa</button></td>
            </tr>
          ))}
          {!db.customers.length && <tr><td colSpan={8} className="sl-empty">Chưa có khách nào.</td></tr>}
        </tbody>
      </table>
    </section>
  )
}

/* ================= DANH MỤC NCC ================= */
function NccTab({ db, form, setForm, busy, onSave }) {
  const tuMaster = master.suppliers.map(s => ({ ...s, nguon: 'Master Data' }))
  const themTay = db.suppliersExtra.map(s => ({ ...s, nguon: 'Thêm trong app' }))
  const all = [...tuMaster, ...themTay.filter(x => !tuMaster.some(m => m.code === x.code))]

  if (form) {
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
    return (
      <section className="m2-panel">
        <div className="m2-head">
          <h3>{form.moi ? 'Nhà cung cấp mới' : `Sửa ${form.code}`}</h3>
          <div className="group-ctrl">
            <button onClick={() => setForm(null)}>Huỷ</button>
            <button className="primary" disabled={!form.code?.trim() || !form.name?.trim() || busy}
              onClick={() => onSave({
                code: form.code.trim(), name: form.name.trim(), mst: form.mst || null,
                phone: form.phone || null, email: form.email || null, addr: form.addr || null,
                term_days: form.term_days ? +form.term_days : null,
                note: form.note || null, active: form.active !== false,
              })}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
          </div>
        </div>
        <div className="sl-form">
          <label>Mã NCC<input className="sl-in" value={form.code || ''} disabled={!form.moi}
            placeholder="SUVN0006" onChange={e => set('code', e.target.value)} /></label>
          <label className="wide">Tên<input className="sl-in" value={form.name || ''}
            onChange={e => set('name', e.target.value)} /></label>
          <label>Mã số thuế<input className="sl-in" value={form.mst || ''}
            onChange={e => set('mst', e.target.value)} /></label>
          <label>Số ngày công nợ<input className="sl-in num" type="number" min="0" value={form.term_days ?? ''}
            onChange={e => set('term_days', e.target.value)} /></label>
          <label>Điện thoại<input className="sl-in" value={form.phone || ''}
            onChange={e => set('phone', e.target.value)} /></label>
          <label>Email<input className="sl-in" value={form.email || ''}
            onChange={e => set('email', e.target.value)} /></label>
          <label className="wide">Địa chỉ<input className="sl-in" value={form.addr || ''}
            onChange={e => set('addr', e.target.value)} /></label>
        </div>
        <p className="sl-note">
          NCC thêm ở đây nằm trong app, <b>không</b> ghi ngược vào file Master Data. Muốn nó có
          trong dữ liệu mua hàng và công nợ thì vẫn phải khai ở Master Data rồi tải lại.
        </p>
      </section>
    )
  }
  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Danh mục nhà cung cấp</h3>
        <span>Gồm NCC từ Master Data và NCC thêm trong app</span>
        <div className="group-ctrl">
          <button className="primary" onClick={() => setForm({ moi: true, active: true })}>
            + Nhà cung cấp mới</button>
        </div>
      </div>
      <table className="sl-tb">
        <thead><tr><th>Mã</th><th>Tên</th><th>MST</th><th className="num">Điều khoản</th>
          <th>Nguồn</th><th /></tr></thead>
        <tbody>
          {all.map(s => (
            <tr key={s.code}>
              <td><b>{s.code}</b></td>
              <td className="sm">{s.name}</td>
              <td className="sm">{s.mst || '—'}</td>
              <td className="num">{s.paymentTerms ?? s.term_days ?? '—'}{(s.paymentTerms ?? s.term_days) ? ' ngày' : ''}</td>
              <td className="sm"><span className={`sl-tag ${s.nguon === 'Master Data' ? 'mid' : 'on'}`}>{s.nguon}</span></td>
              <td className="sl-row-act">
                {s.nguon === 'Thêm trong app'
                  ? <button onClick={() => setForm({ ...s })}>Sửa</button>
                  : <span className="dim sm">sửa ở Master Data</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
