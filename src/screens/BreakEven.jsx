import { useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  ReferenceDot, Legend,
} from 'recharts'
import arFile from '../data/receivable.json'
import { fetchFin, fetchSales } from '../lib/cloud'
import {
  GROUP_OF, BEHAVIOR, ymList, ymLabel, actualByMonth, planByMonth, coverage, defaultUpto,
  beMonth, beSum, beCalc, adsBreakEven, LAST_DATA_YM,
} from '../lib/fin'
import { MONTHS } from '../lib/metrics'
import { xuatBang } from '../lib/xlsxBang'
import './pnl.css'
import './costnorm.css'
import './breakeven.css'

/* ============================================================
   ĐIỂM HÒA VỐN
   Mỗi tháng phải bán bao nhiêu để đủ trả chi phí cố định, đang cách mốc đó
   bao xa, và quảng cáo được phép đắt đến đâu.
   Công thức ở src/lib/fin.js (beCalc). Cố định / biến đổi lấy đúng phân loại
   người dùng đặt ở màn Kế hoạch & Ngân sách → tab Khoản mục.
   ============================================================ */

const C = { navy: '#232A6B', blue: '#353E99', soft: '#A9AFE0', bad: '#B42318', good: '#1F7A45', amber: '#D97706', grid: '#E7E9F3', axis: '#8E93B5' }
const nf = d => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d })
const tr = v => (v == null ? '—' : `${v < 0 ? '−' : ''}${nf(1).format(Math.abs(v) / 1e6)} tr`)
const pc = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${nf(d).format(v * 100)}%`)
const daysIn = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()
const short = n => n.replace(/^Phí sàn · /, 'Phí sàn: ').replace(/^Chi trả /, '').replace(/^./, c => c.toUpperCase())

export default function BreakEven() {
  const [db, setDb] = useState(null)
  const [err, setErr] = useState(null)
  const [ar, setAr] = useState(arFile)
  const yNow = LAST_DATA_YM ? +LAST_DATA_YM.slice(0, 4) : new Date().getFullYear()
  const [year, setYear] = useState(yNow)
  const [src, setSrc] = useState('tt')
  const [scope, setScope] = useState('lk')
  const [sc, setSc] = useState({ gia: 0, phi: 0, cd: 0 })

  useEffect(() => {
    fetchFin().then(setDb).catch(e => setErr(String(e.message || e)))
    fetchSales().then(setAr).catch(() => {})
  }, [])

  const x = useMemo(() => {
    if (!db) return null
    const lines = db.lines.filter(l => l.active !== false)
    const yms = ymList(year)
    const ver = db.versions.filter(v => v.year === year).sort((a, b) => b.is_current - a.is_current)[0]
    const plan = ver ? planByMonth(ver.version, db.plan) : {}
    const act = actualByMonth(year, lines, db.actual, ar)
    const cov = coverage(year, db.lines, db.actual, ar)
    const upto = defaultUpto(year)
    const hasFixed = lines.some(l => l.behavior === 'co_dinh')
    /* Tháng dùng được: thực tế = tháng đã kết thúc VÀ đã nhập đủ chi phí nhập tay
       (thiếu chi phí cố định mà tính là ra hòa vốn thấp giả); kế hoạch = tháng có doanh thu kế hoạch */
    const mAct = yms.map(ym => beMonth(lines, act, ym))
    const mPlan = yms.map(ym => beMonth(lines, plan, ym))
    const okAct = yms.map((ym, i) => i <= upto && cov.months[i].state === 'full' && mAct[i].dt > 0)
    const okPlan = yms.map((ym, i) => mPlan[i].dt > 0)
    const excluded = yms.filter((ym, i) => i <= upto && !okAct[i])
    return { lines, yms, ver, plan, act, cov, upto, hasFixed, mAct, mPlan, okAct, okPlan, excluded }
  }, [db, year, ar])

  const years = [...new Set(MONTHS.map(m => +m.slice(0, 4)))].sort((a, b) => b - a)

  const view = useMemo(() => {
    if (!x) return null
    const M = src === 'tt' ? x.mAct : x.mPlan
    const ok = src === 'tt' ? x.okAct : x.okPlan
    const idx = scope === 'lk' ? x.yms.map((_, i) => i).filter(i => ok[i]) : [+scope].filter(i => ok[i])
    const S = beSum(idx.map(i => M[i]))
    return { M, ok, idx, S, months: idx.map(i => x.yms[i]) }
  }, [x, src, scope])

  if (err) return <div className="pl-page"><div className="pl-warn"><b>Không tải được dữ liệu</b><p>{err}</p></div></div>
  if (!x) return <div className="pl-page"><section className="m2-panel"><p className="pl-empty">Đang tải…</p></section></div>

  const { S } = view
  const nM = view.idx.length
  const scopeLabel = scope === 'lk' ? `lũy kế ${nM} tháng` : `tháng ${+scope + 1}`

  return (
    <div className="pl-page cn-page be-page">
      <div className="m2-title">
        <div>
          <h2>Điểm hòa vốn</h2>
          <p>
            Mỗi tháng phải bán bao nhiêu để đủ trả chi phí cố định, đang cách mốc đó bao xa, và quảng cáo được
            phép đắt đến đâu. Hòa vốn tính <b>trước thuế</b>, cho <b>toàn công ty</b> (sàn + ngoài sàn).
          </p>
        </div>
      </div>

      <section className="m2-panel">
        <div className="pp-bar">
          <label>Năm
            <select value={year} onChange={e => { setYear(+e.target.value); setScope('lk') }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <div className="be-seg">
            {[['tt', 'Thực tế'], ['kh', 'Ngân sách']].map(([id, lb]) => (
              <button key={id} className={src === id ? 'on' : ''} disabled={id === 'kh' && !x.ver}
                title={id === 'kh' && !x.ver ? 'Năm này chưa có ngân sách' : undefined}
                onClick={() => { setSrc(id); setScope('lk') }}>{lb}</button>
            ))}
          </div>
          <label>Phạm vi
            <select value={scope} onChange={e => setScope(e.target.value)}>
              <option value="lk">{src === 'tt' ? 'Lũy kế các tháng dùng được' : 'Cả năm'}</option>
              {x.yms.map((ym, i) => view.ok[i] && <option key={ym} value={i}>Tháng {i + 1}</option>)}
            </select>
          </label>
          <span className="sp" />
          {src === 'kh' && x.ver && <span className="cn-ver">Ngân sách: <b>{x.ver.name}</b></span>}
          {nM > 0 && <button className="pp-btn" onClick={() => xuat(x, view, year, src, scopeLabel)}>⬇ Xuất Excel</button>}
        </div>
      </section>

      {!x.hasFixed && (
        <div className="pl-warn">
          <b>Chưa có khoản chi phí cố định nào</b>
          <p>Đánh dấu khoản cố định (lương, thuê nhà…) ở màn <a href="#/budget">Kế hoạch &amp; Ngân sách</a> → tab Khoản mục.</p>
        </div>
      )}
      {src === 'tt' && x.excluded.length > 0 && (
        <div className={`pl-warn ${nM ? 'soft' : ''}`}>
          <b>{x.excluded.length} tháng bị loại vì chưa nhập đủ chi phí: {x.excluded.map(ymLabel).join(', ')}</b>
          <p>
            Thiếu chi phí cố định mà vẫn tính thì doanh thu hòa vốn ra thấp giả (thậm chí bằng 0). Nhập ở màn{' '}
            <a href="#/budget">Kế hoạch &amp; Ngân sách</a> → tab Chi phí thực tế.
            {nM ? '' : ' Hiện chưa còn tháng nào đủ số để tính.'}
          </p>
        </div>
      )}

      {nM > 0 && x.hasFixed && (
        <>
          <Headline S={S} scopeLabel={scopeLabel} />
          <Kpis S={S} cov={x.cov} nM={nM} />
          <Cumulative x={x} />
          <div className="pl-row2">
            <AdsCard x={x} months={view.months} />
            <OpsCard x={x} view={view} src={src} />
          </div>
          <Scenario x={x} view={view} src={src} sc={sc} setSc={setSc} />
          <MonthTable x={x} view={view} src={src} />
          <VcAtBe x={x} S={S} />
          <Assumptions lines={x.lines} cov={x.cov} />
        </>
      )}
    </div>
  )
}

function Headline({ S, scopeLabel }) {
  if (!S.ok) {
    return (
      <div className="be-head bad">
        <b>KHÔNG CÓ ĐIỂM HÒA VỐN</b>
        <p>
          Chi phí biến đổi ({tr(S.vc)}) đã bằng hoặc vượt doanh thu ({tr(S.dt)}) trong {scopeLabel}: mỗi đồng bán thêm
          không còn đồng nào để trả chi phí cố định — <b>bán càng nhiều càng lỗ</b>. Phải sửa giá bán hoặc chi phí biến
          đổi (giá vốn, phí sàn, quảng cáo) trước khi nghĩ tới tăng doanh số.
        </p>
      </div>
    )
  }
  const qua = S.gap >= 0
  return (
    <div className={`be-head ${qua ? 'good' : 'bad'}`}>
      <b>{qua ? 'ĐÃ VƯỢT ĐIỂM HÒA VỐN' : 'CHƯA HÒA VỐN'}</b>
      <p>
        {scopeLabel[0].toUpperCase() + scopeLabel.slice(1)}: doanh thu {tr(S.dt)}, mức hòa vốn {tr(S.be)} —{' '}
        <strong>{qua ? `dư ${tr(S.gap)}` : `thiếu ${tr(-S.gap)}`}</strong>.
        {' '}Mỗi 100đ doanh thu còn {nf(1).format(S.cmPct * 100)}đ để trả chi phí cố định{' '}
        {tr(S.fc)}; {qua ? `doanh thu có thể giảm ${pc(S.mos, 0)} trước khi bắt đầu lỗ.`
          : `cần bán thêm ${pc(-S.gap / S.dt, 0)} so với hiện tại mới hòa vốn.`}
      </p>
    </div>
  )
}

function Kpis({ S, cov, nM }) {
  const K = [
    { k: 'Doanh thu hòa vốn', v: tr(S.be), sub: nM > 1 ? `cộng ${nM} tháng · bình quân ${tr(S.be == null ? null : S.be / nM)}/tháng` : 'của tháng này' },
    { k: 'Chi phí cố định', v: tr(S.fc), sub: nM > 1 ? `bình quân ${tr(S.fc / nM)}/tháng` : '' },
    { k: 'Tỷ lệ số dư đảm phí (CM%)', v: pc(S.cmPct), tone: S.ok ? '' : 'bad',
      sub: cov.cogs.skuNoCost ? `⚠ ${cov.cogs.skuNoCost} SKU thiếu giá vốn → CM% đang cao giả` : 'giá vốn đủ cho mọi SKU có bán' },
    { k: 'Biên an toàn', v: pc(S.mos, 0), tone: S.mos == null ? 'bad' : S.mos >= 0.1 ? 'good' : S.mos >= 0 ? 'amber' : 'bad',
      sub: 'doanh thu giảm bao nhiêu % thì lỗ' },
  ]
  return (
    <div className="mk-kpis cn-kpis">
      {K.map(k => (
        <div key={k.k} className={`mk-kpi ${k.tone || ''}`}>
          <span className="k">{k.k}</span><strong>{k.v}</strong><span className="sub">{k.sub}</span>
        </div>
      ))}
    </div>
  )
}

/* Doanh thu lũy kế cắt mức hòa vốn cả năm. Mức hòa vốn năm lấy từ ngân sách nếu có;
   chưa có ngân sách thì ngoại suy từ các tháng thực tế dùng được (bình quân × 12). */
function Cumulative({ x }) {
  const actOk = x.yms.map((_, i) => i).filter(i => x.okAct[i])
  const planAll = x.yms.map((_, i) => i).filter(i => x.okPlan[i])
  let line = null, how = ''
  if (planAll.length === 12) {
    const P = beSum(planAll.map(i => x.mPlan[i]))
    if (P.ok) { line = P.be; how = `theo ngân sách cả năm (cố định ${tr(P.fc)} ÷ CM% ${pc(P.cmPct)})` }
  }
  if (line == null && actOk.length) {
    const A = beSum(actOk.map(i => x.mAct[i]))
    if (A.ok) { line = (A.fc / actOk.length) * 12 / A.cmPct; how = `ngoại suy từ ${actOk.length} tháng thực tế (cố định bình quân × 12 ÷ CM% ${pc(A.cmPct)})` }
  }
  let ca = 0, cp = 0, cross = null
  const data = x.yms.map((ym, i) => {
    const hasA = i <= x.upto && x.mAct[i].dt > 0
    if (hasA) ca += x.mAct[i].dt
    cp += x.mPlan[i].dt
    if (hasA && line != null && cross == null && ca >= line) cross = ymLabel(ym)
    return { lb: ymLabel(ym), tt: hasA ? ca / 1e6 : null, kh: x.okPlan[i] ? cp / 1e6 : null }
  })
  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Doanh thu lũy kế so với mức hòa vốn cả năm</h3>
        <span>
          triệu đồng · đường ngang = doanh thu hòa vốn CẢ NĂM, {how || 'chưa tính được'}
          {line != null && (cross ? ` · thực tế vượt mức này ở ${cross}` : ' · thực tế chưa chạm mức này')}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="lb" tick={{ fontSize: 10, fill: C.axis }} />
          <YAxis tick={{ fontSize: 10, fill: C.axis }} width={52} />
          <Tooltip formatter={(v, n) => [v == null ? '—' : `${nf(1).format(v)} tr`, n]} />
          <Legend verticalAlign="top" align="left" height={26} iconSize={10} wrapperStyle={{ fontSize: 10.5 }} />
          {line != null && <ReferenceLine y={line / 1e6} stroke={C.bad} strokeDasharray="6 3"
            label={{ value: `hòa vốn năm ${nf(0).format(line / 1e6)} tr`, fontSize: 10, fill: C.bad, position: 'insideTopLeft' }} />}
          <Line dataKey="kh" name="Kế hoạch lũy kế" stroke={C.soft} strokeDasharray="4 3" dot={false} connectNulls />
          <Line dataKey="tt" name="Thực tế lũy kế" stroke={C.blue} strokeWidth={2.2} dot={{ r: 2.5 }} />
          {cross && <ReferenceDot x={cross} y={data.find(d => d.lb === cross).tt} r={5} fill={C.good} stroke="#fff" />}
        </ComposedChart>
      </ResponsiveContainer>
    </section>
  )
}

function AdsCard({ x, months }) {
  const A = adsBreakEven(months)
  const good = A.perDong != null && A.perDong >= 0
  return (
    <section className="m2-panel be-card">
      <div className="m2-head">
        <h3>Quảng cáo Shopee được phép đắt đến đâu</h3>
        <span>Cùng định nghĩa với màn Marketing · {A.nAds} tháng có số quảng cáo trong kỳ</span>
      </div>
      {A.exp > 0 ? (
        <>
          <div className="be-pair">
            <div><span>ROAS hòa vốn</span><b>{A.roasBE == null ? 'không thể' : nf(2).format(A.roasBE)}</b>
              <small>= 1 ÷ (biên gộp − phí sàn) = 1 ÷ {pc(A.cmPre)}</small></div>
            <div className={good ? 'good' : 'bad'}><span>ROAS thật</span><b>{nf(2).format(A.roas)}</b>
              <small>GMV quảng cáo × {pc(A.netRate, 0)} (thuần/GMV) ÷ chi {tr(A.exp)}</small></div>
          </div>
          <p className="be-say">
            {A.roasBE == null
              ? 'Biên trên sàn trước quảng cáo đã gần như bằng 0 — không mức ROAS nào hòa vốn được.'
              : `Mỗi đồng quảng cáo mang về ${nf(2).format(A.roas * A.cmPre)}đ số dư đảm phí → ${good ? 'LÃI' : 'LỖ'} ${nf(2).format(Math.abs(A.perDong))}đ trên mỗi đồng chi. `
                + (good ? 'Có thể tăng ngân sách từng bước, giữ ROAS trên mức hòa vốn.'
                  : `Cần ROAS ≥ ${nf(2).format(A.roasBE)} — hạ giá thầu/CPC hoặc dồn tiền vào sản phẩm biên cao.`)}
          </p>
        </>
      ) : <p className="pl-empty">Kỳ này chưa có số quảng cáo Shopee (API chỉ giữ khoảng 5 tháng).</p>}
    </section>
  )
}

/* Số đơn Shopee mỗi ngày cần để hòa vốn, GIẢ ĐỊNH doanh thu ngoài sàn giữ nguyên mức thực tế */
function OpsCard({ x, view, src }) {
  if (view.idx.length === 0) return null
  const ms = view.months
  /* Số đơn đang bán và giá trị đơn luôn lấy từ THỰC TẾ (tháng đã có số);
     mức cần thì theo nguồn đang xem (thực tế hoặc ngân sách) */
  const actMs = x.yms.filter((ym, i) => i <= x.upto && ms.includes(ym))
  const A = adsBreakEven(actMs.length ? actMs : x.yms.slice(0, x.upto + 1))
  const actDays = (actMs.length ? actMs : x.yms.slice(0, x.upto + 1)).reduce((s, ym) => s + daysIn(ym), 0)
  const days = ms.reduce((s, ym) => s + daysIn(ym), 0)
  const vals = src === 'tt' ? x.act : x.plan
  const ngoai = ms.reduce((s, ym) => s + (vals.dt_ngoai?.[ym] || 0), 0)
  const need = view.S.be == null || !A.aov ? null : Math.max(0, view.S.be - ngoai) / A.aov / days
  const have = actDays ? A.orders / actDays : 0
  return (
    <section className="m2-panel be-card">
      <div className="m2-head">
        <h3>Vận hành: số đơn Shopee mỗi ngày</h3>
        <span>Giá trị đơn bình quân {tr(A.aov)} · giả định doanh thu ngoài sàn giữ nguyên {tr(ngoai)}</span>
      </div>
      <div className="be-pair">
        <div><span>Cần để hòa vốn</span><b>{need == null ? '—' : nf(1).format(need)}</b><small>đơn/ngày</small></div>
        <div className={need == null ? '' : have >= need ? 'good' : 'bad'}><span>Đang bán</span><b>{nf(1).format(have)}</b><small>đơn/ngày (thuần, sau huỷ/hoàn)</small></div>
      </div>
      {need != null && (
        <p className="be-say">
          {have >= need ? `Đang dư ${nf(1).format(have - need)} đơn/ngày so với mức hòa vốn.`
            : `Thiếu ${nf(1).format(need - have)} đơn/ngày (cần gấp ${nf(1).format(need / Math.max(have, 0.01))} lần hiện tại) — hoặc nâng giá trị đơn.`}
        </p>
      )}
    </section>
  )
}

/* Thử kịch bản — 3 thanh trượt, không lưu.
   Giá bán ±%: doanh thu và phí sàn đổi theo (phí sàn thu theo % giá), giá vốn và chi phí khác giữ nguyên.
   Phí sàn ± điểm %: tính trên doanh thu Shopee. Chi phí cố định ±%. */
function Scenario({ x, view, src, sc, setSc }) {
  const S = view.S
  const feeNow = Object.entries(S.vcBy).filter(([k]) => GROUP_OF[x.lines.find(l => l.code === k)?.grp]?.id === 'phi_san')
    .reduce((s, [, v]) => s + v, 0)
  const dtSan = view.months.reduce((s, ym) => s + ((src === 'tt' ? x.act : x.plan).dt_san?.[ym] ?? 0), 0)
  const p = sc.gia / 100
  const dt2 = S.dt * (1 + p)
  const fee2 = feeNow * (1 + p) + (sc.phi / 100) * dtSan * (1 + p)
  const vc2 = S.vc - feeNow + fee2
  const fc2 = S.fc * (1 + sc.cd / 100)
  const R = beCalc({ dt: dt2, vc: vc2, fc: fc2 })
  const d = R.be != null && S.be != null ? R.be - S.be : null
  const SL = [
    ['gia', 'Giá bán', -20, 20, 1, '%'], ['phi', 'Phí sàn', -5, 5, 0.5, ' điểm %'], ['cd', 'Chi phí cố định', -30, 30, 1, '%'],
  ]
  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Thử kịch bản</h3>
        <span>Không lưu. Giá bán đổi thì doanh thu và phí sàn đổi theo, số lượng bán và giá vốn giữ nguyên.</span>
      </div>
      <div className="be-sc">
        <div className="be-sl">
          {SL.map(([k, lb, mn, mx, st, u]) => (
            <label key={k}>
              <span>{lb} <b>{sc[k] > 0 ? '+' : ''}{nf(1).format(sc[k])}{u}</b></span>
              <input type="range" min={mn} max={mx} step={st} value={sc[k]}
                onChange={e => setSc(s => ({ ...s, [k]: +e.target.value }))} />
            </label>
          ))}
          <button className="pp-btn" onClick={() => setSc({ gia: 0, phi: 0, cd: 0 })}>Về hiện tại</button>
        </div>
        <div className="be-res">
          <div><span>Doanh thu hòa vốn mới</span><b>{R.ok ? tr(R.be) : 'không có'}</b>
            <small>{d == null ? (R.ok ? '' : 'CM% ≤ 0 — bán càng nhiều càng lỗ') : `${d <= 0 ? 'giảm' : 'tăng'} ${tr(Math.abs(d))} so hiện tại (${tr(S.be)})`}</small></div>
          <div><span>CM% mới</span><b>{pc(R.cmPct)}</b><small>hiện tại {pc(S.cmPct)}</small></div>
          <div><span>Lãi / lỗ trước thuế mới</span><b className={R.profit >= 0 ? 'good' : 'bad'}>{tr(R.profit)}</b><small>hiện tại {tr(S.profit)}</small></div>
        </div>
      </div>
    </section>
  )
}

function MonthTable({ x, view, src }) {
  const M = view.M
  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Hòa vốn từng tháng — {src === 'tt' ? 'thực tế' : 'ngân sách'}</h3>
        <span>triệu đồng · "doanh thu hòa vốn tháng" là mốc của RIÊNG tháng đó, khác mốc lũy kế ở trên</span>
      </div>
      <div className="pp-wrap">
        <table className="pl-table">
          <thead>
            <tr><th>Tháng</th><th className="num">Doanh thu</th><th className="num">Chi phí biến đổi</th><th className="num">Số dư đảm phí</th>
              <th className="num">CM%</th><th className="num">Chi phí cố định</th><th className="num">Lãi/lỗ</th>
              <th className="num">DT hòa vốn tháng</th><th className="num">Chênh lệch</th><th className="num">Biên an toàn</th></tr>
          </thead>
          <tbody>
            {x.yms.map((ym, i) => {
              const m = M[i]
              if (!m.dt && !m.fc) return null
              const r = beCalc(m)
              const ok = view.ok[i]
              return (
                <tr key={ym} className={ok ? '' : 'be-off'}>
                  <td><b>{ymLabel(ym)}</b>{!ok && <small> loại — chưa đủ chi phí</small>}</td>
                  <td className="num">{nf(1).format(m.dt / 1e6)}</td>
                  <td className="num">{nf(1).format(m.vc / 1e6)}</td>
                  <td className="num">{nf(1).format(r.cm / 1e6)}</td>
                  <td className={`num ${r.ok ? '' : 'bad'}`}>{pc(r.cmPct)}</td>
                  <td className="num">{nf(1).format(m.fc / 1e6)}</td>
                  <td className={`num b ${r.profit >= 0 ? 'good' : 'bad'}`}>{nf(1).format(r.profit / 1e6)}</td>
                  <td className="num">{r.ok ? nf(1).format(r.be / 1e6) : 'không có'}</td>
                  <td className={`num ${r.gap == null ? '' : r.gap >= 0 ? 'good' : 'bad'}`}>{r.gap == null ? '—' : nf(1).format(r.gap / 1e6)}</td>
                  <td className="num">{pc(r.mos, 0)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function VcAtBe({ x, S }) {
  if (!S.ok) return null
  const k = S.be / S.dt
  const rows = Object.entries(S.vcBy).map(([code, v]) => ({ code, l: x.lines.find(z => z.code === code), v: v * k }))
    .sort((a, b) => b.v - a.v)
  const t = rows.reduce((s, r) => s + r.v, 0)
  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Chi phí biến đổi tại mức hòa vốn</h3>
        <span>Ở doanh thu {tr(S.be)} (giữ nguyên tỷ lệ chi phí biến đổi trên doanh thu như kỳ đang xem)</span>
      </div>
      <table className="pl-table">
        <thead><tr><th>Khoản mục</th><th>Nhóm</th><th className="num">Số tiền</th><th className="num">Tỷ trọng</th><th className="num">% doanh thu</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.code}>
              <td>{short(r.l?.name || r.code)}</td><td className="sm">{GROUP_OF[r.l?.grp]?.label}</td>
              <td className="num">{tr(r.v)}</td><td className="num">{pc(r.v / t, 0)}</td><td className="num">{pc(r.v / S.be)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td><b>Tổng chi phí biến đổi</b></td><td /><td className="num"><b>{tr(t)}</b></td><td className="num">100%</td><td className="num">{pc(t / S.be)}</td></tr></tfoot>
      </table>
    </section>
  )
}

function Assumptions({ lines, cov }) {
  const g = b => lines.filter(l => l.behavior === b && l.grp !== 'doanh_thu' && l.grp !== 'thue').map(l => short(l.name))
  return (
    <section className="m2-panel be-ass">
      <h3>Giả định đang dùng — sửa ở màn Kế hoạch &amp; Ngân sách → Khoản mục</h3>
      <p><b>Biến đổi</b> ({g('bien_doi').length}): {g('bien_doi').join(' · ')}</p>
      <p><b>Cố định</b> ({g('co_dinh').length}): {g('co_dinh').join(' · ')}</p>
      <p className="mono">
        Số dư đảm phí = Doanh thu − Chi phí biến đổi · CM% = Số dư đảm phí ÷ Doanh thu · Doanh thu hòa vốn = Chi phí cố định ÷ CM%
        · Biên an toàn = (Doanh thu − Doanh thu hòa vốn) ÷ Doanh thu · ROAS hòa vốn = 1 ÷ CM% trên sàn trước quảng cáo
        · Hòa vốn đơn/ngày = (Doanh thu hòa vốn − doanh thu ngoài sàn) ÷ giá trị đơn bình quân ÷ số ngày.
      </p>
      {cov.cogs.skuNoCost > 0 && <p className="warn">{cov.cogs.skuNoCost} SKU có bán chưa có giá vốn → chi phí biến đổi thấp, CM% cao, hòa vốn thấp hơn thật.</p>}
    </section>
  )
}

function xuat(x, view, year, src, scopeLabel) {
  const m = { fmt: '#,##0', w: 15 }
  const S = view.S
  return xuatBang(`Diem-hoa-von_${year}_${src}.xlsx`, [{
    name: 'Hòa vốn', title: `ĐIỂM HÒA VỐN ${year} — ${src === 'tt' ? 'THỰC TẾ' : 'NGÂN SÁCH'}`,
    sub: `${scopeLabel} · đơn vị đồng · trước thuế · toàn công ty · xuất ${new Date().toLocaleString('vi-VN')}`,
    cols: [{ h: 'Tháng', w: 10 }, { h: 'Doanh thu', ...m }, { h: 'Chi phí biến đổi', ...m }, { h: 'Số dư đảm phí', ...m },
      { h: 'CM%', fmt: '0.0%', w: 9 }, { h: 'Chi phí cố định', ...m }, { h: 'Lãi/lỗ', ...m },
      { h: 'DT hòa vốn tháng', ...m }, { h: 'Chênh lệch', ...m }, { h: 'Biên an toàn', fmt: '0%', w: 11 }, { h: 'Ghi chú', w: 26 }],
    rows: x.yms.map((ym, i) => {
      const mm = view.M[i]; if (!mm.dt && !mm.fc) return null
      const r = beCalc(mm)
      return {
        kind: view.ok[i] ? undefined : 'note',
        cells: [ymLabel(ym), mm.dt, mm.vc, r.cm, r.cmPct ?? '', mm.fc, r.profit, r.be ?? 'không có', r.gap ?? '', r.mos ?? '',
          view.ok[i] ? '' : 'loại — chưa đủ chi phí'],
        tone: { 6: r.profit >= 0 ? 'good' : 'bad' },
      }
    }).filter(Boolean).concat([{
      kind: 'total', cells: [`Cộng ${view.idx.length} tháng`, S.dt, S.vc, S.cm, S.cmPct ?? '', S.fc, S.profit, S.be ?? 'không có', S.gap ?? '', S.mos ?? '', ''],
    }]),
    notes: ['Doanh thu hòa vốn = chi phí cố định ÷ CM%. Chỉ cộng các tháng đã nhập đủ chi phí.',
      'Cố định / biến đổi theo phân loại ở màn Kế hoạch & Ngân sách.'],
  }])
}
