import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend, Cell,
} from 'recharts'
import master from '../data/master'
import stock from '../data/stock.json'
import { SKU_MAP } from '../lib/metrics'
import { trieu, num } from '../lib/format'
import {
  fetchCashflow, pushCashflow, fetchCashflowLog, cashflowCache, cashflowMeta,
  deviceName, setDeviceName,
} from '../lib/cloud'
import { exportRowsXlsx } from '../lib/masterFile'
import './cashflow.css'

/* ============================================================
   KẾ HOẠCH DÒNG TIỀN THEO TUẦN
   Dựng theo đúng file Excel "Báo Cáo Dòng Tiền" đang dùng: cột là tuần ISO
   (thứ Hai → Chủ nhật), hàng là các khoản thu/chi.

   Nguyên tắc: MỌI số tiền đều do người dùng nhập, app không tự điền. Lý do —
   công nợ theo Master Data (1.379tr) lệch xa con số đang báo cáo (954tr), tự
   điền là đưa số sai vào kế hoạch chi tiền. Số của app để CẠNH làm tham chiếu,
   kèm cảnh báo lệch, để người dùng tự đối chiếu.

   Chỉ có hai thứ app tự tính: tiền mặt đầu kỳ của tuần sau (= cuối kỳ tuần
   trước) và các dòng tổng.
   ============================================================ */

const C = {
  navy: '#232A6B', blue: '#353E99', blue2: '#5C67C4', soft: '#8E96DC',
  bad: '#B42318', good: '#1F7A45', amber: '#D97706', grid: '#E7E9F3', axis: '#8E93B5',
}

/* Các khoản chi cố định, chép từ file Excel đang dùng (mục 7–12) */
const CHI_KHAC = [
  ['luong', 'Chi trả tiền lương và các phụ cấp hàng tháng cho NLĐ'],
  ['khobai', 'Chi phí kho bãi FBS, ACE, vận chuyển'],
  ['ads', 'Chi phí quảng cáo, tiếp thị, website, tên miền, hosting'],
  ['dichvu', 'Chi trả các dịch vụ mua ngoài (tư vấn, bảo hiểm, thuế…)'],
  ['thuenha', 'Tiền thuê nhà, tiền điện nước'],
  ['vattu', 'Chi mua vật tư, trang thiết bị văn phòng, mua mẫu'],
]

const THU = [
  ['banDuKien', 'Thu tiền từ hoạt động bán hàng dự kiến'],
  ['banThucTe', 'Thu tiền từ hoạt động bán hàng thực tế'],
  ['khac', 'Tiền thu khác'],
  ['buVon', 'Nộp tiền mặt vào tài khoản ngân hàng (bù vốn chủ sở hữu)'],
]

/* ---------- tuần ISO ---------- */
const iso = d => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return { y: t.getUTCFullYear(), w: Math.ceil(((t - y0) / 86400000 + 1) / 7) }
}
const wkId = (y, w) => `${y}-W${String(w).padStart(2, '0')}`
/* Thứ Hai của tuần ISO */
const mondayOf = (y, w) => {
  const jan4 = new Date(Date.UTC(y, 0, 4))
  const mon1 = new Date(jan4)
  mon1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1))
  const d = new Date(mon1)
  d.setUTCDate(mon1.getUTCDate() + (w - 1) * 7)
  return d
}
const fmtD = d => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
const addW = (y, w, n) => { const d = mondayOf(y, w); d.setUTCDate(d.getUTCDate() + n * 7); return iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }

/* ---------- nhập số tiền ---------- */
const parseVnd = s => {
  const v = String(s ?? '').replace(/[^\d-]/g, '')
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const fmtVnd = n => (n ? new Intl.NumberFormat('vi-VN').format(Math.round(n)) : '')

function MoneyInput({ value, onChange, placeholder = '—', title }) {
  const [txt, setTxt] = useState(fmtVnd(value))
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setTxt(fmtVnd(value)) }, [value, focus])
  return (
    <input className="cf-in" value={txt} title={title} placeholder={placeholder}
      inputMode="numeric"
      onFocus={() => setFocus(true)}
      onChange={e => { setTxt(e.target.value); onChange(parseVnd(e.target.value)) }}
      onBlur={() => { setFocus(false); setTxt(fmtVnd(value)) }} />
  )
}

export default function Cashflow() {
  const now = new Date()
  const cur = iso(now)
  const [from, setFrom] = useState(() => cur)         // tuần đầu tiên hiển thị
  const [nWeeks, setNWeeks] = useState(8)
  const [data, setData] = useState(() => cashflowCache() || {})
  const [meta, setMeta] = useState(() => cashflowMeta())
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [log, setLog] = useState(null)
  const [dev, setDev] = useState(deviceName())
  const [showRef, setShowRef] = useState(true)

  /* nạp từ đám mây khi mở màn */
  useEffect(() => {
    let huy = false
    fetchCashflow()
      .then(r => { if (!huy) { setData(r.weeks); setMeta({ at: r.at, by: r.by }); setDirty(false) } })
      .catch(e => { if (!huy) setMsg({ t: 'warn', s: `Không tải được từ đám mây (${e.message}). Đang dùng bản lưu tại máy.` }) })
    return () => { huy = true }
  }, [])

  const NCC = useMemo(() => master.suppliers.map(s => [s.code, s.name]), [])

  /* ---------- tính toán ---------- */
  const d = useMemo(() => {
    const weeks = []
    let y = from.y, w = from.w
    for (let i = 0; i < nWeeks; i++) {
      const id = wkId(y, w)
      const mon = mondayOf(y, w)
      const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
      weeks.push({ id, y, w, mon, sun, raw: data[id] || {} })
      const nx = addW(y, w, 1); y = nx.y; w = nx.w
    }
    let carry = null
    for (const k of weeks) {
      const thu = THU.reduce((a, [id]) => a + (k.raw.thu?.[id] || 0), 0)
      const chiNcc = NCC.reduce((a, [code]) => a + (k.raw.chi?.[code] || 0), 0)
      const chiKhac = CHI_KHAC.reduce((a, [id]) => a + (k.raw.chi?.[id] || 0), 0)
      const chi = chiNcc + chiKhac
      /* Đầu kỳ: tuần đầu do người dùng nhập, các tuần sau nối từ cuối kỳ tuần
         trước — đây là chỗ Excel hay sai vì phải kéo tay công thức. */
      const open = carry == null ? (k.raw.open || 0) : carry
      const truocChi = open + thu
      const close = truocChi - chi
      Object.assign(k, { thu, chi, chiNcc, chiKhac, open, truocChi, close, tuNhap: carry == null })
      carry = close
    }
    const am = weeks.find(k => k.close < 0)
    return {
      weeks,
      tong: {
        thu: weeks.reduce((a, k) => a + k.thu, 0),
        chi: weeks.reduce((a, k) => a + k.chi, 0),
        open: weeks[0]?.open || 0,
        close: weeks[weeks.length - 1]?.close || 0,
      },
      am,
      chart: weeks.map(k => ({
        label: `T${k.w}`, thu: k.thu / 1e6, chi: -k.chi / 1e6, close: k.close / 1e6,
      })),
    }
  }, [data, from, nWeeks, NCC])

  /* Công nợ & tồn kho từ dữ liệu app — chỉ để THAM CHIẾU, không tự điền */
  const ref = useMemo(() => {
    const bySup = new Map()
    for (const p of master.purchaseOrders) {
      const o = p.outstanding || 0
      if (o <= 0) continue
      const t = bySup.get(p.supplier) || { name: p.supplier, no: 0, po: 0, quaHan: 0 }
      t.no += o; t.po += 1
      if ((p.daysOverdue || 0) > 0) t.quaHan += o
      bySup.set(p.supplier, t)
    }
    const rows = [...bySup.values()].sort((a, b) => b.no - a.no)
    const tonValue = stock.rows.reduce((a, r) => a + r.qty * (SKU_MAP[r.sku]?.unitCost || 0), 0)
    const tongNo = rows.reduce((a, r) => a + r.no, 0)
    return { rows, tongNo, tonValue, chenh: tonValue - tongNo }
  }, [])

  const set = (wkid, path, val) => {
    setData(o => {
      const w = { ...(o[wkid] || {}) }
      if (path[0] === 'open') w.open = val
      else w[path[0]] = { ...(w[path[0]] || {}), [path[1]]: val }
      return { ...o, [wkid]: w }
    })
    setDirty(true)
  }

  async function luu() {
    setBusy('save'); setMsg(null)
    try {
      const gui = {}
      for (const k of d.weeks) if (data[k.id]) gui[k.id] = data[k.id]
      const r = await pushCashflow(gui, dev)
      setMeta({ at: r?.saved_at || new Date().toISOString(), by: dev })
      setDirty(false)
      setMsg({ t: 'ok', s: `Đã lưu ${r?.n_weeks ?? Object.keys(gui).length} tuần lên đám mây.` })
    } catch (e) {
      /* Báo lỗi thay vì ghi ngầm tại máy: hai máy hai con số mà không ai biết
         thì nguy hiểm hơn là báo lỗi ngay. */
      setMsg({ t: 'bad', s: `CHƯA lưu được (${e.message}). Kiểm tra mạng rồi bấm Lưu lại — số đang chỉ nằm trên màn hình này.` })
    } finally { setBusy(null) }
  }

  async function taiLai() {
    setBusy('load'); setMsg(null)
    try {
      const r = await fetchCashflow()
      setData(r.weeks); setMeta({ at: r.at, by: r.by }); setDirty(false)
      setMsg({ t: 'ok', s: 'Đã tải bản mới nhất từ đám mây.' })
    } catch (e) { setMsg({ t: 'bad', s: `Không tải được: ${e.message}` }) }
    finally { setBusy(null) }
  }

  /* Bản tin nhắn — đúng khuôn đang gửi hằng tuần */
  const banTin = useMemo(() => {
    const k = d.weeks[0], k2 = d.weeks[1]
    if (!k) return ''
    const tr = n => `${Math.round(n / 1e6)}tr`
    const L = []
    L.push(`Em gửi kế hoạch dòng tiền tuần ${k.w}${k2 ? ` và ${k2.w}` : ''} nhé các anh @all`, '')
    const khoi = (x, dau) => {
      L.push(`W${x.w}: ${fmtD(x.mon)} – ${fmtD(x.sun)}/${x.sun.getUTCFullYear()}`)
      L.push(`• ${dau}: ${tr(x.open)}`)
      const duKien = (x.raw.thu?.banDuKien || 0) + (x.raw.thu?.banThucTe || 0) + (x.raw.thu?.khac || 0)
      L.push(`• Tiền về dự kiến: ${tr(duKien)}`)
      L.push(`• Tiền ra: ${tr(x.chi)}`)
      for (const [code, ten] of NCC) {
        const v = x.raw.chi?.[code] || 0
        if (v) L.push(`     - Thanh toán ${ten}: ${new Intl.NumberFormat('vi-VN').format(v)}`)
      }
      for (const [id, ten] of CHI_KHAC) {
        const v = x.raw.chi?.[id] || 0
        if (v) L.push(`     - ${ten.split('(')[0].trim()}: ${new Intl.NumberFormat('vi-VN').format(v)}`)
      }
      const bu = x.raw.thu?.buVon || 0
      L.push(`• Dự kiến bù thêm: ${tr(bu)}`)
      L.push('')
    }
    khoi(k, 'Tiền mặt hiện có')
    if (k2) khoi(k2, 'Đầu kỳ')
    L.push('', `I. CÔNG NỢ : ${tr(ref.tongNo)}`, '')
    ref.rows.forEach((r, i) => L.push(`${i + 1}. ${r.name}: ${tr(r.no)}`))
    L.push('', `II. HÀNG TỒN KHO: ${tr(ref.tonValue)} ${ref.chenh < 0 ? 'âm' : 'dư'} ${tr(Math.abs(ref.chenh))}/ công nợ ncc`)
    return L.join('\n')
  }, [d, ref, NCC])

  function xls() {
    const row = (ten, lay) => ({
      'Khoản mục': ten,
      ...Object.fromEntries(d.weeks.map(k => [`T${k.w}`, Math.round(lay(k))])),
      'Tổng cộng': Math.round(d.weeks.reduce((a, k) => a + lay(k), 0)),
    })
    exportRowsXlsx('Ke hoach dong tien theo tuan.xlsx', {
      'Dong tien tuan': [
        row('Tiền mặt đầu kỳ', k => k.open),
        ...THU.map(([id, ten]) => row(ten, k => k.raw.thu?.[id] || 0)),
        row('TỔNG THU', k => k.thu),
        row('Tổng tiền mặt trước khi chi', k => k.truocChi),
        ...NCC.map(([code, ten]) => row(`Chi trả NCC ${ten}`, k => k.raw.chi?.[code] || 0)),
        ...CHI_KHAC.map(([id, ten]) => row(ten, k => k.raw.chi?.[id] || 0)),
        row('TỔNG CHI', k => k.chi),
        row('Tiền mặt cuối kỳ', k => k.close),
      ],
      'Cong no NCC': ref.rows.map(r => ({
        'Nhà cung cấp': r.name, 'Công nợ (đ)': Math.round(r.no),
        'Trong đó quá hạn (đ)': Math.round(r.quaHan), 'Số PO chưa trả': r.po,
      })),
    })
  }

  const KPI = [
    { k: 'Tiền mặt đầu kỳ', v: trieu(d.tong.open, 1), u: 'tr',
      sub: `tuần ${d.weeks[0]?.w} · ${d.weeks[0] ? fmtD(d.weeks[0].mon) : ''}` },
    { k: 'Tổng thu dự kiến', v: trieu(d.tong.thu, 1), u: 'tr', tone: 'good', sub: `${nWeeks} tuần tới` },
    { k: 'Tổng chi dự kiến', v: trieu(d.tong.chi, 1), u: 'tr', tone: 'bad', sub: `${nWeeks} tuần tới` },
    { k: 'Tiền mặt cuối kỳ', v: trieu(d.tong.close, 1), u: 'tr',
      tone: d.tong.close < 0 ? 'bad' : 'good',
      sub: `sau tuần ${d.weeks[d.weeks.length - 1]?.w}` },
    { k: 'Tuần âm quỹ đầu tiên', v: d.am ? `T${d.am.w}` : 'Không', u: d.am ? '' : 'tuần nào',
      tone: d.am ? 'bad' : 'good',
      sub: d.am ? `thiếu ${trieu(-d.am.close, 1)} tr` : 'quỹ dương suốt kỳ' },
  ]

  return (
    <div className="cf-page">
      <div className="m2-title">
        <div>
          <h2>Kế hoạch dòng tiền theo tuần</h2>
          <p>
            Anh nhập tiền mặt đầu kỳ, tiền dự kiến thu và các khoản dự chi — app nối tuần,
            cộng tổng và chỉ ra tuần nào âm quỹ. Số lưu trên đám mây, mọi máy mở đều thấy
            cùng một kế hoạch.
          </p>
        </div>
        <div className={`cf-health ${d.am ? 't-bad' : 't-good'}`}>
          <span>Tuần âm quỹ</span>
          <b>{d.am ? `Tuần ${d.am.w}` : 'Không có'}</b>
          <i>{d.am ? `thiếu ${trieu(-d.am.close, 1)} tr` : `${nWeeks} tuần tới đều dương`}</i>
        </div>
      </div>

      <div className="cf-bar">
        <label>Từ tuần
          <select value={wkId(from.y, from.w)}
            onChange={e => { const [y, w] = e.target.value.split('-W'); setFrom({ y: +y, w: +w }) }}>
            {Array.from({ length: 27 }, (_, i) => addW(cur.y, cur.w, i - 8)).map(x => (
              <option key={wkId(x.y, x.w)} value={wkId(x.y, x.w)}>
                Tuần {x.w}/{x.y} · {fmtD(mondayOf(x.y, x.w))}
              </option>
            ))}
          </select>
        </label>
        <label>Số tuần
          <select value={nWeeks} onChange={e => setNWeeks(+e.target.value)}>
            {[4, 6, 8, 12].map(n => <option key={n} value={n}>{n} tuần</option>)}
          </select>
        </label>
        <label>Tên máy
          <input className="cf-dev" value={dev}
            onChange={e => { setDev(e.target.value); setDeviceName(e.target.value) }} />
        </label>
        <div className="cf-acts">
          <button className={`btn-primary${dirty ? ' on' : ''}`} onClick={luu} disabled={busy === 'save'}>
            {busy === 'save' ? 'Đang lưu…' : dirty ? '● Lưu lên đám mây' : 'Lưu lên đám mây'}
          </button>
          <button className="btn-ghost" onClick={taiLai} disabled={busy === 'load'}>⟳ Tải lại</button>
          <button className="btn-ghost" onClick={xls}>⬇ Xuất Excel</button>
          <button className="btn-ghost" onClick={async () => {
            setLog(log ? null : await fetchCashflowLog().catch(() => []))
          }}>☰ Lịch sử</button>
        </div>
      </div>

      {meta?.at && (
        <p className="cf-meta">
          Lưu gần nhất <b>{new Date(meta.at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</b>
          {meta.by ? <> bởi <b>{meta.by}</b></> : null}
          {dirty && <span className="cf-dirty"> · có thay đổi chưa lưu</span>}
        </p>
      )}
      {msg && <div className={`cf-msg t-${msg.t}`}>{msg.s}</div>}

      {log && (
        <section className="m2-panel">
          <div className="m2-head"><h3>Lịch sử lưu</h3><span>30 lần gần nhất</span></div>
          <table className="cf-log">
            <thead><tr><th>Lúc</th><th>Máy</th><th className="num">Số tuần</th></tr></thead>
            <tbody>
              {log.map(r => (
                <tr key={r.id}>
                  <td>{new Date(r.at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</td>
                  <td>{r.actor || '—'}</td><td className="num">{r.weeks}</td>
                </tr>
              ))}
              {!log.length && <tr><td colSpan={3} className="cf-empty">Chưa có lần lưu nào.</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      <div className="mk-kpis cf-kpis">
        {KPI.map(x => (
          <div key={x.k} className={`mk-kpi ${x.tone || ''}`}>
            <span className="k">{x.k}</span>
            <strong>{x.v}<em>{x.u}</em></strong>
            <span className="sub">{x.sub}</span>
          </div>
        ))}
      </div>

      {d.am && (
        <div className="cf-warn">
          <b>⚠ Tuần {d.am.w} ({fmtD(d.am.mon)}–{fmtD(d.am.sun)}) âm quỹ {trieu(-d.am.close, 1)} triệu</b>
          <p>
            Với kế hoạch đang nhập, đến tuần đó chi vượt quá tiền có. Ba đường xử lý:
            dời một phần khoản chi sang tuần sau · đẩy nhanh tiền về · hoặc bù vốn chủ sở hữu
            ít nhất <b>{trieu(-d.am.close, 1)} triệu</b> trước tuần {d.am.w}.
          </p>
        </div>
      )}

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Bảng kế hoạch — ô trắng là ô anh nhập</h3>
          <span>
            Tiền mặt đầu kỳ chỉ nhập ở tuần đầu tiên; các tuần sau app tự nối từ cuối kỳ
            tuần trước. Dòng tô đậm là dòng app tự cộng.
          </span>
        </div>
        <div className="m2-tablewrap cf-wrap">
          <table className="cf-tb">
            <thead>
              <tr>
                <th className="lbl">Khoản mục</th>
                {d.weeks.map(k => (
                  <th key={k.id} className="num">
                    Tuần {k.w}<i>{fmtD(k.mon)} – {fmtD(k.sun)}</i>
                  </th>
                ))}
                <th className="num tot">Tổng cộng</th>
              </tr>
            </thead>
            <tbody>
              <tr className="sub">
                <td className="lbl">Tiền mặt đầu kỳ</td>
                {d.weeks.map(k => (
                  <td key={k.id} className="num">
                    {k.tuNhap
                      ? <MoneyInput value={k.raw.open || 0} title="Tiền mặt thực có đầu tuần"
                          onChange={v => set(k.id, ['open'], v)} />
                      : <span className="auto" title="Tự nối từ cuối kỳ tuần trước">{fmtVnd(k.open) || '0'}</span>}
                  </td>
                ))}
                <td className="num tot">—</td>
              </tr>

              <tr className="hdr"><td className="lbl" colSpan={d.weeks.length + 2}>Dòng tiền thu vào</td></tr>
              {THU.map(([id, ten]) => (
                <tr key={id}>
                  <td className="lbl">{ten}</td>
                  {d.weeks.map(k => (
                    <td key={k.id} className="num">
                      <MoneyInput value={k.raw.thu?.[id] || 0} onChange={v => set(k.id, ['thu', id], v)} />
                    </td>
                  ))}
                  <td className="num tot">{fmtVnd(d.weeks.reduce((a, k) => a + (k.raw.thu?.[id] || 0), 0)) || '—'}</td>
                </tr>
              ))}
              <tr className="sum">
                <td className="lbl">Tổng thu</td>
                {d.weeks.map(k => <td key={k.id} className="num">{fmtVnd(k.thu) || '—'}</td>)}
                <td className="num tot">{fmtVnd(d.tong.thu) || '—'}</td>
              </tr>
              <tr className="sub">
                <td className="lbl">Tổng tiền mặt trước khi chi</td>
                {d.weeks.map(k => <td key={k.id} className="num">{fmtVnd(k.truocChi) || '0'}</td>)}
                <td className="num tot">—</td>
              </tr>

              <tr className="hdr"><td className="lbl" colSpan={d.weeks.length + 2}>Dòng tiền chi ra</td></tr>
              {NCC.map(([code, ten]) => (
                <tr key={code}>
                  <td className="lbl">Chi trả nhà cung cấp <b>{ten}</b></td>
                  {d.weeks.map(k => (
                    <td key={k.id} className="num">
                      <MoneyInput value={k.raw.chi?.[code] || 0} onChange={v => set(k.id, ['chi', code], v)} />
                    </td>
                  ))}
                  <td className="num tot">{fmtVnd(d.weeks.reduce((a, k) => a + (k.raw.chi?.[code] || 0), 0)) || '—'}</td>
                </tr>
              ))}
              {CHI_KHAC.map(([id, ten]) => (
                <tr key={id}>
                  <td className="lbl">{ten}</td>
                  {d.weeks.map(k => (
                    <td key={k.id} className="num">
                      <MoneyInput value={k.raw.chi?.[id] || 0} onChange={v => set(k.id, ['chi', id], v)} />
                    </td>
                  ))}
                  <td className="num tot">{fmtVnd(d.weeks.reduce((a, k) => a + (k.raw.chi?.[id] || 0), 0)) || '—'}</td>
                </tr>
              ))}
              <tr className="sum">
                <td className="lbl">Tổng chi</td>
                {d.weeks.map(k => <td key={k.id} className="num">{fmtVnd(k.chi) || '—'}</td>)}
                <td className="num tot">{fmtVnd(d.tong.chi) || '—'}</td>
              </tr>
              <tr className="close">
                <td className="lbl">Tiền mặt cuối kỳ</td>
                {d.weeks.map(k => (
                  <td key={k.id} className={`num${k.close < 0 ? ' neg' : ''}`}>
                    {k.close < 0 ? `(${fmtVnd(-k.close)})` : fmtVnd(k.close) || '0'}
                  </td>
                ))}
                <td className="num tot">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Số dư quỹ theo tuần</h3>
          <span>Cột xanh là thu, cột đỏ là chi, đường là tiền mặt cuối tuần. Đường cắt xuống
            dưới 0 là tuần phải bù tiền.</span>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={d.chart} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" stroke={C.axis} fontSize={10.5} tickLine={false} />
            <YAxis stroke={C.axis} fontSize={10.5} tickLine={false} tickFormatter={v => num(v)} />
            <Tooltip formatter={v => `${num(Math.abs(v), 1)} tr`} />
            <Legend verticalAlign="top" align="left" height={26} iconSize={10}
              wrapperStyle={{ fontSize: 10.5, color: '#6E739B', paddingLeft: 26 }} />
            <ReferenceLine y={0} stroke={C.axis} />
            <Bar dataKey="thu" name="Thu · tr" fill={C.good} radius={[2, 2, 0, 0]} barSize={16} />
            <Bar dataKey="chi" name="Chi · tr" fill={C.bad} radius={[0, 0, 2, 2]} barSize={16} />
            <Line type="monotone" dataKey="close" name="Tiền mặt cuối tuần · tr"
              stroke={C.navy} strokeWidth={2.6} strokeLinecap="round"
              dot={{ r: 3.2, fill: '#fff', stroke: C.navy, strokeWidth: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </section>

      <div className="cf-row2">
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Công nợ nhà cung cấp — số theo Master Data</h3>
            <span>Để đối chiếu khi lên kế hoạch chi. App <b>không</b> tự điền vào bảng trên.</span>
            <div className="group-ctrl">
              <button onClick={() => setShowRef(!showRef)}>{showRef ? '▾' : '▸'} {showRef ? 'Thu gọn' : 'Mở ra'}</button>
            </div>
          </div>
          {showRef && (
            <>
              <table className="cf-ref">
                <thead>
                  <tr><th>Nhà cung cấp</th><th className="num">Công nợ</th>
                    <th className="num">Quá hạn</th><th className="num">PO</th></tr>
                </thead>
                <tbody>
                  {ref.rows.map(r => (
                    <tr key={r.name}>
                      <td><b>{r.name}</b></td>
                      <td className="num">{trieu(r.no, 1)}</td>
                      <td className={`num${r.quaHan ? ' neg' : ''}`}>{r.quaHan ? trieu(r.quaHan, 1) : '—'}</td>
                      <td className="num">{r.po}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td>Tổng</td><td className="num">{trieu(ref.tongNo, 1)}</td>
                    <td className="num">{trieu(ref.rows.reduce((a, r) => a + r.quaHan, 0), 1)}</td>
                    <td className="num">{ref.rows.reduce((a, r) => a + r.po, 0)}</td></tr>
                </tfoot>
              </table>
              <p className="cf-note warn">
                Con số này là <b>tổng mọi PO chưa đánh dấu đã trả</b> trong Master Data
                ({trieu(ref.tongNo, 0)} tr). Bản báo cáo tuần đang gửi ghi khoảng 954 tr —
                lệch vì Master Data chưa cập nhật các khoản đã thanh toán. Dùng cột này để
                <b> đối chiếu</b>, đừng chép thẳng; muốn khớp thì cập nhật cột <i>paid</i> trong
                Master Data rồi tải lại ở màn Cơ sở hạ tầng.
              </p>
            </>
          )}
        </section>

        <section className="m2-panel">
          <div className="m2-head">
            <h3>Hàng tồn kho đối ứng công nợ</h3>
            <span>Hàng đang nằm kho có đủ bù phần nợ nhà cung cấp không</span>
          </div>
          <div className="cf-kv">
            <div><span>Giá trị hàng tồn kho</span><b>{trieu(ref.tonValue, 0)} tr</b></div>
            <div><span>Công nợ nhà cung cấp</span><b>{trieu(ref.tongNo, 0)} tr</b></div>
            <div className={ref.chenh < 0 ? 'bad' : 'good'}>
              <span>{ref.chenh < 0 ? 'Thiếu' : 'Dư'}</span>
              <b>{trieu(Math.abs(ref.chenh), 0)} tr</b>
            </div>
          </div>
          <p className="cf-note">
            Tồn kho tính theo giá vốn chưa VAT, công nợ tính trên giá có VAT — nên phần
            {ref.chenh < 0 ? ' thiếu' : ' dư'} này luôn bị thổi rộng hơn thực tế một chút.
            Đọc theo hướng, đừng đọc như số quyết toán.
          </p>
        </section>
      </div>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Bản tin nhắn gửi nhóm</h3>
          <span>Sinh thẳng từ bảng trên, đúng khuôn anh đang gửi hằng tuần — bấm để chép</span>
          <div className="group-ctrl">
            <button onClick={() => {
              navigator.clipboard?.writeText(banTin)
                .then(() => setMsg({ t: 'ok', s: 'Đã chép bản tin vào bộ nhớ tạm.' }))
                .catch(() => setMsg({ t: 'warn', s: 'Trình duyệt chặn chép tự động — bôi đen rồi copy tay.' }))
            }}>⧉ Chép bản tin</button>
          </div>
        </div>
        <pre className="cf-msgbox">{banTin}</pre>
      </section>
    </div>
  )
}
