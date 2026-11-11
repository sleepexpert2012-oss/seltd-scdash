import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import {
  fetchFcSnapshots, fetchFcLines, createFcSnapshot, saveFcLines, lockFcSnapshot, cloneFcSnapshot, delFcSnapshot,
} from '../lib/cloud'
import { SCENARIOS, HIT_BAND, buildLines, summarize, leadTimeFor, accuracy, LAST_FULL_YM } from '../lib/fcSnap'
import { SKU_MAP } from '../lib/metrics'
import './pnl.css'
import './costnorm.css'
import './fcsnap.css'

/* ============================================================
   HAI TAB MỚI CỦA MÀN FORECAST
   · "Bản dự báo"       đóng băng kết quả dự báo thành bản có tên, sửa được khi
                         còn nháp, CHỐT thì chỉ đọc vĩnh viễn (khoá ở database).
   · "Đối chiếu dự báo" đo bản đã chốt đúng/sai so với thực tế: WAPE, bias, tỷ lệ
                         trúng, so với cách đoán ngây thơ, quy sai lệch ra tiền.
   Không có thuật toán dự báo mới — xem src/lib/fcSnap.js.
   ============================================================ */

const C = { navy: '#232A6B', blue: '#353E99', soft: '#A9AFE0', bad: '#B42318', good: '#1F7A45', amber: '#D97706', grid: '#E7E9F3', axis: '#8E93B5' }
const PIE = ['#232A6B', '#353E99', '#5C67C4', '#8E96DC', '#D97706', '#C9CDE0']
const nf = d => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d })
const tr = v => `${nf(1).format((v || 0) / 1e6)} tr`
const pc = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${nf(d).format(v * 100)}%`)
const ymTxt = ym => `T${+ym.slice(5)}/${ym.slice(2, 4)}`
const fmtTime = s => (s ? new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

function useSnaps() {
  const [st, setSt] = useState({ ok: null, rows: [] })
  const load = () => fetchFcSnapshots().then(setSt).catch(e => setSt({ ok: false, rows: [], err: String(e.message || e) }))
  useEffect(() => { load() }, [])
  return [st, load]
}

function NoTable() {
  return (
    <section className="m2-panel pp-empty">
      <h3>Chưa có bảng lưu bản dự báo trên Supabase</h3>
      <p>
        Cần chạy <code>scripts/shopee/schema_fc.sql</code> (tạo bảng <code>fc_snapshot</code>, <code>fc_snapshot_line</code> và khoá
        "đã chốt là chỉ đọc" ở database). Xem trước bản sẽ tạo thì vẫn được ở bên dưới — chỉ chưa lưu.
      </p>
    </section>
  )
}

/* =====================================================================
   TAB BẢN DỰ BÁO
   ===================================================================== */
export function SnapTab() {
  const [st, load] = useSnaps()
  const [sel, setSel] = useState(null)
  const [lines, setLines] = useState(null)
  const [edit, setEdit] = useState({})          // `${sku}|${ym}` → qty ; `${sku}|price` → giá
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [q, setQ] = useState('')

  const snap = st.rows.find(r => r.id === sel)
  useEffect(() => { if (sel == null && st.rows.length) setSel(st.rows[0].id) }, [st.rows])
  useEffect(() => {
    setEdit({}); setLines(null)
    if (sel != null) fetchFcLines(sel).then(setLines).catch(e => setMsg({ t: 'bad', s: e.message }))
  }, [sel])

  /* xem trước khi chưa có bảng hoặc đang mở form tạo */
  const preview = useMemo(() => {
    const sc = form?.scenario || 'co_so'
    return buildLines(form ? Number(form.factor) || 1 : SCENARIOS[sc][1])
  }, [form?.factor, form?.scenario])

  const view = useMemo(() => {
    const base = form || st.ok === false || !snap ? preview.lines : (lines || [])
    return base.map(l => ({
      ...l, qty: edit[`${l.sku}|${l.ym}`] ?? Number(l.qty), price: edit[`${l.sku}|price`] ?? Number(l.price),
      qty_calc: Number(l.qty_calc), cost: Number(l.cost),
    }))
  }, [form, st.ok, snap, preview, lines, edit])
  const S = useMemo(() => summarize(view), [view])
  const yms = [...new Set(view.map(l => l.ym))].sort()
  const draft = snap?.status === 'draft' && !form
  const nEdit = Object.keys(edit).length

  async function run(fn, ok) {
    setBusy(true); setMsg(null)
    try { const r = await fn(); await load(); if (ok) setMsg({ t: 'ok', s: typeof ok === 'function' ? ok(r) : ok }) ; return r }
    catch (e) { setMsg({ t: 'bad', s: `Không thực hiện được: ${e.message}` }) }
    finally { setBusy(false) }
  }

  const create = () => run(async () => {
    const id = await createFcSnapshot({
      name: form.name.trim(), scenario: form.scenario, factor: Number(form.factor),
      from_ym: preview.from, to_ym: preview.to, note: form.note || null,
    }, preview.lines)
    setForm(null); setSel(Number(id)); return id
  }, () => `Đã tạo bản nháp "${form.name}" (${preview.lines.length} dòng). Sửa nếu cần rồi bấm Chốt.`)

  const saveEdits = () => run(async () => {
    const cells = Object.entries(edit).map(([k, v]) => {
      const [sku, ym] = k.split('|')
      return ym === 'price' ? { sku, price: v } : { sku, ym, qty: v }
    })
    await saveFcLines(sel, cells)
    setLines(await fetchFcLines(sel)); setEdit({})
  }, `Đã lưu ${nEdit} thay đổi.`)

  const lock = () => {
    if (nEdit) { setMsg({ t: 'warn', s: 'Còn thay đổi chưa lưu — lưu hoặc bỏ trước khi chốt.' }); return }
    if (!window.confirm(`Chốt bản "${snap.name}"? Sau khi chốt bản này CHỈ ĐỌC vĩnh viễn — muốn đổi phải nhân bản.`)) return
    run(() => lockFcSnapshot(sel), `Đã chốt "${snap.name}". Bản này giờ dùng để đo sai số ở tab Đối chiếu dự báo.`)
  }
  const clone = () => run(async () => {
    const id = await cloneFcSnapshot(sel, `${snap.name} (bản sao)`); setSel(Number(id)); return id
  }, 'Đã nhân bản thành bản nháp mới.')
  const del = () => {
    if (!window.confirm(`Xoá bản nháp "${snap.name}"?`)) return
    run(async () => { await delFcSnapshot(sel); setSel(null) }, 'Đã xoá bản nháp.')
  }

  const skuRows = useMemo(() => {
    const by = {}
    for (const l of view) (by[l.sku] = by[l.sku] || { sku: l.sku, price: l.price, cells: {} }).cells[l.ym] = l
    const t = q.trim().toLowerCase()
    return Object.values(by)
      .filter(r => !t || r.sku.toLowerCase().includes(t) || (SKU_MAP[r.sku]?.name || '').toLowerCase().includes(t))
      .sort((a, b) => Object.values(b.cells).reduce((s, l) => s + l.qty, 0) - Object.values(a.cells).reduce((s, l) => s + l.qty, 0))
  }, [view, q])
  const lt = S.peak ? leadTimeFor(view, S.peak.ym) : null
  const hanVe = S.peak && lt ? (() => { const d = new Date(`${S.peak.ym}-01T00:00:00Z`); d.setUTCDate(d.getUTCDate() - Math.round(lt)); return d.toISOString().slice(0, 10) })() : null

  return (
    <div className="fs-wrap">
      {st.ok === false && <NoTable />}
      {msg && <div className={`cf-msg t-${msg.t}`}>{msg.s}</div>}

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Danh sách bản dự báo</h3>
          <span>Bản nháp sửa được · bản đã chốt chỉ đọc và dùng để đo sai số</span>
        </div>
        {st.ok && (
          <table className="pl-table fs-list">
            <thead><tr><th>Tên</th><th>Kịch bản</th><th>Kỳ</th><th>Trạng thái</th><th>Tạo</th><th>Chốt</th></tr></thead>
            <tbody>
              {st.rows.map(r => (
                <tr key={r.id} className={r.id === sel && !form ? 'sel' : ''} onClick={() => { setForm(null); setSel(r.id) }}>
                  <td><b>{r.name}</b></td>
                  <td>{SCENARIOS[r.scenario]?.[0]} × {nf(2).format(r.factor)}</td>
                  <td>{ymTxt(r.from_ym)} → {ymTxt(r.to_ym)}</td>
                  <td><span className={`sl-tag ${r.status === 'locked' ? 'on' : 'mid'}`}>{r.status === 'locked' ? 'Đã chốt' : 'Đang soạn'}</span></td>
                  <td className="sm">{r.created_by} · {fmtTime(r.created_at)}</td>
                  <td className="sm">{r.locked_at ? `${r.locked_by} · ${fmtTime(r.locked_at)}` : '—'}</td>
                </tr>
              ))}
              {!st.rows.length && <tr><td colSpan={6} className="pl-empty">Chưa có bản nào — tạo bản đầu tiên.</td></tr>}
            </tbody>
          </table>
        )}
        <div className="fs-acts">
          {!form && <button className="btn-primary" disabled={busy || st.ok === false}
            onClick={() => setForm({ name: `Dự báo ${ymTxt(preview.from)}–${ymTxt(preview.to)} · Cơ sở`, scenario: 'co_so', factor: 1, note: '' })}>+ Tạo bản mới</button>}
          {snap && !form && <button className="pp-btn" disabled={busy} onClick={clone}>⧉ Nhân bản</button>}
          {draft && <button className="pp-btn" disabled={busy} onClick={del}>Xoá nháp</button>}
          {draft && <button className="pp-btn" disabled={busy || !nEdit} onClick={() => setEdit({})}>Bỏ thay đổi</button>}
          {draft && <button className="pp-btn" disabled={busy || !nEdit} onClick={saveEdits}>{nEdit ? `Lưu ${nEdit} thay đổi` : 'Đã lưu'}</button>}
          {draft && <button className="btn-primary" disabled={busy} onClick={lock}>🔒 Chốt bản này</button>}
        </div>
        {form && (
          <div className="bg-form fs-form">
            <h4>Tạo bản dự báo mới — {ymTxt(preview.from)} → {ymTxt(preview.to)}</h4>
            <div className="sl-form">
              <label className="wide">Tên<input className="sl-in" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></label>
              <label>Kịch bản
                <select className="sl-in" value={form.scenario}
                  onChange={e => setForm(f => ({ ...f, scenario: e.target.value, factor: SCENARIOS[e.target.value][1],
                    name: f.name.replace(/· (Thấp|Cơ sở|Cao)$/, `· ${SCENARIOS[e.target.value][0]}`) }))}>
                  {Object.entries(SCENARIOS).map(([k, [lb]]) => <option key={k} value={k}>{lb}</option>)}
                </select>
              </label>
              <label>Hệ số nhân<input className="sl-in num" value={form.factor} onChange={e => setForm(f => ({ ...f, factor: e.target.value.replace(',', '.') }))} /></label>
              <label className="wide">Ghi chú<input className="sl-in" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></label>
            </div>
            <p className="bg-note">
              Số lượng = dự báo 6 tháng tới hiện tại × hệ số. Hệ số Thấp 0,85 / Cao 1,15 là <b>giả định</b> — sửa được.
              Giá bán = giá thuần bình quân 3 tháng gần nhất của từng SKU; giá vốn lấy từ Master Data lúc tạo.
            </p>
            <div className="bg-form-act">
              <button className="btn-ghost" onClick={() => setForm(null)}>Huỷ</button>
              <button className="btn-primary" disabled={busy || !form.name.trim() || !(Number(form.factor) > 0) || st.ok === false} onClick={create}>Tạo bản nháp</button>
            </div>
          </div>
        )}
      </section>

      {(view.length > 0) && (
        <>
          <div className="mk-verdict grey">
            <b>Vậy thì sao</b>
            <p>
              {form || st.ok === false || !snap ? 'Xem trước bản sẽ tạo: ' : `Bản "${snap.name}": `}
              doanh thu thuần dự kiến <strong>{tr(S.rev)}</strong> trong {yms.length} tháng, lợi nhuận gộp {tr(S.gp)} ({pc(S.gm)}).
              {S.peak && S.low && <> Đỉnh mùa vụ ở <strong>{ymTxt(S.peak.ym)}</strong> ({tr(S.peak.rev)}), gấp {nf(1).format(S.peak.rev / Math.max(1, S.low.rev))} lần tháng thấp nhất ({ymTxt(S.low.ym)}).</>}
              {hanVe && (() => {
                const hom = new Date().toISOString().slice(0, 10)
                const tre = Math.round((Date.parse(`${hom}T00:00:00Z`) - Date.parse(`${hanVe}T00:00:00Z`)) / 864e5)
                const d = hanVe.split('-').reverse().join('/')
                return tre > 0
                  ? <> Lead time bình quân {nf(0).format(lt)} ngày → muốn đủ hàng cho đầu tháng đỉnh thì phải đặt trước <strong>{d}</strong> — <strong>đã trễ {tre} ngày</strong>; đặt ngay hôm nay thì hàng về khoảng giữa/cuối tháng đỉnh.</>
                  : <> Lead time bình quân {nf(0).format(lt)} ngày → phải đặt hàng cho tháng đỉnh trước <strong>{d}</strong> (còn {-tre} ngày).</>
              })()}
              {S.edited ? ` ${S.edited} ô đã sửa tay so với số máy tính.` : ''}
            </p>
          </div>

          <div className="mk-kpis cn-kpis">
            <div className="mk-kpi"><span className="k">Doanh thu thuần dự kiến</span><strong>{tr(S.rev)}</strong><span className="sub">{yms.length} tháng · {S.noPrice.length ? `⚠ ${S.noPrice.length} SKU chưa có giá` : 'đủ giá bán'}</span></div>
            <div className="mk-kpi"><span className="k">Giá vốn dự kiến</span><strong>{tr(S.cogs)}</strong><span className="sub">{S.noCost.length ? `⚠ ${S.noCost.length} SKU chưa có giá vốn` : 'đủ giá vốn'}</span></div>
            <div className="mk-kpi good"><span className="k">Lợi nhuận gộp</span><strong>{tr(S.gp)}</strong><span className="sub">biên gộp {pc(S.gm)}</span></div>
            <div className="mk-kpi"><span className="k">Sản lượng</span><strong>{nf(0).format(S.months.reduce((s, m) => s + m.qty, 0))}</strong><span className="sub">sản phẩm · {skuRows.length} SKU</span></div>
          </div>

          <div className="pl-row2 fs-row2">
            <section className="m2-panel">
              <div className="m2-head"><h3>Doanh thu &amp; lợi nhuận gộp theo tháng</h3><span>triệu đồng — thấy mùa vụ</span></div>
              <ResponsiveContainer width="100%" height={230}>
                <ComposedChart data={S.months.map(m => ({ lb: ymTxt(m.ym), dt: m.rev / 1e6, gp: (m.rev - m.cogs) / 1e6 }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="lb" tick={{ fontSize: 10, fill: C.axis }} />
                  <YAxis tick={{ fontSize: 10, fill: C.axis }} width={44} />
                  <Tooltip formatter={(v, n) => [`${nf(1).format(v)} tr`, n]} />
                  <Legend verticalAlign="top" align="left" height={26} iconSize={10} wrapperStyle={{ fontSize: 10.5 }} />
                  <Bar dataKey="dt" name="Doanh thu thuần" fill={C.blue} radius={[2, 2, 0, 0]} />
                  <Line dataKey="gp" name="Lợi nhuận gộp" stroke={C.good} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2.5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </section>
            <section className="m2-panel">
              <div className="m2-head"><h3>Ngành nào kéo doanh thu</h3><span>tỷ trọng doanh thu dự kiến</span></div>
              <div className="cn-mix">
                <ResponsiveContainer width="50%" height={210}>
                  <PieChart><Pie data={S.nganh} dataKey="v" nameKey="k" innerRadius={50} outerRadius={85} paddingAngle={1}>
                    {S.nganh.map((d, i) => <Cell key={d.k} fill={PIE[i % PIE.length]} />)}
                  </Pie><Tooltip formatter={v => tr(v)} /></PieChart>
                </ResponsiveContainer>
                <ul>{S.nganh.map((d, i) => <li key={d.k}><i style={{ background: PIE[i % PIE.length] }} />{d.k}<b>{pc(d.v / (S.rev || 1), 0)}</b><span>{tr(d.v)}</span></li>)}</ul>
              </div>
              <h4 className="fs-h4">7 SKU đứng đầu</h4>
              <ol className="fs-top">{S.top.map(t => <li key={t.sku}><span>{t.sku} · {SKU_MAP[t.sku]?.name || ''}</span><b>{tr(t.rev)}</b></li>)}</ol>
            </section>
          </div>

          <section className="m2-panel">
            <div className="m2-head">
              <h3>Số lượng theo SKU × tháng {draft ? '— sửa trực tiếp' : snap?.status === 'locked' ? '— đã chốt, chỉ đọc' : ''}</h3>
              <span>
                <input className="fs-q" placeholder="Tìm SKU / tên" value={q} onChange={e => setQ(e.target.value)} />
                {' '}ô viền vàng = đã sửa tay (rê chuột xem số máy tính)
              </span>
            </div>
            <div className="pp-wrap fs-grid">
              <table className="pl-table">
                <thead><tr><th>SKU</th><th className="num">Giá bán</th>{yms.map(ym => <th key={ym} className="num">{ymTxt(ym)}</th>)}<th className="num">Tổng SL</th><th className="num">Doanh thu</th></tr></thead>
                <tbody>
                  {skuRows.map(r => {
                    const tot = yms.reduce((s, ym) => s + (r.cells[ym]?.qty || 0), 0)
                    return (
                      <tr key={r.sku}>
                        <td className="lbl" title={SKU_MAP[r.sku]?.name}><b>{r.sku}</b><small>{(SKU_MAP[r.sku]?.name || '').slice(0, 42)}</small></td>
                        <td className="num">{draft
                          ? <input className={`fs-in ${edit[`${r.sku}|price`] != null ? 'dirty' : ''}`} defaultValue={Math.round(r.price)}
                              onBlur={e => { const v = Number(String(e.target.value).replace(/[^\d]/g, '')); if (v !== Math.round(r.price)) setEdit(x => ({ ...x, [`${r.sku}|price`]: v })) }} />
                          : nf(0).format(r.price)}</td>
                        {yms.map(ym => {
                          const c = r.cells[ym]
                          if (!c) return <td key={ym} />
                          const changed = c.qty !== c.qty_calc
                          return (
                            <td key={ym} className="num">
                              {draft
                                ? <input className={`fs-in ${changed ? 'dirty' : ''}`} defaultValue={c.qty} title={`máy tính: ${c.qty_calc}`}
                                    onBlur={e => { const v = Number(String(e.target.value).replace(/[^\d.]/g, '')); if (Number.isFinite(v) && v !== c.qty) setEdit(x => ({ ...x, [`${r.sku}|${ym}`]: v })) }} />
                                : <span className={changed ? 'fs-chg' : ''} title={changed ? `máy tính: ${c.qty_calc}` : undefined}>{nf(0).format(c.qty)}</span>}
                            </td>
                          )
                        })}
                        <td className="num b">{nf(0).format(tot)}</td>
                        <td className="num">{nf(1).format(tot * r.price / 1e6)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

/* =====================================================================
   TAB ĐỐI CHIẾU DỰ BÁO
   ===================================================================== */
export function MatchTab() {
  const [st] = useSnaps()
  const locked = st.rows.filter(r => r.status === 'locked')
  const [sel, setSel] = useState(null)
  const [lines, setLines] = useState(null)
  const [open, setOpen] = useState({})
  const id = sel ?? locked[0]?.id
  const snap = locked.find(r => r.id === id)
  useEffect(() => { setLines(null); if (id != null) fetchFcLines(id).then(setLines).catch(() => setLines([])) }, [id])
  const R = useMemo(() => (snap && lines ? accuracy(snap, lines.map(l => ({ ...l, qty: Number(l.qty), price: Number(l.price), cost: Number(l.cost) }))) : null), [snap, lines])

  if (st.ok === false) return <NoTable />
  if (st.ok == null) return <section className="m2-panel"><p className="pl-empty">Đang tải…</p></section>
  if (!locked.length) {
    return (
      <section className="m2-panel pp-empty">
        <h3>Chưa có bản dự báo nào đã chốt</h3>
        <p>Chốt ít nhất một bản ở tab "Bản dự báo", rồi chờ hết ít nhất một tháng để có thực tế mà so. App không tạo bản chốt lùi ngày.</p>
      </section>
    )
  }
  return (
    <div className="fs-wrap">
      <section className="m2-panel">
        <div className="pp-bar">
          <label>Bản đã chốt
            <select value={id} onChange={e => setSel(Number(e.target.value))}>
              {locked.map(r => <option key={r.id} value={r.id}>{r.name} · chốt {fmtTime(r.locked_at)}</option>)}
            </select>
          </label>
          {R?.ready && <span className="cn-ver">So trên {R.months.map(ymTxt).join(', ')} — các tháng đã có thực tế trọn vẹn</span>}
        </div>
        <p className="pp-scope">Thực tế = sản lượng bán thuần trên <b>Shopee</b> — đúng phạm vi dữ liệu mà dự báo học từ đó.</p>
      </section>

      {R && !R.ready && (
        <div className="pl-warn soft">
          <b>Bản này chưa có tháng nào có thực tế trọn vẹn</b>
          <p>Kỳ dự báo {ymTxt(snap.from_ym)} → {ymTxt(snap.to_ym)}; tháng thực tế đủ gần nhất là {LAST_FULL_YM ? ymTxt(LAST_FULL_YM) : '—'}. Quay lại sau khi hết tháng {ymTxt(snap.from_ym)}.</p>
        </div>
      )}

      {R?.ready && (
        <>
          <div className={`mk-verdict ${R.fva == null ? 'grey' : R.fva > 0 ? 'green' : 'red'}`}>
            <b>Vậy thì sao</b>
            <p>
              Sai số WAPE <strong>{pc(R.wape, 0)}</strong>, dự báo {R.bias > 0 ? 'CAO' : 'THẤP'} hơn thực tế {pc(Math.abs(R.bias), 0)} (bias).
              {R.fva != null && (R.fva > 0
                ? <> Tốt hơn cách đoán ngây thơ (bình quân 3 tháng) {nf(0).format(R.fva * 100)} điểm % — dự báo đang có giá trị.</>
                : <> <strong>Kém hơn cả cách đoán ngây thơ</strong> {nf(0).format(-R.fva * 100)} điểm % — cần xem lại hệ số ở tab "Phương pháp &amp; hệ số".</>)}
              {R.worst[0] && <> Lệch nhiều tiền nhất: {R.worst.slice(0, 3).map(w => `${w.sku} (${w.d > 0 ? `thừa ${nf(0).format(w.d)} sp, ${tr(w.thuaVon)} vốn nằm tồn` : `thiếu ${nf(0).format(-w.d)} sp, có thể mất ${tr(w.thieuDt)} doanh thu`})`).join('; ')}.</>}
            </p>
          </div>

          <div className="mk-kpis cn-kpis">
            <div className={`mk-kpi ${R.wape > 0.5 ? 'bad' : R.wape > 0.3 ? 'amber' : 'good'}`}><span className="k">WAPE</span><strong>{pc(R.wape, 0)}</strong><span className="sub">Σ|thực tế − dự báo| ÷ Σ thực tế, cấp SKU × tháng</span></div>
            <div className={`mk-kpi ${Math.abs(R.bias) > 0.15 ? 'bad' : ''}`}><span className="k">Bias</span><strong>{R.bias > 0 ? '+' : ''}{pc(R.bias, 0)}</strong><span className="sub">dương = dự báo cao hơn thực tế</span></div>
            <div className="mk-kpi"><span className="k">Tỷ lệ trúng</span><strong>{pc(R.hit, 0)}</strong><span className="sub">SKU lệch trong ±{pc(HIT_BAND, 0)} · {R.nSku} SKU</span></div>
            <div className={`mk-kpi ${R.fva == null ? '' : R.fva > 0 ? 'good' : 'bad'}`}><span className="k">Giá trị gia tăng của dự báo</span><strong>{R.fva == null ? '—' : `${R.fva > 0 ? '+' : ''}${nf(0).format(R.fva * 100)} đ%`}</strong><span className="sub">WAPE ngây thơ {pc(R.wapeNaive, 0)} − WAPE bản chốt</span></div>
          </div>

          <section className="m2-panel">
            <div className="m2-head"><h3>Theo ngành → SKU</h3><span>bấm tên ngành để mở · hậu quả quy ra tiền</span></div>
            <div className="pp-wrap">
              <table className="pl-table pp-table">
                <thead><tr><th>Ngành / SKU</th><th className="num">Dự báo</th><th className="num">Thực tế</th><th className="num">Lệch SL</th><th className="num">Lệch %</th><th className="num">WAPE</th><th className="num">Vốn nằm tồn (thừa)</th><th className="num">DT có thể mất (thiếu)</th></tr></thead>
                <tbody>
                  {R.byNg.map(g => (
                    <Fragment key={g.k}>
                      <tr className="grp">
                        <td className="lbl"><button className="pp-tog" onClick={() => setOpen(o => ({ ...o, [g.k]: !o[g.k] }))}>{open[g.k] ? '▾' : '▸'} {g.k}</button></td>
                        <td className="num">{nf(0).format(g.f)}</td><td className="num">{nf(0).format(g.a)}</td>
                        <td className={`num ${g.f - g.a > 0 ? 'bad' : g.f - g.a < 0 ? 'good' : ''}`}>{g.f - g.a > 0 ? '+' : ''}{nf(0).format(g.f - g.a)}</td>
                        <td className="num">{g.a ? pc((g.f - g.a) / g.a, 0) : '—'}</td><td className="num">{g.a ? pc(g.abs / g.a, 0) : '—'}</td>
                        <td className="num">{g.thuaVon ? tr(g.thuaVon) : '—'}</td><td className="num">{g.thieuDt ? tr(g.thieuDt) : '—'}</td>
                      </tr>
                      {open[g.k] && g.rows.sort((a, b) => (b.thuaVon + b.thieuDt) - (a.thuaVon + a.thieuDt)).map(r => (
                        <tr key={r.sku} className="child">
                          <td className="lbl" title={r.name}>{r.sku} <small className="fs-nm">{r.name.slice(0, 40)}</small>{r.hit ? <em className="pp-auto"> trúng</em> : null}</td>
                          <td className="num">{nf(0).format(r.f)}</td><td className="num">{nf(0).format(r.a)}</td>
                          <td className="num">{r.d > 0 ? '+' : ''}{nf(0).format(r.d)}</td>
                          <td className="num">{r.dPct == null ? 'mới bán' : pc(r.dPct, 0)}</td><td className="num">{r.a ? pc(r.abs / r.a, 0) : '—'}</td>
                          <td className="num">{r.thuaVon ? tr(r.thuaVon) : '—'}</td><td className="num">{r.thieuDt ? tr(r.thieuDt) : '—'}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="pl-note">
              "DT có thể mất" = SL thiếu × giá bán, CHƯA xác minh được là do hết hàng (app chưa có lịch sử tồn theo ngày) —
              có thể khách không mua chứ không phải thiếu hàng. Tháng hết hàng cũng làm thực tế thấp giả; chưa loại được vì lý do trên.
            </p>
          </section>

          {R.moi.length > 0 && (
            <section className="m2-panel">
              <div className="m2-head"><h3>SKU có bán nhưng không có trong bản chốt</h3><span>không tính vào WAPE · {R.moi.length} SKU</span></div>
              <ul className="fs-moi">{R.moi.slice(0, 20).map(m => <li key={m.sku}><b>{m.sku}</b> {m.name.slice(0, 50)} — {nf(0).format(m.q)} sp</li>)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
