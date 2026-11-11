import { useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend, PieChart, Pie, Cell,
} from 'recharts'
import arFile from '../data/receivable.json'
import { fetchFin, fetchSales, saveFinLine } from '../lib/cloud'
import {
  GROUPS, GROUP_OF, BEHAVIOR, ymList, ymLabel, actualByMonth, planByMonth, coverage, costNorm,
  revenueByMonth, platformMonthly, defaultUpto, baseOf, LAST_DATA_YM, NORM_WARN,
} from '../lib/fin'
import { MONTHS } from '../lib/metrics'
import { xuatBang } from '../lib/xlsxBang'
import './pnl.css'
import './costnorm.css'

/* ============================================================
   ĐỊNH MỨC CHI PHÍ
   Câu hỏi: khoản chi nào đang ăn quá phần của nó trong mỗi đồng doanh thu,
   vượt bao nhiêu TIỀN, và cắt ở đâu trước?
   Cách tính nằm ở src/lib/fin.js → costNorm(). Trần % và cố định/biến đổi
   khai ở màn Kế hoạch & Ngân sách (tab Khoản mục) hoặc sửa ngay trên bảng.
   ============================================================ */

const C = {
  navy: '#232A6B', blue: '#353E99', soft: '#A9AFE0', bad: '#B42318', good: '#1F7A45',
  amber: '#D97706', grid: '#E7E9F3', axis: '#8E93B5',
}
const GROUP_COLOR = { gia_von: '#232A6B', phi_san: '#353E99', marketing: '#D97706', opex: '#8E96DC', tai_chinh: '#C9CDE0' }
const nf = d => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d })
const tr = v => `${nf(1).format((v || 0) / 1e6)} tr`
const pc = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${nf(d).format(v * 100)}%`)
const STATUS = {
  over: ['Vượt', 'bad'], warn: ['Cần chú ý', 'mid'], ok: ['Trong định mức', 'on'],
  nocap: ['Chưa đặt trần', 'off'], noplan: ['Chưa có ngân sách', 'off'], none: ['Chưa nhập', 'off'],
}
const short = n => {
  const t = n.replace(/^Phí sàn · /, 'Phí sàn: ').replace(/^Chi trả /, '').replace(/^Chi phí /, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const BASE_TXT = { san: 'Shopee', ngoai: 'ngoài sàn', tong: 'toàn công ty' }

export default function CostNorm() {
  const [db, setDb] = useState(null)
  const [err, setErr] = useState(null)
  const [ar, setAr] = useState(arFile)
  const yNow = LAST_DATA_YM ? +LAST_DATA_YM.slice(0, 4) : new Date().getFullYear()
  const [year, setYear] = useState(yNow)
  const [per, setPer] = useState('lk')
  const [pick, setPick] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => fetchFin().then(d => { setDb(d); setErr(null) }).catch(e => setErr(String(e.message || e)))
  useEffect(() => { load(); fetchSales().then(setAr).catch(() => {}) }, [])

  const upto = defaultUpto(year)
  const periods = useMemo(() => {
    const out = []
    if (upto >= 0) out.push(['lk', `Lũy kế T1–T${upto + 1}`, ymList(year).slice(0, upto + 1)])
    for (let q = 0; q < 4; q++) {
      if (q * 3 + 2 <= upto) out.push([`q${q + 1}`, `Quý ${q + 1}`, ymList(year).slice(q * 3, q * 3 + 3)])
    }
    ymList(year).forEach((ym, i) => { if (i <= upto) out.push([`m${i}`, `Tháng ${i + 1}`, [ym]]) })
    return out
  }, [year, upto])
  const period = (periods.find(p => p[0] === per) || periods[0])?.[2] || []
  const perLabel = (periods.find(p => p[0] === per) || periods[0])?.[1] || ''

  const x = useMemo(() => {
    if (!db || !period.length) return null
    const lines = db.lines.filter(l => l.active !== false)
    const act = actualByMonth(year, lines, db.actual, ar)
    const ver = db.versions.filter(v => v.year === year).sort((a, b) => b.is_current - a.is_current)[0]
    const plan = ver ? planByMonth(ver.version, db.plan) : {}
    const rev = revenueByMonth(year, ar)
    const N = costNorm(lines, act, plan, period, rev)
    const cov = coverage(year, db.lines, db.actual, ar)
    const plat = platformMonthly(year)
    return { lines, act, plan, ver, rev, N, cov, plat }
  }, [db, year, period.join(), ar])

  const years = [...new Set(MONTHS.map(m => +m.slice(0, 4)))].sort((a, b) => b - a)

  async function saveCap(line, raw) {
    const t = String(raw).trim().replace(',', '.')
    const cap = t === '' ? null : Number(t)
    if (cap !== null && !(cap >= 0 && cap <= 100)) { setMsg({ t: 'bad', s: 'Trần % phải từ 0 đến 100.' }); return }
    if ((line.cap_pct == null ? null : Number(line.cap_pct)) === cap) return
    setBusy(true); setMsg(null)
    try {
      await saveFinLine({
        code: line.code, name: line.name, grp: line.grp, behavior: line.behavior,
        cap_pct: cap, sort: line.sort, active: line.active !== false, note: line.note,
      })
      await load()
      setMsg({ t: 'ok', s: `Đã lưu trần ${cap == null ? '(bỏ trần)' : `${nf(2).format(cap)}%`} cho "${short(line.name)}".` })
    } catch (e) { setMsg({ t: 'bad', s: `CHƯA lưu được: ${e.message}` }) }
    finally { setBusy(false) }
  }

  return (
    <div className="pl-page cn-page">
      <div className="m2-title">
        <div>
          <h2>Định mức chi phí</h2>
          <p>
            Khoản chi nào đang ăn quá phần của nó trong mỗi đồng doanh thu, vượt bao nhiêu <b>tiền</b>, và nên
            cắt ở đâu trước. Khoản <b>biến đổi</b> xét theo trần % doanh thu; khoản <b>cố định</b> (lương, thuê
            nhà…) xét theo mức tiêu hao ngân sách — vì % trên doanh thu của chúng tăng khi doanh thu giảm,
            không phải vì chi nhiều hơn.
          </p>
        </div>
      </div>

      <section className="m2-panel">
        <div className="pp-bar">
          <label>Năm
            <select value={year} onChange={e => { setYear(+e.target.value); setPer('lk') }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label>Kỳ
            <select value={per} onChange={e => setPer(e.target.value)}>
              {periods.map(([id, lb]) => <option key={id} value={id}>{lb}</option>)}
            </select>
          </label>
          <span className="sp" />
          {x?.ver && <span className="cn-ver">Ngân sách: <b>{x.ver.name}</b>{x.ver.is_current ? ' (hiện hành)' : ''}</span>}
          {x && <button className="pp-btn" onClick={() => xuat(x, year, perLabel)}>⬇ Xuất Excel</button>}
        </div>
        <p className="pp-scope">
          Mẫu số: <b>phí sàn, quảng cáo và giá vốn trên Shopee</b> chia cho doanh thu thuần Shopee (như màn Lãi lỗ);
          giá vốn ngoài sàn chia doanh thu ngoài sàn; các khoản còn lại là chi phí chung nên chia cho{' '}
          <b>doanh thu toàn công ty</b> (sàn + ngoài sàn, chưa VAT).
          Chỉ tính các tháng đã kết thúc.
        </p>
      </section>

      {msg && <div className={`cf-msg t-${msg.t}`}>{msg.s}</div>}
      {err && <div className="pl-warn"><b>Không tải được dữ liệu ngân sách</b><p>{err}</p></div>}
      {!db && !err && <section className="m2-panel"><p className="pl-empty">Đang tải…</p></section>}
      {db && !period.length && (
        <div className="pl-warn soft"><b>Năm {year} chưa có tháng nào kết thúc</b><p>Chọn năm khác.</p></div>
      )}

      {x && (
        <>
          <Notice x={x} period={period} />
          <Verdict x={x} />
          <Kpis N={x.N} />
          <NormTable x={x} busy={busy} onCap={saveCap} pick={pick} setPick={setPick} />
          <Platform x={x} period={period} />
          <div className="pl-row2">
            <Trend x={x} year={year} pick={pick} setPick={setPick} period={period} />
            <Mix N={x.N} />
          </div>
        </>
      )}
    </div>
  )
}

/* ---------- độ tin của số ---------- */
function Notice({ x, period }) {
  const capN = x.lines.filter(l => l.cap_pct != null).length
  const thieu = x.cov.months.filter(m => period.includes(m.ym) && m.state !== 'full')
  return (
    <>
      {!capN && (
        <div className="pl-warn soft">
          <b>Chưa khoản nào có trần % — bảng mới chỉ so được với ngân sách</b>
          <p>
            Đặt trần ngay trên cột "Trần %" của bảng dưới (ô có chữ <i>gợi ý</i> là bình quân 6 tháng gần nhất
            của chính khoản đó — chỉ để tham khảo, app không tự lưu).
          </p>
        </div>
      )}
      {!x.ver && (
        <div className="pl-warn soft">
          <b>Năm này chưa có phiên bản ngân sách</b>
          <p>Khoản cố định cần ngân sách để biết vượt hay chưa. Tạo ở màn <a href="#/budget">Kế hoạch &amp; Ngân sách</a>.</p>
        </div>
      )}
      {thieu.length > 0 && (
        <div className="pl-warn">
          <b>{thieu.length}/{period.length} tháng trong kỳ chưa đủ chi phí nhập tay</b>
          <p>
            {thieu.map(m => ymLabel(m.ym)).join(', ')}. Khoản chưa nhập được ghi "chưa nhập" và loại khỏi tổng
            và Pareto; khoản nhập thiếu tháng chỉ tính trên các tháng có số.
          </p>
        </div>
      )}
    </>
  )
}

/* ---------- vậy thì sao ---------- */
function Verdict({ x }) {
  const { N } = x
  const top = N.rows.filter(r => r.over > 0).slice(0, 3)
  if (!N.nValid) {
    return <div className="mk-verdict grey"><b>Vậy thì sao</b><p>Kỳ này chưa có chi phí nào có số.</p></div>
  }
  if (!top.length) {
    const judged = N.rows.filter(r => ['ok', 'warn', 'over'].includes(r.status)).length
    return (
      <div className={`mk-verdict ${judged ? 'green' : 'grey'}`}>
        <b>Vậy thì sao</b>
        <p>
          {judged
            ? `Không khoản nào vượt định mức trong kỳ (${judged} khoản đã có trần hoặc ngân sách để xét).`
            : 'Chưa xét được khoản nào: cần đặt trần % cho khoản biến đổi và nhập ngân sách cho khoản cố định.'}
          {' '}{N.nPareto}/{N.nValid} khoản tạo ra 80% chi phí — đó là chỗ đáng soi trước.
        </p>
      </div>
    )
  }
  const sum = top.reduce((s, r) => s + r.over, 0)
  const pts = N.revTong > 0 ? sum / N.revTong : 0
  return (
    <div className="mk-verdict red">
      <b>Vậy thì sao</b>
      <p>
        Kỳ này chi <strong>vượt định mức {tr(N.overTotal)}</strong>. Nhiều nhất:{' '}
        {top.map(r => `${short(r.name)} ${tr(r.over)} (${r.overKind === 'tran'
          ? `${pc(r.pct)} so trần ${pc(r.cap)}` : `tiêu hao ${pc(r.use, 0)} ngân sách`})`).join('; ')}.
        {' '}Đưa {top.length === 1 ? 'khoản này' : `${top.length} khoản này`} về đúng định mức thì biên lợi nhuận
        tăng khoảng <strong>{nf(1).format(pts * 100)} điểm %</strong> doanh thu.
      </p>
    </div>
  )
}

function Kpis({ N }) {
  const K = [
    { k: 'Tổng chi phí thực tế', v: tr(N.total), sub: `${N.nValid} khoản có số · chưa gồm thuế`, tone: '' },
    { k: 'Chênh lệch so ngân sách', v: N.budgetT ? `${N.diff > 0 ? '+' : N.diff < 0 ? '−' : ''}${tr(Math.abs(N.diff))}` : '—',
      sub: N.budgetT ? `ngân sách ${tr(N.budgetT)} (khoản có NS)` : 'chưa có ngân sách', tone: !N.budgetT ? '' : N.diff > 0 ? 'bad' : 'good' },
    { k: 'Tỷ lệ tiêu hao ngân sách', v: pc(N.use, 0), sub: 'thực tế ÷ ngân sách cùng tháng',
      tone: N.use == null ? '' : N.use > 1 ? 'bad' : N.use >= NORM_WARN ? 'amber' : 'good' },
    { k: 'Tập trung chi phí', v: `${N.nPareto}/${N.nValid}`, sub: 'khoản tạo ra 80% tổng chi phí', tone: '' },
  ]
  return (
    <div className="mk-kpis cn-kpis">
      {K.map(x => (
        <div key={x.k} className={`mk-kpi ${x.tone}`}>
          <span className="k">{x.k}</span><strong>{x.v}</strong><span className="sub">{x.sub}</span>
        </div>
      ))}
    </div>
  )
}

/* Gợi ý trần = bình quân % trên doanh thu 6 tháng gần nhất có số của chính khoản đó */
function suggest(x, l) {
  const all = Object.keys(x.rev).sort()
  const b = baseOf(l)
  const ms = all.filter(ym => x.act[l.code]?.[ym] != null && x.rev[ym]?.[b] > 0).slice(-6)
  if (!ms.length) return null
  const a = ms.reduce((s, ym) => s + x.act[l.code][ym], 0)
  const r = ms.reduce((s, ym) => s + x.rev[ym][b], 0)
  return (a / r) * 100
}

function NormTable({ x, busy, onCap, pick, setPick }) {
  const { N } = x
  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Bảng định mức — sắp theo tiền vượt</h3>
        <span>triệu đồng · bấm tên khoản để xem xu hướng · sửa trần % trực tiếp (Enter hoặc rời ô để lưu)</span>
      </div>
      <div className="pp-wrap">
        <table className="pl-table cn-table">
          <thead>
            <tr>
              <th>Khoản mục</th><th>Loại</th>
              <th className="num">Ngân sách</th><th className="num">Thực tế</th><th className="num">Còn lại</th>
              <th>Tiêu hao NS</th><th className="num">% doanh thu</th><th className="num">Trần %</th>
              <th className="num">Vượt trần</th><th className="num">Tiền vượt</th><th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {N.rows.map(r => {
              const [st, cls] = STATUS[r.status]
              const sug = r.cap == null && r.behavior !== 'co_dinh' ? suggest(x, r) : null
              return (
                <tr key={r.code} className={(pick === r.code ? 'sel ' : '') + (r.status === 'none' ? 'dim' : '')}>
                  <td className="lbl">
                    <button className="cn-name" onClick={() => setPick(r.code)} title={r.name}>{short(r.name)}</button>
                    <small>{GROUP_OF[r.grp].label}{r.miss.length && r.months.length ? <em className="pp-miss"> · thiếu {r.miss.length} tháng</em> : null}</small>
                  </td>
                  <td className="sm">{BEHAVIOR[r.behavior] || '—'}</td>
                  <td className="num">{r.hasPlan ? nf(1).format(r.budget / 1e6) : <span className="dim">—</span>}</td>
                  <td className="num b">{r.months.length ? nf(1).format(r.actual / 1e6) : <span className="dim">chưa nhập</span>}</td>
                  <td className={`num ${r.hasPlan && r.remain < 0 ? 'bad' : ''}`}>{r.hasPlan ? nf(1).format(r.remain / 1e6) : '—'}</td>
                  <td>
                    {r.use != null ? (
                      <span className="cn-use">
                        <i style={{ width: `${Math.min(100, r.use * 100)}%` }} className={r.use > 1 ? 'bad' : r.use >= NORM_WARN ? 'mid' : ''} />
                        <b>{pc(r.use, 0)}</b>
                      </span>
                    ) : <span className="dim">—</span>}
                  </td>
                  <td className="num" title={`Mẫu số: doanh thu ${BASE_TXT[r.base]}`}>
                    {pc(r.pct, 2)}<sup className="cn-base">{{ san: 'S', ngoai: 'N', tong: 'T' }[r.base]}</sup>
                  </td>
                  <td className="num">
                    <input key={`${r.code}-${r.cap_pct}`} className="cn-cap" disabled={busy}
                      defaultValue={r.cap_pct == null ? '' : nf(2).format(r.cap_pct)}
                      placeholder={sug != null ? `gợi ý ${nf(1).format(sug)}` : ''}
                      onBlur={e => onCap(r, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                  </td>
                  <td className={`num ${r.overPts > 0 ? 'bad' : ''}`}>
                    {r.overPts == null || r.behavior === 'co_dinh' ? '—' : `${r.overPts > 0 ? '+' : ''}${nf(2).format(r.overPts * 100)} đ%`}
                  </td>
                  <td className={`num b ${r.over > 0 ? 'bad' : ''}`}>
                    {r.over > 0 ? nf(1).format(r.over / 1e6) : '—'}
                    {r.over > 0 && <small>{r.overKind === 'ns' ? 'vượt NS' : 'vượt trần'}</small>}
                  </td>
                  <td><span className={`sl-tag ${cls}`}>{st}</span></td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="lbl"><b>Tổng (khoản có số)</b></td><td />
              <td className="num">{nf(1).format(N.budgetT / 1e6)}</td><td className="num b">{nf(1).format(N.total / 1e6)}</td>
              <td colSpan={5} /><td className="num b bad">{N.overTotal ? nf(1).format(N.overTotal / 1e6) : '—'}</td><td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="pl-note">
        <b>S</b> = chia doanh thu Shopee · <b>N</b> = chia doanh thu ngoài sàn · <b>T</b> = chia doanh thu toàn công ty. Tiền vượt: khoản biến đổi =
        (% thực tế − trần) × doanh thu mẫu số; khoản cố định = thực tế − ngân sách. Ngưỡng "cần chú ý" = từ {pc(NORM_WARN, 0)} trần
        hoặc ngân sách. "Tổng ngân sách" chỉ gồm khoản có ngân sách.
      </p>
    </section>
  )
}

/* ---------- 4 chỉ số riêng của sàn ---------- */
function Platform({ x, period }) {
  const P = x.plat
  const sumOf = (k, list) => list.reduce((s, m) => s + (m[k] || 0), 0)
  const inP = P.filter(m => period.includes(m.ym) && m.rev != null)
  const first = P.findIndex(m => m.ym === period[0])
  const prev = P.slice(Math.max(0, first - 6), Math.max(0, first)).filter(m => m.rev > 0)
  const rev = sumOf('rev', inP), revPrev = sumOf('rev', prev)
  const feeCap = (() => {
    const l = x.lines.filter(z => z.grp === 'phi_san')
    return l.length && l.every(z => z.cap_pct != null) ? l.reduce((s, z) => s + Number(z.cap_pct), 0) / 100 : null
  })()
  const adsCap = x.lines.find(z => z.code === 'ads_shopee')?.cap_pct
  const adsMonths = inP.filter(m => m.ads != null)
  const rows = [
    { k: 'Tổng phí sàn (6 khoản)', v: sumOf('fee', inP), r: rev, pv: sumOf('fee', prev), pr: revPrev, cap: feeCap, cost: true },
    { k: 'Quảng cáo Shopee', v: sumOf('ads', adsMonths), r: sumOf('rev', adsMonths),
      pv: sumOf('ads', prev.filter(m => m.ads != null)), pr: sumOf('rev', prev.filter(m => m.ads != null)),
      cap: adsCap == null ? null : Number(adsCap) / 100, cost: true,
      note: adsMonths.length < inP.length ? `chỉ ${adsMonths.length}/${inP.length} tháng có số` : null },
    { k: 'Voucher shop tự chịu', v: sumOf('voucher', inP), r: rev, pv: sumOf('voucher', prev), pr: revPrev,
      note: 'đã trừ khi tính doanh thu' },
    { k: 'Tiền hàng hoàn trả', v: sumOf('hoan', inP), r: rev, pv: sumOf('hoan', prev), pr: revPrev,
      note: 'đã trừ khi tính doanh thu' },
  ]
  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Bán trên sàn — 4 tỷ lệ phải canh</h3>
        <span>
          Mẫu số chung: doanh thu thuần Shopee kỳ này {tr(rev)}. Voucher và hoàn chỉ để theo dõi — KHÔNG cộng vào tổng
          chi phí ở trên (đã bị trừ khi tính doanh thu). So với bình quân 6 tháng trước kỳ.
        </span>
      </div>
      <table className="pl-table cn-plat">
        <thead>
          <tr><th>Chỉ số</th><th className="num">Số tiền</th><th className="num">% DT Shopee</th>
            <th className="num">6 tháng trước</th><th className="num">Thay đổi</th><th className="num">Trần</th><th>Ghi chú</th></tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const p = r.r > 0 ? r.v / r.r : null
            const pp = r.pr > 0 ? r.pv / r.pr : null
            const d = p != null && pp != null ? p - pp : null
            const over = r.cap != null && p != null && p > r.cap
            return (
              <tr key={r.k}>
                <td className="lbl"><b>{r.k}</b></td>
                <td className="num">{tr(r.v)}</td>
                <td className={`num b ${over ? 'bad' : ''}`}>{pc(p, 1)}</td>
                <td className="num">{pc(pp, 1)}</td>
                <td className={`num ${d == null ? '' : d > 0.005 ? 'bad' : d < -0.005 ? 'good' : ''}`}>
                  {d == null ? '—' : `${d > 0 ? '+' : ''}${nf(1).format(d * 100)} đ%`}
                </td>
                <td className="num">{r.cap == null ? <span className="dim">{r.cost ? 'chưa đặt' : '—'}</span> : pc(r.cap, 1)}</td>
                <td className="sm">{[over ? 'VƯỢT TRẦN' : null, r.note].filter(Boolean).join(' · ')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="pl-note">
        Trần phí sàn = cộng trần của 6 khoản phí (chỉ hiện khi đủ cả 6); trần quảng cáo = trần của khoản "Quảng cáo Shopee".
        Voucher và hoàn không có trần lưu trên hệ thống — theo dõi bằng mức thay đổi so 6 tháng trước.
      </p>
    </section>
  )
}

/* ---------- xu hướng 1 khoản ---------- */
function Trend({ x, year, pick, setPick, period }) {
  const cand = x.N.rows.filter(r => r.months.length)
  const code = pick && cand.some(r => r.code === pick) ? pick : cand[0]?.code
  const l = cand.find(r => r.code === code)
  if (!l) return <section className="m2-panel"><p className="pl-empty">Chưa có khoản nào có số.</p></section>
  const base = baseOf(l)
  const data = ymList(year).map(ym => {
    const a = x.act[l.code]?.[ym], r = x.rev[ym]?.[base], p = x.plan[l.code]?.[ym]
    return {
      lb: ymLabel(ym), inP: period.includes(ym),
      pct: a != null && r > 0 ? (a / r) * 100 : null,
      planPct: p != null && r > 0 ? (p / r) * 100 : null,
      tt: a != null ? a / 1e6 : null, kh: p != null ? p / 1e6 : null,
    }
  })
  const fixed = l.behavior === 'co_dinh'
  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Xu hướng: {short(l.name)}</h3>
        <span>
          <select className="cn-sel" value={code} onChange={e => setPick(e.target.value)}>
            {cand.map(r => <option key={r.code} value={r.code}>{short(r.name)}</option>)}
          </select>
          {fixed ? ' · khoản cố định: cột = thực tế vs ngân sách (triệu)' : ` · % doanh thu ${BASE_TXT[base]}, đường ngang = trần`}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        {fixed ? (
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="lb" tick={{ fontSize: 10, fill: C.axis }} />
            <YAxis tick={{ fontSize: 10, fill: C.axis }} width={40} />
            <Tooltip formatter={(v, n) => [v == null ? '—' : `${nf(1).format(v)} tr`, n]} />
            <Legend verticalAlign="top" align="left" height={26} iconSize={10} wrapperStyle={{ fontSize: 10.5 }} />
            <Bar dataKey="kh" name="Ngân sách" fill={C.soft} radius={[2, 2, 0, 0]} />
            <Bar dataKey="tt" name="Thực tế" fill={C.blue} radius={[2, 2, 0, 0]} />
          </ComposedChart>
        ) : (
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="lb" tick={{ fontSize: 10, fill: C.axis }} />
            <YAxis tick={{ fontSize: 10, fill: C.axis }} width={40} unit="%" />
            <Tooltip formatter={(v, n) => [v == null ? '—' : `${nf(2).format(v)}%`, n]} />
            <Legend verticalAlign="top" align="left" height={26} iconSize={10} wrapperStyle={{ fontSize: 10.5 }} />
            {l.cap != null && <ReferenceLine y={l.cap * 100} stroke={C.bad} strokeDasharray="5 3"
              label={{ value: `trần ${nf(1).format(l.cap * 100)}%`, fontSize: 10, fill: C.bad, position: 'insideTopRight' }} />}
            <Line dataKey="planPct" name="Kế hoạch" stroke={C.soft} strokeDasharray="4 3" dot={false} connectNulls />
            <Line dataKey="pct" name="Thực tế" stroke={C.blue} strokeWidth={2} dot={{ r: 2.5 }} />
          </ComposedChart>
        )}
      </ResponsiveContainer>
    </section>
  )
}

/* ---------- cơ cấu chi phí ---------- */
function Mix({ N }) {
  const by = {}
  for (const r of N.rows) if (r.months.length) by[r.grp] = (by[r.grp] || 0) + r.actual
  const data = GROUPS.filter(g => by[g.id] > 0).map(g => ({ k: g.label, v: by[g.id], id: g.id }))
  const total = data.reduce((s, d) => s + d.v, 0)
  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Cơ cấu chi phí theo nhóm</h3>
        <span>Thực tế trong kỳ · tổng {tr(total)}</span>
      </div>
      <div className="cn-mix">
        <ResponsiveContainer width="50%" height={220}>
          <PieChart>
            <Pie data={data} dataKey="v" nameKey="k" innerRadius={55} outerRadius={90} paddingAngle={1}>
              {data.map(d => <Cell key={d.id} fill={GROUP_COLOR[d.id] || C.axis} />)}
            </Pie>
            <Tooltip formatter={v => tr(v)} />
          </PieChart>
        </ResponsiveContainer>
        <ul>
          {data.map(d => (
            <li key={d.id}><i style={{ background: GROUP_COLOR[d.id] }} />{d.k}<b>{pc(d.v / total, 0)}</b><span>{tr(d.v)}</span></li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function xuat(x, year, perLabel) {
  const m = { fmt: '#,##0', w: 15 }
  return xuatBang(`Dinh-muc-chi-phi_${year}_${perLabel.replace(/[^\w–-]+/g, '-')}.xlsx`, [{
    name: 'Định mức', title: `ĐỊNH MỨC CHI PHÍ — ${perLabel}/${year}`,
    sub: `Ngân sách: ${x.ver?.name || 'chưa có'} · đơn vị đồng · sắp theo tiền vượt · xuất ${new Date().toLocaleString('vi-VN')}`,
    cols: [
      { h: 'Khoản mục', w: 44 }, { h: 'Nhóm', w: 18 }, { h: 'Loại', w: 10 }, { h: 'Ngân sách', ...m },
      { h: 'Thực tế', ...m }, { h: 'Còn lại', ...m }, { h: 'Tiêu hao NS', fmt: '0%', w: 11 },
      { h: '% doanh thu', fmt: '0.00%', w: 11 }, { h: 'Mẫu số', w: 12 }, { h: 'Trần', fmt: '0.00%', w: 9 },
      { h: 'Tiền vượt', ...m }, { h: 'Trạng thái', w: 18 },
    ],
    rows: x.N.rows.map(r => ({
      kind: r.status === 'over' ? 'bad' : undefined,
      cells: [r.name, GROUP_OF[r.grp].label, BEHAVIOR[r.behavior] || '', r.hasPlan ? r.budget : '',
        r.months.length ? r.actual : 'chưa nhập', r.hasPlan ? r.remain : '', r.use ?? '', r.pct ?? '',
        `DT ${BASE_TXT[r.base]}`, r.cap ?? '', r.over || '', STATUS[r.status][0]],
    })).concat([{ kind: 'total', cells: ['TỔNG (khoản có số)', '', '', x.N.budgetT, x.N.total, '', x.N.use ?? '', '', '', '', x.N.overTotal, ''] }]),
    notes: [
      'Khoản biến đổi xét theo trần % doanh thu; khoản cố định xét theo tiêu hao ngân sách.',
      'Tiền vượt: biến đổi = (% thực tế − trần) × doanh thu mẫu số; cố định = thực tế − ngân sách.',
      'Mỗi khoản chỉ tính trên các tháng có số thực tế của chính nó.',
    ],
  }])
}
