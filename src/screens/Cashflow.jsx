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
  deviceName, setDeviceName, fetchSales,
  fetchCfSetting, setCfSetting, fetchWcSnapshots, saveWcSnapshot,
} from '../lib/cloud'
import { workingCapital, arHistory } from '../lib/fin'
import { exportRowsXlsx } from '../lib/masterFile'
import { doiChieu, xuatDoiChieu } from '../lib/doiChieu'
import { tenNgan } from '../lib/formbits'
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

/* ---------- tính toán theo tuần ----------
   Hàm thuần dùng chung cho tab "Kế hoạch theo tuần" và tab "Theo tháng":
   cùng cách nối số dư (cuối kỳ tuần trước = đầu kỳ tuần sau) và cùng cách
   đưa tiền thu nợ khách vào tuần đến hạn. */
function tinhTuan(data, from, nWeeks, NCC, ar, resetOnOpen = false) {
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
    /* resetOnOpen (tab Theo tháng): tuần nào người dùng nhập tiền mặt đầu kỳ thì
       đó là số dư THỰC TẾ đã kiểm — lấy làm mốc thay vì số nối từ kế hoạch cũ */
    const open = carry == null || (resetOnOpen && k.raw.open) ? (k.raw.open || 0) : carry
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
}

/* Công nợ phải thu theo hạn — hàm thuần, dùng chung cho màn Dòng tiền và
   bộ nhận xét tự động (src/lib/insights.js). */
export function tinhAR() {
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
}

/* Chạy kế hoạch tuần từ tuần đầu tiên có số (lấy các tuần có nhập tiền mặt đầu kỳ
   làm mốc thật — như tab Theo tháng) và trả về danh sách tuần. */
export function chayKeHoachTuan(data, soTuan = 60) {
  const keys = Object.keys(data || {}).filter(k => {
    const r = data[k] || {}
    return r.open || Object.values(r.thu || {}).some(Boolean) || Object.values(r.chi || {}).some(Boolean)
  }).sort()
  if (!keys.length) return []
  const NCC = master.suppliers.map(x => [x.code, x.name])
  return tinhTuan(data, { y: +keys[0].slice(0, 4), w: +keys[0].slice(6) }, soTuan, NCC, tinhAR(), true).weeks
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
  const [tab, setTab] = useState('plan')

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
  const ar = useMemo(() => tinhAR(), [])

  /* ---------- tính toán ---------- */
  const d = useMemo(() => tinhTuan(data, from, nWeeks, NCC, ar), [data, from, nWeeks, NCC, ar])

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

  /* ---------- Báo cáo cho lãnh đạo ----------
     Mô phỏng lại 8 tuần dưới 3 kịch bản để trả lời "làm gì thì hết thiếu",
     thay vì chỉ báo con số thiếu. Dùng ĐÚNG số thu/chi của bảng kế hoạch,
     chỉ đổi một biến mỗi lần — đổi nhiều biến cùng lúc thì không quy được
     kết quả về đòn bẩy nào. */
  const bc = useMemo(() => {
    const mo = (f) => {
      let carry = null, day = 0, tuanAm = null
      for (const k of d.weeks) {
        const { thu, chi } = f(k)
        const open = carry == null ? k.open : carry
        const close = open + thu - chi
        if (close < 0 && !tuanAm) tuanAm = k
        day = Math.min(day, close)
        carry = close
      }
      return { thieu: day < 0 ? -day : 0, tuanAm, cuoi: carry }
    }
    const goc = mo(k => ({ thu: k.thu, chi: k.chi }))

    /* Đòn bẩy 1 — đòi được toàn bộ nợ quá hạn, tiền về ngay tuần đầu */
    const l1 = mo(k => ({
      thu: k.thu + (k.id === d.weeks[0]?.id ? ar.quaHanTien : 0), chi: k.chi,
    }))
    /* Đòn bẩy 2 — giãn khoản chi nhà cung cấp 2 tuần */
    const dayChi = {}
    d.weeks.forEach((k, i) => { dayChi[i] = k.chiNcc })
    const l2 = mo((k) => {
      const i = d.weeks.indexOf(k)
      const vao = i >= 2 ? (dayChi[i - 2] || 0) : 0
      return { thu: k.thu, chi: k.chiKhac + vao }
    })
    /* Đòn bẩy 3 — bù vốn: cần đúng bằng mức thiếu sâu nhất */
    const canBu = goc.thieu

    return {
      goc, l1, l2, canBu,
      tienMat: d.tong.open,
      phaiThu: ar.conPhaiThu,
      phaiTra: ref.tongNo,
      tonKho: ref.tonValue,
      rong: d.tong.open + ar.conPhaiThu - ref.tongNo,
      rongCaTon: d.tong.open + ar.conPhaiThu + ref.tonValue - ref.tongNo,
      chiLonNhat: [...d.weeks].sort((a, b) => b.chi - a.chi)[0],
    }
  }, [d, ar, ref])

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

      <div className="mk-tabbar">
        <div className="mk-tabs">
          {[['plan', '▦', 'Kế hoạch theo tuần'], ['report', '◈', 'Báo cáo lãnh đạo'],
            ['khach', '◉', 'Theo khách hàng'], ['thang', '▥', 'Theo tháng'],
            ['vld', '⟳', 'Vốn lưu động']].map(([id, ic, lb]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              <span className="ic" aria-hidden>{ic}</span>{lb}
            </button>
          ))}
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

      {tab === 'report' && <BaoCao d={d} bc={bc} ar={ar} ref0={ref} banTin={banTin} setMsg={setMsg} />}

      {tab === 'khach' && <TheoKhach setMsg={setMsg} />}
      {tab === 'thang' && <TheoThang data={data} NCC={NCC} ar={ar} setMsg={setMsg} />}
      {tab === 'vld' && <VonLuuDong setMsg={setMsg} />}

      {tab === 'plan' && <>
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
      </>}
    </div>
  )
}

/* ================= BÁO CÁO CHO LÃNH ĐẠO =================
   Xếp theo thứ tự sếp hỏi, không theo thứ tự dữ liệu: kết luận trước, vị thế,
   đường quỹ, rủi ro, rồi mới tới việc phải làm. */
function BaoCao({ d, bc, ar, ref0, banTin, setMsg }) {
  const T = n => `${num(Math.round(n / 1e6))} tr`
  const am = bc.goc.tuanAm
  return (
    <div className="bc">
      <div className={`bc-ket ${am ? 'bad' : 'good'}`}>
        <span className="bc-lbl">Kết luận</span>
        {am ? (
          <h3>
            Quỹ đủ đến tuần {am.w ? am.w - 1 : '—'}, thiếu <b>{T(bc.goc.thieu)}</b> từ
            tuần {am.w} ({fmtD(am.mon)}–{fmtD(am.sun)})
          </h3>
        ) : (
          <h3>Quỹ dương suốt {d.weeks.length} tuần tới, thấp nhất còn <b>{T(bc.goc.cuoi)}</b></h3>
        )}
        <p>
          Tiền mặt {T(bc.tienMat)} · thu dự kiến {T(d.tong.thu)} · chi dự kiến {T(d.tong.chi)}
          {am && <> · cần bù tối thiểu <b>{T(bc.canBu)}</b> trước tuần {am.w}</>}
        </p>
      </div>

      {d.tong.chi === 0 && d.tong.open === 0 && (
        <div className="cf-msg t-warn">
          Kỳ đang xem (<b>tuần {d.weeks[0]?.w}–{d.weeks[d.weeks.length - 1]?.w}</b>) chưa nhập
          tiền mặt đầu kỳ và khoản chi nào, nên báo cáo mới chỉ phản ánh phần app tự tính
          (thu nợ khách). Sang tab <b>Kế hoạch theo tuần</b> nhập số rồi quay lại.
        </div>
      )}

      <div className="bc-grid">
        <section className="m2-panel">
          <div className="m2-head"><h3>Vị thế tiền ròng</h3>
            <span>Tiền đang có cộng tiền sắp về, trừ tiền phải trả</span></div>
          <table className="bc-tb">
            <tbody>
              <tr><td>Tiền mặt hiện có</td><td className="num">{T(bc.tienMat)}</td></tr>
              <tr><td>+ Khách còn nợ</td><td className="num pos">{T(bc.phaiThu)}</td></tr>
              <tr><td>− Nợ nhà cung cấp</td><td className="num neg">−{T(bc.phaiTra)}</td></tr>
              <tr className="sum"><td>= Vị thế ròng</td>
                <td className={`num ${bc.rong < 0 ? 'neg' : 'pos'}`}>{T(bc.rong)}</td></tr>
              <tr><td>+ Hàng tồn kho (giá vốn)</td><td className="num">{T(bc.tonKho)}</td></tr>
              <tr className="sum"><td>= Gồm cả hàng trong kho</td>
                <td className={`num ${bc.rongCaTon < 0 ? 'neg' : 'pos'}`}>{T(bc.rongCaTon)}</td></tr>
            </tbody>
          </table>
          <p className="cf-note">
            Hàng tồn chỉ thành tiền khi bán được — để dòng cuối riêng, đừng cộng vào vị thế
            ròng khi nói chuyện thanh toán.
          </p>
        </section>

        <section className="m2-panel">
          <div className="m2-head"><h3>Ba rủi ro lớn nhất</h3>
            <span>App tự chấm theo số đang có, không phải nhận định tay</span></div>
          <ol className="bc-rr">
            <li className={am ? 'bad' : 'ok'}>
              <b>{am ? `Âm quỹ tuần ${am.w}` : 'Không có tuần âm quỹ'}</b>
              <span>{am
                ? `Thiếu ${T(bc.goc.thieu)} ở mức sâu nhất. Nguyên nhân chính: tuần ${bc.chiLonNhat?.w} chi ${T(bc.chiLonNhat?.chi || 0)}.`
                : `Mức thấp nhất trong kỳ còn ${T(bc.goc.cuoi)}.`}</span>
            </li>
            <li className={ar.quaHanTien > 0 ? 'bad' : 'ok'}>
              <b>{ar.quaHanTien > 0 ? `Khách nợ quá hạn ${T(ar.quaHanTien)}` : 'Không có nợ quá hạn'}</b>
              <span>{ar.quaHanTien > 0
                ? `${ar.quaHan.length} phiếu đã qua hạn thu. Kế hoạch đang tính là sẽ thu được — nếu không thì quỹ xấu thêm đúng bằng con số này.`
                : 'Toàn bộ khoản phải thu còn trong hạn.'}</span>
            </li>
            <li className={bc.phaiTra > bc.tonKho ? 'bad' : 'ok'}>
              <b>Nợ nhà cung cấp {T(bc.phaiTra)} so với tồn kho {T(bc.tonKho)}</b>
              <span>{bc.phaiTra > bc.tonKho
                ? `Hàng trong kho không đủ bù nợ, thiếu ${T(bc.phaiTra - bc.tonKho)} — bán hết tồn vẫn còn nợ.`
                : `Hàng trong kho còn dư ${T(bc.tonKho - bc.phaiTra)} so với nợ.`}</span>
            </li>
          </ol>
        </section>
      </div>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>{am ? 'Ba đòn bẩy — làm gì thì hết thiếu' : 'Ba đòn bẩy — chưa cần dùng'}</h3>
          <span>{am
            ? 'Mỗi cột là mô phỏng lại đúng 8 tuần đó, chỉ đổi MỘT biến'
            : 'Kỳ này quỹ không âm nên chưa phải dùng đòn bẩy nào — để sẵn ở đây, khi kế hoạch chi tăng lên thì mỗi cột tự tính lại'}</span>
        </div>
        <div className="bc-don">
          {[
            { t: 'Đòi hết nợ quá hạn', v: ar.quaHanTien,
              mo: ar.quaHanTien > 0
                ? `Thu ${T(ar.quaHanTien)} ngay tuần ${d.weeks[0]?.w}`
                : 'Không còn khoản nào quá hạn', kq: bc.l1,
              lam: 'Gọi khách chốt lịch trả cho các phiếu đã qua hạn.' },
            { t: 'Giãn nợ nhà cung cấp 2 tuần', v: null,
              mo: 'Dời toàn bộ khoản chi NCC chậm 2 tuần', kq: bc.l2,
              lam: 'Đàm phán giãn hạn với NCC có khoản chi lớn nhất.' },
            { t: 'Bù vốn chủ sở hữu', v: bc.canBu,
              mo: am ? `Nộp ${T(bc.canBu)} trước tuần ${am.w}` : 'Không phải bù đồng nào trong kỳ này',
              kq: { thieu: 0, tuanAm: null }, lam: 'Phương án cuối, dùng khi hai cách trên không đủ.' },
          ].map(x => (
            <div key={x.t} className={`bc-don-i ${x.kq.thieu === 0 ? 'ok' : 'part'}`}>
              <b>{x.t}</b>
              <span className="mo">{x.mo}</span>
              <div className="kq">
                {!am
                  ? <span className="dim">Chưa cần</span>
                  : x.kq.thieu === 0
                    ? <span className="good">Hết âm quỹ</span>
                    : <span className="warn">Vẫn thiếu {T(x.kq.thieu)}{x.kq.tuanAm ? ` ở tuần ${x.kq.tuanAm.w}` : ''}</span>}
              </div>
              <span className="lam">{x.lam}</span>
            </div>
          ))}
        </div>
        <p className="cf-note">
          Mô phỏng chạy trên đúng số anh đã nhập ở tab Kế hoạch. Đổi số bên đó thì ba cột này
          đổi theo. Mỗi cột chỉ đổi một biến — làm cùng lúc thì kết quả tốt hơn từng cột.
        </p>
      </section>

      <section className="m2-panel">
        <div className="m2-head"><h3>Số liệu kèm theo</h3>
          <span>Dán vào email hoặc tin nhắn báo cáo</span>
          <div className="group-ctrl">
            <button onClick={() => {
              navigator.clipboard?.writeText(banTin)
                .then(() => setMsg({ t: 'ok', s: 'Đã chép bản tin.' }))
                .catch(() => setMsg({ t: 'warn', s: 'Trình duyệt chặn chép — bôi đen rồi copy tay.' }))
            }}>⧉ Chép</button>
            <button onClick={() => window.print()}>🖨 In báo cáo</button>
          </div>
        </div>
        <pre className="cf-msgbox">{banTin}</pre>
      </section>
    </div>
  )
}


/* ============================================================
   CÔNG NỢ THEO TỪNG KHÁCH HÀNG
   Hai việc khác nhau trong một chỗ: xem nhanh ai đang nợ bao nhiêu,
   và xuất đúng bảng đối chiếu đang gửi khách để họ ký xác nhận.
   ============================================================ */
function TheoKhach({ setMsg }) {
  const [db, setDb] = useState(() => ({
    customers: arFile.customers || [], deliveries: arFile.deliveries || [],
    deliveryLines: arFile.deliveryLines || [], payments: arFile.payments || [],
    orders: arFile.orders || [], orderLines: arFile.orderLines || [],
  }))
  const [chot, setChot] = useState(() => new Date().toISOString().slice(0, 10))
  const [mo, setMo] = useState(null)
  useEffect(() => { fetchSales().then(setDb).catch(() => {}) }, [])

  const skuName = useMemo(
    () => Object.fromEntries(master.skus.map(s => [s.sku, s.name])), [])

  const bang = useMemo(() => (db.customers || []).map(c => {
    const dc = doiChieu(c, db, chot)
    dc.payments = (db.payments || []).filter(p => p.cust === c.code)
    /* Hàng đã đặt nhưng CHƯA giao — chưa phải công nợ, nhưng là tiền sắp phải thu */
    const chuaGiao = (db.orders || []).filter(o => o.cust === c.code).reduce((a, o) => {
      const dat = (db.orderLines || []).filter(l => l.code === o.code)
        .reduce((x, l) => x + (l.amount ?? Math.round(l.qty * l.price * (1 - (l.disc || 0)))), 0)
      const giao = (db.deliveries || []).filter(v => v.don === o.code).reduce((x, v) => x + v.amount, 0)
      return a + Math.max(0, dat - giao)
    }, 0)
    return { c, dc, chuaGiao }
  }), [db, chot])

  const tong = bang.reduce((a, b) => ({
    phai: a.phai + b.dc.tong.phai, tra: a.tra + b.dc.tong.daTra,
    con: a.con + b.dc.tong.conLai, qh: a.qh + b.dc.tong.quaHan,
    chuaGiao: a.chuaGiao + b.chuaGiao,
  }), { phai: 0, tra: 0, con: 0, qh: 0, chuaGiao: 0 })

  async function xuat(b) {
    try {
      const ten = await xuatDoiChieu(b.c, b.dc, arFile.congTy || {}, skuName)
      setMsg({ t: 'ok', s: `Đã tạo ${ten} — mở bằng Excel rồi gửi khách ký xác nhận.` })
    } catch (e) { setMsg({ t: 'bad', s: `Không xuất được: ${e.message}` }) }
  }

  return (
    <>
      <section className="m2-panel">
        <div className="m2-head">
          <h3>Công nợ theo khách hàng</h3>
          <span>
            Số chốt đến ngày chọn bên phải. Tiền khách trả cấn trừ nợ cũ trước, VAT làm tròn
            trên từng phiếu rồi mới cộng — đúng cách bảng đối chiếu đang gửi khách đang tính.
          </span>
          <div className="group-ctrl">
            <label className="cf-inline">Chốt đến ngày
              <input type="date" value={chot} onChange={e => setChot(e.target.value)} /></label>
          </div>
        </div>
        <div className="m2-tablewrap">
          <table className="cf-ref">
            <thead>
              <tr><th>Khách hàng</th><th className="num">Phiếu</th><th className="num">Phải thanh toán</th>
                <th className="num">Đã trả</th><th className="num">Còn nợ</th>
                <th className="num">Quá hạn</th><th className="num">Đặt chưa giao</th><th /></tr>
            </thead>
            <tbody>
              {bang.map(b => (
                <tr key={b.c.code}>
                  <td className="sm" title={b.c.name}><b>{tenNgan(b.c.name, b.c.code)}</b>
                    <i className="note">{b.c.code} · công nợ {b.dc.term} ngày · VAT
                      {' '}{(b.dc.vatRate * 100).toFixed(0)}%{b.c.mst ? ` · MST ${b.c.mst}` : ''}</i></td>
                  <td className="num">{b.dc.rows.length}</td>
                  <td className="num">{trieu(b.dc.tong.phai, 1)}</td>
                  <td className="num">{trieu(b.dc.tong.daTra, 1)}</td>
                  <td className="num b">{trieu(b.dc.tong.conLai, 1)}</td>
                  <td className={`num ${b.dc.tong.quaHan > 0 ? 'bad b' : ''}`}>
                    {b.dc.tong.quaHan > 0 ? trieu(b.dc.tong.quaHan, 1) : '—'}</td>
                  <td className="num">{b.chuaGiao > 0 ? trieu(b.chuaGiao, 1) : '—'}</td>
                  <td className="sl-row-act">
                    <button onClick={() => setMo(mo === b.c.code ? null : b.c.code)}>
                      {mo === b.c.code ? 'Ẩn' : 'Chi tiết'}</button>
                    <button onClick={() => xuat(b)}>⬇ Đối chiếu</button>
                  </td>
                </tr>
              ))}
              {!bang.length && <tr><td colSpan={8} className="cf-empty">Chưa có khách hàng nào.</td></tr>}
            </tbody>
            <tfoot>
              <tr><td>CỘNG {bang.length} khách</td><td className="num">
                {bang.reduce((a, b) => a + b.dc.rows.length, 0)}</td>
                <td className="num">{trieu(tong.phai, 1)}</td>
                <td className="num">{trieu(tong.tra, 1)}</td>
                <td className="num">{trieu(tong.con, 1)}</td>
                <td className={`num ${tong.qh > 0 ? 'bad' : ''}`}>{trieu(tong.qh, 1)}</td>
                <td className="num">{trieu(tong.chuaGiao, 1)}</td><td /></tr>
            </tfoot>
          </table>
        </div>
        <p className="cf-note">
          Đơn vị: triệu đồng. <b>Đặt chưa giao</b> chưa phải công nợ — hàng chưa ra khỏi kho nên
          chưa được đòi tiền, nhưng nó là doanh thu và tiền sẽ về sau khi giao, nên để cạnh đây
          cho dễ lên kế hoạch giao hàng theo nhu cầu tiền.
        </p>
      </section>

      {mo && (() => {
        const b = bang.find(x => x.c.code === mo)
        return (
          <section className="m2-panel">
            <div className="m2-head">
              <h3>{tenNgan(b.c.name, b.c.code)}</h3>
              <span>{b.c.name}{b.c.mst ? ` · MST ${b.c.mst}` : ''} — từng phiếu xuất, chốt đến {chot}, cấn trừ nợ cũ trước</span>
              <div className="group-ctrl">
                <button onClick={() => xuat(b)}>⬇ Xuất bảng đối chiếu gửi khách</button>
              </div>
            </div>
            <div className="m2-tablewrap">
              <table className="cf-ref">
                <thead>
                  <tr><th>Ngày giao</th><th>Số phiếu</th><th>Đơn</th><th className="num">SL</th>
                    <th className="num">Chưa VAT</th><th className="num">VAT</th>
                    <th className="num">Phải thanh toán</th><th>Hạn thu</th>
                    <th className="num">Đã trả</th><th className="num">Còn</th>
                    <th className="num">Quá hạn</th><th>Tình trạng</th></tr>
                </thead>
                <tbody>
                  {b.dc.rows.map(r => (
                    <tr key={r.pxk}>
                      <td className="sm">{r.d}</td>
                      <td className="sm"><b>{r.pxk}</b></td>
                      <td className="sm">{r.don || '—'}</td>
                      <td className="num">{r.qty || 0}</td>
                      <td className="num">{vn(r.amount)}</td>
                      <td className="num">{vn(r.vat)}</td>
                      <td className="num b">{vn(r.phai)}</td>
                      <td className="sm">{r.han || '—'}</td>
                      <td className="num">{r.tra ? vn(r.tra) : '—'}</td>
                      <td className="num b">{r.conLai ? vn(r.conLai) : '—'}</td>
                      <td className={`num ${r.quaHan > 0 ? 'bad b' : ''}`}>{r.quaHan || '—'}</td>
                      <td className="sm">
                        <span className={`sl-tag ${r.tinhTrang === 'QUÁ HẠN' ? 'off'
                          : r.tinhTrang === 'Trong hạn' ? 'mid' : 'on'}`}>{r.tinhTrang}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={3}>CỘNG PHÁT SINH</td>
                    <td className="num">{b.dc.tong.qty}</td>
                    <td className="num">{vn(b.dc.tong.amount)}</td>
                    <td className="num">{vn(b.dc.tong.vat)}</td>
                    <td className="num">{vn(b.dc.tong.phai)}</td><td />
                    <td className="num">{vn(b.dc.tong.daTra)}</td>
                    <td className="num">{vn(b.dc.tong.conLai)}</td><td colSpan={2} /></tr>
                </tfoot>
              </table>
            </div>
          </section>
        )
      })()}
    </>
  )
}

const vn = n => (n ? new Intl.NumberFormat('vi-VN').format(Math.round(n)) : '0')

/* =====================================================================
   TAB "THEO THÁNG" — gộp kế hoạch tuần thành tháng.
   Không thêm ô nhập nào ngoài QUỸ TỐI THIỂU. Tuần ISO thuộc tháng chứa
   ngày thứ Năm của tuần. Luôn tính từ tuần ĐẦU TIÊN có số để số dư nối đúng
   như tab tuần, rồi mới cắt ra 12 tháng đang xem.
   ===================================================================== */
const QUY_KEY = 'seltd_quy_toi_thieu'
const thuOf = mon => { const t = new Date(mon); t.setUTCDate(t.getUTCDate() + 3); return t.toISOString().slice(0, 7) }
const ymAdd = (ym, n) => {
  const [y, m] = ym.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  return t.toISOString().slice(0, 7)
}
const ymTxt = ym => `T${+ym.slice(5)}/${ym.slice(2, 4)}`

function TheoThang({ data, NCC, ar, setMsg }) {
  const keys = useMemo(() => Object.keys(data).filter(k => {
    const r = data[k] || {}
    return r.open || Object.values(r.thu || {}).some(Boolean) || Object.values(r.chi || {}).some(Boolean)
  }).sort(), [data])
  const firstYm = keys.length ? thuOf(mondayOf(+keys[0].slice(0, 4), +keys[0].slice(6))) : null
  const [start, setStart] = useState(null)
  const startYm = start || firstYm
  const [quy, setQuy] = useState(() => { try { return Number(localStorage.getItem(QUY_KEY)) || 0 } catch { return 0 } })
  const [quyDb, setQuyDb] = useState(null)        // null = chưa biết; false = chưa có bảng
  const [quyTxt, setQuyTxt] = useState('')

  useEffect(() => {
    fetchCfSetting('quy_toi_thieu').then(r => {
      setQuyDb(r.ok)
      if (r.ok && r.row) setQuy(Number(r.row.value) || 0)
    }).catch(() => setQuyDb(false))
  }, [])

  async function luuQuy() {
    const v = parseVnd(quyTxt)
    if (!(v >= 0)) return
    setQuy(v); setQuyTxt('')
    try { localStorage.setItem(QUY_KEY, String(v)) } catch { /* bỏ qua */ }
    if (quyDb) {
      try { await setCfSetting('quy_toi_thieu', v); setMsg({ t: 'ok', s: `Đã lưu quỹ tối thiểu ${fmtVnd(v)} đ cho cả công ty.` }) }
      catch (e) { setMsg({ t: 'bad', s: `CHƯA lưu lên đám mây: ${e.message}. Đang giữ trên máy này.` }) }
    } else {
      setMsg({ t: 'warn', s: 'Đã giữ quỹ tối thiểu trên MÁY NÀY. Bảng dùng chung chưa tạo (scripts/shopee/schema_wc.sql) nên máy khác chưa thấy.' })
    }
  }

  const m = useMemo(() => {
    if (!keys.length) return null
    const y0 = +keys[0].slice(0, 4), w0 = +keys[0].slice(6)
    const endYm = ymAdd(startYm, 11)
    /* đủ số tuần để phủ hết tháng cuối của khung đang xem */
    let n = 0, y = y0, w = w0
    while (n < 400) {
      const mon = mondayOf(y, w)
      if (thuOf(mon) > endYm) break
      const nx = addW(y, w, 1); y = nx.y; w = nx.w; n++
    }
    const weeks = tinhTuan(data, { y: y0, w: w0 }, n, NCC, ar, true).weeks
    const moc = weeks.filter(k => k.raw.open)
    const lastKey = keys[keys.length - 1]
    const months = []
    for (let i = 0; i < 12; i++) {
      const ym = ymAdd(startYm, i)
      const ws = weeks.filter(k => thuOf(k.mon) === ym)
      if (!ws.length) { months.push({ ym, ws, thu: 0, chi: 0, net: 0, open: null, close: null, plan: false }); continue }
      const thu = ws.reduce((a, k) => a + k.thu, 0), chi = ws.reduce((a, k) => a + k.chi, 0)
      months.push({
        ym, ws, thu, chi, net: thu - chi, open: ws[0].open, close: ws[ws.length - 1].close,
        plan: ws.some(k => k.id <= lastKey),
        /* tuần giữa tháng có mốc tiền mặt thực tế → cuối kỳ ≠ đầu kỳ + thuần; phần chênh là điều chỉnh về số thật */
        adj: ws[ws.length - 1].close - ws[0].open - (thu - chi),
      })
    }
    const inWin = weeks.filter(k => thuOf(k.mon) >= startYm && thuOf(k.mon) <= endYm)
    return { weeks, months, inWin, endYm, lastKey, moc }
  }, [keys, startYm, data, NCC, ar])

  if (!m) {
    return <section className="m2-panel"><p className="pl-empty">Chưa có kế hoạch tuần nào — nhập ở tab "Kế hoạch theo tuần" trước.</p></section>
  }

  const curYm = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)
  const T = {
    thu: m.months.reduce((a, x) => a + x.thu, 0), chi: m.months.reduce((a, x) => a + x.chi, 0),
    close: [...m.months].reverse().find(x => x.close != null)?.close ?? null,
  }
  const duoi = quy > 0 ? m.inWin.find(k => k.close < quy) : null
  /* Tốc độ đốt tiền: bình quân dòng tiền thuần của 3 tháng gần nhất (đến tháng hiện tại) có thuần âm */
  const am = m.months.filter(x => x.ym <= curYm && x.ws.length && x.net < 0).slice(-3)
  const burn = am.length ? -am.reduce((a, x) => a + x.net, 0) / am.length : null
  const today = new Date().toISOString().slice(0, 10)
  const nowWeek = [...m.weeks].reverse().find(k => k.mon.toISOString().slice(0, 10) <= today)
  const soDu = nowWeek ? nowWeek.close : m.weeks[0]?.open ?? 0
  const runway = burn ? soDu / burn : null
  const opts = []
  for (let i = -12; i <= 12; i++) opts.push(ymAdd(firstYm, i))
  const chart = m.months.map(x => ({
    lb: ymTxt(x.ym), thu: x.thu / 1e6, chi: x.chi / 1e6, net: x.ws.length ? x.net / 1e6 : null,
    close: x.close == null ? null : x.close / 1e6,
  }))

  return (
    <>
      <section className="m2-panel">
        <div className="cf-mbar">
          <label className="cf-inline">Từ tháng
            <select value={startYm} onChange={e => setStart(e.target.value)}>
              {opts.map(o => <option key={o} value={o}>{ymTxt(o)}</option>)}
            </select>
          </label>
          <span className="cf-mnote">
            12 tháng · kế hoạch tuần có số từ tuần {keys[0].slice(6)}/{keys[0].slice(0, 4)} đến tuần {m.lastKey.slice(6)}/{m.lastKey.slice(0, 4)}
            {m.moc.length ? ` · mốc tiền mặt thực tế: ${m.moc.map(k => `tuần ${k.w} (${fmtVnd(k.raw.open)} đ)`).join(', ')}` : ''}
          </span>
          <span style={{ flex: 1 }} />
          <label className="cf-inline">Quỹ tối thiểu
            <input value={quyTxt} placeholder={fmtVnd(quy) || 'chưa đặt'} inputMode="numeric"
              onChange={e => setQuyTxt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') luuQuy() }} />
          </label>
          <button className="btn-ghost" disabled={!quyTxt} onClick={luuQuy}>Lưu</button>
          {quyDb === false && <span className="cf-mnote warn">chỉ lưu trên máy này</span>}
        </div>
      </section>

      {duoi ? (
        <div className="cf-msg t-bad">
          Tuần {duoi.w} ({fmtD(duoi.mon)}, {ymTxt(thuOf(duoi.mon))}) số dư xuống <b>{fmtVnd(duoi.close)} đ</b> — dưới quỹ tối thiểu{' '}
          {fmtVnd(quy)} đ, thiếu <b>{fmtVnd(quy - duoi.close)} đ</b>. Đây là tuần ĐẦU TIÊN chạm ngưỡng trong 12 tháng đang xem.
        </div>
      ) : quy > 0 ? (
        <div className="cf-msg t-ok">Cả 12 tháng không tuần nào số dư xuống dưới quỹ tối thiểu {fmtVnd(quy)} đ.</div>
      ) : (
        <div className="cf-msg t-warn">Chưa đặt quỹ tối thiểu — đặt ở ô bên trên để app cảnh báo tuần nào quỹ chạm đáy.</div>
      )}

      <div className="mk-kpis cf-kpis cf-kpis4">
        <div className="mk-kpi"><span className="k">Tổng thu</span><strong>{trieu(T.thu, 1)}<em>tr</em></strong><span className="sub">12 tháng · gồm thu nợ khách đến hạn</span></div>
        <div className="mk-kpi"><span className="k">Tổng chi</span><strong>{trieu(T.chi, 1)}<em>tr</em></strong><span className="sub">12 tháng</span></div>
        <div className={`mk-kpi ${T.thu - T.chi >= 0 ? 'good' : 'bad'}`}><span className="k">Dòng tiền thuần</span><strong>{trieu(T.thu - T.chi, 1)}<em>tr</em></strong><span className="sub">thu − chi</span></div>
        <div className={`mk-kpi ${T.close == null ? '' : T.close < quy ? 'bad' : ''}`}><span className="k">Số dư cuối kỳ</span><strong>{T.close == null ? '—' : trieu(T.close, 1)}<em>tr</em></strong><span className="sub">cuối {ymTxt(m.endYm)}</span></div>
      </div>

      <div className={`mk-verdict ${burn == null ? 'green' : runway < 3 ? 'red' : 'grey'}`}>
        <b>Tốc độ đốt tiền</b>
        <p>
          {burn == null
            ? 'Không đốt tiền: chưa có tháng nào (đến tháng hiện tại) dòng tiền thuần âm.'
            : <>Bình quân {am.length} tháng gần nhất có dòng tiền thuần âm ({am.map(x => ymTxt(x.ym)).join(', ')}): đốt{' '}
              <strong>{trieu(burn, 1)} tr/tháng</strong>.{' '}
              {soDu <= 0
                ? <>Số dư theo kế hoạch tuần này <strong>đã âm {trieu(-soDu, 1)} tr</strong> — cần nguồn bù (thu nợ sớm, giãn chi, bù vốn) ngay, không còn đường băng.</>
                : <>Số dư hiện tại {trieu(soDu, 1)} tr → còn khoảng <strong>{num(runway, 1)} tháng</strong> nếu giữ nhịp này.</>}</>}
        </p>
      </div>

      <div className="pl-row2 cf-row2">
        <section className="m2-panel">
          <div className="m2-head"><h3>Thu, chi và dòng tiền thuần theo tháng</h3><span>triệu đồng</span></div>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="lb" tick={{ fontSize: 10, fill: C.axis }} />
              <YAxis tick={{ fontSize: 10, fill: C.axis }} width={44} />
              <Tooltip formatter={(v, n) => [v == null ? '—' : `${num(v, 1)} tr`, n]} />
              <Legend verticalAlign="top" align="left" height={26} iconSize={10} wrapperStyle={{ fontSize: 10.5 }} />
              <ReferenceLine y={0} stroke={C.axis} />
              <Bar dataKey="thu" name="Thu" fill={C.good} radius={[2, 2, 0, 0]} />
              <Bar dataKey="chi" name="Chi" fill={C.bad} radius={[2, 2, 0, 0]} />
              <Line dataKey="net" name="Dòng tiền thuần" stroke={C.navy} strokeWidth={2} dot={{ r: 2.5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
        <section className="m2-panel">
          <div className="m2-head"><h3>Số dư cuối tháng</h3><span>triệu đồng · đường đỏ = quỹ tối thiểu</span></div>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="lb" tick={{ fontSize: 10, fill: C.axis }} />
              <YAxis tick={{ fontSize: 10, fill: C.axis }} width={44} />
              <Tooltip formatter={(v, n) => [v == null ? '—' : `${num(v, 1)} tr`, n]} />
              <ReferenceLine y={0} stroke={C.axis} />
              {quy > 0 && <ReferenceLine y={quy / 1e6} stroke={C.bad} strokeDasharray="5 3" label={{ value: 'quỹ tối thiểu', fontSize: 10, fill: C.bad, position: 'insideTopLeft' }} />}
              <Line dataKey="close" name="Số dư cuối tháng" stroke={C.blue} strokeWidth={2.2} dot={{ r: 2.5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
      </div>

      <section className="m2-panel">
        <div className="m2-head"><h3>Bảng theo tháng</h3><span>đồng · tháng chưa có kế hoạch tuần nào vẫn nối số dư (thu/chi = 0)</span></div>
        <table className="cf-ref">
          <thead><tr><th>Tháng</th><th className="num">Số tuần</th><th className="num">Đầu kỳ</th><th className="num">Thu</th>
            <th className="num">trong đó thu nợ khách</th><th className="num">Chi</th><th className="num">Thuần</th><th className="num">Cuối kỳ</th></tr></thead>
          <tbody>
            {m.months.map(x => (
              <tr key={x.ym} className={x.plan ? '' : 'dim'}>
                <td><b>{ymTxt(x.ym)}</b>{!x.plan && x.ws.length ? <i className="note"> chưa có kế hoạch</i> : null}</td>
                <td className="num">{x.ws.length}</td>
                <td className="num">{x.open == null ? '—' : fmtVnd(x.open)}</td>
                <td className="num">{fmtVnd(x.thu) || '0'}</td>
                <td className="num">{fmtVnd(x.ws.reduce((a, k) => a + k.thuNo, 0)) || '0'}</td>
                <td className="num">{fmtVnd(x.chi) || '0'}</td>
                <td className={`num ${x.net < 0 ? 'neg' : ''}`}>{x.ws.length ? fmtVnd(x.net) || '0' : '—'}</td>
                <td className={`num ${x.close != null && x.close < quy ? 'neg' : ''}`}>
                  <b>{x.close == null ? '—' : fmtVnd(x.close) || '0'}</b>
                  {Math.abs(x.adj || 0) >= 1 && <i className="note" title="Có tuần nhập tiền mặt đầu kỳ thực tế trong tháng"> gồm điều chỉnh về số thật {x.adj > 0 ? '+' : ''}{fmtVnd(x.adj)}</i>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}

/* =====================================================================
   TAB "VỐN LƯU ĐỘNG" — chu kỳ tiền mặt CCC = DIO + DSO − DPO.
   Cách tính ở src/lib/fin.js → workingCapital(). Mỗi lần mở tab ghi đè ảnh
   chụp của THÁNG HIỆN TẠI (bảng wc_snapshot) — tháng đã qua giữ nguyên, nên
   lịch sử CCC tích luỹ dần từ nay. Không nội suy quá khứ.
   ===================================================================== */
function VonLuuDong({ setMsg }) {
  const [ar, setAr] = useState(arFile)
  const [snap, setSnap] = useState({ ok: null, rows: [] })
  useEffect(() => {
    fetchSales().then(setAr).catch(() => {})
    fetchWcSnapshots().then(setSnap).catch(() => setSnap({ ok: false, rows: [] }))
  }, [])
  const W = useMemo(() => workingCapital(ar), [ar])
  const hist = useMemo(() => arHistory(ar), [ar])

  /* ghi ảnh chụp tháng hiện tại (chỉ khi bảng đã có và số đủ) */
  useEffect(() => {
    if (!snap.ok || W.ccc == null) return
    const ym = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)
    const data = {
      inv: Math.round(W.inv), ar: W.arNgoai, ap: W.ap, cogs90: Math.round(W.cogs90), revSan: W.revSan,
      credit: W.credit.gross, dio: W.dio, dso: W.dso, dsoNgoai: W.dsoNgoai, dpo: W.dpo, ccc: W.ccc,
      nwc: Math.round(W.nwc), qtyNoCost: W.qtyNoCost,
    }
    const cu = snap.rows.find(r => r.ym === ym)
    if (cu && Math.round(cu.data?.ccc * 10) === Math.round(W.ccc * 10) && cu.as_of === W.asOf) return
    saveWcSnapshot(ym, W.asOf, data)
      .then(() => fetchWcSnapshots().then(setSnap))
      .catch(e => setMsg({ t: 'warn', s: `Không ghi được ảnh chụp vốn lưu động tháng này: ${e.message}` }))
  }, [snap.ok, W])

  const day = v => (v == null ? '—' : `${num(v, 0)} ngày`)
  const khau = [
    ['dio', 'Tồn kho (DIO)', W.dio, W.perDay.dio, C.amber],
    ['dso', 'Phải thu (DSO)', W.dso, W.perDay.dso, C.blue],
    ['dpo', 'Phải trả (DPO)', W.dpo, W.perDay.dpo, C.good],
  ]
  const lon = [khau[0], khau[1]].filter(k => k[2] != null).sort((a, b) => b[2] - a[2])[0]
  const maxD = Math.max(1, ...khau.map(k => k[2] || 0))
  const covShare = W.qty > 0 ? W.qtyNoCost / W.qty : 0
  const trend = (() => {
    const by = Object.fromEntries(hist.map(h => [h.ym, { ym: h.ym, dsoNgoai: h.dso }]))
    for (const r of snap.rows) by[r.ym] = { ...(by[r.ym] || { ym: r.ym }), ccc: r.data?.ccc, dio: r.data?.dio, dpo: r.data?.dpo }
    return Object.values(by).sort((a, b) => a.ym.localeCompare(b.ym)).map(x => ({ ...x, lb: ymTxt(x.ym) }))
  })()

  return (
    <>
      <div className="cf-ccc">
        <div className="big">
          <span>Chu kỳ chuyển đổi tiền mặt (CCC)</span>
          <b>{day(W.ccc)}</b>
          <small>DIO {num(W.dio, 0)} + DSO {num(W.dso, 0)} − DPO {num(W.dpo, 0)} · tính ngày {W.asOf.split('-').reverse().join('/')}, cửa sổ 90 ngày</small>
          <p>Số ngày tiền bị "giam" từ lúc trả nhà cung cấp đến lúc thu được tiền khách. Càng ngắn càng tốt.</p>
        </div>
        <div className="bars">
          {khau.map(([id, lb, v, , col]) => (
            <div key={id}><span>{lb}</span><i><em style={{ width: `${((v || 0) / maxD) * 100}%`, background: col }} /></i><b>{day(v)}</b></div>
          ))}
        </div>
      </div>

      <div className="mk-kpis cf-kpis cf-kpis4">
        <div className="mk-kpi amber"><span className="k">Giá trị tồn</span><strong>{trieu(W.inv, 1)}<em>tr</em></strong>
          <span className="sub">{W.qtyNoCost ? `⚠ ${W.noCost.length} SKU thiếu giá vốn = ${num(covShare * 100, 0)}% SL tồn — đang thấp hơn thật` : 'theo giá vốn, gồm kho lưu trữ'}</span></div>
        <div className="mk-kpi"><span className="k">Phải thu</span><strong>{trieu(W.arNgoai, 1)}<em>tr</em></strong><span className="sub">khách ngoài sàn, có VAT · chưa gồm tiền Shopee chờ giải ngân</span></div>
        <div className="mk-kpi"><span className="k">Phải trả NCC</span><strong>{trieu(W.ap, 1)}<em>tr</em></strong><span className="sub">số khai từ kế toán ngày {W.apAsOf ? W.apAsOf.split('-').reverse().join('/') : '—'}</span></div>
        <div className={`mk-kpi ${W.nwc > 0 ? '' : 'good'}`}><span className="k">Vốn lưu động ròng</span><strong>{trieu(W.nwc, 1)}<em>tr</em></strong><span className="sub">tồn + phải thu − phải trả</span></div>
      </div>

      {lon && (
        <div className="mk-verdict grey">
          <b>Vậy thì sao</b>
          <p>
            Khâu giam tiền lâu nhất là <strong>{lon[0] === 'dio' ? 'tồn kho' : 'phải thu'} ({lon[0].toUpperCase()}): {num(lon[2], 0)} ngày</strong>. Rút 1 ngày ở khâu này giải
            phóng khoảng <strong>{trieu(lon[3], 1)} tr</strong> tiền mặt ({lon[0] === 'dio' ? 'giá vốn bình quân 1 ngày' : 'doanh thu bình quân 1 ngày'});
            rút 10 ngày ≈ {trieu(lon[3] * 10, 0)} tr. Kéo dài thời hạn trả nhà cung cấp thêm 1 ngày cũng giải phóng {trieu(W.perDay.dpo, 1)} tr.
          </p>
        </div>
      )}

      <section className="m2-panel">
        <div className="m2-head"><h3>Từng chỉ số lấy từ đâu</h3><span>Bấm vào đây để kiểm lại: tử số, mẫu số và độ phủ dữ liệu</span></div>
        <table className="cf-ref">
          <thead><tr><th>Chỉ số</th><th className="num">Tử số</th><th className="num">Mẫu số (90 ngày)</th><th className="num">Kết quả</th><th>Ghi chú</th></tr></thead>
          <tbody>
            <tr><td><b>DIO</b></td><td className="num">tồn {fmtVnd(W.inv)}</td><td className="num">giá vốn {fmtVnd(W.cogs90)}</td><td className="num">{day(W.dio)}</td>
              <td className="sm">Giá vốn = Shopee {trieu(W.cogsSan, 1)} tr + ngoài sàn {trieu(W.cogsNgoai, 1)} tr. Tồn tính trên {W.skuStock - W.noCost.length}/{W.skuStock} SKU có tồn{W.noCost.length ? ` — thiếu giá vốn: ${W.noCost.slice(0, 6).join(', ')}${W.noCost.length > 6 ? '…' : ''}` : ''}.</td></tr>
            <tr><td><b>DSO toàn công ty</b></td><td className="num">phải thu {fmtVnd(W.arNgoai)}</td><td className="num">DT {fmtVnd(W.revSan + W.credit.gross)}</td><td className="num">{day(W.dso)}</td>
              <td className="sm">Mẫu số = doanh thu Shopee {trieu(W.revSan, 1)} tr + bán chịu có VAT {trieu(W.credit.gross, 1)} tr. <b>Chưa tính tiền Shopee chờ giải ngân</b> (app chưa có số) → DSO đang thấp hơn thật.</td></tr>
            <tr><td><b>DSO ngoài sàn</b></td><td className="num">phải thu {fmtVnd(W.arNgoai)}</td><td className="num">bán chịu {fmtVnd(W.credit.gross)}</td><td className="num">{day(W.dsoNgoai)}</td>
              <td className="sm">Chỉ khách đại lý — so với thời hạn công nợ đã cho khách. Cùng số "còn phải thu" ở tab Theo khách hàng.</td></tr>
            <tr><td><b>DPO</b></td><td className="num">phải trả {fmtVnd(W.ap)}</td><td className="num">giá vốn {fmtVnd(W.cogs90)}</td><td className="num">{day(W.dpo)}</td>
              <td className="sm">Mẫu số dùng giá vốn (tiền mua hàng theo ngày chưa đáng tin: PO trong Master Data chưa cập nhật thanh toán).</td></tr>
          </tbody>
        </table>
      </section>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Xu hướng</h3>
          <span>
            DSO ngoài sàn dựng lại được từ ngày phiếu và ngày thu tiền. CCC/DIO/DPO chỉ có từ khi bắt đầu chụp
            ({snap.ok ? `${snap.rows.length} tháng đã chụp` : 'bảng wc_snapshot chưa tạo — chưa chụp'}) — không nội suy quá khứ.
          </span>
        </div>
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="lb" tick={{ fontSize: 10, fill: C.axis }} />
            <YAxis tick={{ fontSize: 10, fill: C.axis }} width={40} unit="d" />
            <Tooltip formatter={(v, n) => [v == null ? '—' : `${num(v, 0)} ngày`, n]} />
            <Legend verticalAlign="top" align="left" height={26} iconSize={10} wrapperStyle={{ fontSize: 10.5 }} />
            <Line dataKey="dsoNgoai" name="DSO ngoài sàn" stroke={C.blue} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
            <Line dataKey="ccc" name="CCC" stroke={C.navy} strokeWidth={2.2} dot={{ r: 4 }} />
            <Line dataKey="dio" name="DIO" stroke={C.amber} dot={{ r: 3 }} />
            <Line dataKey="dpo" name="DPO" stroke={C.good} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </section>
    </>
  )
}
