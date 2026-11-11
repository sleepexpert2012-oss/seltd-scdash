import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ComposedChart, Line, Bar, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import arFile from '../data/receivable.json'
import {
  fetchKpi, saveKpiDept, saveKpiObjective, saveKpiDef, saveKpiAssign, saveKpiValues, fetchSales,
} from '../lib/cloud'
import { PERSPECTIVES, RATING, ratingOf, autoValues, score, parseNum } from '../lib/kpi'
import { ymList, LAST_FULL_YM } from '../lib/fin'
import './pnl.css'
import './costnorm.css'
import './budget.css'
import './strategy.css'

/* ============================================================
   CHIẾN LƯỢC & KPI — CẤP PHÒNG BAN
   Một mạch: mục tiêu → KPI → phòng ban chịu trách nhiệm → kết quả.
   KHÔNG có tên hay điểm cá nhân (quyết định 11/11/2026): trang công khai,
   dữ liệu đọc được bằng khoá anon. Cách tính ở src/lib/kpi.js.
   ============================================================ */

const TABS = [['map', '◈', 'Bản đồ chiến lược'], ['lib', '≡', 'Thư viện KPI'], ['dept', '⌂', 'Phòng ban'], ['assign', '⇢', 'Giao KPI'], ['track', '▤', 'Theo dõi']]
const nf = d => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d })
const pc = v => (v == null ? '—' : `${nf(1).format(v * 100)}%`)
const fmtV = (v, unit) => (v == null ? '' : unit === 'đ' ? nf(0).format(v) : nf(2).format(v))
const AUTO_SRC = { dt_cty: 'Tổng quan / Lãi lỗ', bien_gop: 'Lãi lỗ', roas: 'Marketing / Điểm hòa vốn', phi_san_pct: 'Lãi lỗ → Phí sàn',
  ty_le_hoan: 'Lãi lỗ', don_shopee: 'Tổng quan', dso_ngoai: 'Dòng tiền → Vốn lưu động' }

export default function Strategy() {
  const [tab, setTab] = useState('map')
  const [K, setK] = useState(null)
  const [ar, setAr] = useState(arFile)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const yNow = LAST_FULL_YM ? +LAST_FULL_YM.slice(0, 4) : new Date().getFullYear()
  const [year, setYear] = useState(yNow)
  const [per, setPer] = useState('ytd')

  const load = () => fetchKpi().then(setK).catch(e => setMsg({ t: 'bad', s: e.message }))
  useEffect(() => { load(); fetchSales().then(setAr).catch(() => {}) }, [])

  const auto = useMemo(() => autoValues(year, ar), [year, ar])
  const full = ymList(year).filter(ym => LAST_FULL_YM && ym <= LAST_FULL_YM)
  const yms = per === 'ytd' ? full : [per]
  const S = useMemo(() => (K?.ok ? score(K, yms, auto) : null), [K, yms.join(), auto])

  async function run(fn, ok) {
    setBusy(true); setMsg(null)
    try { await fn(); await load(); setMsg({ t: 'ok', s: ok }); return true }
    catch (e) { setMsg({ t: 'bad', s: `CHƯA lưu được: ${e.message}` }); return false }
    finally { setBusy(false) }
  }

  return (
    <div className="pl-page st-page">
      <div className="m2-title">
        <div>
          <h2>Chiến lược &amp; KPI</h2>
          <p>
            Một mạch: <b>mục tiêu chiến lược → KPI → phòng ban chịu trách nhiệm → kết quả</b>. Theo dõi ở cấp
            <b> phòng ban</b> — không lưu tên hay điểm cá nhân vì trang này đọc được công khai. KPI tự động lấy
            đúng số các màn khác đang tính, không nhập tay trùng.
          </p>
        </div>
        <div className="sl-acts">
          <label className="bg-unit">Năm<select value={year} onChange={e => { setYear(+e.target.value); setPer('ytd') }}>
            {[yNow, yNow - 1].map(y => <option key={y}>{y}</option>)}</select></label>
          <label className="bg-unit">Kỳ<select value={per} onChange={e => setPer(e.target.value)}>
            <option value="ytd">Lũy kế {full.length ? `T1–T${+full[full.length - 1].slice(5)}` : ''}</option>
            {full.map(ym => <option key={ym} value={ym}>Tháng {+ym.slice(5)}</option>)}
          </select></label>
        </div>
      </div>

      <div className="mk-tabbar">
        <div className="mk-tabs">
          {TABS.map(([id, ic, lb]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              <span className="ic" aria-hidden>{ic}</span>{lb}
              {K?.ok && id !== 'track' && <em>{{ map: K.objs.length, lib: K.defs.length, dept: K.depts.length, assign: K.assigns.length }[id]}</em>}
            </button>
          ))}
        </div>
      </div>

      {msg && <div className={`cf-msg t-${msg.t}`}>{msg.s}</div>}
      {!K && <section className="m2-panel"><p className="pl-empty">Đang tải…</p></section>}
      {K && !K.ok && (
        <section className="m2-panel pp-empty">
          <h3>Chưa có bảng KPI trên Supabase</h3>
          <p>Cần chạy <code>scripts/shopee/schema_kpi.sql</code> (bảng <code>kpi_*</code>, chỉ cấp phòng ban).</p>
        </section>
      )}
      {K?.ok && !K.depts.length && tab !== 'dept' && tab !== 'lib' && (
        <div className="pl-warn soft">
          <b>Bắt đầu trong 4 bước</b>
          <p>① Khai <b>phòng ban</b> (tab Phòng ban) → ② tạo <b>mục tiêu</b> theo 4 góc nhìn (tab Bản đồ) → ③ <b>giao KPI</b>
            cho phòng ban kèm trọng số đủ 100% → ④ nhập <b>mục tiêu từng tháng</b> (và thực tế với KPI nhập tay). App không tạo sẵn số mẫu.</p>
        </div>
      )}

      {K?.ok && S && tab === 'map' && <MapTab K={K} S={S} busy={busy} run={run} />}
      {K?.ok && tab === 'lib' && <LibTab K={K} busy={busy} run={run} />}
      {K?.ok && tab === 'dept' && <DeptTab K={K} S={S} busy={busy} run={run} />}
      {K?.ok && S && tab === 'assign' && <AssignTab K={K} S={S} year={year} auto={auto} busy={busy} run={run} />}
      {K?.ok && S && tab === 'track' && <TrackTab K={K} S={S} full={full} auto={auto} per={per} />}
    </div>
  )
}

/* ================= BẢN ĐỒ CHIẾN LƯỢC ================= */
function MapTab({ K, S, busy, run }) {
  const [form, setForm] = useState(null)
  const box = useRef(null)
  const [arrows, setArrows] = useState([])
  const deptName = Object.fromEntries(K.depts.map(d => [d.code, d.name]))
  useLayoutEffect(() => {
    if (!box.current) return
    const base = box.current.getBoundingClientRect()
    const pos = {}
    box.current.querySelectorAll('[data-obj]').forEach(el => {
      const r = el.getBoundingClientRect()
      pos[el.dataset.obj] = { x: r.left - base.left + r.width / 2, top: r.top - base.top, bot: r.bottom - base.top }
    })
    setArrows(S.objs.filter(o => o.parent_id && pos[o.id] && pos[o.parent_id]).map(o => {
      const a = pos[o.id], b = pos[o.parent_id]
      return { id: o.id, x1: a.x, y1: a.top, x2: b.x, y2: b.bot }
    }))
  }, [S.objs, form])
  const save = f => run(() => saveKpiObjective({ ...f, parent_id: f.parent_id || null, dept: f.dept || null }),
    `Đã lưu mục tiêu "${f.name}".`).then(ok => ok && setForm(null))

  return (
    <>
      <section className="m2-panel">
        <div className="bg-bar">
          <span className="bg-help inline">Mỗi dải là một góc nhìn BSC. Thẻ là mục tiêu; % đạt tự gộp từ các KPI đã giao. Mũi tên: mục tiêu dưới <b>phục vụ</b> mục tiêu trên.</span>
          <span className="sp" />
          <button className="btn-primary" disabled={busy} onClick={() => setForm({ perspective: 'tai_chinh', name: '', dept: '', parent_id: '', sort: 100 })}>+ Mục tiêu</button>
        </div>
        {form && <ObjForm f={form} setF={setForm} K={K} busy={busy} onSave={save} />}
      </section>
      <div className="st-map" ref={box}>
        <svg className="st-arrows">
          <defs><marker id="st-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#232A6B" /></marker></defs>
          {arrows.map(a => <path key={a.id} d={`M${a.x1},${a.y1} C${a.x1},${(a.y1 + a.y2) / 2} ${a.x2},${(a.y1 + a.y2) / 2} ${a.x2},${a.y2 + 2}`} markerEnd="url(#st-ah)" />)}
        </svg>
        {PERSPECTIVES.map(([id, lb]) => {
          const os = S.objs.filter(o => o.perspective === id)
          return (
            <div key={id} className={`st-band b-${id}`}>
              <div className="st-bh"><b>{lb}</b><span>{os.length} mục tiêu</span></div>
              <div className="st-cards">
                {os.map(o => {
                  const r = ratingOf(o.ach)
                  return (
                    <button key={o.id} data-obj={o.id} className="st-card" onClick={() => setForm({ ...o, parent_id: o.parent_id || '', dept: o.dept || '' })}>
                      <b>{o.name}</b>
                      {o.dept && <span className="st-dep">{deptName[o.dept] || o.dept}</span>}
                      {o.nKpi ? (
                        <>
                          <div className="st-row"><span>{o.nKpi} KPI đã giao</span>{o.ach != null ? <em className={`r-${r[2]}`}>Đạt {pc(o.ach)}</em> : <em className="r-na">chưa có số</em>}</div>
                          <i className="st-bar"><i style={{ width: `${Math.min(100, (o.ach || 0) / 1.2 * 100)}%` }} className={`r-${r?.[2] || 'na'}`} /></i>
                          <div className="st-cnt">{RATING.map(([, l, k]) => o.cnt[k] ? <span key={k} className={`r-${k}`}>● {o.cnt[k]} {l.toLowerCase()}</span> : null)}</div>
                        </>
                      ) : <span className="st-none">Chưa giao KPI nào</span>}
                    </button>
                  )
                })}
                {!os.length && <span className="st-empty">— chưa có mục tiêu —</span>}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function ObjForm({ f, setF, K, busy, onSave }) {
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  return (
    <div className="bg-form">
      <h4>{f.id ? 'Sửa mục tiêu' : 'Mục tiêu mới'}</h4>
      <div className="sl-form">
        <label>Góc nhìn<select className="sl-in" value={f.perspective} onChange={e => set('perspective', e.target.value)}>{PERSPECTIVES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="wide">Tên mục tiêu<input className="sl-in" value={f.name} placeholder="vd: Tăng doanh thu 20%" onChange={e => set('name', e.target.value)} /></label>
        <label>Phòng chủ trì<select className="sl-in" value={f.dept} onChange={e => set('dept', e.target.value)}><option value="">—</option>{K.depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></label>
        <label>Phục vụ cho mục tiêu<select className="sl-in" value={f.parent_id} onChange={e => set('parent_id', e.target.value)}><option value="">—</option>{K.objs.filter(o => o.id !== f.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label>Thứ tự<input className="sl-in num" value={f.sort} onChange={e => set('sort', e.target.value)} /></label>
        <label className="bg-chk"><input type="checkbox" checked={f.active !== false} onChange={e => set('active', e.target.checked)} /> Đang dùng</label>
      </div>
      <div className="bg-form-act">
        <button className="btn-ghost" onClick={() => setF(null)}>Huỷ</button>
        <button className="btn-primary" disabled={busy || !f.name.trim()} onClick={() => onSave({ ...f, sort: parseInt(f.sort, 10) || 100 })}>Lưu</button>
      </div>
    </div>
  )
}

/* ================= THƯ VIỆN KPI ================= */
function LibTab({ K, busy, run }) {
  const [form, setForm] = useState(null)
  const set = (k, v) => setForm(x => ({ ...x, [k]: v }))
  const codeOk = form && /^[a-z][a-z0-9_]{1,39}$/.test(form.code || '')
  return (
    <section className="m2-panel">
      <div className="bg-bar">
        <span className="bg-help inline">KPI <em className="auto">tự động</em> lấy số từ màn khác — chỉ sửa được tên và chiều tốt. KPI nhập tay thì phòng ban tự nhập thực tế hằng tháng.</span>
        <span className="sp" />
        <button className="btn-primary" disabled={busy} onClick={() => setForm({ moi: true, code: '', name: '', unit: '', direction: 'up', formula: '', freq: 'thang' })}>+ KPI nhập tay</button>
      </div>
      {form && (
        <div className="bg-form">
          <h4>{form.moi ? 'KPI nhập tay mới' : `Sửa ${form.code}`}</h4>
          <div className="sl-form">
            <label>Mã<input className="sl-in" disabled={!form.moi} value={form.code} placeholder="vd: nps" onChange={e => set('code', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} /></label>
            <label className="wide">Tên<input className="sl-in" value={form.name} onChange={e => set('name', e.target.value)} /></label>
            <label>Đơn vị<input className="sl-in" value={form.unit} placeholder="%, đ, ngày, điểm…" onChange={e => set('unit', e.target.value)} /></label>
            <label>Chiều tốt<select className="sl-in" value={form.direction} onChange={e => set('direction', e.target.value)}><option value="up">Cao là tốt</option><option value="down">Thấp là tốt</option></select></label>
            <label className="wide">Công thức / cách đo<input className="sl-in" value={form.formula || ''} onChange={e => set('formula', e.target.value)} /></label>
          </div>
          {form.moi && form.code && !codeOk && <p className="bg-note bad">Mã: chữ thường không dấu, số, gạch dưới; bắt đầu bằng chữ.</p>}
          <div className="bg-form-act">
            <button className="btn-ghost" onClick={() => setForm(null)}>Huỷ</button>
            <button className="btn-primary" disabled={busy || !form.name.trim() || (form.moi && !codeOk)}
              onClick={() => run(() => saveKpiDef(form), `Đã lưu KPI ${form.code}.`).then(ok => ok && setForm(null))}>Lưu</button>
          </div>
        </div>
      )}
      <table className="sl-tb">
        <thead><tr><th>Mã</th><th>KPI</th><th>Đơn vị</th><th>Chiều tốt</th><th>Nguồn số</th><th>Công thức</th><th /></tr></thead>
        <tbody>
          {K.defs.map(d => (
            <tr key={d.code}>
              <td className="mono">{d.code}</td><td><b>{d.name}</b></td><td>{d.unit}</td>
              <td>{d.direction === 'up' ? '↑ cao là tốt' : '↓ thấp là tốt'}</td>
              <td>{d.source === 'auto' ? <span className="sl-tag mid">tự động · {AUTO_SRC[d.auto_key] || d.auto_key}</span> : <span className="sl-tag off">nhập tay</span>}</td>
              <td className="sm">{d.formula}</td>
              <td><button className="btn-ghost sm" onClick={() => setForm({ ...d })}>Sửa</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/* ================= PHÒNG BAN ================= */
function DeptTab({ K, S, busy, run }) {
  const [form, setForm] = useState(null)
  const set = (k, v) => setForm(x => ({ ...x, [k]: v }))
  const codeOk = form && /^[a-z][a-z0-9_]{1,29}$/.test(form.code || '')
  const sc = Object.fromEntries((S?.depts || []).map(d => [d.code, d]))
  return (
    <section className="m2-panel">
      <div className="bg-bar">
        <span className="bg-help inline">Chỉ cấp phòng ban — không khai nhân sự.</span>
        <span className="sp" />
        <button className="btn-primary" disabled={busy} onClick={() => setForm({ moi: true, code: '', name: '', sort: 100, active: true })}>+ Phòng ban</button>
      </div>
      {form && (
        <div className="bg-form">
          <h4>{form.moi ? 'Phòng ban mới' : `Sửa ${form.name}`}</h4>
          <div className="sl-form">
            <label>Mã<input className="sl-in" disabled={!form.moi} value={form.code} placeholder="vd: kinh_doanh" onChange={e => set('code', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} /></label>
            <label className="wide">Tên<input className="sl-in" value={form.name} onChange={e => set('name', e.target.value)} /></label>
            <label>Thứ tự<input className="sl-in num" value={form.sort} onChange={e => set('sort', e.target.value)} /></label>
            <label className="bg-chk"><input type="checkbox" checked={form.active !== false} onChange={e => set('active', e.target.checked)} /> Đang dùng</label>
          </div>
          <div className="bg-form-act">
            <button className="btn-ghost" onClick={() => setForm(null)}>Huỷ</button>
            <button className="btn-primary" disabled={busy || !form.name.trim() || (form.moi && !codeOk)}
              onClick={() => run(() => saveKpiDept({ ...form, sort: parseInt(form.sort, 10) || 100 }), `Đã lưu phòng ${form.name}.`).then(ok => ok && setForm(null))}>Lưu</button>
          </div>
        </div>
      )}
      <table className="sl-tb">
        <thead><tr><th>Mã</th><th>Phòng ban</th><th className="num">KPI được giao</th><th className="num">Tổng trọng số</th><th>Trạng thái</th><th /></tr></thead>
        <tbody>
          {K.depts.map(d => (
            <tr key={d.code} className={d.active === false ? 'dim' : ''}>
              <td className="mono">{d.code}</td><td><b>{d.name}</b></td>
              <td className="num">{sc[d.code]?.nKpi ?? 0}</td>
              <td className={`num ${sc[d.code] && !sc[d.code].wOk && sc[d.code].nKpi ? 'st-bad' : ''}`}>{sc[d.code] ? `${nf(1).format(sc[d.code].wSum)}%` : '—'}</td>
              <td>{d.active === false ? <span className="sl-tag off">đã tắt</span> : <span className="sl-tag on">đang dùng</span>}</td>
              <td><button className="btn-ghost sm" onClick={() => setForm({ ...d })}>Sửa</button></td>
            </tr>
          ))}
          {!K.depts.length && <tr><td colSpan={6} className="sl-empty">Chưa có phòng ban.</td></tr>}
        </tbody>
      </table>
    </section>
  )
}

/* ================= GIAO KPI ================= */
function AssignTab({ K, S, year, auto, busy, run }) {
  const [form, setForm] = useState(null)
  const [sel, setSel] = useState(null)
  const [edit, setEdit] = useState({})
  const defOf = Object.fromEntries(K.defs.map(d => [d.code, d]))
  const objOf = Object.fromEntries(K.objs.map(o => [o.id, o]))
  const deptOf = Object.fromEntries(K.depts.map(d => [d.code, d]))
  const set = (k, v) => setForm(x => ({ ...x, [k]: v }))
  const a = K.assigns.find(x => x.id === sel)
  const d = a && defOf[a.kpi]
  const vals = Object.fromEntries(K.values.filter(v => v.assign_id === sel).map(v => [v.ym, v]))
  const yms = ymList(year)
  useEffect(() => setEdit({}), [sel])
  const nEdit = Object.keys(edit).length
  const bad = Object.values(edit).some(v => Number.isNaN(v))

  return (
    <>
      <section className="m2-panel">
        <div className="bg-bar">
          <span className="bg-help inline">Gắn KPI vào mục tiêu và phòng ban. Trọng số các KPI của một phòng phải cộng đủ <b>100%</b>.</span>
          <span className="sp" />
          <button className="btn-primary" disabled={busy || !K.depts.length} onClick={() => setForm({ kpi: K.defs[0]?.code, objective_id: '', dept: K.depts[0]?.code, weight: 0, active: true })}>+ Giao KPI</button>
        </div>
        {S.depts.filter(x => x.nKpi && !x.wOk).map(x => (
          <div key={x.code} className="cf-msg t-warn">Phòng {x.name}: tổng trọng số {nf(1).format(x.wSum)}% — chưa đủ 100%. Điểm phòng chỉ là <b>tạm tính</b> trên phần trọng số đã khai và phòng <b>không được xếp hạng</b> cho tới khi đủ 100%.</div>
        ))}
        {form && (
          <div className="bg-form">
            <h4>{form.id ? 'Sửa KPI đã giao' : 'Giao KPI'}</h4>
            <div className="sl-form">
              <label className="wide">KPI<select className="sl-in" value={form.kpi} onChange={e => set('kpi', e.target.value)}>{K.defs.filter(x => x.active !== false).map(x => <option key={x.code} value={x.code}>{x.name}{x.source === 'auto' ? ' (tự động)' : ''}</option>)}</select></label>
              <label>Phòng ban<select className="sl-in" value={form.dept} onChange={e => set('dept', e.target.value)}>{K.depts.map(x => <option key={x.code} value={x.code}>{x.name}</option>)}</select></label>
              <label className="wide">Phục vụ mục tiêu<select className="sl-in" value={form.objective_id || ''} onChange={e => set('objective_id', e.target.value)}><option value="">—</option>{K.objs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
              <label>Trọng số %<input className="sl-in num" value={form.weight} onChange={e => set('weight', e.target.value)} /></label>
              <label className="bg-chk"><input type="checkbox" checked={form.active !== false} onChange={e => set('active', e.target.checked)} /> Đang dùng</label>
            </div>
            <div className="bg-form-act">
              <button className="btn-ghost" onClick={() => setForm(null)}>Huỷ</button>
              <button className="btn-primary" disabled={busy || !(parseNum(form.weight) >= 0 && parseNum(form.weight) <= 100)}
                onClick={() => run(() => saveKpiAssign({ ...form, weight: parseNum(form.weight), objective_id: form.objective_id || null }), 'Đã lưu.').then(ok => ok && setForm(null))}>Lưu</button>
            </div>
          </div>
        )}
        <table className="sl-tb">
          <thead><tr><th>KPI</th><th>Phòng ban</th><th>Mục tiêu</th><th className="num">Trọng số</th><th className="num">Đạt kỳ này</th><th /></tr></thead>
          <tbody>
            {S.rows.map(r => (
              <tr key={r.id} className={sel === r.id ? 'st-sel' : ''}>
                <td><button className="cn-name" onClick={() => setSel(r.id)}>{r.def.name}</button>{r.def.source === 'auto' && <em className="pp-auto"> tự động</em>}</td>
                <td>{deptOf[r.dept]?.name || r.dept}</td><td className="sm">{objOf[r.objective_id]?.name || '—'}</td>
                <td className="num">{nf(1).format(r.weight)}%</td>
                <td className="num">{r.ach == null ? <span className="dim">{r.noTarget ? 'chưa có mục tiêu' : 'chưa có số'}</span> : <b className={`r-${ratingOf(r.ach)[2]}`}>{pc(r.ach)}</b>}</td>
                <td><button className="btn-ghost sm" onClick={() => setForm({ ...r, objective_id: r.objective_id || '' })}>Sửa</button></td>
              </tr>
            ))}
            {!S.rows.length && <tr><td colSpan={6} className="sl-empty">Chưa giao KPI nào.</td></tr>}
          </tbody>
        </table>
      </section>

      {a && d && (
        <section className="m2-panel">
          <div className="bg-bar">
            <span className="bg-help inline"><b>{d.name}</b> · {deptOf[a.dept]?.name} · đơn vị {d.unit || '—'} · {d.direction === 'up' ? 'cao là tốt' : 'thấp là tốt'} — mục tiêu và thực tế từng tháng năm {year}</span>
            <span className="sp" />
            <button className="btn-ghost" disabled={!nEdit} onClick={() => setEdit({})}>Bỏ thay đổi</button>
            <button className="btn-primary" disabled={busy || !nEdit || bad}
              onClick={() => run(() => saveKpiValues(Object.entries(edit).map(([k, v]) => { const [ym, f] = k.split('|'); return { assign_id: a.id, ym, [f]: v } })), `Đã lưu ${nEdit} ô.`).then(ok => ok && setEdit({}))}>
              {nEdit ? `Lưu ${nEdit} ô` : 'Đã lưu'}
            </button>
          </div>
          <div className="bg-wrap">
            <table className="bg-grid">
              <thead><tr><th className="lbl" />{yms.map(ym => <th key={ym} className="num">T{+ym.slice(5)}</th>)}</tr></thead>
              <tbody>
                {['target', 'actual'].map(f => (
                  <tr key={f}>
                    <td className="lbl"><span className="nm">{f === 'target' ? 'Mục tiêu' : 'Thực tế'}</span>{f === 'actual' && d.source === 'auto' && <span className="meta"><em className="auto">tự động</em></span>}</td>
                    {yms.map(ym => {
                      if (f === 'actual' && d.source === 'auto') {
                        const v = auto[d.auto_key]?.[ym]
                        return <td key={ym} className="num"><span className="bg-cell off">{v == null ? '' : fmtV(v, d.unit)}</span></td>
                      }
                      const k = `${ym}|${f}`
                      const cur = k in edit ? edit[k] : (vals[ym]?.[f] == null ? null : Number(vals[ym][f]))
                      return (
                        <td key={ym} className="num cellwrap">
                          <input key={`${sel}-${k}-${vals[ym]?.[f]}`} className={`bg-in ${k in edit ? 'dirty' : ''} ${Number.isNaN(cur) ? 'bad' : ''}`}
                            defaultValue={cur == null || Number.isNaN(cur) ? '' : fmtV(cur, d.unit)}
                            onBlur={e => { const v = parseNum(e.target.value); const old = vals[ym]?.[f] == null ? null : Number(vals[ym][f]); setEdit(x => { const n = { ...x }; if (v === old) delete n[k]; else n[k] = v; return n }) }} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="bg-derived"><td className="lbl">% đạt</td>{yms.map(ym => { const m = S.rows.find(r => r.id === a.id)?.months.find(x => x.ym === ym); return <td key={ym} className="num">{m?.ach == null ? '' : pc(m.ach)}</td> })}</tr>
              </tbody>
            </table>
          </div>
          <p className="pl-note">% đạt chỉ hiện cho tháng trong kỳ đang xem có cả mục tiêu và thực tế; chặn trên 120%.</p>
        </section>
      )}
    </>
  )
}

/* ================= THEO DÕI ================= */
function TrackTab({ K, S, full, auto, per }) {
  const [dept, setDept] = useState('')
  const trend = full.map(ym => {
    const s = score(K, [ym], auto)
    const ds = dept ? s.depts.find(d => d.code === dept)?.score : s.overall
    return { lb: `T${+ym.slice(5)}`, v: ds == null ? null : ds * 100 }
  })
  const bars = S.depts.filter(d => d.nKpi).map(d => ({ k: d.name, v: d.score == null ? 0 : d.score * 100, r: d.rating?.[2] || 'na', n: d.nKpi }))
  const COL = { xs: '#1F7A45', tot: '#353E99', dat: '#D97706', chua: '#B42318', na: '#C9CDE0' }
  const rows = S.rows.filter(r => !dept || r.dept === dept)
  return (
    <>
      <section className="m2-panel">
        <div className="pp-bar">
          <label>Phòng ban<select value={dept} onChange={e => setDept(e.target.value)}><option value="">Tất cả</option>{K.depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></label>
          <span className="cn-ver">Kỳ: {per === 'ytd' ? 'lũy kế' : `tháng ${+per.slice(5)}`} · xếp loại: Xuất sắc ≥100% · Tốt 80–99% · Đạt 60–79% · Chưa đạt &lt;60%</span>
        </div>
      </section>
      <div className="mk-kpis cn-kpis">
        <div className="mk-kpi"><span className="k">Hoàn thành tổng KPI</span><strong>{pc(S.overall)}</strong><span className="sub">bình quân trọng số mọi KPI có số</span></div>
        <div className="mk-kpi"><span className="k">Điểm bình quân phòng ban</span><strong>{pc(S.avgDept)}</strong><span className="sub">{S.ranked.length} phòng đủ điều kiện xếp hạng</span></div>
        <div className="mk-kpi"><span className="k">Phân bố xếp loại</span><strong className="st-dist">{S.dist.map(x => <span key={x.k} className={`r-${x.k}`}>{x.n}</span>)}</strong><span className="sub">{S.dist.map(x => x.lb).join(' · ')}</span></div>
        <div className="mk-kpi"><span className="k">KPI chưa có số</span><strong>{S.rows.filter(r => r.ach == null).length}/{S.rows.length}</strong><span className="sub">chưa có mục tiêu hoặc thực tế trong kỳ</span></div>
      </div>
      <div className="pl-row2 st-row2">
        <section className="m2-panel">
          <div className="m2-head"><h3>Điểm theo phòng ban</h3><span>% đạt bình quân trọng số · đường đỏ = 100%</span></div>
          <ResponsiveContainer width="100%" height={Math.max(160, bars.length * 38 + 30)}>
            <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#E7E9F3" horizontal={false} />
              <XAxis type="number" domain={[0, 120]} unit="%" tick={{ fontSize: 10, fill: '#8E93B5' }} />
              <YAxis type="category" dataKey="k" width={130} tick={{ fontSize: 11, fill: '#232A6B' }} />
              <Tooltip formatter={v => `${nf(1).format(v)}%`} />
              <ReferenceLine x={100} stroke="#B42318" strokeDasharray="4 3" />
              <Bar dataKey="v" radius={[0, 3, 3, 0]}>{bars.map(b => <Cell key={b.k} fill={COL[b.r]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="m2-panel">
          <div className="m2-head"><h3>Xu hướng theo tháng</h3><span>{dept ? K.depts.find(d => d.code === dept)?.name : 'Toàn công ty'} · % đạt</span></div>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#E7E9F3" vertical={false} />
              <XAxis dataKey="lb" tick={{ fontSize: 10, fill: '#8E93B5' }} />
              <YAxis unit="%" tick={{ fontSize: 10, fill: '#8E93B5' }} width={40} />
              <Tooltip formatter={v => (v == null ? '—' : `${nf(1).format(v)}%`)} />
              <ReferenceLine y={100} stroke="#B42318" strokeDasharray="4 3" />
              <Line dataKey="v" name="% đạt" stroke="#353E99" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
      </div>
      <section className="m2-panel">
        <div className="m2-head"><h3>Bảng xếp hạng phòng ban</h3><span>Không xếp hạng: phòng dưới 2 KPI (ít KPI dễ điểm cao) hoặc trọng số chưa đủ 100%</span></div>
        <table className="pl-table">
          <thead><tr><th>Hạng</th><th>Phòng ban</th><th className="num">Số KPI</th><th className="num">Trọng số</th><th className="num">Điểm</th><th>Xếp loại</th></tr></thead>
          <tbody>
            {S.depts.filter(d => d.nKpi).sort((a, b) => (b.rankable - a.rankable) || ((b.score ?? -1) - (a.score ?? -1))).map(d => (
              <tr key={d.code}>
                <td>{d.rankable ? S.ranked.indexOf(S.ranked.find(x => x.code === d.code)) + 1 : '—'}</td>
                <td><b>{d.name}</b></td><td className="num">{d.nKpi}</td>
                <td className={`num ${d.wOk ? '' : 'st-bad'}`}>{nf(1).format(d.wSum)}%</td>
                <td className="num">{pc(d.score)}{d.score != null && !d.wOk ? <small className="st-tam"> tạm tính</small> : null}</td>
                <td>{d.rating ? <span className={`st-rt r-${d.rating[2]}`}>{d.rating[1]}</span> : <span className="dim">chưa có số</span>}
                  {!d.rankable && d.score != null && <small className="st-tam"> · {d.nKpi < 2 ? 'dưới 2 KPI' : 'trọng số chưa đủ 100%'}</small>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="m2-panel">
        <div className="m2-head"><h3>Chi tiết KPI</h3><span>{rows.length} KPI</span></div>
        <table className="pl-table">
          <thead><tr><th>KPI</th><th>Phòng</th><th className="num">Trọng số</th><th className="num">Tháng có số</th><th className="num">% đạt</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}><td>{r.def.name}{r.def.source === 'auto' && <em className="pp-auto"> tự động</em>}</td><td>{K.depts.find(x => x.code === r.dept)?.name}</td>
              <td className="num">{nf(1).format(r.weight)}%</td><td className="num">{r.nMonths}</td>
              <td className="num">{r.ach == null ? <span className="dim">chưa có số</span> : <b className={`r-${ratingOf(r.ach)[2]}`}>{pc(r.ach)}</b>}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </>
  )
}
