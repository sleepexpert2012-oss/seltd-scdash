import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, BarChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts'
import arFile from '../data/receivable.json'
import { fetchFin, fetchSales } from '../lib/cloud'
import {
  GROUPS, DERIVED, ymList, ymLabel, actualByMonth, planByMonth, coverage, compare,
  monthlyTotals, defaultUpto, PARTIAL_YM, LAST_DATA_YM,
} from '../lib/fin'
import { xuatBang } from '../lib/xlsxBang'

/* ============================================================
   TAB "KẾ HOẠCH vs THỰC ĐẠT" của màn Lãi lỗ
   So lũy kế T1..Tn giữa thực tế và một phiên bản ngân sách, rồi chỉ ra
   khoản nào làm lợi nhuận lệch kế hoạch.
   · Phạm vi TOÀN CÔNG TY (trên sàn + ngoài sàn), không theo bộ lọc ngành/NCC —
     ngân sách không lập theo ngành.
   · Mặc định so đến tháng TRỌN VẸN gần nhất: tháng đang chạy dở mà đem so với
     ngân sách cả tháng thì lúc nào cũng "hụt".
   ============================================================ */

const C = {
  navy: '#232A6B', blue: '#353E99', soft: '#A9AFE0', bad: '#B42318', good: '#1F7A45',
  amber: '#D97706', grid: '#E7E9F3', axis: '#8E93B5', grey: '#C9CDE0',
}
const UNITS = [[1, 'đồng'], [1e6, 'triệu'], [1e9, 'tỷ']]
const nf = d => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: 0 })
const pctT = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${nf(d).format(v * 100)}%`)
const tr = v => `${nf(1).format(v / 1e6)} tr`

export default function PnlPlan() {
  const [db, setDb] = useState(null)
  const [err, setErr] = useState(null)
  const [ar, setAr] = useState(arFile)
  const [ver, setVer] = useState(null)
  const [withPartial, setWithPartial] = useState(false)
  const [upto, setUpto] = useState(null)
  const [unit, setUnit] = useState(1e6)
  const [open, setOpen] = useState({})

  useEffect(() => {
    fetchFin().then(d => {
      setDb(d)
      const cur = d.versions.filter(v => v.is_current).sort((a, b) => b.year - a.year)
      /* Ưu tiên bản hiện hành của năm đang có thực tế */
      const yNow = LAST_DATA_YM ? +LAST_DATA_YM.slice(0, 4) : null
      setVer((cur.find(v => v.year === yNow) || cur[0] || d.versions[0])?.version || null)
    }).catch(e => setErr(String(e.message || e)))
    fetchSales().then(setAr).catch(() => {})
  }, [])

  const version = db?.versions.find(v => v.version === ver)
  const year = version?.year
  const autoUpto = year ? defaultUpto(year, withPartial) : -1
  const n = upto ?? autoUpto
  useEffect(() => { setUpto(null) }, [ver, withPartial])

  const x = useMemo(() => {
    if (!db || !version) return null
    const lines = db.lines.filter(l => l.active !== false)
    const yms = ymList(year)
    const act = actualByMonth(year, lines, db.actual, ar)
    const plan = planByMonth(ver, db.plan)
    const hasPlan = Object.keys(plan).length > 0
    const cov = coverage(year, db.lines, db.actual, ar)
    if (n < 0) return { lines, yms, act, plan, hasPlan, cov, cmp: null }
    const cmp = compare(lines, act, plan, year, n)
    /* Tháng trong kỳ lũy kế còn thiếu chi phí nhập tay → lợi nhuận chưa tin được */
    const thieu = cov.months.filter(m => cmp.lk.includes(m.ym) && m.state !== 'full' && m.state !== 'future')
    const ma = monthlyTotals(lines, act, yms).map((m, i) => (i <= n ? m : { ...m, dt: null, lntt: null, gp: null }))
    const mp = monthlyTotals(lines, plan, yms)
    return { lines, yms, act, plan, hasPlan, cov, cmp, thieu, ma, mp }
  }, [db, version, year, ver, n, ar])

  if (err) return <div className="pl-warn"><b>Không tải được ngân sách</b><p>{err}</p></div>
  if (!db) return <section className="m2-panel"><p className="pl-empty">Đang tải ngân sách…</p></section>
  if (!db.versions.length) {
    return (
      <section className="m2-panel pp-empty">
        <h3>Chưa có ngân sách để so</h3>
        <p>
          Tab này so thực tế với ngân sách theo tháng. Chưa có phiên bản ngân sách nào — vào màn{' '}
          <a href="#/budget">Kế hoạch &amp; Ngân sách</a> tạo một phiên bản, nhập (hoặc dán từ Excel)
          số kế hoạch từng tháng, và nhập chi phí thực tế các tháng đã qua.
        </p>
      </section>
    )
  }

  const fmt = v => (v == null ? '—' : nf(unit === 1 ? 0 : unit === 1e6 ? 1 : 2).format(v / unit))
  const uName = UNITS.find(u => u[0] === unit)[1]
  const cmp = x?.cmp
  const partialHere = PARTIAL_YM && +PARTIAL_YM.slice(0, 4) === year

  return (
    <div className="pl-body">
      <section className="m2-panel">
        <div className="pp-bar">
          <label>Ngân sách
            <select value={ver || ''} onChange={e => setVer(e.target.value)}>
              {db.versions.map(v => (
                <option key={v.version} value={v.version}>{v.is_current ? '★ ' : ''}{v.name} · {v.year}</option>
              ))}
            </select>
          </label>
          <div className="pp-chips" role="group" aria-label="Lũy kế đến tháng">
            <span>Lũy kế đến</span>
            {ymList(year).map((ym, i) => (
              <button key={ym} className={(i === n ? 'on ' : '') + (i <= n ? 'in' : '')}
                disabled={i > defaultUpto(year, true)}
                title={i > defaultUpto(year, true) ? 'Chưa có số thực tế'
                  : i > defaultUpto(year, false) ? 'Tháng đang chạy dở — số chưa trọn tháng' : undefined}
                onClick={() => setUpto(i)}>{ymLabel(ym)}</button>
            ))}
          </div>
          {partialHere && (
            <label className="pp-chk">
              <input type="checkbox" checked={withPartial} onChange={e => setWithPartial(e.target.checked)} />
              Tính cả {ymLabel(PARTIAL_YM)} đang chạy dở
            </label>
          )}
          <span className="sp" />
          <label>Đơn vị
            <select value={unit} onChange={e => setUnit(+e.target.value)}>
              {UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}
            </select>
          </label>
          {cmp && <button className="pp-btn" onClick={() => xuat(version, cmp)}>⬇ Xuất Excel</button>}
        </div>
        <p className="pp-scope">
          Phạm vi: <b>toàn công ty</b> (trên sàn + ngoài sàn), không theo bộ lọc ngành/NCC ở trên.
          Doanh thu ngoài sàn tính theo ngày giao trên phiếu xuất kho, chưa VAT.
        </p>
      </section>

      {!x.hasPlan && (
        <div className="pl-warn">
          <b>Phiên bản "{version.name}" chưa có số nào</b>
          <p>Nhập số kế hoạch ở màn <a href="#/budget">Kế hoạch &amp; Ngân sách</a> rồi quay lại.</p>
        </div>
      )}

      {n < 0 && (
        <div className="pl-warn soft">
          <b>Năm {year} chưa có số thực tế</b>
          <p>Chọn một phiên bản ngân sách của năm đã có dữ liệu bán để so.</p>
        </div>
      )}

      {cmp && x.hasPlan && (
        <>
          <Warnings x={x} n={n} />
          <Verdict cmp={cmp} n={n} thieu={x.thieu} />
          <Kpis cmp={cmp} fmt={fmt} uName={uName} thieu={x.thieu} cov={x.cov} />
          <Table cmp={cmp} fmt={fmt} uName={uName} n={n} open={open} setOpen={setOpen} />
          <Why cmp={cmp} fmt={fmt} uName={uName} />
          <Charts x={x} n={n} />
        </>
      )}
    </div>
  )
}

/* ---------------- cảnh báo độ tin của số ---------------- */
function Warnings({ x, n }) {
  const { thieu, cov, cmp } = x
  const adsMiss = cov.adsMissing.filter(ym => cmp.lk.includes(ym))
  return (
    <>
      {thieu.length > 0 && (
        <div className="pl-warn">
          <b>{thieu.length}/{n + 1} tháng trong kỳ chưa đủ chi phí nhập tay — lợi nhuận đang bị nhìn CAO hơn thật</b>
          <p>
            {thieu.map(m => ymLabel(m.ym)).join(', ')} chưa nhập {thieu[0].state === 'none' ? 'khoản chi phí nào' : 'đủ các khoản'}
            {' '}(lương, thuê nhà, kho bãi…). Khoản chưa nhập không bị trừ, nên thực đạt chi phí thấp và lợi nhuận cao
            hơn thật. Nhập ở màn <a href="#/budget">Kế hoạch &amp; Ngân sách</a> → tab Chi phí thực tế.
          </p>
        </div>
      )}
      {adsMiss.length > 0 && (
        <div className="pl-warn soft">
          <b>Quảng cáo Shopee chưa có số {adsMiss.map(ymLabel).join(', ')}</b>
          <p>API Shopee chỉ giữ khoảng 5 tháng lịch sử. Các tháng này đang tính như chưa chi quảng cáo.</p>
        </div>
      )}
      {cov.cogs.skuNoCost > 0 && (
        <div className="pl-warn soft">
          <b>{cov.cogs.skuNoCost}/{cov.cogs.skuSold} SKU có bán chưa có giá vốn</b>
          <p>Chiếm {pctT(cov.cogs.revShare)} doanh thu sàn. Giá vốn các SKU này đang tính 0 — lợi nhuận gộp bị cao hơn thật.</p>
        </div>
      )}
    </>
  )
}

/* ---------------- câu kết luận ---------------- */
function Verdict({ cmp, n, thieu }) {
  const L = cmp.der.lntt, D = cmp.grp.doanh_thu
  const top = cmp.contribs.slice(0, 2)
  const good = L.d >= 0
  const reason = top.map(r => {
    const vuot = r.sign < 0 ? (r.d > 0 ? 'vượt' : 'thấp hơn') : (r.d > 0 ? 'cao hơn' : 'hụt')
    return `${r.name.replace(/^Phí sàn · /, 'phí sàn ')} ${vuot} kế hoạch ${tr(Math.abs(r.d))}`
  })
  const dtTxt = D.planLK > 0 ? `Doanh thu đạt ${pctT(D.actLK / D.planLK, 0)} kế hoạch` : 'Kế hoạch chưa có doanh thu'
  const sg = v => `${v < 0 ? '−' : ''}${tr(Math.abs(v))}`
  return (
    <div className={`mk-verdict ${thieu.length ? 'grey' : good ? 'green' : 'red'}`}>
      <b>Vậy thì sao</b>
      <p>
        Lũy kế T1–T{n + 1}: lợi nhuận trước thuế <strong>{sg(L.actLK)}</strong> so với kế hoạch {sg(L.planLK)} —{' '}
        <strong>{good ? 'vượt' : 'hụt'} {tr(Math.abs(L.d))}</strong>. {dtTxt}.
        {reason.length ? ` Lệch chủ yếu vì ${reason.join(' và ')}.` : ''}
        {' '}Cả năm, nếu các tháng còn lại đúng kế hoạch: lợi nhuận {sg(L.fcYear)} ({L.dYear >= 0 ? '+' : '−'}{tr(Math.abs(L.dYear))} so kế hoạch năm).
        {thieu.length ? ' Lưu ý: chi phí thực tế chưa nhập đủ nên con số này còn lạc quan.' : ''}
      </p>
    </div>
  )
}

/* ---------------- 5 thẻ ---------------- */
function Kpis({ cmp, fmt, uName, thieu, cov }) {
  const items = [
    { k: 'Doanh thu', o: cmp.grp.doanh_thu, sign: 1 },
    { k: 'Giá vốn', o: cmp.grp.gia_von, sign: -1,
      note: cov.cogs.skuNoCost ? `thiếu giá vốn ${cov.cogs.skuNoCost} SKU` : null },
    { k: 'Lợi nhuận gộp', o: cmp.der.gp, sign: 1 },
    { k: 'Chi phí vận hành', o: cmp.der.vh, sign: -1, note: 'phí sàn + marketing + hoạt động' },
    { k: 'Lợi nhuận trước thuế', o: cmp.der.lntt, sign: 1, note: thieu.length ? 'chưa đủ chi phí' : null },
  ]
  return (
    <div className="mk-kpis pl-kpis">
      {items.map(({ k, o, sign, note }) => {
        const d = o.actLK - o.planLK
        const fav = sign * d >= 0
        /* % đạt chỉ có nghĩa khi kế hoạch dương: kế hoạch lỗ −655 mà thực tế lỗ −751
           thì "đạt 115%" đọc như vượt kế hoạch — sai chiều. Khi đó ghi chênh lệch. */
        const rate = o.planLK > 0 ? o.actLK / o.planLK : null
        return (
          <div key={k} className={`mk-kpi ${!o.planLK ? '' : fav ? 'good' : 'bad'}`}>
            <span className="k">{k}</span>
            <strong>{fmt(o.actLK)}<em>{uName === 'đồng' ? 'đ' : uName === 'triệu' ? 'tr' : 'tỷ'}</em></strong>
            <span className="sub">
              KH {fmt(o.planLK)} · {rate != null ? `đạt ${pctT(rate, 0)}`
                : !o.planLK ? 'chưa có KH' : `${fav ? 'tốt hơn' : 'kém hơn'} KH ${fmt(Math.abs(d))}`}
              {note ? <i className={note === 'chưa đủ chi phí' ? 'pp-flag' : ''}> · {note}</i> : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ---------------- bảng đối chiếu ---------------- */
function Table({ cmp, fmt, uName, n, open, setOpen }) {
  const cell = (v, sign, isD) => {
    if (!isD) return <td className="num">{fmt(v)}</td>
    const tone = !v ? '' : sign * v > 0 ? 'good' : 'bad'
    return <td className={`num ${tone}`}>{v > 0 ? '+' : v < 0 ? '−' : ''}{fmt(Math.abs(v))}</td>
  }
  const pctCell = (p, sign) => {
    if (p == null) return <td className="num dim">—</td>
    const tone = !p ? '' : sign * p > 0 ? 'good' : 'bad'
    return <td className={`num ${tone}`}>{p > 0 ? '+' : ''}{pctT(p)}</td>
  }
  const line = (o, sign, cls, label, extra) => (
    <tr className={cls}>
      <td className="lbl">{label}{extra}</td>
      {cell(o.actLK)}{cell(o.planLK)}{cell(o.d ?? o.actLK - o.planLK, sign, true)}
      {pctCell(o.dPct ?? (o.planLK ? (o.actLK - o.planLK) / Math.abs(o.planLK) : null), sign)}
      {cell(o.fcYear)}{cell(o.planYear)}{cell(o.dYear ?? o.fcYear - o.planYear, sign, true)}
    </tr>
  )
  const derAfter = { gia_von: 'gp', opex: 'vh', tai_chinh: 'lntt' }
  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Đối chiếu ngân sách — lũy kế T1–T{n + 1}</h3>
        <span>Đơn vị {uName} · bấm tên nhóm để mở từng khoản · xanh = có lợi cho lợi nhuận, đỏ = bất lợi</span>
      </div>
      <div className="pp-wrap">
        <table className="pl-table pp-table">
          <thead>
            <tr>
              <th>Khoản mục</th>
              <th className="num">Thực đạt LK</th><th className="num">Ngân sách LK</th>
              <th className="num">Δ</th><th className="num">Δ %</th>
              <th className="num">Dự báo cả năm</th><th className="num">Ngân sách cả năm</th>
              <th className="num">Δ cả năm</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map(g => {
              const G = cmp.grp[g.id]
              if (!G.rows.length) return null
              const isOpen = !!open[g.id]
              return (
                <Fragment key={g.id}>
                  {line(G, g.sign, 'grp', (
                    <button className="pp-tog" onClick={() => setOpen(o => ({ ...o, [g.id]: !o[g.id] }))}>
                      {isOpen ? '▾' : '▸'} {g.label}
                    </button>
                  ), G.miss ? <i className="pp-miss" title="Có khoản chưa đủ số thực tế trong kỳ"> *</i> : null)}
                  {isOpen && G.rows.map(r => (
                    <Fragment key={r.code}>
                      {line(r, r.sign, 'child', r.name,
                        <>
                          {r.source === 'auto' ? <em className="pp-auto">tự tính</em> : null}
                          {r.missMonths.length ? (
                            <em className="pp-miss" title={`Chưa có số: ${r.missMonths.map(ymLabel).join(', ')}`}>
                              thiếu {r.missMonths.length} tháng
                            </em>
                          ) : null}
                        </>)}
                    </Fragment>
                  ))}
                  {derAfter[g.id] && line(cmp.der[derAfter[g.id]], cmp.der[derAfter[g.id]].sign, 'der', cmp.der[derAfter[g.id]].label)}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="pl-note">
        Dự báo cả năm = thực đạt đến T{n + 1} + ngân sách các tháng còn lại. Thực đạt lũy kế chỉ cộng các tháng có số;
        dấu <i className="pp-miss">*</i> là nhóm có khoản chưa đủ số trong kỳ.
      </p>
    </section>
  )
}

/* ---------------- vì sao lợi nhuận lệch ---------------- */
function Why({ cmp, fmt, uName }) {
  const L = cmp.der.lntt
  const list = cmp.contribs
  const top = list.slice(0, 10)
  const rest = list.slice(10).reduce((a, r) => a + r.contrib, 0)
  const max = Math.max(1, ...top.map(r => Math.abs(r.contrib)), Math.abs(rest))
  const check = list.reduce((a, r) => a + r.contrib, 0)
  return (
    <section className="m2-panel">
      <div className="m2-head">
        <h3>Vì sao lợi nhuận lệch kế hoạch</h3>
        <span>Mỗi khoản góp bao nhiêu {uName} vào mức lệch lợi nhuận trước thuế. Cộng tất cả = đúng mức lệch.</span>
      </div>
      {!list.length ? <p className="pl-empty">Thực tế trùng khít kế hoạch — không có khoản nào lệch.</p> : (
        <div className="pp-why">
          {top.map(r => (
            <div key={r.code} className="pp-wrow">
              <span className="nm" title={r.name}>{r.name.replace(/^Phí sàn · /, 'Phí sàn: ')}</span>
              <span className="bar">
                <i className={r.contrib >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(r.contrib) / max) * 50}%` }} />
              </span>
              <b className={r.contrib >= 0 ? 'good' : 'bad'}>{r.contrib >= 0 ? '+' : '−'}{fmt(Math.abs(r.contrib))}</b>
              <small>{r.sign < 0
                ? `chi ${r.d > 0 ? 'nhiều' : 'ít'} hơn KH ${fmt(Math.abs(r.d))}`
                : `${r.d > 0 ? 'cao' : 'thấp'} hơn KH ${fmt(Math.abs(r.d))}`}</small>
            </div>
          ))}
          {list.length > 10 && (
            <div className="pp-wrow dim">
              <span className="nm">{list.length - 10} khoản khác</span>
              <span className="bar"><i className={rest >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(rest) / max) * 50}%` }} /></span>
              <b>{rest >= 0 ? '+' : '−'}{fmt(Math.abs(rest))}</b><small />
            </div>
          )}
          <div className="pp-wrow tot">
            <span className="nm">Lệch lợi nhuận trước thuế</span><span className="bar" />
            <b className={L.d >= 0 ? 'good' : 'bad'}>{L.d >= 0 ? '+' : '−'}{fmt(Math.abs(L.d))}</b>
            <small>{Math.round(check) === Math.round(L.d) ? '✓ khớp tổng các khoản' : `⚠ tổng các khoản ${fmt(check)}`}</small>
          </div>
        </div>
      )}
    </section>
  )
}

/* ---------------- 3 biểu đồ ---------------- */
function Charts({ x, n }) {
  const { yms, ma, mp, cmp } = x
  const data = yms.map((ym, i) => ({
    lb: ymLabel(ym),
    dtKH: mp[i].dt == null ? null : mp[i].dt / 1e6,
    dtTT: ma[i].dt == null ? null : ma[i].dt / 1e6,
    lnKH: mp[i].lntt == null ? null : mp[i].lntt / 1e6,
    lnTT: ma[i].lntt == null ? null : ma[i].lntt / 1e6,
    gmKH: mp[i].dt ? (mp[i].gp / mp[i].dt) * 100 : null,
    gmTT: ma[i].dt ? (ma[i].gp / ma[i].dt) * 100 : null,
    lnpKH: mp[i].dt ? (mp[i].lntt / mp[i].dt) * 100 : null,
    lnpTT: ma[i].dt ? (ma[i].lntt / ma[i].dt) * 100 : null,
  }))
  const share = (src) => {
    const G = id => cmp.grp[id][src]
    const dt = G('doanh_thu') || 1
    const p = v => (v / dt) * 100
    return {
      gv: p(G('gia_von')), san: p(G('phi_san')), mkt: p(G('marketing')),
      hd: p(G('opex') + G('tai_chinh')), ln: p(cmp.der.lntt[src]),
    }
  }
  const dong = [{ k: 'Kế hoạch', ...share('planLK') }, { k: 'Thực tế', ...share('actLK') }]
  const tip = { formatter: (v, name) => [v == null ? '—' : `${nf(1).format(v)}`, name] }
  const leg = { verticalAlign: 'top', align: 'left', height: 28, iconSize: 10, wrapperStyle: { fontSize: 10.5 } }
  const k = dong[1], kh = dong[0]
  return (
    <>
      <div className="pl-row2">
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Doanh thu &amp; lợi nhuận trước thuế theo tháng</h3>
            <span>triệu đồng · cột nhạt = kế hoạch, cột đậm = thực tế · tháng sau T{n + 1} chỉ có kế hoạch</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="lb" tick={{ fontSize: 10, fill: C.axis }} />
              <YAxis tick={{ fontSize: 10, fill: C.axis }} width={44} />
              <Tooltip {...tip} />
              <Legend {...leg} />
              <ReferenceLine y={0} stroke={C.axis} />
              <Bar dataKey="dtKH" name="Doanh thu KH" fill={C.soft} radius={[2, 2, 0, 0]} />
              <Bar dataKey="dtTT" name="Doanh thu TT" fill={C.blue} radius={[2, 2, 0, 0]} />
              <Line dataKey="lnKH" name="LN trước thuế KH" stroke={C.amber} strokeDasharray="4 3" dot={false} connectNulls />
              <Line dataKey="lnTT" name="LN trước thuế TT" stroke={C.bad} strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Biên lợi nhuận — kế hoạch vs thực tế</h3>
            <span>% doanh thu · nét đứt = kế hoạch</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="lb" tick={{ fontSize: 10, fill: C.axis }} />
              <YAxis tick={{ fontSize: 10, fill: C.axis }} width={36} unit="%" />
              <Tooltip {...tip} />
              <Legend {...leg} />
              <ReferenceLine y={0} stroke={C.axis} />
              <Line dataKey="gmKH" name="Biên gộp KH" stroke={C.soft} strokeDasharray="4 3" dot={false} connectNulls />
              <Line dataKey="gmTT" name="Biên gộp TT" stroke={C.blue} strokeWidth={2} dot={{ r: 2 }} />
              <Line dataKey="lnpKH" name="Biên LN trước thuế KH" stroke={C.amber} strokeDasharray="4 3" dot={false} connectNulls />
              <Line dataKey="lnpTT" name="Biên LN trước thuế TT" stroke={C.bad} strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
      </div>
      <section className="m2-panel">
        <div className="m2-head">
          <h3>1 đồng doanh thu đi đâu — lũy kế T1–T{n + 1}</h3>
          <span>
            Thực tế: giá vốn {nf(1).format(k.gv)}đ (KH {nf(1).format(kh.gv)}đ) · phí sàn {nf(1).format(k.san)}đ (KH {nf(1).format(kh.san)}đ) ·
            marketing {nf(1).format(k.mkt)}đ (KH {nf(1).format(kh.mkt)}đ) · còn lại lợi nhuận {nf(1).format(k.ln)}đ (KH {nf(1).format(kh.ln)}đ) trên mỗi 100đ
          </span>
        </div>
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={dong} layout="vertical" stackOffset="sign" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: C.axis }} unit="%" />
            <YAxis type="category" dataKey="k" tick={{ fontSize: 11, fill: C.navy }} width={70} />
            <Tooltip formatter={(v, name) => [`${nf(1).format(v)}%`, name]} />
            <Legend {...leg} />
            <ReferenceLine x={0} stroke={C.axis} />
            <Bar dataKey="gv" stackId="a" name="Giá vốn" fill={C.navy} />
            <Bar dataKey="san" stackId="a" name="Phí sàn" fill={C.blue} />
            <Bar dataKey="mkt" stackId="a" name="Marketing" fill={C.amber} />
            <Bar dataKey="hd" stackId="a" name="Hoạt động + tài chính" fill={C.grey} />
            <Bar dataKey="ln" stackId="a" name="Lợi nhuận trước thuế" fill={C.good} />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </>
  )
}

/* ---------------- xuất Excel ---------------- */
function xuat(version, cmp) {
  const n = cmp.lk.length
  const money = { fmt: '#,##0', w: 17 }
  const cols = [
    { h: 'Khoản mục', w: 46 }, { h: `Thực đạt T1–T${n}`, ...money }, { h: `Ngân sách T1–T${n}`, ...money },
    { h: 'Chênh lệch', ...money }, { h: 'Chênh lệch %', fmt: '0.0%', w: 12 },
    { h: 'Dự báo cả năm', ...money }, { h: 'Ngân sách cả năm', ...money }, { h: 'Chênh lệch cả năm', ...money },
  ]
  const row = (o, sign, label, kind) => {
    const d = o.actLK - o.planLK, dy = o.fcYear - o.planYear
    const tone = v => (!v ? undefined : sign * v > 0 ? 'good' : 'bad')
    return {
      kind, cells: [label, o.actLK, o.planLK, d, o.planLK ? d / Math.abs(o.planLK) : '', o.fcYear, o.planYear, dy],
      tone: { 3: tone(d), 4: tone(d), 7: tone(dy) },
    }
  }
  const rows = []
  const after = { gia_von: 'gp', opex: 'vh', tai_chinh: 'lntt' }
  for (const g of GROUPS) {
    const G = cmp.grp[g.id]
    if (!G.rows.length) continue
    rows.push(row(G, g.sign, g.label.toUpperCase(), 'group'))
    for (const r of G.rows) {
      rows.push(row(r, r.sign, `   ${r.name}${r.missMonths.length ? ` (thiếu ${r.missMonths.length} tháng)` : ''}`))
    }
    if (after[g.id]) rows.push(row(cmp.der[after[g.id]], cmp.der[after[g.id]].sign, cmp.der[after[g.id]].label, 'total'))
  }
  const why = cmp.contribs.map(r => ({
    cells: [r.name, r.actLK, r.planLK, r.contrib],
    tone: { 3: r.contrib >= 0 ? 'good' : 'bad' },
  }))
  why.push({ kind: 'total', cells: ['Lệch lợi nhuận trước thuế', cmp.der.lntt.actLK, cmp.der.lntt.planLK, cmp.der.lntt.d] })
  return xuatBang(`Ke-hoach-vs-Thuc-dat_${version.version}_T1-T${n}.xlsx`, [
    {
      name: 'Đối chiếu', title: `KẾ HOẠCH vs THỰC ĐẠT — ${version.name}`,
      sub: `Lũy kế T1–T${n}/${version.year} · đơn vị đồng · toàn công ty (trên sàn + ngoài sàn) · xuất ${new Date().toLocaleString('vi-VN')}`,
      cols, rows,
      notes: [
        'Dự báo cả năm = thực đạt đến tháng chọn + ngân sách các tháng còn lại.',
        'Màu: xanh = có lợi cho lợi nhuận, đỏ = bất lợi (chi phí cao hơn kế hoạch là bất lợi).',
        'Thực đạt chỉ cộng các tháng có số; khoản ghi "thiếu N tháng" chưa đủ số thực tế.',
      ],
    },
    {
      name: 'Vì sao lệch', title: 'KHOẢN NÀO LÀM LỢI NHUẬN LỆCH KẾ HOẠCH',
      sub: `Lũy kế T1–T${n}/${version.year} · đóng góp = (thực tế − kế hoạch) theo chiều có lợi cho lợi nhuận`,
      cols: [{ h: 'Khoản mục', w: 46 }, { h: 'Thực đạt', ...money }, { h: 'Ngân sách', ...money }, { h: 'Đóng góp vào lệch LN', ...money }],
      rows: why,
    },
  ])
}
