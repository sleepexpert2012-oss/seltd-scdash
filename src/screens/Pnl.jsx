import { useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, Area, AreaChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend, Cell, BarChart,
} from 'recharts'
import platform from '../data/platform.json'
import { MONTHS, pickRows, monthlySeries, comparePeriod, SKU_MAP } from '../lib/metrics'
import { trieu, num, pct } from '../lib/format'
import { exportRowsXlsx } from '../lib/masterFile'
import { useDrill } from '../app/drill'
import './pnl.css'

const C = {
  navy: '#232A6B', blue: '#353E99', blue2: '#5C67C4', soft: '#8E96DC',
  bad: '#B42318', good: '#1F7A45', amber: '#D97706',
  grid: '#E7E9F3', axis: '#8E93B5', ink3: '#6E739B',
}

/* ---------- Các khoản Shopee trừ trực tiếp trong escrow ------------------
   "Phí sàn" trong màn này = đúng 6 khoản dưới đây, khớp với tong_phi_san ở
   mart_fee_month. KHÔNG gộp voucher shop vào đây: voucher shop đã bị trừ ở
   bước "Giảm giá" khi tính doanh thu, gộp lại là tính hai lần. */
const FEES = [
  ['phi_hoa_hong', 'Hoa hồng', 'Shopee thu theo % giá bán của từng đơn'],
  ['phi_dich_vu', 'Phí dịch vụ', 'Gói Freeship Xtra / Hoàn Xu Xtra shop đăng ký'],
  ['phi_giao_dich', 'Phí giao dịch', 'Phí thanh toán mỗi đơn. API trả 2 tên bằng nhau ở 100% đơn — chỉ tính 1 lần'],
  ['phi_ams', 'Phí AMS (affiliate)', 'Hoa hồng trả cho người tiếp thị liên kết'],
  ['phi_campaign', 'Phí chiến dịch sàn', 'Phí tham gia campaign của Shopee'],
  ['phi_ads_ktkt', 'Phí hỗ trợ kỹ thuật', 'Khoản trừ khi nạp tiền quảng cáo qua escrow'],
]

/* Các khoản CÓ trong escrow nhưng KHÔNG phải phí sàn — để riêng, kèm lý do,
   để không ai cộng nhầm vào chi phí. */
const OUTSIDE = [
  ['voucher_shop', 'Voucher shop tự chịu', 'cost',
    'Đã trừ ở bước Giảm giá khi tính doanh thu — không tính lại vào phí sàn'],
  ['voucher_shopee', 'Voucher Shopee tài trợ', 'none',
    'Sàn chịu, shop vẫn nhận đủ — không phải chi phí của shop'],
  ['phi_van_chuyen', 'Phí vận chuyển thực tế', 'wash',
    'Gần như bù hết bởi trợ giá của Shopee, phần lệch nhỏ đã nằm trong tiền thực nhận'],
  ['tro_gia_vc_shopee', 'Trợ giá vận chuyển Shopee', 'in',
    'Khoản Shopee bù lại cho phí vận chuyển ở trên'],
  ['xu_shop', 'Xu shop hoàn cho khách', 'cost', 'Shop tự chịu khi bật hoàn xu'],
  ['thue_giu_lai', 'Thuế giữ lại', 'cost', 'Shopee giữ lại nộp thay'],
]

const FEE_COLORS = [C.navy, C.blue, C.blue2, C.soft, C.amber, C.bad]

const FEE_BY_YM = Object.fromEntries(platform.fees.map(f => [f.ym, f]))
const ADS_BY_YM = Object.fromEntries(platform.ads.map(a => [a.ym, a]))
/* Ads chỉ có từ tháng này trở đi — API Shopee chỉ lưu khoảng 5 tháng lịch sử.
   Tháng trước đó là KHÔNG CÓ DỮ LIỆU, không phải bằng 0. */
const ADS_FROM = platform.ads.length ? platform.ads[0].ym : null

const ymOf = i => MONTHS[i].replace('.', '-')
const val = (o, k) => (o && o[k]) || 0

/* ================= THÁC NƯỚC =================
   Vẽ tay bằng SVG: recharts không có waterfall, và cột nổi (floating bar) dựng
   bằng Bar xếp lớp thì không hiện được đường nối và nhãn hai dòng. */
function Waterfall({ steps, height = 340 }) {
  const W = 1120
  const padX = 10
  const topPad = 32          // chỗ cho nhãn số phía trên cột
  const botPad = 74          // chỗ cho nhãn hai dòng phía dưới
  const plotH = height - topPad - botPad
  const n = steps.length
  const colW = (W - padX * 2) / n
  const barW = Math.min(74, colW * 0.6)

  const max = Math.max(...steps.map(s => Math.max(s.from, s.to)), 1)
  const min = Math.min(...steps.map(s => Math.min(s.from, s.to)), 0)
  const span = max - min || 1
  const y = v => topPad + plotH - ((v - min) / span) * plotH
  const zeroY = y(0)

  return (
    <div className="pl-wf">
      <svg viewBox={`0 0 ${W} ${height}`} role="img"
        aria-label="Thác nước từ GMV đặt hàng xuống lãi lỗ cuối kỳ">
        {/* đường 0 */}
        <line x1={padX} x2={W - padX} y1={zeroY} y2={zeroY} stroke={C.grid} strokeWidth="1" />
        {steps.map((s, i) => {
          const cx = padX + colW * i + colW / 2
          const top = Math.min(y(s.from), y(s.to))
          const h = Math.max(2, Math.abs(y(s.to) - y(s.from)))
          const isPillar = s.kind === 'total' || s.kind === 'sub'
          const fill = s.kind === 'total' ? C.navy
            : s.kind === 'sub' ? C.blue2
              : s.to < s.from ? C.bad : C.good
          const prev = steps[i - 1]
          return (
            <g key={s.k}>
              {/* đường nối từ cột trước sang cột này */}
              {prev && (
                <line
                  x1={padX + colW * (i - 1) + colW / 2 + barW / 2}
                  x2={cx - barW / 2}
                  y1={y(prev.to)} y2={y(prev.to)}
                  stroke={C.axis} strokeWidth="1" strokeDasharray="3 3" opacity=".55"
                />
              )}
              <rect
                x={cx - barW / 2} y={top} width={barW} height={h}
                rx={isPillar ? 2 : 1.5} fill={fill}
                opacity={isPillar ? 1 : 0.92}
              >
                <title>{`${s.label} ${s.sub || ''}: ${trieu(Math.abs(s.to - s.from), 1)} tr`}</title>
              </rect>
              {/* nhãn số */}
              <text x={cx} y={top - 8} textAnchor="middle" className="wf-v"
                fill={isPillar ? C.navy : fill}>
                {(() => {
                  const v = isPillar ? s.to : s.to - s.from
                  return (v < 0 ? '−' : '') + trieu(Math.abs(v), 0)
                })()}
              </text>
              {/* nhãn hai dòng */}
              <text x={cx} y={height - botPad + 20} textAnchor="middle"
                className={`wf-l${isPillar ? ' pillar' : ''}`}>{s.l1}</text>
              {s.l2 && (
                <text x={cx} y={height - botPad + 34} textAnchor="middle"
                  className={`wf-l${isPillar ? ' pillar' : ''}`}>{s.l2}</text>
              )}
              {s.sub && (
                <text x={cx} y={height - botPad + 50} textAnchor="middle" className="wf-s">
                  {s.sub}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

const SOFT = { type: 'monotone', strokeLinecap: 'round', strokeLinejoin: 'round' }
const dotOf = (c, n) => (n > 14 ? false : { r: 3.2, fill: '#fff', stroke: c, strokeWidth: 2 })
const actOf = c => ({ r: 5.5, fill: '#fff', stroke: c, strokeWidth: 2.5 })
const LEG = {
  verticalAlign: 'top', align: 'left', height: 26, iconSize: 10,
  wrapperStyle: { fontSize: 10.5, color: C.ink3, paddingLeft: 26, paddingBottom: 2, lineHeight: '15px' },
}
const AX = { stroke: C.axis, fontSize: 10.5, tickLine: false }

/* Kỳ mặc định để so cùng kỳ năm trước: từ tháng 01 của năm cuối đến tháng cuối
   có dữ liệu, và chỉ hợp lệ khi năm trước có đủ các tháng tương ứng. */
const YOY_READY = (() => {
  const last = MONTHS[MONTHS.length - 1]
  const y = +last.slice(0, 4)
  const from = `${y}.01`
  if (MONTHS.indexOf(from) < 0) return null
  if (MONTHS.indexOf(`${y - 1}.01`) < 0) return null
  if (MONTHS.indexOf(`${y - 1}.${last.slice(5)}`) < 0) return null
  return { from, to: last }
})()

const TAB_IC = { flow: '⌁', month: '▦', fee: '⛁', why: '⚖', unit: '◫', method: 'ƒ' }

export default function Pnl({ filters, setFilters }) {
  const [tab, setTab] = useState('flow')
  const drill = useDrill()

  const d = useMemo(() => {
    const a = Math.max(0, MONTHS.indexOf(filters.from))
    const b = Math.max(0, MONTHS.indexOf(filters.to))
    const range = [a, b]

    /* Phí sàn và ads chỉ có ở cấp THÁNG. Khi bộ lọc chiều (ngành/loại hình/NCC/
       tìm kiếm) đang bật thì không có cách nào biết phí của riêng phần đã lọc,
       nên phân bổ theo tỷ trọng doanh thu trong cùng tháng — và phải nói rõ. */
    const dimOn = !!(filters.nganh || filters.loaiHinh || filters.supplier
      || filters.q || filters.kenh || filters.trend?.length)

    const selRows = pickRows(filters, range)
    const allRows = pickRows({ trend: [] }, range)
    const sel = monthlySeries(selRows, range)
    const all = monthlySeries(allRows, range)

    const months = sel.map((s, i) => {
      const ym = ymOf(a + i)
      const f = FEE_BY_YM[ym]
      const ad = ADS_BY_YM[ym]
      const share = all[i].rev > 0 ? s.rev / all[i].rev : (dimOn ? 0 : 1)
      const fee = val(f, 'tong_phi_san') * share
      const hasAds = !!ad
      const ads = val(ad, 'chi_phi_ads') * share
      const gp = s.rev - s.cogs
      const ln = gp - fee - ads
      const feeParts = Object.fromEntries(FEES.map(([k]) => [k, val(f, k) * share]))
      const outParts = Object.fromEntries(OUTSIDE.map(([k]) => [k, val(f, k) * share]))
      return {
        ym, label: MONTHS[a + i], i: a + i, share,
        ...s, gp, gm: s.rev > 0 ? gp / s.rev : 0,
        fee, feeRate: s.rev > 0 ? fee / s.rev : 0,
        ads, adsRate: s.rev > 0 ? ads / s.rev : 0, hasAds,
        ln, lnRate: s.rev > 0 ? ln / s.rev : 0,
        don: Math.round(val(f, 'don') * share),
        banHang: val(f, 'ban_hang') * share,
        ttn: val(f, 'tien_thuc_nhan') * share,
        ...feeParts, ...outParts,
        lnTr: ln / 1e6, feeTr: fee / 1e6, adsTr: ads / 1e6, gpTr: gp / 1e6,
      }
    })

    const sum = k => months.reduce((t, m) => t + (m[k] || 0), 0)
    const T = {
      gmv: sum('gmv'), cx: sum('cx'), rt: sum('rt'), dc: sum('dc'),
      rev: sum('rev'), cogs: sum('cogs'), fee: sum('fee'), ads: sum('ads'),
      banHang: sum('banHang'), ttn: sum('ttn'), don: sum('don'), un: sum('un'),
    }
    T.gp = T.rev - T.cogs
    T.gm = T.rev > 0 ? T.gp / T.rev : 0
    T.ln = T.gp - T.fee - T.ads
    T.lnRate = T.rev > 0 ? T.ln / T.rev : 0
    T.feeRate = T.rev > 0 ? T.fee / T.rev : 0
    T.adsRate = T.rev > 0 ? T.ads / T.rev : 0
    T.cancelRate = T.gmv > 0 ? T.cx / T.gmv : 0
    /* Đối chiếu dòng tiền: escrow_amount = giá bán − phí sàn − voucher shop.
       Kiểm trên 1.521 đơn: khớp 99,6%, phần lệch là điều chỉnh lẻ của Shopee. */
    T.ttnTinh = T.banHang - T.fee - sum('voucher_shop')
    T.ttnLech = T.ttn - T.ttnTinh

    /* Hàng có giá vốn mà không sinh doanh thu = hàng tặng kèm (giá bán 0). */
    const gift = selRows.reduce((t, r) => {
      if ((r.rev || 0) <= 0 && (r.cogs || 0) > 0) {
        t.cogs += r.cogs; t.un += r.un || 0
        t.bySku[r.sku] = (t.bySku[r.sku] || 0) + r.cogs
      }
      return t
    }, { cogs: 0, un: 0, bySku: {} })

    /* Thác nước */
    const wf = []
    let cum = 0
    const push = (k, l1, l2, kind, delta, sub) => {
      if (kind === 'total' || kind === 'sub') {
        wf.push({ k, l1, l2, kind, from: 0, to: cum, label: `${l1} ${l2 || ''}`.trim(), sub })
      } else {
        wf.push({ k, l1, l2, kind, from: cum, to: cum + delta, label: `${l1} ${l2 || ''}`.trim(), sub })
        cum += delta
      }
    }
    cum = T.gmv
    push('gmv', 'GMV', 'đặt hàng', 'total', 0, 'giá thực bán × SL mua')
    push('cx', 'Huỷ', 'đơn', 'neg', -T.cx, T.gmv ? `${pct(T.cx / T.gmv, 0)} GMV` : '')
    push('rt', 'Trả', 'hàng', 'neg', -T.rt, T.gmv ? `${pct(T.rt / T.gmv, 1)} GMV` : '')
    push('dc', 'Giảm giá &', 'voucher shop', 'neg', -T.dc, T.gmv ? `${pct(T.dc / T.gmv, 1)} GMV` : '')
    push('rev', 'Doanh thu', 'thuần', 'sub', 0, T.gmv ? `${pct(T.rev / T.gmv, 0)} GMV` : '')
    push('cogs', 'Giá vốn', 'hàng bán', 'neg', -T.cogs, T.rev ? `${pct(T.cogs / T.rev, 0)} DT` : '')
    push('gp', 'Lợi nhuận', 'gộp', 'sub', 0, T.rev ? `GM ${pct(T.gm, 1)}` : '')
    push('fee', 'Phí', 'sàn', 'neg', -T.fee, T.rev ? `${pct(T.feeRate, 1)} DT` : '')
    push('ads', 'Quảng', 'cáo', 'neg', -T.ads, T.rev ? `${pct(T.adsRate, 1)} DT` : '')
    push('ln', T.ln >= 0 ? 'Lãi' : 'Lỗ', 'sau phí & ads', 'total', 0, T.rev ? `${pct(T.lnRate, 1)} DT` : '')

    /* Tháng không có dữ liệu ads -> lãi của tháng đó là CHƯA trừ ads */
    const noAds = months.filter(m => !m.hasAds).map(m => m.ym)

    /* Chuỗi lỗ liên tiếp tính từ tháng cuối kỳ trở về */
    let streak = 0
    for (let i = months.length - 1; i >= 0; i--) {
      if (months[i].rev > 0 && months[i].ln < 0) streak++
      else if (months[i].rev > 0) break
    }

    /* Phân rã vì sao LN% đổi: GM% + phí% + ads% (cộng lại đúng bằng LN%) */
    const cmpRange = comparePeriod(filters.from, filters.to, filters.compare)
    let bridge = null
    if (cmpRange) {
      const pRows = pickRows(filters, cmpRange)
      const pAll = pickRows({ trend: [] }, cmpRange)
      const ps = monthlySeries(pRows, cmpRange)
      const pa = monthlySeries(pAll, cmpRange)
      const p = { rev: 0, cogs: 0, fee: 0, ads: 0, adsKnown: true }
      ps.forEach((s, i) => {
        const ym = ymOf(cmpRange[0] + i)
        const share = pa[i].rev > 0 ? s.rev / pa[i].rev : (dimOn ? 0 : 1)
        p.rev += s.rev; p.cogs += s.cogs
        p.fee += val(FEE_BY_YM[ym], 'tong_phi_san') * share
        if (ADS_BY_YM[ym]) p.ads += val(ADS_BY_YM[ym], 'chi_phi_ads') * share
        else p.adsKnown = false
      })
      if (p.rev > 0 && T.rev > 0) {
        const gmP = (p.rev - p.cogs) / p.rev, feeP = p.fee / p.rev, adsP = p.ads / p.rev
        const lnP = gmP - feeP - adsP
        bridge = {
          from: MONTHS[cmpRange[0]], to: MONTHS[cmpRange[1]],
          adsKnown: p.adsKnown, prev: { ...p, gm: gmP, feeRate: feeP, adsRate: adsP, lnRate: lnP },
          lnP, lnC: T.lnRate,
          parts: [
            { k: 'gm', label: 'Biên gộp GM%', v: T.gm - gmP,
              why: `${pct(gmP, 1)} → ${pct(T.gm, 1)}` },
            { k: 'fee', label: 'Phí sàn / doanh thu', v: -(T.feeRate - feeP),
              why: `${pct(feeP, 1)} → ${pct(T.feeRate, 1)}` },
            { k: 'ads', label: 'Quảng cáo / doanh thu', v: -(T.adsRate - adsP),
              why: `${pct(adsP, 1)} → ${pct(T.adsRate, 1)}` },
          ],
        }
      }
    }

    /* Theo ngành hàng — phí & ads phân bổ theo doanh thu trong kỳ */
    const byNg = (() => {
      const m = new Map()
      for (const r of selRows) {
        const s = SKU_MAP[r.sku]
        const k = s?.nganh || '(không rõ ngành)'
        const t = m.get(k) || { k, rev: 0, cogs: 0, un: 0, gift: 0, skus: new Set() }
        t.rev += r.rev || 0; t.cogs += r.cogs || 0; t.un += r.un || 0
        if ((r.rev || 0) <= 0 && (r.cogs || 0) > 0) t.gift += r.cogs
        t.skus.add(r.sku)
        m.set(k, t)
      }
      const load = T.fee + T.ads
      return [...m.values()].map(t => {
        const share = T.rev > 0 ? t.rev / T.rev : 0
        const gp = t.rev - t.cogs
        return {
          ...t, nSku: t.skus.size, gp, gm: t.rev > 0 ? gp / t.rev : 0,
          alloc: load * share, ln: gp - load * share, share,
        }
      }).sort((x, z) => z.rev - x.rev)
    })()

    /* Theo SKU — cùng cách phân bổ, để chỉ ra SKU nào ăn lãi */
    const bySku = (() => {
      const m = new Map()
      for (const r of selRows) {
        const t = m.get(r.sku) || { sku: r.sku, rev: 0, cogs: 0, un: 0, o: 0 }
        t.rev += r.rev || 0; t.cogs += r.cogs || 0; t.un += r.un || 0; t.o += r.o || 0
        m.set(r.sku, t)
      }
      const load = T.fee + T.ads
      return [...m.values()].map(t => {
        const share = T.rev > 0 ? t.rev / T.rev : 0
        const gp = t.rev - t.cogs
        const s = SKU_MAP[t.sku]
        return {
          ...t, name: s?.name || t.sku, nganh: s?.nganh || '—',
          gp, gm: t.rev > 0 ? gp / t.rev : 0, alloc: load * share, ln: gp - load * share,
        }
      }).sort((x, z) => x.ln - z.ln)
    })()

    return {
      T, months, wf, gift, noAds, streak, bridge, byNg, bySku, dimOn,
      nMonths: b - a + 1, lossSkus: bySku.filter(s => s.ln < 0).length,
    }
  }, [filters])

  const { T } = d

  /* Kết luận tự sinh — nói thẳng vấn đề lớn nhất, không mô tả lại số */
  const verdict = (() => {
    const t = []
    let tone = T.ln >= 0 ? 'green' : 'red'
    t.push(T.ln >= 0
      ? `Kỳ này lãi ${trieu(T.ln, 0)} tr, bằng ${pct(T.lnRate, 1)} doanh thu.`
      : `Kỳ này lỗ ${trieu(-T.ln, 0)} tr, bằng ${pct(-T.lnRate, 1)} doanh thu.`)
    if (d.streak >= 2) {
      t.push(`Đã lỗ ${d.streak} tháng liên tiếp tính đến ${d.months[d.months.length - 1].label}.`)
      tone = 'red'
    }
    /* Đâu là chỗ ăn hết lãi gộp: so phí sàn và ads với biên gộp */
    if (T.rev > 0) {
      const eat = T.feeRate + T.adsRate
      if (eat >= T.gm) {
        t.push(`Biên gộp ${pct(T.gm, 1)} không đủ gánh phí sàn ${pct(T.feeRate, 1)} `
          + `cộng quảng cáo ${pct(T.adsRate, 1)} — bán thêm là lỗ thêm.`)
      } else {
        t.push(`Biên gộp ${pct(T.gm, 1)} còn dư ${pct(T.gm - eat, 1)} sau phí sàn `
          + `${pct(T.feeRate, 1)} và quảng cáo ${pct(T.adsRate, 1)}.`)
      }
    }
    if (T.cancelRate > 0.3) {
      t.push(`Huỷ đơn ${pct(T.cancelRate, 0)} GMV (${trieu(T.cx, 0)} tr) — `
        + `đây là doanh thu chưa từng thành hình, không phải chi phí, nhưng tiền quảng cáo `
        + `chạy cho những đơn đó thì đã tiêu mất.`)
    }
    return { tone, t: t.join(' ') }
  })()

  const KPI = [
    { k: 'Doanh thu thuần', v: trieu(T.rev, 0), u: 'tr', tone: '',
      sub: `${pct(T.rev / (T.gmv || 1), 0)} GMV · ${num(T.un)} sản phẩm` },
    { k: 'Lợi nhuận gộp', v: trieu(T.gp, 0), u: 'tr', tone: T.gp > 0 ? 'good' : 'bad',
      sub: `GM ${pct(T.gm, 1)} · giá vốn ${pct(T.cogs / (T.rev || 1), 0)} doanh thu` },
    { k: 'Phí sàn', v: trieu(T.fee, 0), u: 'tr', tone: T.feeRate > 0.25 ? 'bad' : 'amber',
      sub: `${pct(T.feeRate, 1)} doanh thu` },
    { k: 'Quảng cáo', v: trieu(T.ads, 0), u: 'tr', tone: T.adsRate > 0.08 ? 'bad' : '',
      sub: d.noAds.length
        ? `${pct(T.adsRate, 1)} doanh thu · ${d.noAds.length} tháng chưa có dữ liệu`
        : `${pct(T.adsRate, 1)} doanh thu` },
    { k: T.ln >= 0 ? 'Lãi sau phí & ads' : 'Lỗ sau phí & ads',
      v: trieu(Math.abs(T.ln), 0), u: 'tr', tone: T.ln >= 0 ? 'good' : 'bad',
      sub: `${pct(T.lnRate, 1)} doanh thu` },
  ]

  return (
    <div className="pl-page">
      <div className="m2-title">
        <div>
          <h2>Lãi lỗ</h2>
          <p>
            Đi từ GMV đặt hàng xuống lãi lỗ cuối cùng, chỉ ra tiền rơi ở đâu và vì sao.
            Phí sàn lấy từ escrow từng đơn (không phải ước lượng theo %), giá vốn lấy từ
            Master Data. Kỳ đang xem: <b>{filters.from} → {filters.to}</b> ({d.nMonths} tháng).
          </p>
        </div>
        <div className={`pl-health ${T.ln >= 0 ? 't-good' : 't-bad'}`}>
          <span>Lãi lỗ kỳ này</span>
          <b>{T.ln >= 0 ? '' : '−'}{trieu(Math.abs(T.ln), 0)} tr</b>
          <i>{pct(T.lnRate, 1)} doanh thu</i>
        </div>
      </div>

      <div className="mk-tabbar">
        <div className="mk-tabs">
          {[['flow', 'Tiền rơi ở đâu', null],
            ['month', 'Theo tháng', d.months.length],
            ['fee', 'Phí sàn', FEES.length],
            ['why', 'Vì sao lãi đổi', null],
            ['unit', 'Ngành & SKU', d.byNg.length],
            ['method', 'Cách tính', null]].map(([id, lb, n]) => (
              <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                <span className="ic" aria-hidden>{TAB_IC[id]}</span>
                {lb}
                {n != null && <em>{n}</em>}
              </button>
            ))}
        </div>
      </div>

      {d.dimOn && (
        <div className="pl-warn">
          <b>Bộ lọc chiều đang bật — phí sàn và quảng cáo là số PHÂN BỔ</b>
          <p>
            Shopee chỉ trả phí ở cấp đơn hàng, không cấp SKU hay ngành hàng, và tiền
            quảng cáo tính theo chiến dịch. Nên phần đã lọc được chia phí theo
            <b> tỷ trọng doanh thu trong cùng tháng</b>. Doanh thu, giá vốn và lợi nhuận
            gộp vẫn là số thật. Bỏ bộ lọc ngành/loại hình/NCC để xem phí sàn chính xác.
          </p>
        </div>
      )}

      {d.noAds.length > 0 && (
        <div className="pl-warn soft">
          <b>{d.noAds.length}/{d.months.length} tháng trong kỳ chưa có dữ liệu quảng cáo</b>
          <p>
            API Shopee chỉ lưu khoảng 5 tháng lịch sử ads (có từ <b>{ADS_FROM}</b>).
            Các tháng {d.noAds.slice(0, 4).join(', ')}{d.noAds.length > 4 ? '…' : ''} là
            <b> không có dữ liệu</b>, không phải bằng 0 — nên lãi của những tháng đó là
            <b> chưa trừ quảng cáo</b> và đang bị nhìn cao hơn thực tế.
          </p>
        </div>
      )}

      <div className={`mk-verdict ${verdict.tone}`}>
        <b>Vì sao</b>
        <p>{verdict.t}</p>
      </div>

      <div className="mk-kpis pl-kpis">
        {KPI.map(x => (
          <div key={x.k} className={`mk-kpi ${x.tone}`}>
            <span className="k">{x.k}</span>
            <strong>{x.v}<em>{x.u}</em></strong>
            <span className="sub">{x.sub}</span>
          </div>
        ))}
      </div>

      {tab === 'flow' && <FlowTab d={d} />}
      {tab === 'month' && <MonthTab d={d} />}
      {tab === 'fee' && <FeeTab d={d} />}
      {tab === 'why' && <WhyTab d={d} filters={filters} setFilters={setFilters} />}
      {tab === 'unit' && <UnitTab d={d} drill={drill} />}
      {tab === 'method' && <MethodTab d={d} />}
    </div>
  )
}

/* ================= TAB: TIỀN RƠI Ở ĐÂU =================
   Nơi DUY NHẤT có thác nước. Các tab khác không lặp lại biểu đồ này. */
function FlowTab({ d }) {
  const { T } = d
  return (
    <div className="pl-body">
      <section className="m2-panel">
        <div className="m2-head">
          <h3>Từ GMV đặt hàng xuống lãi lỗ</h3>
          <span>
            Cột xanh đậm là mốc, cột xanh nhạt là số cộng dồn, cột đỏ là phần bị trừ.
            Ba cột đầu (huỷ, trả hàng, giảm giá) <b>không phải chi phí</b> — đó là doanh thu
            chưa từng thành hình. Chi phí thật chỉ có giá vốn, phí sàn và quảng cáo.
          </span>
        </div>
        <Waterfall steps={d.wf} />
        <div className="pl-note">
          Đọc theo hàng: mỗi <b>100 đồng khách đặt</b>, chỉ <b>{num(T.rev / (T.gmv || 1) * 100, 0)} đồng</b>{' '}
          thành doanh thu; sau giá vốn còn <b>{num(T.gp / (T.gmv || 1) * 100, 0)} đồng</b> lợi nhuận gộp;
          sau phí sàn và quảng cáo còn <b>{num(T.ln / (T.gmv || 1) * 100, 1)} đồng</b>.
        </div>
      </section>

      <div className="pl-row2">
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Đối chiếu với tiền Shopee thực trả</h3>
            <span>
              Kiểm chéo con số tự tính với <code>escrow_amount</code> — số tiền Shopee thật sự
              chuyển về. Công thức đã dò trên từng đơn:
              giá bán − phí sàn − voucher shop, khớp 99,6% ở 1.521 đơn.
            </span>
          </div>
          <table className="pl-table recon">
            <tbody>
              <tr><td>Giá bán các đơn thành công <i>(order_selling_price)</i></td>
                <td className="num">{trieu(T.banHang, 1)}</td></tr>
              <tr><td>− Phí sàn</td><td className="num neg">−{trieu(T.fee, 1)}</td></tr>
              <tr><td>− Voucher shop tự chịu</td>
                <td className="num neg">−{trieu(T.banHang - T.fee - T.ttnTinh, 1)}</td></tr>
              <tr className="sub"><td>= Tiền thực nhận (tính ra)</td>
                <td className="num">{trieu(T.ttnTinh, 1)}</td></tr>
              <tr className="tot"><td>Tiền thực nhận Shopee báo</td>
                <td className="num">{trieu(T.ttn, 1)}</td></tr>
              <tr className={Math.abs(T.ttnLech) / (T.ttn || 1) > 0.02 ? 'diff bad' : 'diff'}>
                <td>Chênh lệch</td>
                <td className="num">{T.ttnLech >= 0 ? '+' : '−'}{trieu(Math.abs(T.ttnLech), 1)}
                  <i> ({pct(Math.abs(T.ttnLech) / (T.ttn || 1), 2)})</i></td></tr>
            </tbody>
          </table>
          <p className="pl-note">
            Chênh lệch là các khoản điều chỉnh lẻ Shopee áp trên từng đơn (hoàn một phần,
            bù phí vận chuyển ngược, xu). Dưới 2% thì coi là khớp; vượt 2% là dấu hiệu có
            khoản mới trong escrow chưa được đưa vào công thức.
          </p>
        </section>

        <section className="m2-panel">
          <div className="m2-head">
            <h3>Hàng tặng kèm — chi phí không có doanh thu</h3>
            <span>
              Những dòng bán có giá vốn nhưng giá bán bằng 0. Đây là chi phí thật, đã nằm
              trong giá vốn ở thác nước, nhưng bị lẫn nên không ai thấy.
            </span>
          </div>
          {d.gift.cogs > 0 ? (
            <>
              <div className="pl-gift">
                <div><span>Giá vốn hàng tặng</span><b>{trieu(d.gift.cogs, 1)} tr</b></div>
                <div><span>Số sản phẩm đã tặng</span><b>{num(d.gift.un)}</b></div>
                <div><span>So với doanh thu</span><b>{pct(d.gift.cogs / (T.rev || 1), 1)}</b></div>
                <div><span>So với lãi lỗ kỳ này</span><b>{pct(d.gift.cogs / Math.abs(T.ln || 1), 0)}</b></div>
              </div>
              <table className="pl-table">
                <thead><tr><th>SKU</th><th>Tên</th><th className="num">Giá vốn đã tặng</th></tr></thead>
                <tbody>
                  {Object.entries(d.gift.bySku).sort((a, b) => b[1] - a[1]).slice(0, 8)
                    .map(([sku, c]) => (
                      <tr key={sku}>
                        <td className="mono">{sku}</td>
                        <td className="sm">{SKU_MAP[sku]?.name || '—'}</td>
                        <td className="num">{trieu(c, 2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="pl-empty">Kỳ này không có dòng bán nào giá 0 mà vẫn phát sinh giá vốn.</p>
          )}
        </section>
      </div>
    </div>
  )
}

/* ================= TAB: THEO THÁNG ================= */
function MonthTab({ d }) {
  const rows = d.months
  const chart = rows.map(m => ({
    label: m.label.replace('20', ''), lnTr: m.lnTr, gpTr: m.gpTr,
    lnRate: m.lnRate * 100, gmPct: m.gm * 100,
  }))
  function xls() {
    exportRowsXlsx('Lai lo theo thang.xlsx', {
      'Lai lo': rows.map(m => ({
        thang: m.ym, don: m.don, gmv: Math.round(m.gmv), huy: Math.round(m.cx),
        hoan: Math.round(m.rt), giam_gia: Math.round(m.dc), doanh_thu: Math.round(m.rev),
        gia_von: Math.round(m.cogs), ln_gop: Math.round(m.gp), gm_pct: +(m.gm * 100).toFixed(1),
        phi_san: Math.round(m.fee), phi_san_pct_dt: +(m.feeRate * 100).toFixed(1),
        quang_cao: Math.round(m.ads), co_du_lieu_ads: m.hasAds ? 'co' : 'khong',
        lai_lo: Math.round(m.ln), lai_lo_pct_dt: +(m.lnRate * 100).toFixed(1),
        tien_thuc_nhan: Math.round(m.ttn),
      })),
      'Phi san chi tiet': rows.map(m => ({
        thang: m.ym,
        ...Object.fromEntries(FEES.map(([k, lb]) => [lb, Math.round(m[k] || 0)])),
        tong_phi_san: Math.round(m.fee),
        ...Object.fromEntries(OUTSIDE.map(([k, lb]) => [lb, Math.round(m[k] || 0)])),
      })),
    })
  }
  return (
    <div className="pl-body">
      <section className="m2-panel">
        <div className="m2-head">
          <h3>Lãi lỗ và biên theo tháng</h3>
          <span>
            Cột là số tiền (triệu), đường là tỷ lệ trên doanh thu. Cột dưới 0 là tháng lỗ.
            Khoảng cách giữa hai đường chính là phần phí sàn và quảng cáo ăn vào.
          </span>
        </div>
        <ResponsiveContainer width="100%" height={310}>
          <ComposedChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" {...AX} />
            <YAxis yAxisId="l" {...AX} tickFormatter={v => num(v)} />
            <YAxis yAxisId="r" orientation="right" {...AX} tickFormatter={v => `${num(v)}%`} />
            <Tooltip formatter={(v, n) => (String(n).includes('%')
              ? `${num(v, 1)}%` : `${num(v, 1)} tr`)} />
            <Legend {...LEG} />
            <ReferenceLine yAxisId="l" y={0} stroke={C.axis} />
            <Bar yAxisId="l" dataKey="gpTr" name="Lợi nhuận gộp · tr (trái)"
              fill={C.soft} radius={[2, 2, 0, 0]} barSize={16} />
            <Bar yAxisId="l" dataKey="lnTr" name="Lãi lỗ sau phí & ads · tr (trái)"
              radius={[2, 2, 0, 0]} barSize={16}>
              {chart.map((r, i) => <Cell key={i} fill={r.lnTr >= 0 ? C.good : C.bad} />)}
            </Bar>
            <Line yAxisId="r" {...SOFT} dataKey="gmPct" name="Biên gộp GM% (phải)"
              stroke={C.blue2} strokeWidth={1.8} strokeDasharray="5 4" dot={false}
              activeDot={actOf(C.blue2)} />
            <Line yAxisId="r" {...SOFT} dataKey="lnRate" name="Lãi lỗ % doanh thu (phải)"
              stroke={C.amber} strokeWidth={2.6} dot={dotOf(C.amber, chart.length)}
              activeDot={actOf(C.amber)} />
          </ComposedChart>
        </ResponsiveContainer>
      </section>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Bảng lãi lỗ đầy đủ</h3>
          <span>Mọi cột đều là số thật từ đơn hàng và escrow, không nội suy</span>
          <div className="group-ctrl">
            <button onClick={xls}>⬇ Xuất Excel (2 sheet: lãi lỗ · phí sàn chi tiết)</button>
          </div>
        </div>
        <div className="m2-tablewrap">
          <table className="pl-table wide">
            <thead>
              <tr>
                <th>Tháng</th><th className="num">GMV</th><th className="num">Huỷ</th>
                <th className="num">Hoàn</th><th className="num">Giảm giá</th>
                <th className="num">Doanh thu</th><th className="num">Giá vốn</th>
                <th className="num">LN gộp</th><th className="num">GM%</th>
                <th className="num">Phí sàn</th><th className="num">%DT</th>
                <th className="num">Ads</th><th className="num">Lãi/lỗ</th><th className="num">%DT</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.ym} className={m.ln < 0 ? 'loss' : ''}>
                  <td className="mono">{m.label}</td>
                  <td className="num">{trieu(m.gmv, 0)}</td>
                  <td className="num neg">{trieu(m.cx, 0)}</td>
                  <td className="num neg">{trieu(m.rt, 1)}</td>
                  <td className="num neg">{trieu(m.dc, 1)}</td>
                  <td className="num b">{trieu(m.rev, 0)}</td>
                  <td className="num">{trieu(m.cogs, 0)}</td>
                  <td className="num">{trieu(m.gp, 0)}</td>
                  <td className="num">{pct(m.gm, 0)}</td>
                  <td className="num">{trieu(m.fee, 0)}</td>
                  <td className={`num ${m.feeRate > 0.25 ? 'hl' : ''}`}>{pct(m.feeRate, 0)}</td>
                  <td className="num">{m.hasAds ? trieu(m.ads, 0) : <i className="na">n/a</i>}</td>
                  <td className={`num b ${m.ln < 0 ? 'neg' : 'pos'}`}>{trieu(m.ln, 0)}</td>
                  <td className={`num ${m.ln < 0 ? 'neg' : ''}`}>{pct(m.lnRate, 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Tổng</td>
                <td className="num">{trieu(d.T.gmv, 0)}</td>
                <td className="num">{trieu(d.T.cx, 0)}</td>
                <td className="num">{trieu(d.T.rt, 1)}</td>
                <td className="num">{trieu(d.T.dc, 1)}</td>
                <td className="num">{trieu(d.T.rev, 0)}</td>
                <td className="num">{trieu(d.T.cogs, 0)}</td>
                <td className="num">{trieu(d.T.gp, 0)}</td>
                <td className="num">{pct(d.T.gm, 0)}</td>
                <td className="num">{trieu(d.T.fee, 0)}</td>
                <td className="num">{pct(d.T.feeRate, 0)}</td>
                <td className="num">{trieu(d.T.ads, 0)}</td>
                <td className={`num ${d.T.ln < 0 ? 'neg' : 'pos'}`}>{trieu(d.T.ln, 0)}</td>
                <td className="num">{pct(d.T.lnRate, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="pl-note">
          Đơn vị: triệu đồng. <b>n/a</b> ở cột Ads là tháng API Shopee không còn lưu dữ liệu —
          lãi tháng đó chưa trừ quảng cáo.
        </p>
      </section>
    </div>
  )
}

/* ================= TAB: PHÍ SÀN ================= */
function FeeTab({ d }) {
  const { T, months } = d
  const chart = months.map(m => ({
    label: m.label.replace('20', ''),
    ...Object.fromEntries(FEES.map(([k]) => [k, (m[k] || 0) / 1e6])),
    feeRate: m.feeRate * 100, adsRate: m.adsRate * 100, gmPct: m.gm * 100,
  }))
  const totals = FEES.map(([k, label, note], i) => {
    const v = months.reduce((t, m) => t + (m[k] || 0), 0)
    return { k, label, note, v, share: T.fee > 0 ? v / T.fee : 0, rate: T.rev > 0 ? v / T.rev : 0, c: FEE_COLORS[i] }
  }).sort((a, b) => b.v - a.v)
  const outs = OUTSIDE.map(([k, label, kind, note]) => ({
    k, label, kind, note, v: months.reduce((t, m) => t + (m[k] || 0), 0),
  })).filter(o => o.v !== 0)

  return (
    <div className="pl-body">
      <section className="m2-panel">
        <div className="m2-head">
          <h3>Phí sàn ăn bao nhiêu phần doanh thu</h3>
          <span>
            Đường liền là tổng phí sàn trên doanh thu, đường gạch là biên gộp. Khi đường
            phí tiến sát đường biên gộp thì phần còn lại cho giá vốn và quảng cáo hết chỗ.
          </span>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" {...AX} />
            <YAxis {...AX} tickFormatter={v => `${num(v)}%`} />
            <Tooltip formatter={v => `${num(v, 1)}%`} />
            <Legend {...LEG} />
            <Line {...SOFT} dataKey="gmPct" name="Biên gộp GM%" stroke={C.blue2}
              strokeWidth={1.8} strokeDasharray="5 4" dot={false} activeDot={actOf(C.blue2)} />
            <Line {...SOFT} dataKey="feeRate" name="Phí sàn / doanh thu" stroke={C.bad}
              strokeWidth={2.6} dot={dotOf(C.bad, chart.length)} activeDot={actOf(C.bad)} />
            <Line {...SOFT} dataKey="adsRate" name="Quảng cáo / doanh thu" stroke={C.amber}
              strokeWidth={2.2} dot={dotOf(C.amber, chart.length)} activeDot={actOf(C.amber)} />
          </ComposedChart>
        </ResponsiveContainer>
      </section>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Cơ cấu phí sàn theo tháng</h3>
          <span>Diện tích xếp lớp — nhìn được khoản nào phình lên, đơn vị triệu đồng</span>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" {...AX} />
            <YAxis {...AX} tickFormatter={v => num(v)} />
            <Tooltip formatter={v => `${num(v, 1)} tr`} />
            <Legend {...LEG} />
            {FEES.map(([k, label], i) => (
              <Area key={k} {...SOFT} dataKey={k} name={label} stackId="1"
                stroke={FEE_COLORS[i]} fill={FEE_COLORS[i]} fillOpacity={0.82} strokeWidth={0.8} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </section>

      <div className="pl-row2">
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Sáu khoản Shopee trừ trong escrow</h3>
            <span>Cộng lại đúng bằng dòng “Phí sàn” trong thác nước</span>
          </div>
          <table className="pl-table">
            <thead>
              <tr><th>Khoản</th><th className="num">Số tiền</th><th className="num">% phí</th>
                <th className="num">% DT</th></tr>
            </thead>
            <tbody>
              {totals.map(t => (
                <tr key={t.k}>
                  <td>
                    <span className="pl-dot" style={{ background: t.c }} />
                    <b>{t.label}</b>
                    <i className="note">{t.note}</i>
                  </td>
                  <td className="num">{trieu(t.v, 1)}</td>
                  <td className="num">{pct(t.share, 0)}</td>
                  <td className="num">{pct(t.rate, 1)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td>Tổng phí sàn</td><td className="num">{trieu(T.fee, 1)}</td>
                <td className="num">100%</td><td className="num">{pct(T.feeRate, 1)}</td></tr>
            </tfoot>
          </table>
        </section>

        <section className="m2-panel">
          <div className="m2-head">
            <h3>Các khoản khác trong escrow — vì sao không tính vào phí sàn</h3>
            <span>Để tránh cộng trùng hoặc cộng nhầm khoản sàn tự chịu</span>
          </div>
          <table className="pl-table">
            <thead><tr><th>Khoản</th><th className="num">Số tiền</th><th>Xử lý</th></tr></thead>
            <tbody>
              {outs.map(o => (
                <tr key={o.k}>
                  <td><b>{o.label}</b><i className="note">{o.note}</i></td>
                  <td className="num">{trieu(o.v, 1)}</td>
                  <td className="sm">
                    <span className={`pl-tag ${o.kind}`}>
                      {o.kind === 'cost' ? 'đã trừ ở chỗ khác'
                        : o.kind === 'none' ? 'không phải chi phí shop'
                          : o.kind === 'in' ? 'khoản thu bù' : 'gần như bù trừ hết'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pl-note">
            Đây là chỗ dễ tính sai nhất: gộp voucher shop vào phí sàn là tính hai lần
            (nó đã bị trừ khi tính doanh thu), còn cộng voucher Shopee tài trợ vào chi phí
            là tự nhận khoản mà sàn chịu.
          </p>
        </section>
      </div>
    </div>
  )
}

/* ================= TAB: VÌ SAO LÃI ĐỔI =================
   Phân rã theo ĐIỂM PHẦN TRĂM trên doanh thu, vì so số tiền tuyệt đối giữa hai
   kỳ có quy mô khác nhau thì không nói được điều gì.
   LN% = GM% − phí sàn% − ads%, nên ba phần cộng lại đúng bằng mức thay đổi LN%. */
function WhyTab({ d, filters, setFilters }) {
  const b = d.bridge
  if (!b) {
    return (
      <div className="pl-body">
        <section className="m2-panel">
          <p className="pl-empty">
            Chưa có kỳ để so sánh. Chọn <b>So sánh: kỳ liền trước</b> hoặc
            <b> cùng kỳ năm trước</b> ở thanh lọc, và đảm bảo kỳ so sánh nằm trong
            phạm vi dữ liệu ({MONTHS[0]} → {MONTHS[MONTHS.length - 1]}).
          </p>
          <div className="pl-acts">
            {YOY_READY && (
              <button className="primary" onClick={() => setFilters(f => ({
                ...f, preset: 'ytd', from: YOY_READY.from, to: YOY_READY.to, compare: 'yoy',
              }))}>
                Xem {YOY_READY.from} → {YOY_READY.to} so với cùng kỳ năm trước
              </button>
            )}
            <button onClick={() => setFilters(f => ({ ...f, compare: 'prev' }))}>
              So với kỳ liền trước
            </button>
            <button onClick={() => setFilters(f => ({ ...f, compare: 'yoy' }))}>
              So với cùng kỳ năm trước
            </button>
          </div>
          <p className="pl-note">
            Kỳ đang chọn dài {d.nMonths} tháng nên không có kỳ nào trước đó đủ dài để so.
            Muốn xem vì sao lãi đổi thì chọn kỳ ngắn hơn, hoặc bấm nút đầu tiên để so
            năm nay với cùng kỳ năm trước.
          </p>
        </section>
      </div>
    )
  }
  const delta = b.lnC - b.lnP
  const chart = [
    { label: `LN% kỳ so sánh`, v: b.lnP * 100, kind: 'base' },
    ...b.parts.map(p => ({ label: p.label, v: p.v * 100, kind: p.v >= 0 ? 'pos' : 'neg' })),
    { label: 'LN% kỳ này', v: b.lnC * 100, kind: 'base' },
  ]
  return (
    <div className="pl-body">
      <section className="m2-panel">
        <div className="m2-head">
          <h3>
            Lãi trên doanh thu đổi {delta >= 0 ? 'tăng' : 'giảm'} {num(Math.abs(delta) * 100, 1)} điểm %
          </h3>
          <span>
            So <b>{filters.from} → {filters.to}</b> với <b>{b.from} → {b.to}</b>
            {' '}({filters.compare === 'yoy' ? 'cùng kỳ năm trước' : 'kỳ liền trước'}).
            Vì <code>LN% = GM% − phí sàn% − ads%</code> nên ba thanh giữa cộng lại đúng bằng
            mức thay đổi — không có phần “còn lại” nào bị bỏ sót.
          </span>
        </div>
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={chart} layout="vertical"
            margin={{ top: 6, right: 56, left: 150, bottom: 4 }}>
            <CartesianGrid stroke={C.grid} horizontal={false} />
            <XAxis type="number" {...AX} tickFormatter={v => `${num(v, 0)}`} />
            <YAxis type="category" dataKey="label" {...AX} width={148} />
            <Tooltip formatter={v => `${num(v, 2)} điểm %`} />
            <ReferenceLine x={0} stroke={C.axis} />
            <Bar dataKey="v" barSize={20} radius={[0, 2, 2, 0]}>
              {chart.map((r, i) => (
                <Cell key={i} fill={r.kind === 'base' ? C.navy : r.kind === 'pos' ? C.good : C.bad} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {!b.adsKnown && (
          <p className="pl-note warn">
            Kỳ so sánh <b>{b.from} → {b.to}</b> thiếu dữ liệu quảng cáo, nên thanh
            “Quảng cáo / doanh thu” đang tính như thể kỳ đó không chạy ads. Mức tụt thật
            của lãi <b>nhỏ hơn</b> con số hiển thị.
          </p>
        )}
      </section>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Đọc từng nguyên nhân</h3>
          <span>Dấu dương là làm lãi tăng, dấu âm là ăn vào lãi</span>
        </div>
        <table className="pl-table">
          <thead>
            <tr><th>Nguyên nhân</th><th className="num">Đổi</th><th className="num">Tác động lên LN%</th>
              <th>Nghĩa là gì</th></tr>
          </thead>
          <tbody>
            {b.parts.map(p => (
              <tr key={p.k}>
                <td><b>{p.label}</b></td>
                <td className="num sm">{p.why}</td>
                <td className={`num b ${p.v >= 0 ? 'pos' : 'neg'}`}>
                  {p.v >= 0 ? '+' : '−'}{num(Math.abs(p.v) * 100, 2)} đ%
                </td>
                <td className="sm">
                  {p.k === 'gm' && (p.v >= 0
                    ? 'Bán được giá tốt hơn hoặc giá vốn nhẹ hơn — phần này đang đỡ cho lãi.'
                    : 'Giá bán thực tụt hoặc giá vốn tăng — mất ngay từ trước khi tính phí.')}
                  {p.k === 'fee' && (p.v >= 0
                    ? 'Tỷ lệ phí sàn giảm — thường do đổi gói dịch vụ hoặc bớt affiliate.'
                    : 'Tỷ lệ phí sàn tăng: cùng một đồng doanh thu nay phải trả cho sàn nhiều hơn. '
                      + 'Soát lại gói Freeship/Hoàn Xu và hoa hồng affiliate.')}
                  {p.k === 'ads' && (p.v >= 0
                    ? 'Bớt phụ thuộc quảng cáo hoặc quảng cáo hiệu quả hơn.'
                    : 'Quảng cáo chiếm phần lớn hơn trong doanh thu — xem màn Marketing Analysis '
                      + 'để biết chiến dịch nào tiêu mà không sinh đơn.')}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Tổng thay đổi LN%</td>
              <td className="num sm">{pct(b.lnP, 1)} → {pct(b.lnC, 1)}</td>
              <td className={`num b ${delta >= 0 ? 'pos' : 'neg'}`}>
                {delta >= 0 ? '+' : '−'}{num(Math.abs(delta) * 100, 2)} đ%
              </td>
              <td className="sm">Ba nguyên nhân trên cộng lại đúng bằng con số này</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  )
}

/* ================= TAB: NGÀNH & SKU ================= */
function UnitTab({ d, drill }) {
  const { T } = d
  const chart = d.byNg.map(g => ({
    label: g.k, gpTr: g.gp / 1e6, allocTr: -g.alloc / 1e6, lnTr: g.ln / 1e6,
  }))
  return (
    <div className="pl-body">
      <div className="pl-warn soft">
        <b>Phí sàn và quảng cáo ở tab này là số phân bổ theo doanh thu</b>
        <p>
          Shopee không trả phí ở cấp SKU hay ngành hàng. Doanh thu, giá vốn và lợi nhuận
          gộp là số thật; phần <b>phân bổ</b> chỉ để trả lời “nếu gánh phí theo đúng tỷ
          trọng doanh thu thì ngành/SKU này còn lãi không”. Đừng dùng con số phân bổ để
          đàm phán giá — dùng cột lợi nhuận gộp.
        </p>
      </div>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Ngành nào còn lãi sau khi gánh phí</h3>
          <span>
            Thanh xanh nhạt là lợi nhuận gộp thật, thanh đỏ là phần phí sàn + quảng cáo
            phân bổ, thanh đậm là phần còn lại
          </span>
        </div>
        <ResponsiveContainer width="100%" height={40 + d.byNg.length * 54}>
          <BarChart data={chart} layout="vertical"
            margin={{ top: 6, right: 40, left: 118, bottom: 4 }}>
            <CartesianGrid stroke={C.grid} horizontal={false} />
            <XAxis type="number" {...AX} tickFormatter={v => num(v)} />
            <YAxis type="category" dataKey="label" {...AX} width={116} />
            <Tooltip formatter={v => `${num(v, 1)} tr`} />
            <Legend {...LEG} />
            <ReferenceLine x={0} stroke={C.axis} />
            <Bar dataKey="gpTr" name="Lợi nhuận gộp · tr" fill={C.soft}
              barSize={13} radius={[0, 2, 2, 0]} />
            <Bar dataKey="allocTr" name="Phí sàn + ads phân bổ · tr" fill={C.bad}
              barSize={13} radius={[2, 0, 0, 2]} />
            <Bar dataKey="lnTr" name="Lãi lỗ còn lại · tr" barSize={13} radius={[0, 2, 2, 0]}>
              {chart.map((r, i) => <Cell key={i} fill={r.lnTr >= 0 ? C.good : C.navy} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="m2-tablewrap">
          <table className="pl-table wide">
            <thead>
              <tr><th>Ngành hàng</th><th className="num">SKU</th><th className="num">Doanh thu</th>
                <th className="num">%DT</th><th className="num">Giá vốn</th><th className="num">LN gộp</th>
                <th className="num">GM%</th><th className="num">Phân bổ phí</th>
                <th className="num">Lãi/lỗ</th><th className="num">Tặng kèm</th></tr>
            </thead>
            <tbody>
              {d.byNg.map(g => (
                <tr key={g.k} className={g.ln < 0 ? 'loss' : ''}>
                  <td><b>{g.k}</b></td>
                  <td className="num">{g.nSku}</td>
                  <td className="num b">{trieu(g.rev, 1)}</td>
                  <td className="num">{pct(g.share, 0)}</td>
                  <td className="num">{trieu(g.cogs, 1)}</td>
                  <td className={`num ${g.gp < 0 ? 'neg' : ''}`}>{trieu(g.gp, 1)}</td>
                  <td className="num">{g.rev > 0 ? pct(g.gm, 0) : '—'}</td>
                  <td className="num neg">−{trieu(g.alloc, 1)}</td>
                  <td className={`num b ${g.ln < 0 ? 'neg' : 'pos'}`}>{trieu(g.ln, 1)}</td>
                  <td className="num">{g.gift ? trieu(g.gift, 2) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Tổng</td><td className="num">{d.bySku.length}</td>
                <td className="num">{trieu(T.rev, 1)}</td><td className="num">100%</td>
                <td className="num">{trieu(T.cogs, 1)}</td><td className="num">{trieu(T.gp, 1)}</td>
                <td className="num">{pct(T.gm, 0)}</td>
                <td className="num">−{trieu(T.fee + T.ads, 1)}</td>
                <td className={`num b ${T.ln < 0 ? 'neg' : 'pos'}`}>{trieu(T.ln, 1)}</td>
                <td className="num">{d.gift.cogs ? trieu(d.gift.cogs, 2) : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>SKU ăn lãi nhiều nhất — {d.lossSkus} SKU lỗ sau phân bổ</h3>
          <span>
            Sắp xếp từ lỗ nặng nhất. Bấm dòng để mở loại hình của SKU đó. Cột GM% âm nghĩa là
            <b> bán dưới giá vốn</b>, không cần chờ tính phí đã lỗ.
          </span>
        </div>
        <div className="m2-tablewrap">
          <table className="pl-table wide clickable">
            <thead>
              <tr><th>SKU</th><th>Tên</th><th>Ngành</th><th className="num">SL thuần</th>
                <th className="num">Doanh thu</th><th className="num">LN gộp</th>
                <th className="num">GM%</th><th className="num">Phân bổ phí</th>
                <th className="num">Lãi/lỗ</th></tr>
            </thead>
            <tbody>
              {d.bySku.slice(0, 20).map(s => (
                <tr key={s.sku} className={s.ln < 0 ? 'loss' : ''}
                  onClick={() => SKU_MAP[s.sku]?.className && drill.open(SKU_MAP[s.sku].className)}>
                  <td className="mono">{s.sku}</td>
                  <td className="sm">{s.name}</td>
                  <td className="sm">{s.nganh}</td>
                  <td className="num">{num(s.un)}</td>
                  <td className="num">{trieu(s.rev, 1)}</td>
                  <td className={`num ${s.gp < 0 ? 'neg' : ''}`}>{trieu(s.gp, 1)}</td>
                  <td className={`num ${s.gm < 0 ? 'neg' : ''}`}>{s.rev > 0 ? pct(s.gm, 0) : '—'}</td>
                  <td className="num neg">−{trieu(s.alloc, 2)}</td>
                  <td className={`num b ${s.ln < 0 ? 'neg' : 'pos'}`}>{trieu(s.ln, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

/* ================= TAB: CÁCH TÍNH ================= */
function MethodTab({ d }) {
  const { T } = d
  return (
    <div className="pl-body">
      <section className="m2-panel">
        <div className="m2-head">
          <h3>Từng dòng lấy từ đâu</h3>
          <span>Để ai đọc cũng kiểm lại được, và biết dòng nào là số thật, dòng nào là phân bổ</span>
        </div>
        <table className="pl-table wide">
          <thead><tr><th>Dòng</th><th>Công thức</th><th>Nguồn</th><th>Độ chắc</th></tr></thead>
          <tbody>
            {[
              ['GMV đặt hàng', 'giá thực bán × SL mua', 'Đơn hàng Shopee (mọi trạng thái)', 'ok'],
              ['Huỷ đơn', 'giá thực bán × SL huỷ', 'Trạng thái đơn CANCELLED và dòng bị huỷ', 'ok'],
              ['Trả hàng', 'giá thực bán × SL hoàn', 'API đơn hoàn', 'ok'],
              ['Giảm giá & voucher shop', 'voucher shop, chia theo tỷ lệ SL còn hiệu lực', 'escrow từng dòng đơn', 'ok'],
              ['Doanh thu thuần', 'GMV − huỷ − hoàn − giảm giá', 'tính ra', 'ok'],
              ['Giá vốn hàng bán', 'giá vốn 1 đơn vị × SL thuần', 'Master Data (cột Unit Cost)', 'ok'],
              ['Phí sàn', 'hoa hồng + dịch vụ + giao dịch + AMS + campaign + hỗ trợ kỹ thuật', 'escrow từng đơn', 'ok'],
              ['Quảng cáo', 'chi phí ads theo ngày, cộng theo tháng', 'API ads Shopee', 'part'],
              ['Lãi/lỗ', 'doanh thu − giá vốn − phí sàn − quảng cáo', 'tính ra', 'part'],
              ['Phí ở cấp ngành/SKU', 'tổng phí × tỷ trọng doanh thu', 'phân bổ, không phải số Shopee trả', 'alloc'],
            ].map(([a, b, c, k]) => (
              <tr key={a}>
                <td><b>{a}</b></td>
                <td className="sm mono">{b}</td>
                <td className="sm">{c}</td>
                <td>
                  <span className={`pl-tag ${k === 'ok' ? 'in' : k === 'alloc' ? 'cost' : 'wash'}`}>
                    {k === 'ok' ? 'số thật' : k === 'alloc' ? 'phân bổ' : 'thật nhưng thiếu kỳ'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="pl-row2">
        <section className="m2-panel">
          <div className="m2-head"><h3>Ba chỗ dễ hiểu sai</h3></div>
          <ol className="pl-ol">
            <li>
              <b>Huỷ đơn không phải chi phí.</b> {trieu(T.cx, 0)} tr GMV bị huỷ là doanh thu
              chưa từng thành hình — hàng không xuất, giá vốn không mất. Nhưng tiền quảng cáo
              chạy cho những đơn đó thì đã tiêu, nên nó vẫn làm lãi xấu đi, chỉ là qua đường khác.
            </li>
            <li>
              <b>Voucher shop chỉ được trừ một lần.</b> Nó đã nằm trong dòng “Giảm giá” khi
              tính doanh thu, nên không được cộng tiếp vào phí sàn. Voucher Shopee tài trợ
              thì không phải chi phí của shop.
            </li>
            <li>
              <b>Phí giao dịch chỉ tính một lần.</b> API Shopee trả hai tên
              (<code>seller_transaction_fee</code> và <code>credit_card_transaction_fee</code>)
              bằng nhau ở 100% đơn — cùng một khoản. Cộng cả hai là phí sàn bị đội thêm
              khoảng 5 điểm %.
            </li>
          </ol>
        </section>

        <section className="m2-panel">
          <div className="m2-head"><h3>Còn thiếu gì để thành lãi lỗ đầy đủ</h3></div>
          <ul className="pl-ul">
            <li>
              <b>Quảng cáo trước {ADS_FROM}:</b> API Shopee chỉ lưu khoảng 5 tháng, nên lãi
              các tháng cũ là <b>chưa trừ ads</b> và đang bị nhìn cao hơn thực tế.
            </li>
            <li>
              <b>Chi phí vận hành:</b> nhân sự, kho bãi, đóng gói, vận chuyển nội bộ — chưa có
              nguồn nào cấp vào app, nên đây là lãi lỗ ở mức <b>đóng góp</b>, chưa phải lãi ròng.
            </li>
            <li>
              <b>Kênh ngoài Shopee:</b> toàn bộ số trong app là của shop
              Tuft &amp; Needle by Sleep Expert trên Shopee. Bán ở kênh khác không nằm đây.
            </li>
            <li>
              <b>Thuế:</b> khoản Shopee giữ lại nộp thay có trong escrow (đang bằng 0 ở kỳ này),
              nhưng thuế doanh nghiệp thì không thuộc phạm vi này.
            </li>
          </ul>
        </section>
      </div>
    </div>
  )
}
