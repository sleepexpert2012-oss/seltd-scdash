import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend, Cell,
} from 'recharts'
import master from '../data/master'
import debtFile from '../data/supplier_debt.json'
import arFile from '../data/receivable.json'
import { SKU_MAP, BASE_SUMMARY, STOCK_BY_SKU } from '../lib/metrics'
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

  /* ---------- Công nợ phải thu từ đại lý ----------
     Hạn thu = ngày giao + số ngày công nợ. Tiền đến hạn tuần nào rơi vào tuần
     đó. Tiền đã thu trừ dần theo thứ tự hạn CŨ TRƯỚC (đòi nợ bao giờ cũng thu
     khoản cũ nhất trước), nên khoản nào còn lại mới là khoản thực sự phải đòi. */
  const ar = useMemo(() => {
    const term = Object.fromEntries((arFile.customers || []).map(c => [c.code, c.term_days || 30]))
    const tenKH = Object.fromEntries((arFile.customers || []).map(c => [c.code, c.name]))
    const addDays = (iso, n) => {
      const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n)
      return t.toISOString().slice(0, 10)
    }
    const khoan = (arFile.deliveries || []).map(x => ({
      ...x, han: addDays(x.d, term[x.cust] ?? 30), conLai: x.amount, loai: 'giao',
    })).sort((a, b) => a.han.localeCompare(b.han))

    /* Kế hoạch giao tiếp theo -> phải thu DỰ KIẾN, hạn = cuối tuần giao + term */
    const duKien = (arFile.plans || []).map(x => ({
      pxk: `KH ${x.d_from.slice(8)}/${x.d_from.slice(5, 7)}`, cust: x.cust, d: x.d_to,
      amount: x.amount, han: addDays(x.d_to, term[x.cust] ?? 30), conLai: x.amount, loai: 'kehoach',
    })).sort((a, b) => a.han.localeCompare(b.han))

    let daThu = (arFile.payments || []).reduce((a, p) => a + (p.amount || 0), 0)
    const thuTong = daThu
    for (const k of khoan) {
      if (daThu <= 0) break
      const tru = Math.min(daThu, k.conLai)
      k.conLai -= tru; daThu -= tru
    }
    const conPhaiThu = khoan.reduce((a, k) => a + k.conLai, 0)
    const homNay = new Date().toISOString().slice(0, 10)
    const quaHan = khoan.filter(k => k.conLai > 0 && k.han < homNay)
    return {
      tenKH, khoan, duKien, thuTong, conPhaiThu,
      daGiao: khoan.reduce((a, k) => a + k.amount, 0),
      keHoach: duKien.reduce((a, k) => a + k.amount, 0),
      quaHan, quaHanTien: quaHan.reduce((a, k) => a + k.conLai, 0),
      asOf: arFile.meta?.as_of || null,
      /* Khoản còn lại theo tuần đến hạn — đây là thứ nối vào bảng dòng tiền */
      theoHan: [...khoan, ...duKien].filter(k => k.conLai > 0),
    }
  }, [])

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
      /* Thu nợ khách hàng KHÔNG nhập tay: tự lấy các khoản đến hạn trong tuần.
         Tách riêng `thuNo` để bảng chỉ rõ phần nào do app tính. */
      const t0 = k.mon.toISOString().slice(0, 10)
      const t1 = k.sun.toISOString().slice(0, 10)
      const trongTuan = ar.theoHan.filter(x => x.han >= t0 && x.han <= t1)
      const thuNo = trongTuan.reduce((a, x) => a + x.conLai, 0)
      k.thuNoChiTiet = trongTuan
      const thu = THU.reduce((a, [id]) => a + (k.raw.thu?.[id] || 0), 0) + thuNo
      k.thuNo = thuNo
      const chiNcc = NCC.reduce((a, [code]) => a + (k.raw.chi?.[code] || 0), 0)
      const chiKhac = CHI_KHAC.reduce((a, [id]) => a + (k.raw.chi?.[id] || 0), 0)
      const chi = chiNcc + chiKhac
      /* Đầu kỳ: tuần đầu do người dùng nhập, các tuần sau nối từ cuối kỳ tuần
         trước — đây là chỗ Excel hay sai vì phải kéo tay công thức. */
      const open = carry == null ? (k.raw.open || 0) : carry
      const truocChi = open + thu
      const close = truocChi - chi
      Object.assign(k, { thu, thuNo, chi, chiNcc, chiKhac, open, truocChi, close, tuNhap: carry == null })
      carry = close
    }
    /* Khoản đến hạn TRƯỚC tuần đầu tiên đang hiển thị sẽ không xuất hiện ở bảng
       — phải nêu riêng, nếu không người đọc tưởng đã tính hết. */
    const dauKy = weeks[0] ? weeks[0].mon.toISOString().slice(0, 10) : null
    const noNgoaiKy = dauKy
      ? ar.theoHan.filter(x => x.han < dauKy).reduce((a, x) => a + x.conLai, 0)
      : 0
    const am = weeks.find(k => k.close < 0)
    return {
      weeks, noNgoaiKy,
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
  }, [data, from, nWeeks, NCC, ar])

  /* Công nợ: lấy số KHAI TAY từ phần mềm kế toán (src/data/supplier_debt.json).
     Số app tự cộng từ PO trong Master Data ra 1.379,6tr trong khi số thật là
     779,2tr — lệch 600tr vì Master Data chưa cập nhật các khoản đã thanh toán.
     Giữ cả hai để đối chiếu, nhưng số dùng để lập kế hoạch chi là số khai tay. */
  const ref = useMemo(() => {
    const byCode = new Map(master.suppliers.map(s => [s.code, s.name]))
    const rows = (debtFile.rows || []).map(r => ({
      code: r.code, name: byCode.get(r.code) || r.name, no: r.debt || 0,
    })).filter(r => r.no > 0).sort((a, b) => b.no - a.no)
    const tongNo = rows.reduce((a, r) => a + r.no, 0)

    /* Số cũ tính từ PO — chỉ để chỉ ra độ lệch, không dùng để lập kế hoạch */
    let noTuPO = 0
    for (const p of master.purchaseOrders) noTuPO += Math.max(0, p.outstanding || 0)

    /* Giá trị tồn lấy từ TỒN KIỂM KHO (gồm cả kho không bán được), không lấy
       từ số Shopee nữa — cùng nguồn với màn Tồn kho. */
    const tonValue = Object.entries(STOCK_BY_SKU).reduce(
      (a, [sku, t]) => a + (t.total + t.store) * (SKU_MAP[sku]?.unitCost || 0), 0)

    return {
      rows, tongNo, noTuPO, tonValue, chenh: tonValue - tongNo,
      asOf: debtFile.meta?.as_of || null, tonAsOf: BASE_SUMMARY.asOf,
    }
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
    L.push('', `III. CÔNG NỢ PHẢI THU: ${tr(ar.conPhaiThu)}`)
    if (ar.quaHanTien > 0) L.push(`   - Quá hạn: ${tr(ar.quaHanTien)} (${ar.quaHan.length} phiếu)`)
    if (ar.keHoach > 0) L.push(`   - Kế hoạch giao tiếp: ${tr(ar.keHoach)}`)
    return L.join('\n')
  }, [d, ref, NCC, ar])

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
              <tr className="auto-row">
                <td className="lbl">
                  Thu nợ khách hàng (đến hạn)
                  <i className="auto-tag">app tự tính từ phiếu xuất + hạn công nợ</i>
                </td>
                {d.weeks.map(k => (
                  <td key={k.id} className="num">
                    {k.thuNo
                      ? <span className="auto" title={k.thuNoChiTiet.map(x => `${x.pxk}: ${fmtVnd(x.conLai)}`).join('\n')}>
                          {fmtVnd(k.thuNo)}
                        </span>
                      : <span className="dim">—</span>}
                  </td>
                ))}
                <td className="num tot">{fmtVnd(d.weeks.reduce((a, k) => a + k.thuNo, 0)) || '—'}</td>
              </tr>
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
                  <tr><th>Mã</th><th>Nhà cung cấp</th><th className="num">Nợ cần trả</th></tr>
                </thead>
                <tbody>
                  {ref.rows.map(r => (
                    <tr key={r.code}>
                      <td className="sm">{r.code}</td>
                      <td><b>{r.name}</b></td>
                      <td className="num">{trieu(r.no, 1)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td /><td>Tổng</td><td className="num">{trieu(ref.tongNo, 1)}</td></tr>
                </tfoot>
              </table>
              <p className="cf-note">
                Số lấy từ <b>phần mềm kế toán</b>, chốt ngày <b>{ref.asOf}</b> — đây là số dùng
                để lập kế hoạch chi.
              </p>
              <p className="cf-note warn">
                App tự cộng từ PO trong Master Data ra <b>{trieu(ref.noTuPO, 0)} tr</b>, lệch{' '}
                <b>{trieu(ref.noTuPO - ref.tongNo, 0)} tr</b> so với số trên — vì Master Data chưa
                đánh dấu các khoản đã thanh toán (cột <i>paid</i>). Không dùng số tính từ PO để
                chi tiền; muốn hai bên khớp thì cập nhật cột <i>paid</i> rồi tải lại Master Data.
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
            Tồn kho theo <b>kiểm kho ngày {ref.tonAsOf}</b> (gồm cả hàng ở kho không bán được),
            tính theo giá vốn chưa VAT; công nợ tính trên giá có VAT — nên phần
            {ref.chenh < 0 ? ' thiếu' : ' dư'} này luôn bị thổi rộng hơn thực tế một chút.
            Đọc theo hướng, đừng đọc như số quyết toán.
          </p>
        </section>
      </div>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Công nợ khách hàng phải thu</h3>
          <span>
            Hạn thu = ngày xuất kho + số ngày công nợ của đại lý. Khoản đến hạn tuần nào đã
            được cộng thẳng vào dòng <b>Thu nợ khách hàng</b> ở bảng trên — không phải nhập tay.
          </span>
        </div>
        <div className="cf-kv cf-kv4">
          <div><span>Đã giao</span><b>{trieu(ar.daGiao, 1)} tr</b></div>
          <div className="good"><span>Đã thu</span><b>{trieu(ar.thuTong, 1)} tr</b></div>
          <div><span>Còn phải thu</span><b>{trieu(ar.conPhaiThu, 1)} tr</b></div>
          <div className={ar.quaHanTien > 0 ? 'bad' : ''}>
            <span>Quá hạn</span><b>{trieu(ar.quaHanTien, 1)} tr</b>
          </div>
        </div>
        {ar.quaHanTien > 0 && (
          <div className="cf-warn" style={{ margin: '12px 0 0' }}>
            <b>⚠ {trieu(ar.quaHanTien, 1)} triệu đã quá hạn thu ({ar.quaHan.length} phiếu)</b>
            <p>
              Tiền này đáng ra đã phải về.
              {d.noNgoaiKy > 0
                ? <> Trong đó <b>{trieu(d.noNgoaiKy, 1)} triệu</b> đến hạn <b>trước</b> tuần đầu
                    của bảng nên <b>không</b> xuất hiện ở dòng Thu nợ — phần còn lại đã nằm trong
                    tuần tương ứng.</>
                : <> Toàn bộ đã rơi vào các tuần tương ứng trong bảng trên.</>}
              {' '}Khoản quá hạn vẫn được tính là sẽ thu được — nếu khách chưa chắc trả thì đừng
              dựa vào nó để lên lịch chi.
            </p>
          </div>
        )}
        <div className="m2-tablewrap" style={{ marginTop: 12 }}>
          <table className="cf-ref">
            <thead>
              <tr><th>Phiếu / kế hoạch</th><th>Khách</th><th>Ngày giao</th><th>Hạn thu</th>
                <th className="num">Giá trị</th><th className="num">Còn phải thu</th><th>Tình trạng</th></tr>
            </thead>
            <tbody>
              {[...ar.khoan, ...ar.duKien].map(k => {
                const homNay = new Date().toISOString().slice(0, 10)
                const qh = k.conLai > 0 && k.han < homNay
                const xong = k.conLai === 0
                return (
                  <tr key={k.pxk + k.han}>
                    <td className="sm">{k.pxk}</td>
                    <td className="sm">{ar.tenKH[k.cust] || k.cust}</td>
                    <td className="sm">{k.d.slice(8)}/{k.d.slice(5, 7)}</td>
                    <td className="sm">{k.han.slice(8)}/{k.han.slice(5, 7)}</td>
                    <td className="num">{trieu(k.amount, 1)}</td>
                    <td className={`num${qh ? ' neg' : ''}`}>{k.conLai ? trieu(k.conLai, 1) : '—'}</td>
                    <td className="sm">
                      {xong ? <span className="ar-tag done">đã thu</span>
                        : k.loai === 'kehoach' ? <span className="ar-tag plan">chưa giao</span>
                          : qh ? <span className="ar-tag late">quá hạn</span>
                            : <span className="ar-tag ok">chưa tới hạn</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="cf-note">
          Tiền khách đã trả được trừ vào khoản có <b>hạn cũ nhất trước</b> — đòi nợ bao giờ cũng
          thu khoản cũ nhất, nên phần còn lại mới đúng là phần thực sự phải đòi.
          Dòng “chưa giao” là kế hoạch giao tiếp theo, hạn thu tính từ cuối tuần giao dự kiến —
          giao trễ thì tiền về trễ theo.
          {ar.asOf && <> Số chốt từ file ngày <b>{ar.asOf}</b>.</>}
        </p>
      </section>

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
