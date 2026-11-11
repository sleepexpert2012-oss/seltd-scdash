import { useEffect, useMemo, useRef, useState } from 'react'
import arFile from '../data/receivable.json'
import {
  fetchFin, fetchSales, fetchCashflow, cashflowCache, fetchCfSetting, fetchFcSnapshots, fetchFcLines,
  fetchReports, saveReport, delReport, deviceName,
} from '../lib/cloud'
import { runInsights, NHOM } from '../lib/insights'
import { chayKeHoachTuan } from './Cashflow'
import { MONTHS } from '../lib/metrics'
import { ymList, LAST_FULL_YM, LAST_DATA_YM } from '../lib/fin'
import { xuatBang } from '../lib/xlsxBang'
import './pnl.css'
import './report.css'

/* ============================================================
   BÁO CÁO ĐIỀU HÀNH
   Trái: máy đọc số (bộ quy tắc tất định ở src/lib/insights.js — KHÔNG gọi AI).
   Phải: nhận định của người viết — máy không bao giờ ghi đè.
   Lưu: đóng băng nguyên các phát hiện lúc lưu (snapshot_json), nên báo cáo cũ
   không đổi khi dữ liệu mới về. In A4 / xuất Excel từ bản gộp.
   ============================================================ */

const CMP = [['prev', 'kỳ trước'], ['yoy', 'cùng kỳ năm trước'], ['kh', 'kế hoạch']]
const MUC = { canh_bao: ['Cảnh báo', 'bad'], luu_y: ['Lưu ý', 'mid'], tot: ['Tốt', 'good'] }
const LINK = { overview: 'Tổng quan', range: 'Range Review', pnl: 'Lãi lỗ', cashflow: 'Dòng tiền', costnorm: 'Định mức chi phí',
  breakeven: 'Điểm hòa vốn', marketing: 'Marketing', stock: 'Tồn kho', forecast: 'Forecast', sales: 'Bán hàng' }
const nf = d => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d })
const tr = v => (v == null ? '—' : Math.abs(v) < 1e9 ? `${v < 0 ? '−' : ''}${nf(1).format(Math.abs(v) / 1e6)} tr` : `${v < 0 ? '−' : ''}${nf(2).format(Math.abs(v) / 1e9)} tỷ`)
const trM = v => (v == null ? '—' : `${v < 0 ? '−' : ''}${nf(1).format(Math.abs(v) / 1e6)} tr`)
const fmtTime = s => (s ? new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/* Làm sạch HTML người dùng gõ: chỉ giữ b, i, u, ul, ol, li, p, br — bỏ mọi thuộc tính */
const OK_TAGS = new Set(['B', 'I', 'U', 'UL', 'OL', 'LI', 'P', 'BR'])
export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html')
  const walk = node => {
    let out = ''
    for (const n of node.childNodes) {
      if (n.nodeType === 3) out += n.textContent.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))
      else if (n.nodeType === 1) {
        const t = n.tagName === 'STRONG' ? 'B' : n.tagName === 'EM' ? 'I' : n.tagName === 'DIV' ? 'P' : n.tagName
        const inner = walk(n)
        if (OK_TAGS.has(t)) out += t === 'BR' ? '<br>' : `<${t.toLowerCase()}>${inner}</${t.toLowerCase()}>`
        else out += inner
      }
    }
    return out
  }
  return walk(doc.body.firstChild)
}
const plain = html => new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html').body.textContent.trim()

function periods(year) {
  const last = LAST_DATA_YM && +LAST_DATA_YM.slice(0, 4) === year ? +LAST_DATA_YM.slice(5) : 12
  const full = LAST_FULL_YM && +LAST_FULL_YM.slice(0, 4) === year ? +LAST_FULL_YM.slice(5) : last
  const yms = ymList(year)
  const out = []
  if (full >= 1) out.push([`ytd`, `Lũy kế T1–T${full}`, yms.slice(0, full)])
  for (let q = 1; q <= 4; q++) if ((q - 1) * 3 + 1 <= last) out.push([`q${q}`, `Quý ${q} (T${q * 3 - 2}–T${q * 3})`, yms.slice(q * 3 - 3, q * 3).filter((_, i) => q * 3 - 2 + i <= last)])
  for (let m = last; m >= 1; m--) out.push([`m${m}`, `Tháng ${m}${m > full ? ' (đang chạy)' : ''}`, [yms[m - 1]]])
  return out
}

export default function Report() {
  const years = [...new Set(MONTHS.map(m => +m.slice(0, 4)))].sort((a, b) => b - a)
  const [year, setYear] = useState(years[0])
  const [per, setPer] = useState('ytd')
  const [cmp, setCmp] = useState('prev')
  const [src, setSrc] = useState(null)          // dữ liệu nguồn đã tải
  const [res, setRes] = useState(null)          // kết quả phân tích đang hiển thị
  const [frozen, setFrozen] = useState(null)    // báo cáo đã lưu đang mở (số đóng băng)
  const [hidden, setHidden] = useState(new Set())
  const [grp, setGrp] = useState('all')
  const [name, setName] = useState('')
  const [docId, setDocId] = useState(null)
  const [reps, setReps] = useState({ ok: null, rows: [] })
  const [msg, setMsg] = useState(null)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const ed = useRef(null)

  const P = periods(year)
  const cur = P.find(p => p[0] === per) || P[0]

  useEffect(() => {
    (async () => {
      const [fin, ar, cf, quy, fcs] = await Promise.all([
        fetchFin().catch(() => null), fetchSales().catch(() => arFile),
        fetchCashflow().then(r => r.weeks).catch(() => cashflowCache() || {}),
        fetchCfSetting('quy_toi_thieu').catch(() => ({ ok: false })), fetchFcSnapshots().catch(() => ({ ok: false, rows: [] })),
      ])
      let quyMin = quy?.row ? Number(quy.row.value) : null
      if (quyMin == null) { try { quyMin = Number(localStorage.getItem('seltd_quy_toi_thieu')) || null } catch { /* bỏ qua */ } }
      const lock = (fcs.rows || []).find(r => r.status === 'locked')
      let fc = null
      if (lock) { try { fc = { snap: lock, lines: (await fetchFcLines(lock.id)).map(l => ({ ...l, qty: +l.qty, price: +l.price, cost: +l.cost })) } } catch { /* bỏ qua */ } }
      setSrc({ fin: fin || { lines: [], versions: [], plan: [], actual: [] }, ar, weeks: chayKeHoachTuan(cf), quyMin, fc })
    })()
    fetchReports().then(setReps).catch(() => setReps({ ok: false, rows: [] }))
  }, [])

  function phanTich() {
    if (!src || !cur) return
    const r = runInsights({ yms: cur[2], cmpMode: cmp, ...src, today: new Date().toISOString().slice(0, 10) })
    setRes({ ...r, at: new Date().toISOString(), from: cur[2][0], to: cur[2][cur[2].length - 1], cmpMode: cmp })
    setFrozen(null)
  }
  /* tự phân tích khi đổi kỳ — trừ khi đang mở bản đã lưu */
  useEffect(() => { if (!frozen) phanTich() }, [src, per, cmp, year])

  const view = frozen ? frozen.snapshot_json : res
  const list = (view?.phat_hien || []).filter(f => grp === 'all' || f.nhom === grp)
  const shown = (view?.phat_hien || []).filter(f => !hidden.has(f.id))

  function moBan(r) {
    setFrozen(r); setDocId(r.id); setName(r.name); setHidden(new Set(r.hidden_ids || [])); setCmp(r.compare)
    if (ed.current) ed.current.innerHTML = sanitize(r.note_html)
    setMsg({ t: 'warn', s: `Đang xem bản đã lưu lúc ${fmtTime(r.saved_at)} — số liệu ĐÓNG BĂNG. Bấm "Phân tích lại" để tính trên dữ liệu mới (giữ nguyên nhận định).` })
  }
  function moi() {
    setFrozen(null); setDocId(null); setName(''); setHidden(new Set()); if (ed.current) ed.current.innerHTML = ''; setMsg(null); phanTich()
  }

  async function luu() {
    if (!view) return
    const nm = name.trim() || `Báo cáo ${view.ky}`
    setBusy(true); setMsg(null)
    try {
      const id = await saveReport({
        id: docId, name: nm, period_from: view.from, period_to: view.to, compare: view.cmpMode || cmp,
        note_html: sanitize(ed.current?.innerHTML), hidden_ids: [...hidden], snapshot_json: view,
      })
      setDocId(Number(id)); setName(nm)
      setReps(await fetchReports())
      setMsg({ t: 'ok', s: `Đã lưu "${nm}" — số liệu được đóng băng tại thời điểm này.` })
    } catch (e) { setMsg({ t: 'bad', s: `CHƯA lưu được: ${e.message}` }) }
    finally { setBusy(false) }
  }
  async function xoa(r) {
    if (!window.confirm(`Xoá báo cáo "${r.name}"?`)) return
    try { await delReport(r.id); setReps(await fetchReports()); if (docId === r.id) moi() } catch (e) { setMsg({ t: 'bad', s: e.message }) }
  }
  const cmd = c => { ed.current?.focus(); document.execCommand(c) }

  function inA4() {
    setPreview(true)
    setTimeout(() => {
      document.body.classList.add('rp-printing')
      window.print()
      setTimeout(() => document.body.classList.remove('rp-printing'), 500)
    }, 150)
  }

  function excel() {
    if (!view) return
    xuatBang(`Bao-cao-dieu-hanh_${view.from}_${view.to}.xlsx`, [{
      name: 'Báo cáo', title: (name.trim() || `BÁO CÁO ĐIỀU HÀNH ${view.ky}`).toUpperCase(),
      sub: `Kỳ ${view.ky} · so với ${view.cmp} · số liệu tính lúc ${fmtTime(view.at)} · đơn vị đồng`,
      cols: [{ h: 'Mức độ', w: 11 }, { h: 'Nhóm', w: 20 }, { h: 'Phát hiện', w: 70, wrap: true }, { h: 'Vậy thì sao', w: 50, wrap: true }, { h: 'Làm gì', w: 50, wrap: true }, { h: 'Bằng chứng', w: 60, wrap: true }],
      rows: [
        { kind: 'group', cells: ['CHỈ SỐ', '', `Doanh thu ${view.the.dt ?? ''} đ · ${view.the.lnNhan} ${view.the.ln ?? ''} đ · Quỹ cuối kỳ ${view.the.quy ?? '—'} đ`, '', '', ''] },
        ...shown.map(f => ({
          kind: f.muc_do === 'canh_bao' ? 'bad' : f.muc_do === 'tot' ? 'good' : undefined,
          cells: [MUC[f.muc_do][0], NHOM[f.nhom], f.tieu_de, f.vay_thi_sao, f.hanh_dong, f.bang_chung.map(b => `${b.nhan}: ${b.gia_tri}`).join(' · ')],
        })),
        { kind: 'group', cells: ['NHẬN ĐỊNH', '', plain(ed.current?.innerHTML) || '(chưa viết)', '', '', ''] },
      ],
      notes: ['Phát hiện do phần mềm tính theo quy tắc cố định (src/lib/insights.js) — cùng dữ liệu luôn ra cùng câu.'],
    }])
  }

  const cnt = id => (view?.phat_hien || []).filter(f => f.nhom === id).length

  return (
    <div className="pl-page rp-page">
      <div className="m2-title rp-noprint">
        <div>
          <h2>Báo cáo điều hành</h2>
          <p>
            Máy đọc số và nêu phát hiện theo <b>quy tắc cố định</b> — cùng dữ liệu luôn ra cùng câu, không dùng AI.
            Người viết thêm nhận định của mình ở khung bên phải. Lưu lại thì số liệu được đóng băng; in A4 hoặc xuất Excel từ bản gộp.
          </p>
        </div>
      </div>

      <section className="m2-panel rp-noprint">
        <div className="pp-bar">
          <label>Năm<select value={year} onChange={e => { setYear(+e.target.value); setPer('ytd') }}>{years.map(y => <option key={y}>{y}</option>)}</select></label>
          <label>Kỳ báo cáo<select value={cur?.[0]} onChange={e => setPer(e.target.value)}>{P.map(([id, lb]) => <option key={id} value={id}>{lb}</option>)}</select></label>
          <label>So với<select value={cmp} onChange={e => setCmp(e.target.value)}>{CMP.map(([id, lb]) => <option key={id} value={id}>{lb}</option>)}</select></label>
          <span className="sp" />
          <input className="rp-name" placeholder="Tên báo cáo (vd: Báo cáo CEO quý 3)" value={name} onChange={e => setName(e.target.value)} />
          <button className="pp-btn" onClick={moi}>+ Mới</button>
          <button className="btn-primary rp-btn" disabled={busy || !view || reps.ok === false} title={reps.ok === false ? 'Chưa tạo bảng report_doc (scripts/shopee/schema_report.sql)' : ''} onClick={luu}>💾 Lưu</button>
          <button className="pp-btn" onClick={() => setPreview(p => !p)}>{preview ? 'Đóng bản gộp' : '👁 Xem bản gộp'}</button>
          <button className="pp-btn" onClick={inA4}>🖨 In A4</button>
          <button className="pp-btn" onClick={excel}>⬇ Excel</button>
        </div>
        {reps.ok === false && <p className="pp-scope">Chưa lưu được báo cáo: bảng <code>report_doc</code> chưa tạo (<code>scripts/shopee/schema_report.sql</code>). Phân tích, in và xuất Excel vẫn dùng được.</p>}
        {reps.ok && reps.rows.length > 0 && (
          <div className="rp-saved">
            <span>Đã lưu:</span>
            {reps.rows.map(r => (
              <span key={r.id} className={`rp-chip ${docId === r.id ? 'on' : ''}`}>
                <button onClick={() => moBan(r)} title={`${r.saved_by} · ${fmtTime(r.saved_at)}`}>{r.name}</button>
                <i onClick={() => xoa(r)} title="Xoá">×</i>
              </span>
            ))}
          </div>
        )}
      </section>

      {msg && <div className={`cf-msg t-${msg.t} rp-noprint`}>{msg.s}</div>}

      {!view && <section className="m2-panel"><p className="pl-empty">Đang tải dữ liệu và phân tích…</p></section>}

      {view && (
        <div className={`rp-grid ${preview ? 'hide' : ''}`}>
          <section className="m2-panel rp-ai">
            <div className="rp-h"><span>✦ Máy đọc số</span><em>kỳ {view.ky} · so với {view.cmp}</em></div>
            <Cards the={view.the} />
            <div className="rp-filter">
              <span>Nhận xét về</span>
              {[['all', `Tất cả (${view.phat_hien.length})`], ...Object.entries(NHOM).map(([k, v]) => [k, `${v} (${cnt(k)})`])].map(([k, lb]) => (
                <button key={k} className={grp === k ? 'on' : ''} onClick={() => setGrp(k)}>{lb}</button>
              ))}
            </div>
            <h4 className="rp-h4">Phát hiện chính</h4>
            {!list.length && <p className="pl-empty">Không có phát hiện nào ở nhóm này.</p>}
            {list.map(f => (
              <div key={f.id} className={`rp-f m-${f.muc_do} ${hidden.has(f.id) ? 'off' : ''}`}>
                <div className="top">
                  <span className={`rp-tag ${MUC[f.muc_do][1]}`}>{MUC[f.muc_do][0]}</span>
                  <b>{f.tieu_de}</b>
                  <label className="rp-tg" title="Tắt = không đưa vào bản in">
                    <input type="checkbox" checked={!hidden.has(f.id)} onChange={() => setHidden(h => { const n = new Set(h); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })} /> in
                  </label>
                </div>
                {f.bang_chung.length > 0 && <ul>{f.bang_chung.map((b, i) => <li key={i}><span>{b.nhan}</span><b>{b.gia_tri}</b></li>)}</ul>}
                {f.vay_thi_sao && <p><em>Vậy thì sao:</em> {f.vay_thi_sao}</p>}
                {f.hanh_dong && <p><em>Làm gì:</em> {f.hanh_dong} {f.man_nguon && <a href={`#/${f.man_nguon}`}>→ {LINK[f.man_nguon] || f.man_nguon}</a>}</p>}
              </div>
            ))}
            <div className="rp-acts">
              <button className="btn-primary rp-btn" onClick={phanTich}>↻ Phân tích lại</button>
              <span>{frozen ? `Số đóng băng lúc ${fmtTime(frozen.saved_at)}` : `Tính lúc ${fmtTime(view.at)}`} · không đụng phần bạn viết</span>
            </div>
            {view.bo_qua.length > 0 && (
              <details className="rp-skip">
                <summary>{view.bo_qua.length} quy tắc chưa xét được vì thiếu dữ liệu</summary>
                <ul>{view.bo_qua.map(b => <li key={b.id}><code>{b.id}</code> — {b.ly_do}</li>)}</ul>
              </details>
            )}
          </section>

          <section className="m2-panel rp-me">
            <div className="rp-h"><span>✎ Nhận định của bạn</span><em>máy không ghi đè phần này</em></div>
            <div className="rp-tools">
              <button onClick={() => cmd('undo')} title="Hoàn tác">↶</button>
              <button onClick={() => cmd('redo')} title="Làm lại">↷</button>
              <button onClick={() => cmd('bold')}><b>B</b></button>
              <button onClick={() => cmd('italic')}><i>I</i></button>
              <button onClick={() => cmd('underline')}><u>U</u></button>
              <button onClick={() => cmd('insertUnorderedList')}>• Danh sách</button>
            </div>
            <div ref={ed} className="rp-ed" contentEditable suppressContentEditableWarning
              data-ph="Viết nhận định, đề xuất của bạn cho kỳ này…" />
          </section>
        </div>
      )}

      {view && (
        <div className={`rp-print ${preview ? 'show' : ''}`}>
          <PrintView view={view} shown={shown} name={name} note={sanitize(ed.current?.innerHTML)} frozen={frozen} />
        </div>
      )}
    </div>
  )
}

function Cards({ the }) {
  return (
    <div className="rp-cards">
      <div><span>Doanh thu</span><b>{tr(the.dt)}</b><small>toàn công ty</small></div>
      <div className={the.ln >= 0 ? 'good' : 'bad'}><span>{the.lnNhan}</span><b>{tr(the.ln)}</b><small>{the.lnRev ? `${nf(1).format(the.ln / the.lnRev * 100)}% doanh thu` : ''}</small></div>
      <div><span>Quỹ cuối kỳ</span><b>{the.quy == null ? '—' : trM(the.quy)}</b><small>{the.quyTuan ? `theo kế hoạch tuần ${the.quyTuan}` : 'chưa có kế hoạch tuần'}</small></div>
    </div>
  )
}

function PrintView({ view, shown, name, note, frozen }) {
  return (
    <div className="rp-doc">
      <header>
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
        <div>
          <h1>{name.trim() || `Báo cáo điều hành ${view.ky}`}</h1>
          <p>Kỳ {view.ky} · so với {view.cmp}{view.to === LAST_DATA_YM && LAST_DATA_YM !== LAST_FULL_YM ? ` · tính đến ngày ${new Date().toLocaleDateString('vi-VN')} (tháng đang chạy)` : ''}</p>
        </div>
      </header>
      <Cards the={view.the} />
      <h2>Phát hiện chính</h2>
      {shown.map(f => (
        <div key={f.id} className={`rp-f m-${f.muc_do}`}>
          <div className="top"><span className={`rp-tag ${MUC[f.muc_do][1]}`}>{MUC[f.muc_do][0]}</span><b>{f.tieu_de}</b></div>
          {f.bang_chung.length > 0 && <ul>{f.bang_chung.map((b, i) => <li key={i}><span>{b.nhan}</span><b>{b.gia_tri}</b></li>)}</ul>}
          {f.vay_thi_sao && <p><em>Vậy thì sao:</em> {f.vay_thi_sao}</p>}
          {f.hanh_dong && <p><em>Làm gì:</em> {f.hanh_dong}</p>}
        </div>
      ))}
      <h2>Nhận định</h2>
      {note ? <div className="rp-note" dangerouslySetInnerHTML={{ __html: note }} /> : <p className="rp-muted">(chưa viết)</p>}
      <footer>
        Số liệu do phần mềm tính theo quy tắc cố định lúc {fmtTime(frozen?.saved_at || view.at)} · dữ liệu bán hàng đến {LAST_DATA_YM} · SELTD Supply Chain Dashboard
      </footer>
    </div>
  )
}
