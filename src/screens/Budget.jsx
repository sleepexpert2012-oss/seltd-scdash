import { Fragment, useEffect, useMemo, useState } from 'react'
import arFile from '../data/receivable.json'
import {
  fetchFin, saveFinLine, saveFinVersion, setFinCurrentVersion, saveFinPlan, saveFinActual,
  fetchSales, fetchCashflow, cashflowCache, deviceName,
} from '../lib/cloud'
import {
  GROUPS, GROUP_OF, BEHAVIOR, ymList, ymLabel, currentYm, planByMonth, rollup, coverage,
  cashChiByMonth, parseAmount, slug,
} from '../lib/fin'
import { MONTHS } from '../lib/metrics'
import { exportRowsXlsx } from '../lib/masterFile'
import './sales.css'
import './budget.css'

/* ============================================================
   KẾ HOẠCH & NGÂN SÁCH
   Lớp NHẬP LIỆU cho mọi so sánh kế hoạch – thực tế. Màn này không phân tích:
   nó chỉ giữ ba thứ app trước đây không có —
   · ngân sách theo tháng (nhiều phiên bản, mỗi năm một bản hiện hành)
   · chi phí thực tế mà dữ liệu Shopee không có (lương, thuê nhà, kho bãi…)
   · danh mục khoản mục: nhóm, cố định/biến đổi, trần % doanh thu
   Doanh thu, giá vốn, phí sàn, quảng cáo Shopee KHÔNG nhập ở đây — app tự tính
   (src/lib/fin.js), cùng cách tính với màn Lãi lỗ.
   ============================================================ */

const TABS = [['plan', '▦', 'Ngân sách'], ['actual', '✎', 'Chi phí thực tế'], ['lines', '≡', 'Khoản mục']]
const UNITS = [[1, 'đồng'], [1e3, 'nghìn đồng'], [1e6, 'triệu đồng']]
const DEC = { 1: 0, 1000: 1, 1000000: 2 }
const nf = d => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d })
const fmt = (v, unit) => (v == null ? '' : nf(DEC[unit] ?? 2).format(v / unit))
const fmtEdit = (v, unit) => (v == null ? '' : nf(6).format(v / unit))
const tr = v => `${nf(1).format((v || 0) / 1e6)} tr`
const pctTxt = v => `${nf(1).format(v * 100)}%`
const key = (line, ym) => `${line}|${ym}`
/* Một khoản trong một tháng từ 100 tỷ trở lên gần như chắc là gõ nhầm đơn vị
   (đang nhập theo triệu mà gõ số đồng đầy đủ: "52.300.000" → 52.300 tỷ). */
const HUGE = 1e11
const unitName = unit => UNITS.find(u => u[0] === unit)?.[1] || 'đồng'

const isSchemaMissing = e => /PGRST20[25]|does not exist|Could not find the (table|function)|404/.test(String(e?.message || e))

export default function Budget() {
  const [tab, setTab] = useState('plan')
  const [db, setDb] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [unit, setUnit] = useState(1e6)
  const [ar, setAr] = useState(arFile)
  const [weeks, setWeeks] = useState(() => cashflowCache() || {})
  const [dirtyCount, setDirtyCount] = useState(0)

  async function load() {
    setBusy(true)
    try { setDb(await fetchFin()); setErr(null) }
    catch (e) { setErr({ schema: isSchemaMissing(e), text: String(e.message || e) }) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    load()
    fetchSales().then(setAr).catch(() => {})
    fetchCashflow().then(r => setWeeks(r.weeks)).catch(() => {})
  }, [])

  /* Đóng tab khi còn ô chưa lưu → trình duyệt hỏi lại */
  useEffect(() => {
    if (!dirtyCount) return
    const h = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirtyCount])

  function switchTab(id) {
    if (dirtyCount && !window.confirm(`Còn ${dirtyCount} ô chưa lưu. Bỏ thay đổi và chuyển tab?`)) return
    setDirtyCount(0); setTab(id); setMsg(null)
  }

  const nVer = db?.versions.length || 0
  const nNhap = db?.lines.filter(l => l.source === 'nhap').length || 0

  return (
    <div className="sl-page bg-page">
      <div className="m2-title">
        <div>
          <h2>Kế hoạch &amp; Ngân sách</h2>
          <p>
            Nơi nhập <b>ngân sách theo tháng</b> và <b>chi phí thực tế ngoài sàn</b> (lương, thuê nhà,
            kho bãi…). Doanh thu, giá vốn, phí sàn và quảng cáo Shopee <b>không nhập ở đây</b> — app
            tự tính từ dữ liệu Shopee và phiếu xuất kho, cùng cách tính với màn Lãi lỗ. Các màn
            Kế hoạch vs Thực đạt, Định mức chi phí, Điểm hòa vốn đọc số từ đây.
          </p>
        </div>
        <div className="sl-acts">
          <label className="bg-unit">Đơn vị
            <select value={unit} onChange={e => setUnit(+e.target.value)}>
              {UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}
            </select>
          </label>
          <button className="btn-ghost" onClick={load} disabled={busy}>⟳ Tải lại</button>
          <span className="sl-dev">Máy: {deviceName()}</span>
        </div>
      </div>

      <div className="mk-tabbar">
        <div className="mk-tabs">
          {TABS.map(([id, ic, lb]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => switchTab(id)}>
              <span className="ic" aria-hidden>{ic}</span>{lb}
              {db && <em>{id === 'plan' ? nVer : id === 'actual' ? nNhap : db.lines.length}</em>}
            </button>
          ))}
        </div>
      </div>

      {msg && <div className={`cf-msg t-${msg.t}`}>{msg.s}</div>}

      {err && (
        <section className="m2-panel bg-empty">
          {err.schema ? (
            <>
              <h3>Chưa có bảng ngân sách trên Supabase</h3>
              <p>
                Màn này cần các bảng <code>fin_line</code>, <code>fin_plan_version</code>,{' '}
                <code>fin_plan</code>, <code>fin_actual</code>, <code>fin_log</code>. Chạy file{' '}
                <code>scripts/shopee/schema_fin.sql</code> trên Supabase (SQL Editor) rồi bấm Tải lại.
              </p>
            </>
          ) : (
            <>
              <h3>Không tải được dữ liệu</h3>
              <p>{err.text}</p>
            </>
          )}
        </section>
      )}

      {!err && !db && <section className="m2-panel bg-empty"><p>Đang tải…</p></section>}

      {db && tab === 'plan' && (
        <PlanTab db={db} unit={unit} reload={load} setMsg={setMsg} onDirty={setDirtyCount} />
      )}
      {db && tab === 'actual' && (
        <ActualTab db={db} unit={unit} ar={ar} weeks={weeks} reload={load} setMsg={setMsg}
          onDirty={setDirtyCount} />
      )}
      {db && tab === 'lines' && <LinesTab db={db} reload={load} setMsg={setMsg} />}
    </div>
  )
}

/* =====================================================================
   Ô NHẬP SỐ
   Không đang sửa: hiện số theo đơn vị đang chọn. Đang sửa: hiện đầy đủ
   (nhiều chữ số thập phân) để gõ lại không mất phần lẻ. Rời ô mới đọc số.
   ===================================================================== */
function Cell({ value, unit, disabled, dirty, missing, cellId, onCommit, onPasteBlock, title }) {
  const [txt, setTxt] = useState(null)       // null = không đang sửa
  const [bad, setBad] = useState(false)

  function commit() {
    if (txt === null) return
    const v = parseAmount(txt, unit)
    setTxt(null)
    if (Number.isNaN(v)) { setBad(true); setTimeout(() => setBad(false), 1600); return }
    if (v != null && Math.abs(v) >= HUGE && !window.confirm(
      `Đang nhập theo ${unitName(unit)}: "${txt.trim()}" = ${fmt(v, 1)} đồng (${nf(0).format(v / 1e9)} tỷ).\n`
      + 'Số này rất lớn — có phải gõ nhầm đơn vị? Bấm Huỷ để bỏ.')) return
    if (v !== value) onCommit(v)
  }

  if (disabled) return <span className="bg-cell off" title={title}>{fmt(value, unit) || ''}</span>

  return (
    <input
      className={'bg-in' + (dirty ? ' dirty' : '') + (missing ? ' miss' : '') + (bad ? ' bad' : '')}
      data-cell={cellId} title={title}
      value={txt ?? fmt(value, unit)}
      placeholder={missing ? 'chưa nhập' : ''}
      inputMode="decimal"
      onFocus={e => { setTxt(fmtEdit(value, unit)); requestAnimationFrame(() => e.target.select()) }}
      onChange={e => setTxt(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Escape') { setTxt(null); e.currentTarget.blur() }
        if (e.key === 'Enter') {
          e.preventDefault()
          const [r, c] = cellId.split(':').map(Number)
          const next = document.querySelector(`[data-cell="${r + (e.shiftKey ? -1 : 1)}:${c}"]`)
          e.currentTarget.blur()
          next?.focus()
        }
      }}
      onPaste={e => {
        const t = e.clipboardData.getData('text')
        if (!/[\t\n]/.test(t.replace(/\r?\n$/, ''))) return       // một ô → dán bình thường
        e.preventDefault()
        setTxt(null)
        onPasteBlock(t)
      }}
    />
  )
}

/* =====================================================================
   LƯỚI KHOẢN MỤC × THÁNG — dùng chung cho Ngân sách và Chi phí thực tế
   ===================================================================== */
function Grid({ lines, yms, vals, dirty, unit, editable, missingAt, onSet, onPasteDone,
  refVals, showDerived }) {
  const R = useMemo(() => rollup(lines, vals, yms), [lines, vals, yms])
  /* Thứ tự các dòng nhập được — dùng cho phím Enter và dán khối từ Excel */
  const editLines = useMemo(() => {
    const out = []
    for (const g of GROUPS) {
      for (const l of lines.filter(x => x.grp === g.id)) out.push(l)
    }
    return out
  }, [lines])
  const rowOf = Object.fromEntries(editLines.map((l, i) => [l.code, i]))
  const dtYear = R.grp.doanh_thu.year

  function pasteBlock(line, ym, text) {
    const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(r => r.split('\t'))
    const r0 = rowOf[line.code], c0 = yms.indexOf(ym)
    let n = 0, skip = 0, badN = 0, huge = 0, first = null
    rows.forEach((cells, i) => cells.forEach((raw, j) => {
      const l = editLines[r0 + i], y = yms[c0 + j]
      if (!l || !y || !editable(l, y)) { if (String(raw).trim() !== '') skip += 1; return }
      const v = parseAmount(raw, unit)
      if (Number.isNaN(v)) { badN += 1; return }
      if (v != null && Math.abs(v) >= HUGE) { huge += 1; return }
      if (first === null && v !== null) first = { raw, v, l, y }
      onSet(l.code, y, v); n += 1
    }))
    onPasteDone({ n, skip, bad: badN, huge, first, rows: rows.length, cols: Math.max(...rows.map(r => r.length)) })
  }

  /* Lợi nhuận gộp chỉ có nghĩa khi đã có doanh thu hoặc giá vốn; các dòng lợi nhuận
     sau đó hiện khi bảng có bất kỳ số nào. Không có gì để cộng → để trống, không ghi 0. */
  const has = (k, ym) => (k === 'gp' ? R.filled.doanh_thu[ym] + R.filled.gia_von[ym] : R.any[ym]) > 0
  const derivedRow = (k, label) => (
    <tr className="bg-derived" key={k}>
      <td className="lbl">{label}</td>
      {yms.map(ym => <td key={ym} className="num">{has(k, ym) ? fmt(R.derived[ym][k], unit) : ''}</td>)}
      <td className="num yr">{has(k, 'year') ? fmt(R.derived.year[k], unit) : ''}</td>
      {showDerived && <td className="num pc">{dtYear ? pctTxt(R.derived.year[k] / dtYear) : ''}</td>}
    </tr>
  )

  return (
    <div className="bg-wrap">
      <table className="bg-grid">
        <thead>
          <tr>
            <th className="lbl">Khoản mục</th>
            {yms.map(ym => <th key={ym} className="num">{ymLabel(ym)}</th>)}
            <th className="num yr">Cả năm</th>
            {showDerived && <th className="num pc" title="Tỷ trọng trên doanh thu cả năm">% DT</th>}
          </tr>
        </thead>
        <tbody>
          {GROUPS.map(g => {
            const gl = lines.filter(l => l.grp === g.id)
            if (!gl.length) return null
            return (
              <Fragment key={g.id}>
                <tr className="bg-grp">
                  <td className="lbl">{g.label}</td>
                  {yms.map(ym => (
                    <td key={ym} className="num">
                      {R.filled[g.id][ym] ? fmt(R.grp[g.id][ym], unit) : ''}
                      {R.missing[g.id][ym] > 0 && R.missing[g.id][ym] < gl.length && (
                        <i className="bg-part" title={`${R.missing[g.id][ym]} khoản chưa có số`}>*</i>
                      )}
                    </td>
                  ))}
                  <td className="num yr">{R.filled[g.id].year ? fmt(R.grp[g.id].year, unit) : ''}</td>
                  {showDerived && (
                    <td className="num pc">{dtYear && g.id !== 'doanh_thu' ? pctTxt(R.grp[g.id].year / dtYear) : ''}</td>
                  )}
                </tr>
                {gl.map(l => (
                  <tr key={l.code} className={l.active === false ? 'inactive' : ''}>
                    <td className="lbl" title={l.note || l.name}>
                      <span className="nm">{l.name}</span>
                      <span className="meta">
                        {l.source === 'auto' ? <em className="auto">tự tính</em> : null}
                        {l.behavior ? <em>{BEHAVIOR[l.behavior]}</em> : null}
                        {l.cap_pct != null ? <em>trần {nf(1).format(l.cap_pct)}%</em> : null}
                      </span>
                    </td>
                    {yms.map((ym, c) => {
                      const v = vals[l.code]?.[ym] ?? null
                      const ref = refVals?.[l.code]?.[ym]
                      return (
                        <td key={ym} className="num cellwrap">
                          <Cell value={v} unit={unit} cellId={`${rowOf[l.code]}:${c}`}
                            disabled={!editable(l, ym)} dirty={dirty.has(key(l.code, ym))}
                            missing={missingAt?.(l, ym, v)}
                            title={ref ? `Kế hoạch dòng tiền tháng này chi ${fmt(ref, 1)} đ` : undefined}
                            onCommit={nv => onSet(l.code, ym, nv)}
                            onPasteBlock={t => pasteBlock(l, ym, t)} />
                          {ref ? <small className="bg-ref">DT {fmt(ref, unit)}</small> : null}
                        </td>
                      )
                    })}
                    <td className="num yr">{fmt(R.lineYear[l.code], unit)}</td>
                    {showDerived && (
                      <td className="num pc">
                        {dtYear && l.grp !== 'doanh_thu' && R.lineYear[l.code] != null
                          ? pctTxt(R.lineYear[l.code] / dtYear) : ''}
                      </td>
                    )}
                  </tr>
                ))}
                {showDerived && g.id === 'gia_von' && derivedRow('gp', 'Lợi nhuận gộp')}
                {showDerived && g.id === 'tai_chinh' && derivedRow('lntt', 'Lợi nhuận trước thuế')}
                {showDerived && g.id === 'thue' && derivedRow('lnst', 'Lợi nhuận sau thuế')}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* Gộp số đã lưu với ô đang sửa */
function useDraft(base, lines, yms) {
  const [dirty, setDirty] = useState({})
  const vals = useMemo(() => {
    const out = {}
    for (const l of lines) {
      out[l.code] = {}
      for (const ym of yms) {
        const k = key(l.code, ym)
        out[l.code][ym] = k in dirty ? dirty[k] : (base[l.code]?.[ym] ?? null)
      }
    }
    return out
  }, [base, lines, yms, dirty])
  /* Gõ lại đúng số đã lưu → ô hết "chưa lưu" */
  const set = (line, ym, v) => setDirty(d => {
    const k = key(line, ym), n = { ...d }
    if ((base[line]?.[ym] ?? null) === v) delete n[k]
    else n[k] = v
    return n
  })
  const cells = () => Object.entries(dirty).map(([k, amount]) => {
    const [line, ym] = k.split('|')
    return { line, ym, amount }
  })
  return { vals, dirty, dirtySet: new Set(Object.keys(dirty)), set, cells, reset: () => setDirty({}) }
}

/* Nhập Excel: tìm dòng tiêu đề có ô "Mã", cột tháng là "YYYY-MM" hoặc "T1".."T12".
   Số trong file luôn là ĐỒNG (đúng như file xuất ra), không phụ thuộc đơn vị đang xem. */
async function readGridFile(file, yms, codes) {
  const m = await import('xlsx')
  const XLSX = m.utils ? m : m.default
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })
  const h = grid.findIndex(r => r.some(c => String(c).trim().toLowerCase() === 'mã'))
  if (h < 0) throw new Error('không thấy dòng tiêu đề có cột "Mã"')
  const head = grid[h].map(c => String(c).trim())
  const cCode = head.findIndex(c => c.toLowerCase() === 'mã')
  const cols = []
  head.forEach((c, i) => {
    let ym = /^\d{4}-\d{2}$/.test(c) ? c : null
    const t = /^T(\d{1,2})$/i.exec(c)
    if (!ym && t && +t[1] >= 1 && +t[1] <= 12) ym = yms[+t[1] - 1]
    if (ym) cols.push([i, ym])
  })
  const out = [], unknown = new Set(), outOfYear = new Set()
  let badN = 0
  for (const r of grid.slice(h + 1)) {
    const code = String(r[cCode] ?? '').trim()
    if (!code) continue
    if (!codes.has(code)) { unknown.add(code); continue }
    for (const [i, ym] of cols) {
      const raw = r[i]
      if (raw === '' || raw == null) continue
      if (!yms.includes(ym)) { outOfYear.add(ym); continue }
      const v = typeof raw === 'number' ? Math.round(raw) : parseAmount(raw, 1)
      if (v == null) continue
      if (Number.isNaN(v)) { badN += 1; continue }
      out.push({ line: code, ym, amount: v })
    }
  }
  return { cells: out, unknown: [...unknown], outOfYear: [...outOfYear], bad: badN, nCols: cols.length }
}

function gridRows(lines, vals, yms) {
  const head = ['Mã', 'Khoản mục', 'Nhóm', ...yms, 'Cả năm']
  const rows = [head]
  for (const g of GROUPS) {
    for (const l of lines.filter(x => x.grp === g.id)) {
      const vs = yms.map(ym => vals[l.code]?.[ym] ?? '')
      const yr = vs.reduce((a, v) => a + (v === '' ? 0 : v), 0)
      rows.push([l.code, l.name, g.label, ...vs, vs.some(v => v !== '') ? yr : ''])
    }
  }
  return rows
}

function ImportBtn({ onFile, disabled }) {
  return (
    <label className={'btn-ghost bg-file' + (disabled ? ' dis' : '')}>
      ⇪ Nhập Excel
      <input type="file" accept=".xlsx,.xls,.csv" disabled={disabled}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }} />
    </label>
  )
}

function pasteMsg(r, unit) {
  const parts = [`Đã dán ${r.n} ô (khối ${r.rows}×${r.cols})`]
  if (r.first) {
    parts.push(`kiểm lại cách đọc: "${String(r.first.raw).trim()}" ở ${r.first.l.code} ${ymLabel(r.first.y)} `
      + `→ ${fmt(r.first.v, 1)} đ (đang nhập theo ${unitName(unit)})`)
  }
  if (r.skip) parts.push(`${r.skip} ô rơi ra ngoài lưới hoặc vào ô khoá — bỏ qua`)
  if (r.bad) parts.push(`${r.bad} ô không đọc được số — bỏ qua`)
  if (r.huge) parts.push(`${r.huge} ô ra từ 100 tỷ trở lên — nhiều khả năng sai đơn vị, bỏ qua (đổi đơn vị rồi dán lại)`)
  return { t: r.skip || r.bad || r.huge ? 'warn' : 'ok', s: parts.join(' · ') + '. Chưa lưu — bấm Lưu.' }
}

/* =====================================================================
   TAB 1 — NGÂN SÁCH
   ===================================================================== */
function PlanTab({ db, unit, reload, setMsg, onDirty }) {
  const pickDefault = () => {
    const cur = db.versions.filter(v => v.is_current).sort((a, b) => b.year - a.year)[0]
    return (cur || db.versions[0])?.version || null
  }
  const [ver, setVer] = useState(pickDefault)
  const [form, setForm] = useState(db.versions.length ? null : { mode: 'new' })
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!db.versions.find(v => v.version === ver)) setVer(pickDefault()) }, [db])

  const version = db.versions.find(v => v.version === ver)
  const yms = useMemo(() => (version ? ymList(version.year) : []), [version?.year])
  const base = useMemo(() => planByMonth(ver, db.plan), [ver, db.plan])
  const lines = useMemo(() => db.lines.filter(l => l.active !== false || base[l.code]), [db.lines, base])
  const draft = useDraft(base, lines, yms)
  const nDirty = Object.keys(draft.dirty).length
  useEffect(() => { onDirty(nDirty) }, [nDirty])
  useEffect(() => { draft.reset() }, [ver])

  function choose(v) {
    if (nDirty && !window.confirm(`Còn ${nDirty} ô chưa lưu. Bỏ thay đổi và đổi phiên bản?`)) return
    setVer(v)
  }

  async function run(fn) {
    setBusy(true); setMsg(null)
    try { await fn() } catch (e) { setMsg({ t: 'bad', s: `CHƯA lưu được: ${e.message}` }) }
    finally { setBusy(false) }
  }

  const save = () => run(async () => {
    const r = await saveFinPlan(ver, draft.cells())
    draft.reset(); await reload()
    setMsg({ t: 'ok', s: `Đã lưu ${r?.n_changed ?? 0} ô vào phiên bản "${version.name}".` })
  })

  const makeCurrent = () => run(async () => {
    await setFinCurrentVersion(ver); await reload()
    setMsg({ t: 'ok', s: `"${version.name}" là ngân sách hiện hành của năm ${version.year}.` })
  })

  const create = f => run(async () => {
    const p = { version: f.version, name: f.name.trim(), year: +f.year, note: f.note || null }
    if (db.versions.some(v => v.version === p.version)) throw new Error(`mã phiên bản "${p.version}" đã có`)
    const r = await saveFinVersion(p, f.mode === 'clone' ? ver : null)
    const first = !db.versions.some(v => v.year === p.year && v.is_current)
    if (first) await setFinCurrentVersion(p.version)
    await reload(); setVer(p.version); setForm(null)
    setMsg({ t: 'ok', s: `Đã tạo phiên bản "${p.name}"`
      + (f.mode === 'clone' ? ` — chép ${r?.n_cloned ?? 0} ô từ "${version.name}"` : '')
      + (first ? `, và đặt làm hiện hành cho năm ${p.year} vì năm này chưa có bản nào.` : '.') })
  })

  const exportXls = () => exportRowsXlsx(`Ngan-sach_${ver}.xlsx`, {
    'Ngân sách': gridRows(lines, draft.vals, yms),
    'Ghi chú': [
      ['Phiên bản', version.name], ['Mã', version.version], ['Năm', version.year],
      ['Đơn vị', 'đồng'], ['Xuất lúc', new Date().toLocaleString('vi-VN')],
      ['Nhập lại', 'Sửa số trong sheet "Ngân sách", giữ cột Mã và tiêu đề tháng, rồi bấm Nhập Excel.'],
    ],
  })

  const importXls = file => run(async () => {
    const codes = new Set(lines.map(l => l.code))
    const r = await readGridFile(file, yms, codes)
    for (const c of r.cells) draft.set(c.line, c.ym, c.amount)
    const warn = [
      r.unknown.length && `${r.unknown.length} mã không có trong danh mục (${r.unknown.slice(0, 5).join(', ')})`,
      r.outOfYear.length && `${r.outOfYear.length} cột tháng không thuộc năm ${version.year}`,
      r.bad && `${r.bad} ô không đọc được số`,
    ].filter(Boolean)
    setMsg({ t: warn.length ? 'warn' : 'ok',
      s: `Đọc ${r.cells.length} ô từ ${file.name} (${r.nCols} cột tháng). `
        + (warn.length ? `Bỏ qua: ${warn.join(' · ')}. ` : '') + 'Chưa lưu — kiểm lại rồi bấm Lưu.' })
  })

  /* Câu "vậy thì sao" cho bản đang xem */
  const insight = useMemo(() => {
    if (!version) return null
    const R = rollup(lines, draft.vals, yms)
    const dt = R.grp.doanh_thu.year
    const empty = lines.filter(l => yms.every(ym => draft.vals[l.code]?.[ym] == null))
    if (!dt) return { t: 'warn', s: `Bản này chưa có doanh thu kế hoạch — ${empty.length}/${lines.length} khoản chưa có số ở tháng nào.` }
    const costs = lines.filter(l => l.grp !== 'doanh_thu' && R.lineYear[l.code])
      .sort((a, b) => R.lineYear[b.code] - R.lineYear[a.code])
    const top = costs[0]
    const lntt = R.derived.year.lntt
    return {
      t: lntt < 0 ? 'bad' : empty.length ? 'warn' : 'ok',
      s: `Bản "${version.name}": doanh thu ${tr(dt)}, lợi nhuận trước thuế ${tr(lntt)} (${pctTxt(lntt / dt)} doanh thu)`
        + (top ? `. Khoản chi lớn nhất: ${top.name.replace(/^Phí sàn · /, 'phí sàn ')} ${tr(R.lineYear[top.code])} (${pctTxt(R.lineYear[top.code] / dt)} doanh thu)` : '')
        + (empty.length ? `. Còn ${empty.length} khoản chưa có số ở tháng nào — lợi nhuận đang bị nhìn cao hơn thật.` : '.'),
    }
  }, [version, lines, draft.vals, yms])

  return (
    <>
      <section className="m2-panel">
        <div className="bg-bar">
          <label>Phiên bản
            <select value={ver || ''} onChange={e => choose(e.target.value)} disabled={!db.versions.length}>
              {!db.versions.length && <option value="">— chưa có —</option>}
              {db.versions.map(v => (
                <option key={v.version} value={v.version}>
                  {v.is_current ? '★ ' : ''}{v.name} · {v.year}
                </option>
              ))}
            </select>
          </label>
          {version && (version.is_current
            ? <span className="sl-tag on">Hiện hành năm {version.year}</span>
            : <button className="btn-ghost" disabled={busy} onClick={makeCurrent}>Đặt làm hiện hành</button>)}
          <button className="btn-ghost" disabled={busy} onClick={() => setForm({ mode: 'new' })}>+ Phiên bản mới</button>
          {version && <button className="btn-ghost" disabled={busy} onClick={() => setForm({ mode: 'clone' })}>⧉ Nhân bản</button>}
          <span className="sp" />
          {version && <button className="btn-ghost" disabled={busy} onClick={exportXls}>⬇ Xuất Excel</button>}
          {version && <ImportBtn disabled={busy} onFile={importXls} />}
          {version && (
            <>
              <button className="btn-ghost" disabled={busy || !nDirty} onClick={draft.reset}>Bỏ thay đổi</button>
              <button className="btn-primary" disabled={busy || !nDirty} onClick={save}>
                {busy ? 'Đang lưu…' : nDirty ? `Lưu ${nDirty} ô` : 'Đã lưu'}
              </button>
            </>
          )}
        </div>
        {form && (
          <VersionForm mode={form.mode} from={version} busy={busy} versions={db.versions}
            onCancel={db.versions.length ? () => setForm(null) : null} onSubmit={create} />
        )}
      </section>

      {version && (
        <>
          {insight && <div className={`cf-msg t-${insight.t}`}>{insight.s}</div>}
          <section className="m2-panel">
            <div className="bg-help">
              Đơn vị <b>{UNITS.find(u => u[0] === unit)[1]}</b> · gõ hoặc dán cả khối từ Excel vào ô
              đầu tiên · <b>Enter</b> xuống dòng · ô trống là <i>chưa có số</i>, khác với 0 · dấu{' '}
              <i className="bg-part">*</i> ở dòng nhóm = có khoản trong nhóm chưa có số tháng đó.
            </div>
            <Grid lines={lines} yms={yms} vals={draft.vals} dirty={draft.dirtySet} unit={unit}
              editable={() => true} onSet={draft.set} showDerived
              onPasteDone={r => setMsg(pasteMsg(r, unit))} />
          </section>
        </>
      )}
    </>
  )
}

function VersionForm({ mode, from, busy, versions, onCancel, onSubmit }) {
  const vn = new Date()
  const defYear = mode === 'clone' ? from.year : vn.getFullYear() + (vn.getMonth() >= 9 ? 1 : 0)
  const [f, setF] = useState(() => ({
    mode, year: defYear, note: '',
    name: mode === 'clone' ? `${from.name} (bản sao)` : `Ngân sách ${defYear}`,
  }))
  const [code, setCode] = useState(null)        // null = tự sinh từ tên
  const auto = slug(`${f.name}`) || `ns-${f.year}`
  const version = code ?? (auto.includes(String(f.year)) ? auto : `${auto}-${f.year}`).slice(0, 40)
  const dup = versions.some(v => v.version === version)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  return (
    <div className="bg-form">
      <h4>{mode === 'clone' ? `Nhân bản "${from.name}"` : versions.length ? 'Phiên bản ngân sách mới' : 'Tạo phiên bản ngân sách đầu tiên'}</h4>
      <div className="sl-form">
        <label className="wide">Tên<input className="sl-in" value={f.name} onChange={e => set('name', e.target.value)} /></label>
        <label>Năm<input className="sl-in" type="number" min="2020" max="2100" value={f.year}
          onChange={e => set('year', e.target.value)} /></label>
        <label>Mã (tự sinh)<input className="sl-in" value={version}
          onChange={e => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} /></label>
        <label className="wide">Ghi chú<input className="sl-in" value={f.note} placeholder="vd: kịch bản cơ sở, duyệt ngày…"
          onChange={e => set('note', e.target.value)} /></label>
      </div>
      {mode === 'clone' && +f.year !== from.year && (
        <p className="bg-note">Khác năm: số của từng tháng được chép sang đúng tháng đó của năm {f.year}.</p>
      )}
      {dup && <p className="bg-note bad">Mã "{version}" đã có — đổi tên hoặc sửa mã.</p>}
      <div className="bg-form-act">
        {onCancel && <button className="btn-ghost" onClick={onCancel}>Huỷ</button>}
        <button className="btn-primary" disabled={busy || dup || !f.name.trim() || !(+f.year >= 2020) || version.length < 2}
          onClick={() => onSubmit({ ...f, version })}>
          {mode === 'clone' ? 'Nhân bản' : 'Tạo'}
        </button>
      </div>
    </div>
  )
}

/* =====================================================================
   TAB 2 — CHI PHÍ THỰC TẾ (chỉ khoản nhập tay)
   ===================================================================== */
function ActualTab({ db, unit, ar, weeks, reload, setMsg, onDirty }) {
  const cur = currentYm()
  const years = useMemo(() => [...new Set([
    ...MONTHS.map(m => +m.slice(0, 4)), +cur.slice(0, 4), ...db.actual.map(r => +r.ym.slice(0, 4)),
  ])].sort((a, b) => b - a), [db.actual, cur])
  const [year, setYear] = useState(+cur.slice(0, 4))
  const [showRef, setShowRef] = useState(true)
  const [busy, setBusy] = useState(false)

  const yms = useMemo(() => ymList(year), [year])
  const base = useMemo(() => {
    const o = {}
    for (const r of db.actual) (o[r.line] = o[r.line] || {})[r.ym] = Number(r.amount)
    return o
  }, [db.actual])
  const lines = useMemo(() => db.lines.filter(l => l.source === 'nhap'
    && (l.active !== false || yms.some(ym => base[l.code]?.[ym] != null))), [db.lines, base, yms])
  const draft = useDraft(base, lines, yms)
  const nDirty = Object.keys(draft.dirty).length
  useEffect(() => { onDirty(nDirty) }, [nDirty])

  const cov = useMemo(() => coverage(year, db.lines, db.actual, ar), [year, db.lines, db.actual, ar])
  const refVals = useMemo(() => (showRef ? cashChiByMonth(weeks, lines.map(l => l.code)) : null),
    [showRef, weeks, lines])

  function chooseYear(y) {
    if (nDirty && !window.confirm(`Còn ${nDirty} ô chưa lưu. Bỏ thay đổi và đổi năm?`)) return
    draft.reset(); setYear(y)
  }

  async function run(fn) {
    setBusy(true); setMsg(null)
    try { await fn() } catch (e) { setMsg({ t: 'bad', s: `CHƯA lưu được: ${e.message}` }) }
    finally { setBusy(false) }
  }
  const save = () => run(async () => {
    const r = await saveFinActual(draft.cells())
    draft.reset(); await reload()
    setMsg({ t: 'ok', s: `Đã lưu ${r?.n_changed ?? 0} ô chi phí thực tế.` })
  })
  const exportXls = () => exportRowsXlsx(`Chi-phi-thuc-te_${year}.xlsx`, {
    'Chi phí thực tế': gridRows(lines, draft.vals, yms),
    'Ghi chú': [['Năm', year], ['Đơn vị', 'đồng'], ['Phạm vi', 'Chỉ các khoản nhập tay. Ô trống = chưa nhập.'],
      ['Xuất lúc', new Date().toLocaleString('vi-VN')]],
  })
  const importXls = file => run(async () => {
    const r = await readGridFile(file, yms, new Set(lines.map(l => l.code)))
    const ok = r.cells.filter(c => c.ym <= cur)
    for (const c of ok) draft.set(c.line, c.ym, c.amount)
    const fut = r.cells.length - ok.length
    setMsg({ t: fut || r.unknown.length || r.bad ? 'warn' : 'ok',
      s: `Đọc ${ok.length} ô từ ${file.name}.`
        + (fut ? ` Bỏ ${fut} ô ở tháng chưa tới.` : '')
        + (r.unknown.length ? ` Bỏ ${r.unknown.length} mã không phải khoản nhập tay (${r.unknown.slice(0, 5).join(', ')}).` : '')
        + (r.bad ? ` ${r.bad} ô không đọc được số.` : '') + ' Chưa lưu — bấm Lưu.' })
  })

  /* Cảnh báo tính trên tháng đã KẾT THÚC: tháng đang chạy dở chưa nhập là bình thường */
  const past = cov.months.filter(m => m.ym < cur)
  const lastPast = past[past.length - 1]
  const nameOf = c => db.lines.find(l => l.code === c)?.name || c

  return (
    <>
      <section className="m2-panel">
        <div className="bg-bar">
          <label>Năm
            <select value={year} onChange={e => chooseYear(+e.target.value)}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="bg-chk">
            <input type="checkbox" checked={showRef} onChange={e => setShowRef(e.target.checked)} />
            Hiện tiền chi theo kế hoạch dòng tiền (DT)
          </label>
          <span className="sp" />
          <button className="btn-ghost" disabled={busy} onClick={exportXls}>⬇ Xuất Excel</button>
          <ImportBtn disabled={busy} onFile={importXls} />
          <button className="btn-ghost" disabled={busy || !nDirty} onClick={draft.reset}>Bỏ thay đổi</button>
          <button className="btn-primary" disabled={busy || !nDirty} onClick={save}>
            {busy ? 'Đang lưu…' : nDirty ? `Lưu ${nDirty} ô` : 'Đã lưu'}
          </button>
        </div>
        <div className="bg-months">
          {cov.months.map(m => (
            <span key={m.ym} className={`bg-mchip s-${m.state}`}
              title={m.state === 'part' ? `Thiếu: ${m.missing.map(nameOf).join(', ')}` : undefined}>
              <b>{ymLabel(m.ym)}</b>
              {m.state === 'future' ? 'chưa tới' : m.state === 'full' ? 'đủ'
                : m.state === 'none' ? 'chưa nhập' : `thiếu ${m.missing.length}`}
            </span>
          ))}
        </div>
      </section>

      {lastPast && lastPast.state !== 'full' && (
        <div className="cf-msg t-warn">
          {ymLabel(lastPast.ym)}/{year} {lastPast.state === 'none'
            ? 'chưa nhập khoản chi phí nào'
            : `còn thiếu ${lastPast.missing.length} khoản: ${lastPast.missing.map(nameOf).join(', ')}`}.
          {' '}Các màn so sánh sẽ coi lợi nhuận tháng này là <b>chưa đủ chi phí</b> — không tính như bằng 0.
          {past.filter(m => m.state !== 'full').length > 1 && ` Tổng cộng ${past.filter(m => m.state !== 'full').length}/${past.length} tháng đã kết thúc còn thiếu.`}
        </div>
      )}

      <section className="m2-panel">
        <div className="bg-help">
          Chỉ các khoản <b>nhập tay</b>. Chi phí ghi theo <b>tháng phát sinh</b> (dồn tích), không phải
          tháng trả tiền — số <i>DT</i> nhỏ dưới ô là tiền chi trong kế hoạch dòng tiền cùng tháng, chỉ để
          đối chiếu, app không tự điền. Riêng dòng tiếp thị: số DT có thể gồm cả tiền nạp Shopee Ads.
        </div>
        {lines.length ? (
          <Grid lines={lines} yms={yms} vals={draft.vals} dirty={draft.dirtySet} unit={unit}
            editable={(l, ym) => ym <= cur}
            missingAt={(l, ym, v) => v == null && ym <= cur}
            onSet={draft.set} refVals={refVals}
            onPasteDone={r => setMsg(pasteMsg(r, unit))} />
        ) : <p className="sl-empty">Chưa có khoản mục nhập tay nào — thêm ở tab Khoản mục.</p>}
      </section>

      <section className="m2-panel bg-cov">
        <h3>Các khoản app tự tính — không nhập ở đây</h3>
        <ul>
          <li>
            <b>Doanh thu, giá vốn</b> (trên sàn và ngoài sàn), <b>6 khoản phí sàn</b>, <b>quảng cáo Shopee</b>:
            tính từ dữ liệu Shopee và phiếu xuất kho, cùng cách tính với màn Lãi lỗ.
          </li>
          {cov.cogs.skuNoCost ? (
            <li className="warn">
              Giá vốn năm {year}: <b>{cov.cogs.skuNoCost}/{cov.cogs.skuSold}</b> SKU có bán chưa có giá vốn
              trong Master Data (chiếm {pctTxt(cov.cogs.revShare)} doanh thu sàn) — giá vốn của các SKU này
              đang tính bằng 0, lợi nhuận gộp bị <b>cao hơn thật</b>. Thiếu: {cov.cogs.noCostList.slice(0, 8).join(', ')}
              {cov.cogs.noCostList.length > 8 ? '…' : ''}
            </li>
          ) : cov.cogs.skuSold ? (
            <li>Giá vốn năm {year}: đủ cho cả <b>{cov.cogs.skuSold}</b> SKU có bán (trên sàn và ngoài sàn).</li>
          ) : null}
          {cov.adsMissing.length > 0 && (
            <li className="warn">
              Quảng cáo Shopee <b>chưa có số</b> các tháng {cov.adsMissing.map(ymLabel).join(', ')} — API
              Shopee chỉ lưu khoảng 5 tháng lịch sử. Đây là thiếu dữ liệu, không phải chi 0.
            </li>
          )}
          {cov.partialYm && (
            <li>{ymLabel(cov.partialYm)}/{year} đang chạy dở — số thực tế tháng này chưa trọn tháng.</li>
          )}
          {cov.unknownAuto.length > 0 && (
            <li className="warn">Khoản "tự tính" app chưa biết cách tính: {cov.unknownAuto.join(', ')}.</li>
          )}
        </ul>
      </section>
    </>
  )
}

/* =====================================================================
   TAB 3 — KHOẢN MỤC
   ===================================================================== */
function LinesTab({ db, reload, setMsg }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  async function save(p) {
    setBusy(true); setMsg(null)
    try {
      await saveFinLine(p); await reload(); setForm(null)
      setMsg({ t: 'ok', s: `Đã lưu khoản mục ${p.code}.` })
    } catch (e) { setMsg({ t: 'bad', s: `CHƯA lưu được: ${e.message}` }) }
    finally { setBusy(false) }
  }

  const rows = [...db.lines].sort((a, b) =>
    GROUPS.findIndex(g => g.id === a.grp) - GROUPS.findIndex(g => g.id === b.grp) || a.sort - b.sort)

  return (
    <section className="m2-panel">
      <div className="bg-bar">
        <span className="bg-help inline">
          <b>Cố định/biến đổi</b> quyết định điểm hòa vốn · <b>trần %</b> là mức chi tối đa trên doanh thu,
          dùng ở màn Định mức chi phí. Khoản <em className="auto">tự tính</em> không đổi được nhóm.
        </span>
        <span className="sp" />
        <button className="btn-primary" disabled={busy} onClick={() => setForm({ moi: true, grp: 'opex', behavior: 'co_dinh', sort: 100, active: true })}>
          + Khoản mục mới
        </button>
      </div>

      {form && <LineForm form={form} setForm={setForm} busy={busy} onSave={save} codes={db.lines.map(l => l.code)} />}

      <div className="bg-wrap">
        <table className="sl-tb">
          <thead>
            <tr>
              <th>Mã</th><th>Khoản mục</th><th>Nhóm</th><th>Nguồn</th><th>Cố định / biến đổi</th>
              <th className="num">Trần % DT</th><th className="num">Thứ tự</th><th>Trạng thái</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map(l => (
              <tr key={l.code} className={l.active === false ? 'dim' : ''}>
                <td className="mono">{l.code}</td>
                <td><b>{l.name}</b>{l.note && <small>{l.note}</small>}</td>
                <td>{GROUP_OF[l.grp]?.label || l.grp}</td>
                <td>{l.source === 'auto' ? <span className="sl-tag mid">tự tính</span> : <span className="sl-tag off">nhập tay</span>}</td>
                <td>{l.behavior ? BEHAVIOR[l.behavior] : <span className="dim">—</span>}</td>
                <td className="num">{l.cap_pct != null ? `${nf(1).format(l.cap_pct)}%` : <span className="dim">—</span>}</td>
                <td className="num">{l.sort}</td>
                <td>{l.active === false ? <span className="sl-tag off">đã tắt</span> : <span className="sl-tag on">đang dùng</span>}</td>
                <td><button className="btn-ghost sm" onClick={() => setForm({ ...l })}>Sửa</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function LineForm({ form, setForm, busy, onSave, codes }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const auto = form.source === 'auto'
  const noBehavior = form.grp === 'doanh_thu' || form.grp === 'thue'
  const codeOk = /^[a-z][a-z0-9_]{1,39}$/.test(form.code || '')
  const dup = form.moi && codes.includes(form.code)
  const cap = form.cap_pct === '' || form.cap_pct == null ? null : Number(String(form.cap_pct).replace(',', '.'))
  const capOk = cap === null || (cap >= 0 && cap <= 100)
  return (
    <div className="bg-form">
      <h4>{form.moi ? 'Khoản mục mới (nhập tay)' : `Sửa ${form.code}`}</h4>
      <div className="sl-form">
        <label>Mã<input className="sl-in" value={form.code || ''} disabled={!form.moi} placeholder="vd: bao_hiem"
          onChange={e => set('code', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} /></label>
        <label className="wide">Tên<input className="sl-in" value={form.name || ''} onChange={e => set('name', e.target.value)} /></label>
        <label>Nhóm
          <select className="sl-in" value={form.grp} disabled={auto}
            onChange={e => setForm(f => ({ ...f, grp: e.target.value,
              behavior: ['doanh_thu', 'thue'].includes(e.target.value) ? '' : (f.behavior || 'co_dinh') }))}>
            {GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
        <label>Cố định / biến đổi
          <select className="sl-in" value={noBehavior ? '' : (form.behavior || '')} disabled={noBehavior}
            onChange={e => set('behavior', e.target.value)}>
            {noBehavior && <option value="">— không áp dụng —</option>}
            <option value="co_dinh">Cố định</option>
            <option value="bien_doi">Biến đổi</option>
          </select>
        </label>
        <label>Trần % doanh thu<input className="sl-in num" value={form.cap_pct ?? ''} placeholder="để trống = chưa đặt"
          onChange={e => set('cap_pct', e.target.value)} /></label>
        <label>Thứ tự<input className="sl-in num" value={form.sort ?? 100} onChange={e => set('sort', e.target.value)} /></label>
        <label className="wide">Ghi chú / giả định<input className="sl-in" value={form.note || ''} onChange={e => set('note', e.target.value)} /></label>
        <label className="bg-chk"><input type="checkbox" checked={form.active !== false}
          onChange={e => set('active', e.target.checked)} /> Đang dùng</label>
      </div>
      {!form.moi || codeOk ? null : <p className="bg-note bad">Mã: chữ thường không dấu, số, gạch dưới; bắt đầu bằng chữ.</p>}
      {dup && <p className="bg-note bad">Mã "{form.code}" đã có.</p>}
      {!capOk && <p className="bg-note bad">Trần % phải từ 0 đến 100.</p>}
      <div className="bg-form-act">
        <button className="btn-ghost" onClick={() => setForm(null)}>Huỷ</button>
        <button className="btn-primary"
          disabled={busy || !form.name?.trim() || (form.moi && (!codeOk || dup)) || !capOk}
          onClick={() => onSave({
            code: form.code, name: form.name.trim(), grp: form.grp,
            behavior: noBehavior ? null : (form.behavior || 'co_dinh'),
            cap_pct: cap, sort: parseInt(form.sort, 10) || 100,
            active: form.active !== false, note: form.note?.trim() || null,
          })}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      </div>
    </div>
  )
}
