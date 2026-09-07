import { Fragment, useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, BarChart, ScatterChart, Scatter, ZAxis, Treemap, LabelList,
  AreaChart, Area, Legend,
} from 'recharts'
import mkt from '../data/marketing.json'
import { trieu, num, pct } from '../lib/format'
import { useDrill } from '../app/drill'
import './marketing.css'

const C = {
  ads: '#353E99', adsOther: '#8E96DC', roasS: '#8E93B5', roasR: '#D97706',
  be: '#B42318', good: '#1F7A45', grid: '#E7E9F3', axis: '#8E93B5',
  blue2: '#5C67C4', amber: '#D97706', navy: '#232A6B',
}

/* ---------- Chẩn đoán: phễu vỡ ở đâu ----------------------------------
   Thứ tự kiểm tra đi theo đúng chiều phễu, dừng ở mắt vỡ ĐẦU TIÊN — vì
   sửa mắt sau khi mắt trước còn vỡ thì không có tác dụng. */
const DIAG = [
  { id: 'off', label: 'Không chạy quảng cáo', tone: 'grey',
    why: 'Chiến dịch không tiêu đồng nào trong kỳ.',
    action: 'Quyết định dứt điểm: bật lại có kiểm soát, hay đóng để dọn danh sách.' },
  { id: 'reach', label: 'Không ai thấy', tone: 'grey',
    why: 'Hiển thị quá thấp — ngân sách hoặc giá thầu không đủ để vào phiên đấu giá.',
    action: 'Nâng giá thầu / ngân sách, hoặc mở rộng vị trí hiển thị. Chưa cần sửa ảnh, giá.' },
  { id: 'ctr', label: 'Thấy nhưng không bấm', tone: 'amber',
    why: 'CTR dưới 1,5%: ảnh bìa, tiêu đề hoặc giá niêm yết không đủ hấp dẫn ngay trên ô tìm kiếm.',
    action: 'Đổi ảnh bìa & tiêu đề, soát lại giá hiển thị so với đối thủ cùng ô.' },
  { id: 'cr', label: 'Bấm nhưng không chốt', tone: 'amber',
    why: 'CTR ổn nhưng tỷ lệ chốt dưới 0,5%: trang sản phẩm, giá cuối, phí ship hoặc đánh giá làm khách rời.',
    action: 'Soát trang SP: mô tả, ảnh chi tiết, đánh giá, khuyến mãi, phí vận chuyển.' },
  { id: 'cancel', label: 'Chốt rồi huỷ mất', tone: 'red',
    why: 'Chốt được đơn nhưng dưới 50% GMV còn lại sau huỷ/hoàn — tiền quảng cáo đã tiêu vẫn mất.',
    action: 'Đây là vấn đề vận hành, không phải marketing: soát tồn thật, thời gian giao, giá sai, COD.' },
  { id: 'margin', label: 'Phễu ổn nhưng lỗ', tone: 'red',
    why: 'ROAS thật thấp hơn ROAS hoà vốn: mỗi đồng quảng cáo tiêu ra không bù nổi giá vốn + phí sàn. '
       + 'Trường hợp hoà vốn ghi "không thể" là biên đã mỏng hơn phí sàn — không mức ROAS nào cứu được.',
    action: 'Hạ CPC mục tiêu, hoặc nâng giá bán / hạ giá vốn. Giữ nguyên là càng bán càng lỗ.' },
  { id: 'ok', label: 'Hiệu quả', tone: 'green',
    why: 'ROAS thật vượt điểm hoà vốn — quảng cáo đang sinh lời.',
    action: 'Tăng ngân sách từng bước 20%, theo dõi CPC và chất lượng đơn khi mở rộng.' },
]
const DIAG_MAP = Object.fromEntries(DIAG.map(d => [d.id, d]))

function diagnose(r) {
  if (!r.expense) return 'off'
  if (r.impression < 2000) return 'reach'
  if ((r.ctr || 0) < 0.015) return 'ctr'
  if ((r.cr || 0) < 0.005) return 'cr'
  if (r.net_rate != null && r.net_rate < 0.5) return 'cancel'
  /* be == null nghĩa là biên (GM% − phí sàn) đã mỏng hơn 2 điểm % — KHÔNG có mức
     ROAS nào hoà vốn được, nên luôn xếp vào lỗ, không được rơi xuống 'ok'. */
  const be = r.roas_hoa_von
  if (be == null) return 'margin'
  if ((r.roas_thuc || 0) < be) return 'margin'
  return 'ok'
}

const TAB_IC = { overview: '▩', campaign: '◎', item: '▤', nganh: '◈', diag: '⌕', method: 'ⓘ' }
const ADS_MONTHS = mkt.months.map(m => m.ym)
/* chỉ liệt kê ngành & loại hình thực sự có mặt trong dữ liệu ads */
const NGANH = [...new Set(mkt.items.map(r => r.nganh).filter(Boolean))].sort()
const LOAI_HINH = [...new Set(mkt.items.map(r => r.class_name).filter(Boolean))].sort()
const NG_OF = Object.fromEntries(mkt.items.filter(r => r.class_name).map(r => [r.class_name, r.nganh]))
/* item -> ngành / loại hình / tên, dựng từ TOÀN BỘ dữ liệu.
   Nếu tra theo kỳ đang chọn thì kỳ hẹp sẽ làm mất luôn chiến dịch khỏi bảng. */
const ITEM_INFO = (() => {
  const m = {}
  for (const r of mkt.items) {
    const t2 = m[r.item_id] || {}
    m[r.item_id] = {
      item_name: t2.item_name || r.item_name,
      nganh: t2.nganh || r.nganh,
      class_name: t2.class_name || r.class_name,
    }
  }
  return m
})()
const fmtRoas = v => (v == null ? '—' : num(v, 2))

/* ROAS hoà vốn = 1 / (GM% − phí sàn). Khi biên còn dưới 2 điểm % thì mẫu số gần 0,
   công thức cho ra số vô nghĩa (kiểu 8.400) — thực chất nghĩa là KHÔNG có mức ROAS nào
   hoà vốn được. Trả null và ghi rõ, thay vì in một con số làm méo cả trục biểu đồ. */
const BE_MIN_MARGIN = 0.02
const BE_CAP = 20                     // trần khi vẽ, để 1 tháng bất thường không dí bẹp trục
const beOf = (gm, fee) => {
  if (gm == null) return null
  const m = gm - (fee || 0)
  return m > BE_MIN_MARGIN ? 1 / m : null
}
const fmtBe = v => (v == null ? 'không thể' : v > BE_CAP ? `>${BE_CAP}` : num(v, 2))

/* ---------- PHỄU QUẢNG CÁO — vẽ đúng hình phễu bằng SVG ---------------
   4 bậc: Lượt xem → Lượt click → Lượt mua → Đơn thành công.
   Giữa các bậc là tỷ lệ chuyển bậc: tỷ lệ click, tỷ lệ chuyển đổi, tỷ lệ thành công.
   Bề rộng theo thang căn bậc hai vì bậc sau nhỏ hơn bậc trước hàng trăm lần —
   thang tuyến tính sẽ làm 3 bậc cuối mảnh như sợi chỉ, không đọc được. */
const FUNNEL_C = ['#232A6B', '#353E99', '#5C67C4', '#D97706']

function FunnelChart({ stages }) {
  const BW = 300, PAD = 12, BH = 52, GAP = 28
  const H = stages.length * BH + (stages.length - 1) * GAP + PAD * 2
  const W = 520
  const max = stages[0].v || 1
  const wOf = v => Math.max(0.14, Math.sqrt(Math.max(v, 0) / max)) * BW
  const cx = PAD + BW / 2

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mk-funnel-svg" role="img">
      <defs>
        {stages.map((s, i) => (
          <linearGradient key={i} id={`fg${i}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={FUNNEL_C[i]} stopOpacity="0.95" />
            <stop offset="100%" stopColor={FUNNEL_C[i]} stopOpacity="0.72" />
          </linearGradient>
        ))}
      </defs>
      {stages.map((s, i) => {
        const y = PAD + i * (BH + GAP)
        const top = wOf(s.v)
        const bot = i < stages.length - 1 ? wOf(stages[i + 1].v) : top * 0.9
        const pts = [
          [cx - top / 2, y], [cx + top / 2, y],
          [cx + bot / 2, y + BH], [cx - bot / 2, y + BH],
        ].map(p => p.join(',')).join(' ')
        const wide = top > 110
        return (
          <g key={s.k}>
            <polygon points={pts} fill={`url(#fg${i})`} />
            {/* giá trị: đặt trong bậc nếu đủ rộng, không thì đặt ngay bên phải */}
            {wide ? (
              <text x={cx} y={y + BH / 2 + 5} textAnchor="middle"
                className="fn-val in">{s.label}</text>
            ) : (
              <text x={cx + top / 2 + 8} y={y + BH / 2 + 5}
                className="fn-val out">{s.label}</text>
            )}
            {/* tên bậc + ghi chú ở cột phải */}
            <text x={PAD + BW + 26} y={y + BH / 2 - 2} className="fn-name">{s.k}</text>
            <text x={PAD + BW + 26} y={y + BH / 2 + 14} className="fn-note">{s.note}</text>
            {/* tỷ lệ chuyển bậc, nằm trong khe giữa hai bậc */}
            {i < stages.length - 1 && (
              <g>
                <line x1={cx} y1={y + BH + 3} x2={cx} y2={y + BH + GAP - 3}
                  stroke="#C9CCE4" strokeWidth="1" strokeDasharray="2 2" />
                <rect x={cx - 76} y={y + BH + 4} width={152} height={18} rx={9}
                  className={`fn-rate-bg ${stages[i + 1].bad ? 'bad' : ''}`} />
                <text x={cx} y={y + BH + 17} textAnchor="middle"
                  className={`fn-rate ${stages[i + 1].bad ? 'bad' : ''}`}>
                  {stages[i + 1].rateLabel}
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/* ---------- Trục & tooltip ------------------------------------------- */
const TipBox = ({ active, payload, label, rows }) => {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="mk-tip">
      <b>{label}</b>
      {rows(p).map(([k, v, cls]) => (
        <div key={k} className={cls || ''}><span>{k}</span><em>{v}</em></div>
      ))}
    </div>
  )
}

/* '2026.04' (thanh lọc) <-> '2026-04' (dữ liệu) */
const toYm = m => (m || '').replace('.', '-')
const toDot = m => (m || '').replace('-', '.')

export default function Marketing({ filters, setFilters }) {
  const [tab, setTab] = useState('overview')
  const [openNg, setOpenNg] = useState(() => new Set(DIAG.map(g => g.id)))
  const drill = useDrill()

  /* Kỳ phân tích = kỳ trên thanh lọc GIAO với cửa sổ có dữ liệu ads.
     Ads chỉ có từ 2026-04 nên nếu kỳ chọn nằm ngoài thì phải nói rõ,
     không được im lặng đổi kỳ hay chia cho 0. */
  const win = useMemo(() => {
    const a = toYm(filters.from), b = toYm(filters.to)
    const inSel = ADS_MONTHS.filter(m => m >= a && m <= b)
    return {
      months: inSel,
      selFrom: filters.from, selTo: filters.to,
      empty: inSel.length === 0,
      clipped: inSel.length > 0 && (a < ADS_MONTHS[0] || b > ADS_MONTHS[ADS_MONTHS.length - 1]),
    }
  }, [filters.from, filters.to])

  const d = useMemo(() => {
    /* Dùng ĐÚNG bộ lọc chung ở thanh trên: ngành hàng, loại hình, tìm kiếm.
       Không dựng bộ lọc riêng để tránh hai chỗ lọc mâu thuẫn nhau. */
    const q = (filters.q || '').toLowerCase()
    const inNg = r => {
      if (filters.nganh && r.nganh !== filters.nganh) return false
      if (filters.loaiHinh && r.class_name !== filters.loaiHinh) return false
      if (q && !((r.item_name || '').toLowerCase().includes(q)
              || (r.class_name || '').toLowerCase().includes(q))) return false
      return true
    }
    const MW = win.months
    const hasSkuFilter = !!(filters.nganh || filters.loaiHinh || filters.q)

    const items = mkt.items.filter(r => MW.includes(r.ym) && inNg(r))
    const sum = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0)

    const exp = sum(items, 'expense')
    const imp = sum(items, 'impression')
    const clk = sum(items, 'clicks')
    const adsOrd = sum(items, 'ads_order')
    const adsGmv = sum(items, 'ads_gmv')
    const gmv = sum(items, 'gmv')
    const rev = sum(items, 'rev')
    const cogs = sum(items, 'cogs')
    const netRate = gmv > 0 ? rev / gmv : 0
    const feeRate = (() => {
      const w = mkt.items.filter(r => MW.includes(r.ym))
      const t = w.reduce((s, r) => s + (r.rev || 0) * (r.fee_rate || 0), 0)
      const b = w.reduce((s, r) => s + (r.rev || 0), 0)
      return b > 0 ? t / b : 0
    })()
    const gm = rev > 0 ? (rev - cogs) / rev : 0
    const beRoas = beOf(gm, feeRate)
    const kpi = {
      exp, imp, clk, adsOrd, adsGmv, gmv, rev, cogs, netRate, feeRate, gm, beRoas,
      ctr: imp > 0 ? clk / imp : 0,
      cr: clk > 0 ? adsOrd / clk : 0,
      cpc: clk > 0 ? exp / clk : 0,
      cpo: adsOrd > 0 ? exp / adsOrd : 0,
      roasS: exp > 0 ? adsGmv / exp : 0,
      roasR: exp > 0 ? (adsGmv * netRate) / exp : 0,
      acos: adsGmv > 0 ? exp / adsGmv : 0,
      tacos: rev > 0 ? exp / rev : 0,
      adsShare: gmv > 0 ? adsGmv / gmv : 0,
      ln: rev - cogs - rev * feeRate - exp,
      ordNet: adsOrd * netRate,
    }

    /* chuỗi theo tháng — tính lại toàn bộ chỉ số phễu từ dữ liệu ĐÃ LỌC,
       không lấy chỉ số cấp shop (sai khi lọc theo ngành / loại hình). */
    const series = mkt.months.filter(m => MW.includes(m.ym)).map(m => {
      const rs = items.filter(r => r.ym === m.ym)
      const S = k => rs.reduce((a, r) => a + (r[k] || 0), 0)
      const e = S('expense'), imp = S('impression'), clk = S('clicks')
      const ord = S('ads_order'), ag = S('ads_gmv')
      const g = S('gmv'), rv = S('rev'), cg = S('cogs')
      const nr = g > 0 ? rv / g : 0
      const feeAmt = rs.reduce((a, r) => a + (r.rev || 0) * (r.fee_rate || 0), 0)
      const fr = rv > 0 ? feeAmt / rv : 0
      const gmM = rv > 0 ? (rv - cg) / rv : 0
      const be = beOf(gmM, fr)
      const ln = rv - cg - feeAmt - e
      return {
        label: m.ym.slice(2).replace('-', '.'),
        ads: e / 1e6,
        adsKhac: hasSkuFilter ? 0 : Math.max(0, (m.ads_khac || 0)) / 1e6,
        roasS: e > 0 ? ag / e : null,
        roasR: e > 0 ? (ag * nr) / e : null,
        beRoas: be,
        beRoasPlot: be == null ? null : Math.min(be, BE_CAP),
        netRate: nr,
        rev: rv / 1e6, cogs: cg / 1e6, fee: feeAmt / 1e6, ln: ln / 1e6,
        imp, clk, ord, ordNet: ord * nr,
        ctr: imp > 0 ? clk / imp : null,
        cr: clk > 0 ? ord / clk : null,
        cpc: clk > 0 ? e / clk : null,
        cpcK: clk > 0 ? e / clk / 1e3 : null,
        cpo: ord > 0 ? e / ord / 1e6 : null,
        /* mỗi đồng doanh thu đi đâu — quy về % để so giữa các tháng */
        pCogs: rv > 0 ? 100 * cg / rv : 0,
        pFee: rv > 0 ? 100 * feeAmt / rv : 0,
        pAds: rv > 0 ? 100 * e / rv : 0,
        pLn: rv > 0 ? 100 * ln / rv : 0,
      }
    })

    /* theo ngành hàng: chi phí ads vs doanh thu — đầu tư lệch ở đâu */
    const ngMap = new Map()
    for (const r of mkt.nganh.filter(x => MW.includes(x.ym)
                                         && (!filters.nganh || x.nganh === filters.nganh))) {
      const t = ngMap.get(r.nganh) || {
        nganh: r.nganh, expense: 0, rev: 0, gmv: 0, cogs: 0, ads_gmv: 0,
        clicks: 0, impression: 0, ads_order: 0, ln_sau_ads: 0,
      }
      for (const k of ['expense', 'rev', 'gmv', 'cogs', 'ads_gmv', 'clicks',
                       'impression', 'ads_order', 'ln_sau_ads']) t[k] += r[k] || 0
      ngMap.set(r.nganh, t)
    }
    const totExp = [...ngMap.values()].reduce((s, x) => s + x.expense, 0)
    const totRev = [...ngMap.values()].reduce((s, x) => s + x.rev, 0)
    const byNganh = [...ngMap.values()].map(x => {
      const gmN = x.rev > 0 ? (x.rev - x.cogs) / x.rev : null
      return {
        ...x,
        shareExp: totExp > 0 ? x.expense / totExp : 0,
        shareRev: totRev > 0 ? x.rev / totRev : 0,
        tacos: x.rev > 0 ? x.expense / x.rev : null,
        netRate: x.gmv > 0 ? x.rev / x.gmv : null,
        roasR: x.expense > 0 && x.gmv > 0 ? x.ads_gmv * (x.rev / x.gmv) / x.expense : null,
        gm: gmN,
        beRoas: beOf(gmN, feeRate),
      }
    }).sort((a, b) => b.expense - a.expense)

    /* theo sản phẩm (gộp toàn cửa sổ ads) */
    const itMap = new Map()
    for (const r of items) {
      const t = itMap.get(r.item_id) || {
        item_id: r.item_id, item_name: r.item_name, nganh: r.nganh, class_name: r.class_name,
        expense: 0, impression: 0, clicks: 0, ads_order: 0, ads_gmv: 0,
        gmv: 0, rev: 0, cogs: 0, un: 0, so_chien_dich: 0,
      }
      for (const k of ['expense', 'impression', 'clicks', 'ads_order', 'ads_gmv', 'gmv', 'rev', 'cogs', 'un']) t[k] += r[k] || 0
      t.so_chien_dich = Math.max(t.so_chien_dich, r.so_chien_dich || 0)
      t.item_name = t.item_name || r.item_name
      t.nganh = t.nganh || r.nganh
      itMap.set(r.item_id, t)
    }
    const byItem = [...itMap.values()].map(x => {
      const nr = x.gmv > 0 ? x.rev / x.gmv : null
      const gmI = x.rev > 0 ? (x.rev - x.cogs) / x.rev : null
      const be = beOf(gmI, feeRate)
      return {
        ...x,
        ctr: x.impression > 0 ? x.clicks / x.impression : null,
        cr: x.clicks > 0 ? x.ads_order / x.clicks : null,
        cpc: x.clicks > 0 ? x.expense / x.clicks : null,
        cpo: x.ads_order > 0 ? x.expense / x.ads_order : null,
        roas_shopee: x.expense > 0 ? x.ads_gmv / x.expense : null,
        roas_thuc: x.expense > 0 && nr != null ? x.ads_gmv * nr / x.expense : null,
        net_rate: nr, gm: gmI, roas_hoa_von: be,
        tacos: x.rev > 0 ? x.expense / x.rev : null,
        ads_share: x.gmv > 0 ? x.ads_gmv / x.gmv : null,
        ln_sau_ads: x.rev - x.cogs - x.rev * feeRate - x.expense,
      }
    }).sort((a, b) => b.expense - a.expense)
    byItem.forEach(r => { r.diag = diagnose(r) })

    /* theo chiến dịch — hiệu năng gom lại theo ĐÚNG kỳ đang chọn,
       không dùng số luỹ kế toàn cửa sổ ads. */
    const full = MW.length === ADS_MONTHS.length
    const cmPerf = new Map()
    for (const r of mkt.campaignMonths) {
      if (!MW.includes(r.ym)) continue
      const t2 = cmPerf.get(r.campaign_id) || { expense: 0, impression: 0, clicks: 0, ads_order: 0, ads_gmv: 0, so_ngay: 0 }
      for (const k of ['expense', 'impression', 'clicks', 'ads_order', 'ads_gmv', 'so_ngay']) t2[k] += r[k] || 0
      cmPerf.set(r.campaign_id, t2)
    }
    /* byItem là mảng đã tính chỉ số phái sinh — phải tra ở ĐÂY, không tra itMap
       (itMap chỉ giữ số cộng dồn thô, không có net_rate / roas_hoa_von). */
    const itDer = new Map(byItem.map(x => [x.item_id, x]))
    const camps = mkt.campaigns
      .map(c => {
        const info = ITEM_INFO[c.item_id] || {}
        const it = itDer.get(c.item_id)
        const pf = cmPerf.get(c.campaign_id) || { expense: 0, impression: 0, clicks: 0, ads_order: 0, ads_gmv: 0, so_ngay: 0 }
        const nr = it?.net_rate ?? c.net_rate ?? null
        return {
          ...c, ...pf,
          nganh: info.nganh || '—',
          class_name: info.class_name || null,
          roas_hoa_von: it?.roas_hoa_von ?? null,
          net_rate: nr,
          ctr: pf.impression > 0 ? pf.clicks / pf.impression : null,
          cr: pf.clicks > 0 ? pf.ads_order / pf.clicks : null,
          cpc: pf.clicks > 0 ? pf.expense / pf.clicks : null,
          cpo: pf.ads_order > 0 ? pf.expense / pf.ads_order : null,
          roas_shopee: pf.expense > 0 ? pf.ads_gmv / pf.expense : null,
          roas_thuc: pf.expense > 0 && nr != null ? pf.ads_gmv * nr / pf.expense : null,
        }
      })
      .filter(c => {
        if (filters.nganh && c.nganh !== filters.nganh) return false
        if (filters.loaiHinh && c.class_name !== filters.loaiHinh) return false
        if (q && !((c.ad_name || '').toLowerCase().includes(q)
                || (c.class_name || '').toLowerCase().includes(q))) return false
        return true
      })
      .sort((a, b) => b.expense - a.expense)
    camps.forEach(c => { c.diag = diagnose(c) })

    /* gom theo nhóm chẩn đoán */
    const diagGroups = DIAG.map(g => {
      const rows = camps.filter(c => c.diag === g.id)
      return { ...g, rows, expense: rows.reduce((s, r) => s + (r.expense || 0), 0), budget: rows.reduce((s, r) => s + (r.budget || 0), 0) }
    }).filter(g => g.rows.length)

    return { kpi, series, byNganh, byItem, camps, diagGroups, items, full }
  }, [win, filters.nganh, filters.loaiHinh, filters.q])

  const { kpi, series, byNganh, byItem, camps, diagGroups } = d

  const KPI = [
    { k: 'Chi phí quảng cáo', v: trieu(kpi.exp), u: 'triệu', sub: `${num(kpi.imp)} hiển thị · ${num(kpi.clk)} click`, tone: 'blue' },
    { k: 'ROAS Shopee', v: fmtRoas(kpi.roasS), u: 'trên GMV', sub: 'số Shopee báo — tính cả đơn bị huỷ', tone: 'grey' },
    { k: 'ROAS thật', v: fmtRoas(kpi.roasR), u: 'trên doanh thu', sub: `sau khi trừ huỷ/hoàn/giảm giá (${pct(kpi.netRate)})`, tone: kpi.beRoas && kpi.roasR >= kpi.beRoas ? 'good' : 'bad' },
    { k: 'ROAS hoà vốn', v: fmtBe(kpi.beRoas), u: 'ngưỡng phải vượt', sub: `GM ${pct(kpi.gm)} − phí sàn ${pct(kpi.feeRate)}`, tone: 'amber' },
    { k: 'Chi phí / đơn', v: trieu(kpi.cpo, 2), u: 'triệu/đơn ads', sub: `CPC ${num(kpi.cpc)} đ · CTR ${pct(kpi.ctr, 2)}`, tone: 'grey' },
    { k: 'TACOS', v: pct(kpi.tacos, 1), u: 'ads ÷ doanh thu', sub: `ads đóng ${pct(kpi.adsShare)} GMV sản phẩm được QC`, tone: 'grey' },
  ]

  /* Phễu: Lượt xem → Lượt click → Lượt mua → Đơn thành công,
     kèm tỷ lệ click / tỷ lệ chuyển đổi / tỷ lệ thành công ở khe giữa các bậc. */
  const funnel = [
    { k: 'Lượt xem', v: kpi.imp, label: num(kpi.imp), note: 'quảng cáo được hiển thị' },
    {
      k: 'Lượt click', v: kpi.clk, label: num(kpi.clk), note: 'khách bấm vào sản phẩm',
      rateLabel: `Tỷ lệ click (CTR) ${pct(kpi.ctr, 2)}`, bad: kpi.ctr < 0.015,
    },
    {
      k: 'Lượt mua', v: kpi.adsOrd, label: num(Math.round(kpi.adsOrd)), note: 'đơn phát sinh từ ads',
      rateLabel: `Tỷ lệ chuyển đổi (CR) ${pct(kpi.cr, 2)}`, bad: kpi.cr < 0.005,
    },
    {
      k: 'Đơn thành công', v: kpi.ordNet, label: num(Math.round(kpi.ordNet)),
      note: 'sau khi trừ huỷ & hoàn',
      rateLabel: `Tỷ lệ thành công ${pct(kpi.netRate)}`, bad: kpi.netRate < 0.5,
    },
  ]

  const verdict = (() => {
    if (!kpi.exp) return { tone: 'grey', t: 'Không có chi phí quảng cáo trong kỳ.' }
    const worst = diagGroups.filter(g => ['cancel', 'margin', 'cr', 'ctr', 'reach'].includes(g.id))
      .sort((a, b) => b.expense - a.expense)[0]
    const ok = kpi.beRoas && kpi.roasR >= kpi.beRoas
    return {
      tone: ok ? 'green' : 'red',
      t: ok
        ? `ROAS thật ${fmtRoas(kpi.roasR)} vượt điểm hoà vốn ${fmtBe(kpi.beRoas)} — quảng cáo đang sinh lời.`
        : `ROAS thật chỉ ${fmtRoas(kpi.roasR)} so với điểm hoà vốn ${fmtBe(kpi.beRoas)}. `
          + `Shopee báo ROAS ${fmtRoas(kpi.roasS)} vì tính cả đơn bị huỷ — chỉ ${pct(kpi.netRate)} GMV thật sự thành doanh thu.`
          + (worst ? ` Mắt vỡ nặng nhất: ${DIAG_MAP[worst.id].label.toLowerCase()} (${trieu(worst.expense)} tr).` : ''),
    }
  })()

  return (
    <div className="mk-page">
      <div className="m2-title">
        <div>
          <span>MARKETING · SHOPEE ADS</span>
          <h2>Marketing Analysis</h2>
          <p>
            Hiệu quả quảng cáo theo chiến dịch → sản phẩm → ngành hàng, đối chiếu với đơn hàng thật
            để trả lời <b>vì sao</b> tiền quảng cáo có hoặc không sinh lời.
            {' '}Kỳ đang xem: <b>{win.months.length ? `${toDot(win.months[0])} → ${toDot(win.months[win.months.length - 1])}` : '—'}</b>
            {' '}({win.months.length} tháng). Dữ liệu ads chỉ có từ <b>{toDot(ADS_MONTHS[0])}</b> vì
            API Shopee chỉ lưu khoảng 5 tháng lịch sử.
          </p>
        </div>
      </div>

      <div className="mk-tabbar">
        <div className="mk-tabs">
          {[['overview', 'Tổng quan', null],
            ['campaign', 'Theo chiến dịch', camps.length],
            ['item', 'Theo sản phẩm', byItem.length],
            ['nganh', 'Theo ngành hàng', byNganh.length],
            ['diag', 'Chẩn đoán & hành động', diagGroups.length],
            ['method', 'Cách tính', null]].map(([id, lb, n]) => (
              <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                <span className="ic" aria-hidden>{TAB_IC[id]}</span>
                {lb}
                {n != null && <em>{n}</em>}
              </button>
            ))}
        </div>
      </div>

      <div className="m2-filter">
        <b>Phạm vi:</b>
        <label>Ngành hàng
          <select value={filters.nganh} onChange={e => setFilters(f => ({ ...f, nganh: e.target.value }))}>
            <option value="">Tất cả</option>
            {NGANH.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>Loại hình
          <select value={filters.loaiHinh} onChange={e => setFilters(f => ({ ...f, loaiHinh: e.target.value }))}>
            <option value="">Tất cả</option>
            {LOAI_HINH.filter(c => !filters.nganh || NG_OF[c] === filters.nganh)
              .map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <span className="hint">— dùng chung bộ lọc ở thanh trên, áp dụng cho KPI, phễu, biểu đồ và mọi bảng</span>
      </div>

      {win.empty ? (
        <div className="mk-empty">
          <b>Kỳ đang chọn không có dữ liệu quảng cáo</b>
          <p>
            Thanh lọc đang ở <b>{win.selFrom} → {win.selTo}</b>, nhưng API ads của Shopee chỉ trả về
            từ <b>{toDot(ADS_MONTHS[0])}</b> đến <b>{toDot(ADS_MONTHS[ADS_MONTHS.length - 1])}</b>.
            Các tháng trước đó là <b>không có dữ liệu</b>, không phải bằng 0 — nên màn này để trống
            thay vì hiển thị số sai.
          </p>
          <button onClick={() => setFilters(f => ({
            ...f, from: toDot(ADS_MONTHS[0]), to: toDot(ADS_MONTHS[ADS_MONTHS.length - 1]),
          }))}>
            Xem kỳ có dữ liệu ads ({toDot(ADS_MONTHS[0])} → {toDot(ADS_MONTHS[ADS_MONTHS.length - 1])})
          </button>
        </div>
      ) : (
        <>
      {win.clipped && (
        <div className="mk-clip">
          Kỳ chọn <b>{win.selFrom} → {win.selTo}</b> rộng hơn phạm vi ads có sẵn — các số dưới đây
          chỉ tính trên <b>{toDot(win.months[0])} → {toDot(win.months[win.months.length - 1])}</b>.
        </div>
      )}
      <div className={`mk-verdict ${verdict.tone}`}>
        <b>Vì sao</b>
        <p>{verdict.t}</p>
      </div>

      <div className="mk-kpis">
        {KPI.map(x => (
          <div key={x.k} className={`mk-kpi ${x.tone}`}>
            <span className="k">{x.k}</span>
            <strong>{x.v}<em>{x.u}</em></strong>
            <span className="sub">{x.sub}</span>
          </div>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab kpi={kpi} funnel={funnel} series={series} />}
      {tab === 'campaign' && <CampaignTab rows={camps} beAll={kpi.beRoas} />}
      {tab === 'item' && <ItemTab rows={byItem} drill={drill} />}
      {tab === 'nganh' && <NganhTab rows={byNganh} beAll={kpi.beRoas} />}
      {tab === 'diag' && <DiagTab groups={diagGroups} openNg={openNg} setOpenNg={setOpenNg} />}
      {tab === 'method' && <MethodTab kpi={kpi} />}
        </>
      )}
    </div>
  )
}

/* ================= TAB: TỔNG QUAN =================
   Nơi DUY NHẤT hiển thị phễu và biểu đồ chi phí/ROAS theo tháng.
   Các tab cấp dưới chỉ hiển thị biểu đồ của đúng cấp đó, không lặp lại. */
/* Chú giải dùng chung: mọi biểu đồ có từ 2 chỉ số trở lên đều phải có nhãn,
   và với biểu đồ 2 trục thì nhãn ghi luôn chỉ số đó đọc ở trục nào. */
/* Kiểu đường mềm, thống nhất với màn Tổng quan. Dùng 'monotone' để không tạo
   đỉnh/đáy ảo. Trên 14 mốc thì bỏ điểm cố định, chỉ hiện khi trỏ vào. */
const SOFT = { type: 'monotone', strokeLinecap: 'round', strokeLinejoin: 'round' }
const dotOf = (c, n) => (n > 14 ? false : { r: 3.2, fill: '#fff', stroke: c, strokeWidth: 2 })
const actOf = c => ({ r: 5.5, fill: '#fff', stroke: c, strokeWidth: 2.5 })

const LEG = {
  verticalAlign: 'top', align: 'left', height: 26, iconSize: 10,
  wrapperStyle: { fontSize: 10.5, color: '#6E739B', paddingLeft: 26, paddingBottom: 2, lineHeight: '15px' },
}

function OverviewTab({ kpi, funnel, series }) {
  const A = { grid: C.grid, axis: C.axis }
  const ax = { tick: { fontSize: 10, fill: C.axis }, axisLine: false, tickLine: false }

  return (
    <>
      <div className="mk-row2">
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Phễu quảng cáo</h3>
            <span>Bậc cuối là bậc Shopee KHÔNG báo: đơn còn lại sau huỷ &amp; hoàn</span>
          </div>
          <FunnelChart stages={funnel} />
          <p className="mk-note">
            Tỷ lệ click và tỷ lệ chuyển đổi là phần <b>marketing</b> kiểm soát được.
            Bậc cuối — chỉ {pct(kpi.netRate)} còn lại sau huỷ &amp; hoàn — là <b>vận hành &amp; giá</b>,
            nhưng tiền quảng cáo thì đã tiêu rồi. Bề rộng vẽ theo thang căn bậc hai.
          </p>
        </section>

        <section className="m2-panel">
          <div className="m2-head">
            <h3>Chi phí quảng cáo &amp; ROAS theo tháng</h3>
            <span>Cột = chi phí (triệu) · đường cam = ROAS thật · đường xám = ROAS Shopee ·
              đường đỏ gạch = điểm hoà vốn (chặn trần {BE_CAP})</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={A.grid} vertical={false} />
              <XAxis dataKey="label" {...ax} />
              <YAxis yAxisId="l" {...ax} />
              <YAxis yAxisId="r" orientation="right" {...ax} />
              <Tooltip content={<TipBox rows={p => [
                ['Chi phí chiến dịch SP', `${num(p.ads, 2)} tr`],
                ['Chi phí ads khác', `${num(p.adsKhac, 2)} tr`],
                ['ROAS Shopee', fmtRoas(p.roasS)],
                ['ROAS thật', fmtRoas(p.roasR), p.beRoas && p.roasR < p.beRoas ? 'bad' : 'good'],
                ['ROAS hoà vốn', fmtBe(p.beRoas)],
                ['Tỷ lệ thành công đơn', pct(p.netRate)],
                ['LN sau ads', `${num(p.ln, 1)} tr`, p.ln < 0 ? 'bad' : 'good'],
              ]} />} />
              <Legend {...LEG} height={42} />
              <Bar yAxisId="l" dataKey="ads" name="Chi phí chiến dịch SP · tr (trái)" stackId="a" fill={C.ads} barSize={26} />
              <Bar yAxisId="l" dataKey="adsKhac" name="Chi phí ads khác · tr (trái)" stackId="a" fill={C.adsOther} barSize={26} radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" {...SOFT} dataKey="roasS" name="ROAS Shopee (phải)" stroke={C.roasS} strokeWidth={1.8} strokeDasharray="5 4" dot={false} activeDot={actOf(C.roasS)} />
              <Line yAxisId="r" {...SOFT} dataKey="roasR" name="ROAS thật (phải)" stroke={C.roasR} strokeWidth={2.6} dot={dotOf(C.roasR, series.length)} activeDot={actOf(C.roasR)} />
              <Line yAxisId="r" {...SOFT} dataKey="beRoasPlot" name="ROAS hoà vốn (phải)" stroke={C.be} strokeWidth={1.5} strokeDasharray="3 4" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mk-note">
            Khoảng cách giữa đường xám và đường cam chính là phần <b>ROAS ảo</b> do đơn huỷ.
            Đường cam nằm dưới đường đỏ tháng nào thì tháng đó quảng cáo lỗ.
          </p>
        </section>
      </div>

      <div className="mk-row2">
        {/* 3. CTR & CPC — chất lượng hiển thị và giá mỗi click */}
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Tỷ lệ click (CTR) &amp; giá mỗi click (CPC)</h3>
            <span>Cột = CPC (nghìn đồng/click) · đường = CTR. CTR tăng mà CPC cũng tăng nghĩa là
              cạnh tranh đấu giá đang đắt lên</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={A.grid} vertical={false} />
              <XAxis dataKey="label" {...ax} />
              <YAxis yAxisId="l" {...ax} unit="k" />
              <YAxis yAxisId="r" orientation="right" {...ax} tickFormatter={v => `${num(v * 100, 1)}%`} />
              <Tooltip content={<TipBox rows={p => [
                ['CPC', `${num(p.cpc)} đ/click`],
                ['CTR', p.ctr != null ? pct(p.ctr, 2) : '—', p.ctr < 0.015 ? 'bad' : 'good'],
                ['Lượt xem', num(p.imp)],
                ['Lượt click', num(p.clk)],
              ]} />} />
              <Legend {...LEG} />
              <Bar yAxisId="l" dataKey="cpcK" name="CPC · nghìn đ/click (trái)" fill={C.ads} barSize={24} radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" {...SOFT} dataKey="ctr" name="Tỷ lệ click CTR (phải)" stroke={C.roasR} strokeWidth={2.6} dot={dotOf(C.roasR, series.length)} activeDot={actOf(C.roasR)} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        {/* 4. CR & Chi phí/đơn */}
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Tỷ lệ chuyển đổi (CR) &amp; chi phí mỗi đơn</h3>
            <span>Cột = chi phí/đơn ads (triệu) · đường = CR. Chi phí/đơn tăng trong khi CR đứng
              nghĩa là phải trả đắt hơn cho cùng một đơn</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={A.grid} vertical={false} />
              <XAxis dataKey="label" {...ax} />
              <YAxis yAxisId="l" {...ax} />
              <YAxis yAxisId="r" orientation="right" {...ax} tickFormatter={v => `${num(v * 100, 1)}%`} />
              <Tooltip content={<TipBox rows={p => [
                ['Chi phí / đơn', p.cpo != null ? `${num(p.cpo, 2)} tr` : '—'],
                ['CR', p.cr != null ? pct(p.cr, 2) : '—', p.cr < 0.005 ? 'bad' : 'good'],
                ['Lượt mua', num(Math.round(p.ord))],
                ['Đơn thành công', num(Math.round(p.ordNet))],
              ]} />} />
              <Legend {...LEG} />
              <Bar yAxisId="l" dataKey="cpo" name="Chi phí/đơn · tr (trái)" fill={C.blue2} barSize={24} radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" {...SOFT} dataKey="cr" name="Tỷ lệ chuyển đổi CR (phải)" stroke={C.roasR} strokeWidth={2.6} dot={dotOf(C.roasR, series.length)} activeDot={actOf(C.roasR)} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
      </div>

      <div className="mk-row2">
        {/* 5. Lưu lượng: lượt xem & lượt click */}
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Lưu lượng quảng cáo: lượt xem &amp; lượt click</h3>
            <span>Vùng tô = lượt xem · đường = lượt click. Lượt xem tụt là dấu hiệu ngân sách
              hoặc giá thầu bị cắt</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
              <defs>
                <linearGradient id="gImp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#353E99" stopOpacity={0.34} />
                  <stop offset="100%" stopColor="#353E99" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={A.grid} vertical={false} />
              <XAxis dataKey="label" {...ax} />
              <YAxis yAxisId="l" {...ax} tickFormatter={v => `${num(v / 1000)}k`} />
              <YAxis yAxisId="r" orientation="right" {...ax} />
              <Tooltip content={<TipBox rows={p => [
                ['Lượt xem', num(p.imp)],
                ['Lượt click', num(p.clk)],
                ['CTR', p.ctr != null ? pct(p.ctr, 2) : '—'],
              ]} />} />
              <Legend {...LEG} />
              <Area yAxisId="l" {...SOFT} dataKey="imp" name="Lượt xem (trái)"
                stroke="#353E99" strokeWidth={2.2} fill="url(#gImp)" activeDot={actOf('#353E99')} />
              <Line yAxisId="r" {...SOFT} dataKey="clk" name="Lượt click (phải)"
                stroke={C.amber} strokeWidth={2.6} dot={dotOf(C.amber, series.length)} activeDot={actOf(C.amber)} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        {/* 6. Tỷ lệ thành công đơn */}
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Tỷ lệ thành công của đơn</h3>
            <span>Phần GMV thật sự thành doanh thu sau huỷ &amp; hoàn · đường đỏ gạch = ngưỡng 50%,
              dưới mức này quảng cáo gần như không thể có lãi</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="gNr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#D97706" stopOpacity={0.42} />
                  <stop offset="100%" stopColor="#D97706" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={A.grid} vertical={false} />
              <XAxis dataKey="label" {...ax} />
              <YAxis {...ax} domain={[0, 1]} tickFormatter={v => `${num(v * 100)}%`} />
              <Tooltip content={<TipBox rows={p => [
                ['Tỷ lệ thành công', pct(p.netRate), p.netRate < 0.5 ? 'bad' : 'good'],
                ['Doanh thu', `${num(p.rev, 1)} tr`],
              ]} />} />
              <ReferenceLine y={0.5} stroke={C.be} strokeDasharray="4 3"
                label={{ value: '50%', position: 'insideTopRight', fontSize: 9.5, fill: C.be }} />
              <Legend {...LEG} />
              <Area {...SOFT} dataKey="netRate" name="Tỷ lệ thành công của đơn"
                stroke="#D97706" strokeWidth={2.6} fill="url(#gNr)"
                dot={dotOf('#D97706', series.length)} activeDot={actOf('#D97706')} />
            </AreaChart>
          </ResponsiveContainer>
        </section>
      </div>

      <div className="mk-row2">
        {/* 7. Ads so với doanh thu và lợi nhuận */}
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Chi phí quảng cáo so với doanh thu &amp; lợi nhuận</h3>
            <span>Cột xanh = doanh thu · cột cam = chi phí ads (trục trái) ·
              đường xanh = LN sau giá vốn, phí sàn và ads (trục phải) · đơn vị triệu đồng</span>
          </div>
          <ResponsiveContainer width="100%" height={268}>
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={A.grid} vertical={false} />
              <XAxis dataKey="label" {...ax} />
              <YAxis yAxisId="l" {...ax} />
              <YAxis yAxisId="r" orientation="right" {...ax} />
              <Tooltip content={<TipBox rows={p => [
                ['Doanh thu', `${num(p.rev, 1)} tr`],
                ['Giá vốn', `${num(p.cogs, 1)} tr`],
                ['Phí sàn', `${num(p.fee, 1)} tr`],
                ['Chi phí ads', `${num(p.ads, 2)} tr`],
                ['LN sau ads', `${num(p.ln, 1)} tr`, p.ln < 0 ? 'bad' : 'good'],
              ]} />} />
              <ReferenceLine yAxisId="r" y={0} stroke="#B9BDD8" strokeDasharray="3 3" />
              <Legend {...LEG} />
              <Bar yAxisId="l" dataKey="rev" name="Doanh thu · tr (trái)" fill={C.ads} barSize={16} radius={[3, 3, 0, 0]} />
              <Bar yAxisId="l" dataKey="ads" name="Chi phí ads · tr (trái)" fill={C.roasR} barSize={16} radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" {...SOFT} dataKey="ln" name="LN sau ads · tr (phải)" stroke={C.good}
                strokeWidth={2.6} dot={dotOf(C.good, series.length)} activeDot={actOf(C.good)} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        {/* 8. Mỗi đồng doanh thu đi đâu */}
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Mỗi 100 đồng doanh thu đi đâu</h3>
            <span>Cột chồng: giá vốn · phí sàn · quảng cáo · phần còn lại.
              Cột vượt mốc đỏ 100 đồng = chi phí đã ăn hết doanh thu, phần xanh tụt xuống dưới 0 là lỗ</span>
          </div>
          <ResponsiveContainer width="100%" height={268}>
            <BarChart data={series} stackOffset="sign" margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={A.grid} vertical={false} />
              <XAxis dataKey="label" {...ax} />
              <YAxis {...ax} unit="%" />
              <Tooltip content={<TipBox rows={p => [
                ['Giá vốn', `${num(p.pCogs, 1)}%`],
                ['Phí sàn', `${num(p.pFee, 1)}%`],
                ['Quảng cáo', `${num(p.pAds, 1)}%`],
                ['Còn lại', `${num(p.pLn, 1)}%`, p.pLn < 0 ? 'bad' : 'good'],
              ]} />} />
              <ReferenceLine y={0} stroke="#B9BDD8" />
              <ReferenceLine y={100} stroke={C.be} strokeDasharray="4 3"
                label={{ value: 'hết 100 đồng', position: 'insideTopRight',
                         fontSize: 9.5, fill: C.be }} />
              <Legend verticalAlign="top" height={26} iconSize={9}
                wrapperStyle={{ fontSize: 10.5, color: '#6E739B' }}
                payload={[
                  { value: 'Giá vốn', type: 'square', color: '#232A6B' },
                  { value: 'Phí sàn', type: 'square', color: '#5C67C4' },
                  { value: 'Quảng cáo', type: 'square', color: '#D97706' },
                  { value: 'Còn lại', type: 'square', color: '#1F7A45' },
                ]} />
              <Bar dataKey="pCogs" name="Giá vốn" stackId="s" fill="#232A6B" barSize={30} />
              <Bar dataKey="pFee" name="Phí sàn" stackId="s" fill="#5C67C4" barSize={30} />
              <Bar dataKey="pAds" name="Quảng cáo" stackId="s" fill="#D97706" barSize={30} />
              <Bar dataKey="pLn" name="Còn lại" stackId="s" fill="#1F7A45" barSize={30} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>
    </>
  )
}

/* ================= TAB: CHIẾN DỊCH ================= */
function CampaignTab({ rows, beAll }) {
  const [only, setOnly] = useState('spend')      // spend | all
  const list = only === 'spend' ? rows.filter(r => r.expense > 0) : rows
  const tot = k => list.reduce((s, r) => s + (r[k] || 0), 0)

  /* Biểu đồ danh mục chiến dịch: trục X = tiền đã tiêu, trục Y = ROAS thật,
     kích thước bóng = GMV ads. Đường ngang = điểm hoà vốn. Bóng nằm dưới đường
     và lệch về phải = đang đốt nhiều tiền nhất mà không hoà vốn. */
  const pts = rows.filter(r => r.expense > 0).map(r => ({
    x: r.expense / 1e6,
    y: r.roas_thuc || 0,
    z: Math.max(1, (r.ads_gmv || 0) / 1e6),
    name: r.ad_name, nganh: r.nganh, diag: r.diag,
    be: r.roas_hoa_von, ctr: r.ctr, cr: r.cr, netRate: r.net_rate,
  }))
  const TONE = { red: C.be, amber: '#D97706', green: C.good, grey: '#8E93B5' }

  return (
    <>
      <section className="m2-panel">
        <div className="m2-head">
          <h3>Danh mục chiến dịch: tiền tiêu so với ROAS thật</h3>
          <span>Mỗi bóng là 1 chiến dịch · bóng càng lớn = GMV ads càng cao ·
            đường đỏ gạch = điểm hoà vốn {fmtBe(beAll)} · màu theo chẩn đoán</span>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 12, right: 20, left: -6, bottom: 14 }}>
            <CartesianGrid stroke={C.grid} />
            <XAxis type="number" dataKey="x" name="Chi phí"
              tick={{ fontSize: 10, fill: C.axis }} axisLine={false} tickLine={false}
              label={{ value: 'Chi phí quảng cáo (triệu đồng)', position: 'insideBottom',
                       offset: -8, fontSize: 10, fill: C.axis }} />
            <YAxis type="number" dataKey="y" name="ROAS thật"
              tick={{ fontSize: 10, fill: C.axis }} axisLine={false} tickLine={false}
              label={{ value: 'ROAS thật', angle: -90, position: 'insideLeft',
                       offset: 16, fontSize: 10, fill: C.axis }} />
            <ZAxis type="number" dataKey="z" range={[60, 700]} />
            {beAll != null && beAll <= BE_CAP &&
              <ReferenceLine y={beAll} stroke={C.be} strokeDasharray="4 3"
                label={{ value: `hoà vốn ${num(beAll, 1)}`, position: 'insideTopRight',
                         fontSize: 9.5, fill: C.be, offset: 6 }} />}
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload
              return (
                <div className="mk-tip">
                  <b>{(p.name || '').slice(0, 58)}</b>
                  <div><span>Ngành</span><em>{p.nganh}</em></div>
                  <div><span>Chi phí</span><em>{num(p.x, 2)} tr</em></div>
                  <div className={p.be != null && p.y < p.be ? 'bad' : 'good'}>
                    <span>ROAS thật</span><em>{fmtRoas(p.y)}</em></div>
                  <div><span>Hoà vốn</span><em>{fmtBe(p.be)}</em></div>
                  <div><span>Tỷ lệ click</span><em>{p.ctr != null ? pct(p.ctr, 2) : '—'}</em></div>
                  <div><span>Tỷ lệ chuyển đổi</span><em>{p.cr != null ? pct(p.cr, 2) : '—'}</em></div>
                  <div className={p.netRate != null && p.netRate < 0.5 ? 'bad' : ''}>
                    <span>Tỷ lệ thành công</span><em>{p.netRate != null ? pct(p.netRate) : '—'}</em></div>
                  <div><span>Chẩn đoán</span><em>{DIAG_MAP[p.diag]?.label}</em></div>
                </div>
              )
            }} />
            <Scatter data={pts} fillOpacity={0.72}>
              {pts.map((p, i) => (
                <Cell key={i} fill={TONE[DIAG_MAP[p.diag]?.tone] || C.ads} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div className="mk-legend">
          {DIAG.filter(g => pts.some(p => p.diag === g.id)).map(g => (
            <span key={g.id}><i style={{ background: TONE[g.tone] }} />{g.label}</span>
          ))}
        </div>
      </section>
      <section className="m2-panel">
      <div className="m2-head">
        <h3>Hiệu quả từng chiến dịch</h3>
        <span>{rows.length} chiến dịch · {rows.filter(r => r.expense > 0).length} có phát sinh chi phí</span>
        <div className="group-ctrl">
          <button className={only === 'spend' ? 'on' : ''} onClick={() => setOnly('spend')}>Có chi phí</button>
          <button className={only === 'all' ? 'on' : ''} onClick={() => setOnly('all')}>Tất cả</button>
        </div>
      </div>
      <div className="m2-tablewrap">
        <table className="mk-table">
          <thead>
            <tr>
              <th>Chiến dịch</th><th>Ngành</th><th>Trạng thái</th><th>Đấu giá</th>
              <th className="num">Ngân sách/ngày</th><th className="num">Mục tiêu ROAS</th>
              <th className="num">Chi phí</th><th className="num">Hiển thị</th><th className="num">Click</th>
              <th className="num">CTR</th><th className="num">CR</th><th className="num">CPC</th>
              <th className="num">CP/đơn</th><th className="num">ROAS Shopee</th>
              <th className="num">ROAS thật</th><th className="num">Hoà vốn</th><th>Chẩn đoán</th>
            </tr>
          </thead>
          <tbody>
            {list.map(r => {
              const g = DIAG_MAP[r.diag]
              const bad = r.roas_hoa_von != null && (r.roas_thuc || 0) < r.roas_hoa_von
              return (
                <tr key={r.campaign_id}>
                  <td className="nm" title={r.ad_name}>{r.ad_name}</td>
                  <td>{r.nganh}</td>
                  <td><span className={`st st-${r.campaign_status}`}>{
                    { ongoing: 'Đang chạy', paused: 'Tạm dừng', ended: 'Đã kết thúc', closed: 'Đã đóng' }[r.campaign_status] || r.campaign_status
                  }</span></td>
                  <td>{r.bidding_method === 'auto' ? 'Tự động' : 'Thủ công'}</td>
                  <td className="num">{r.budget ? num(r.budget) : '—'}</td>
                  <td className="num">{r.roas_target ? num(r.roas_target, 1) : '—'}</td>
                  <td className="num b">{r.expense ? trieu(r.expense, 2) : '—'}</td>
                  <td className="num">{num(r.impression)}</td>
                  <td className="num">{num(r.clicks)}</td>
                  <td className="num">{r.ctr != null ? pct(r.ctr, 2) : '—'}</td>
                  <td className="num">{r.cr != null ? pct(r.cr, 2) : '—'}</td>
                  <td className="num">{r.cpc ? num(r.cpc) : '—'}</td>
                  <td className="num">{r.cpo ? trieu(r.cpo, 2) : '—'}</td>
                  <td className="num muted">{fmtRoas(r.roas_shopee)}</td>
                  <td className={`num b ${bad ? 'bad' : r.roas_thuc ? 'good' : ''}`}>{fmtRoas(r.roas_thuc)}</td>
                  <td className="num muted">{fmtBe(r.roas_hoa_von)}</td>
                  <td><span className={`tag t-${g.tone}`}>{g.label}</span></td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>Tổng {list.length} chiến dịch</td>
              <td className="num b">{trieu(tot('expense'), 2)}</td>
              <td className="num">{num(tot('impression'))}</td>
              <td className="num">{num(tot('clicks'))}</td>
              <td className="num">{pct(tot('impression') > 0 ? tot('clicks') / tot('impression') : 0, 2)}</td>
              <td className="num">{pct(tot('clicks') > 0 ? tot('ads_order') / tot('clicks') : 0, 2)}</td>
              <td className="num">{num(tot('clicks') > 0 ? tot('expense') / tot('clicks') : 0)}</td>
              <td className="num">{trieu(tot('ads_order') > 0 ? tot('expense') / tot('ads_order') : 0, 2)}</td>
              <td className="num">{fmtRoas(tot('expense') > 0 ? tot('ads_gmv') / tot('expense') : null)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
      </section>
    </>
  )
}

/* ================= TAB: SẢN PHẨM ================= */
function ItemTab({ rows, drill }) {
  /* Thanh ngang so ROAS thật với ROAS hoà vốn của từng sản phẩm — khoảng hụt
     giữa hai thanh chính là mức phải cải thiện mới hết lỗ. */
  const bars = rows.filter(r => r.expense > 0)
    .map(r => ({
      label: (r.class_name || r.item_name || '').slice(0, 26),
      roas: +(r.roas_thuc || 0).toFixed(2),
      be: r.roas_hoa_von == null ? null : +Math.min(r.roas_hoa_von, BE_CAP).toFixed(2),
      beRaw: r.roas_hoa_von, exp: r.expense, ln: r.ln_sau_ads,
    }))
    .sort((a, b) => b.exp - a.exp).slice(0, 12)

  return (
    <>
      <section className="m2-panel">
        <div className="m2-head">
          <h3>ROAS thật so với ROAS hoà vốn — 12 sản phẩm tiêu nhiều nhất</h3>
          <span>Thanh cam = ROAS thật đang đạt · thanh xám = mức cần đạt để hết lỗ ·
            hụt càng dài càng lỗ sâu</span>
        </div>
        <ResponsiveContainer width="100%" height={Math.max(260, bars.length * 30 + 64)}>
          <BarChart data={bars} layout="vertical" barGap={2}
            margin={{ top: 6, right: 28, left: 6, bottom: 6 }}>
            <CartesianGrid stroke={C.grid} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: C.axis }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" width={168}
              tick={{ fontSize: 10, fill: '#4A5285' }} axisLine={false} tickLine={false} />
            <Tooltip content={<TipBox rows={p => [
              ['ROAS thật', fmtRoas(p.roas), p.beRaw != null && p.roas >= p.beRaw ? 'good' : 'bad'],
              ['ROAS hoà vốn', fmtBe(p.beRaw)],
              ['Chi phí ads', `${num(p.exp / 1e6, 2)} tr`],
              ['LN sau ads', `${num(p.ln / 1e6, 1)} tr`, p.ln < 0 ? 'bad' : 'good'],
            ]} />} />
            <Legend {...LEG} />
            <Bar dataKey="be" name="ROAS cần đạt để hoà vốn" fill="#C9CCE4" barSize={11} radius={[0, 3, 3, 0]} />
            <Bar dataKey="roas" name="ROAS thật đang đạt" fill={C.roasR} barSize={11} radius={[0, 3, 3, 0]}>
              <LabelList dataKey="roas" position="right" fontSize={9.5} fill="#6E739B"
                formatter={v => num(v, 2)} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>
      <section className="m2-panel">
      <div className="m2-head">
        <h3>Hiệu quả theo sản phẩm</h3>
        <span>Mỗi chiến dịch Shopee gắn đúng 1 sản phẩm nên chi phí quy về sản phẩm là chính xác 1:1</span>
      </div>
      <div className="m2-tablewrap">
        <table className="mk-table">
          <thead>
            <tr>
              <th>Sản phẩm</th><th>Ngành</th><th>Loại hình</th><th className="num">CD</th>
              <th className="num">Chi phí</th><th className="num">CTR</th><th className="num">CR</th>
              <th className="num">CP/đơn</th><th className="num">ROAS Shopee</th><th className="num">ROAS thật</th>
              <th className="num">Hoà vốn</th><th className="num">Chất lượng đơn</th>
              <th className="num">TACOS</th><th className="num">% GMV từ ads</th>
              <th className="num">Doanh thu</th><th className="num">GM%</th>
              <th className="num">LN sau ads</th><th>Chẩn đoán</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const g = DIAG_MAP[r.diag]
              const bad = r.roas_hoa_von != null && (r.roas_thuc || 0) < r.roas_hoa_von
              return (
                <tr key={r.item_id}>
                  <td className="nm" title={r.item_name}>{r.item_name}</td>
                  <td>{r.nganh || '—'}</td>
                  <td className={r.class_name ? 'drill-link' : ''}
                      onClick={() => r.class_name && drill.open(r.class_name)}>{r.class_name || '—'}</td>
                  <td className="num">{r.so_chien_dich || '—'}</td>
                  <td className="num b">{r.expense ? trieu(r.expense, 2) : '—'}</td>
                  <td className="num">{r.ctr != null ? pct(r.ctr, 2) : '—'}</td>
                  <td className="num">{r.cr != null ? pct(r.cr, 2) : '—'}</td>
                  <td className="num">{r.cpo ? trieu(r.cpo, 2) : '—'}</td>
                  <td className="num muted">{fmtRoas(r.roas_shopee)}</td>
                  <td className={`num b ${bad ? 'bad' : r.roas_thuc ? 'good' : ''}`}>{fmtRoas(r.roas_thuc)}</td>
                  <td className="num muted">{fmtBe(r.roas_hoa_von)}</td>
                  <td className={`num ${r.net_rate != null && r.net_rate < 0.5 ? 'bad' : ''}`}>
                    {r.net_rate != null ? pct(r.net_rate) : '—'}</td>
                  <td className="num">{r.tacos != null ? pct(r.tacos, 1) : '—'}</td>
                  <td className="num">{r.ads_share != null ? pct(r.ads_share) : '—'}</td>
                  <td className="num">{trieu(r.rev)}</td>
                  <td className="num">{r.gm != null ? pct(r.gm) : '—'}</td>
                  <td className={`num b ${r.ln_sau_ads < 0 ? 'bad' : 'good'}`}>{trieu(r.ln_sau_ads, 1)}</td>
                  <td><span className={`tag t-${g.tone}`}>{g.label}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mk-note">
        <b>TACOS</b> = chi phí ads ÷ doanh thu thật của chính sản phẩm đó — mức phụ thuộc quảng cáo.
        TACOS cao mà <b>% GMV từ ads</b> thấp nghĩa là tiêu nhiều nhưng ads không mang được đơn.
      </p>
      </section>
    </>
  )
}

/* ================= TAB: NGÀNH HÀNG ================= */
function NganhTab({ rows, beAll }) {
  const chart = rows.map(r => ({
    label: r.nganh,
    shareExp: r.shareExp * 100,
    shareRev: r.shareRev * 100,
    lech: +((r.shareExp - r.shareRev) * 100).toFixed(1),
  })).sort((a, b) => b.lech - a.lech)
  return (
    <>
      <div className="mk-row2">
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Lệch đầu tư: % chi phí ads − % doanh thu</h3>
            <span>Cột phải (đỏ) = ăn ngân sách quá phần đóng góp · cột trái (xanh) = tự bán được mà chưa đầu tư</span>
          </div>
          <ResponsiveContainer width="100%" height={276}>
            <BarChart data={chart} layout="vertical" margin={{ top: 8, right: 34, left: 6, bottom: 4 }}>
              <CartesianGrid stroke={C.grid} horizontal={false} />
              <XAxis type="number" unit=" đ%" tick={{ fontSize: 10, fill: C.axis }}
                axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={92}
                tick={{ fontSize: 10.5, fill: '#4A5285' }} axisLine={false} tickLine={false} />
              <Tooltip content={<TipBox rows={p => [
                ['% chi phí ads', `${num(p.shareExp, 1)}%`],
                ['% doanh thu', `${num(p.shareRev, 1)}%`],
                ['Lệch', `${p.lech >= 0 ? '+' : ''}${num(p.lech, 1)} điểm %`, p.lech > 3 ? 'bad' : 'good'],
              ]} />} />
              <Legend {...LEG} payload={[
                { value: 'Ăn ngân sách quá phần đóng góp', type: 'square', color: C.be },
                { value: 'Chưa được đầu tư đủ', type: 'square', color: C.good },
              ]} />
              <ReferenceLine x={0} stroke="#B9BDD8" />
              <Bar dataKey="lech" name="Lệch (điểm %)" barSize={18} radius={[3, 3, 3, 3]}>
                {chart.map((r, i) => <Cell key={i} fill={r.lech > 0 ? C.be : C.good} />)}
                <LabelList dataKey="lech" position="right" fontSize={10} fill="#6E739B"
                  formatter={v => `${v >= 0 ? '+' : ''}${num(v, 1)}`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Bản đồ chi phí quảng cáo</h3>
            <span>Diện tích = tiền đã tiêu · xanh = ngành vượt điểm hoà vốn riêng · đỏ = chưa vượt</span>
          </div>
          {(() => {
            const ad = rows.filter(r => r.expense > 0)
            const data = ad.map(r => ({
              name: r.nganh, size: r.expense,
              ok: r.beRoas != null && (r.roasR || 0) >= r.beRoas,
              roas: r.roasR, be: r.beRoas, tacos: r.tacos, ln: r.ln_sau_ads,
            }))
            const Node = ({ x, y, width, height, name, ok, size, roas, be }) => {
              if (width == null || height == null) return null
              const show = width > 62 && height > 34
              const room = width > 62 && height > 62
              return (
                <g>
                  <rect x={x} y={y} width={width} height={height}
                    fill={ok ? C.good : '#C0453B'} fillOpacity={0.92}
                    stroke="#fff" strokeWidth={2} />
                  {show && (
                    <>
                      <text x={x + 10} y={y + 20} fill="#fff" fontSize={11.5} fontWeight={650}>{name}</text>
                      <text x={x + 10} y={y + 36} fill="#fff" fontSize={10} opacity={0.9}>
                        {num(size / 1e6, 2)} tr
                      </text>
                      {room && (
                        <text x={x + 10} y={y + 54} fill="#fff" fontSize={9.5} opacity={0.82}>
                          ROAS {fmtRoas(roas)} / cần {fmtBe(be)}
                        </text>
                      )}
                    </>
                  )}
                </g>
              )
            }
            return (
              <ResponsiveContainer width="100%" height={252}>
                <Treemap data={data} dataKey="size" stroke="#fff" isAnimationActive={false}
                  content={<Node />}>
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload
                    return (
                      <div className="mk-tip">
                        <b>{p.name}</b>
                        <div><span>Chi phí ads</span><em>{num((p.size || 0) / 1e6, 2)} tr</em></div>
                        <div className={p.ok ? 'good' : 'bad'}><span>ROAS thật</span><em>{fmtRoas(p.roas)}</em></div>
                        <div><span>Hoà vốn</span><em>{fmtBe(p.be)}</em></div>
                        <div><span>TACOS</span><em>{p.tacos != null ? pct(p.tacos, 1) : '—'}</em></div>
                        <div className={p.ln < 0 ? 'bad' : 'good'}>
                          <span>LN sau ads</span><em>{num((p.ln || 0) / 1e6, 1)} tr</em></div>
                      </div>
                    )
                  }} />
                </Treemap>
              </ResponsiveContainer>
            )
          })()}
        </section>
      </div>
      <section className="m2-panel">
        <div className="m2-head"><h3>Chi tiết theo ngành hàng</h3></div>
        <div className="m2-tablewrap">
          <table className="mk-table">
            <thead>
              <tr>
                <th>Ngành hàng</th><th className="num">Chi phí ads</th><th className="num">% chi phí</th>
                <th className="num">Doanh thu</th><th className="num">% doanh thu</th><th className="num">Lệch</th>
                <th className="num">Hiển thị</th><th className="num">Click</th>
                <th className="num">ROAS thật</th><th className="num">Hoà vốn</th><th className="num">TACOS</th>
                <th className="num">Chất lượng đơn</th><th className="num">LN sau ads</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const lech = (r.shareExp - r.shareRev) * 100
                return (
                  <tr key={r.nganh}>
                    <td className="nm">{r.nganh}</td>
                    <td className="num b">{r.expense ? trieu(r.expense, 2) : '—'}</td>
                    <td className="num">{pct(r.shareExp)}</td>
                    <td className="num">{trieu(r.rev)}</td>
                    <td className="num">{pct(r.shareRev)}</td>
                    <td className={`num ${lech > 5 ? 'bad' : lech < -5 ? 'good' : ''}`}>
                      {`${lech >= 0 ? '+' : ''}${num(lech, 1)} đ%`}</td>
                    <td className="num">{num(r.impression)}</td>
                    <td className="num">{num(r.clicks)}</td>
                    <td className={`num b ${!r.expense ? '' : r.beRoas != null && (r.roasR || 0) >= r.beRoas ? 'good' : 'bad'}`}>{fmtRoas(r.roasR)}</td>
                    <td className="num muted">{fmtBe(r.beRoas)}</td>
                    <td className="num">{r.tacos != null ? pct(r.tacos, 1) : '—'}</td>
                    <td className={`num ${r.netRate != null && r.netRate < 0.5 ? 'bad' : ''}`}>{r.netRate != null ? pct(r.netRate) : '—'}</td>
                    <td className={`num b ${r.ln_sau_ads < 0 ? 'bad' : 'good'}`}>{trieu(r.ln_sau_ads, 1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mk-note">
          <b>Lệch</b> = % chi phí ads − % doanh thu. Dương nhiều = ngành đang ăn ngân sách quá phần
          nó đóng góp; âm nhiều = ngành tự bán được mà chưa được đầu tư.
        </p>
      </section>
    </>
  )
}

/* ================= TAB: CHẨN ĐOÁN ================= */
function DiagTab({ groups, openNg, setOpenNg }) {
  const toggle = id => setOpenNg(o => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n })
  const tot = groups.reduce((s, g) => s + g.expense, 0)
  const TONE = { red: C.be, amber: '#D97706', green: C.good, grey: '#C9CCE4' }
  const spend = groups.filter(g => g.expense > 0)

  return (
    <>
      <section className="m2-panel">
        <div className="m2-head">
          <h3>Tiền quảng cáo đang chảy vào mắt vỡ nào</h3>
          <span>Toàn bộ {trieu(tot, 2)} tr chi phí, chia theo mắt phễu bị vỡ đầu tiên của từng chiến dịch</span>
        </div>
        <div className="mk-split">
          {spend.map(g => (
            <div key={g.id} className="seg" title={`${g.label} · ${trieu(g.expense, 2)} tr`}
              style={{ flexGrow: g.expense, background: TONE[g.tone] }}>
              {g.expense / tot > 0.1 && <span>{pct(g.expense / tot, 0)}</span>}
            </div>
          ))}
        </div>
        <div className="mk-legend wrap">
          {spend.map(g => (
            <span key={g.id}>
              <i style={{ background: TONE[g.tone] }} />
              {g.label} — <b>{trieu(g.expense, 2)} tr</b> · {pct(g.expense / tot, 0)} · {g.rows.length} CD
            </span>
          ))}
        </div>
        <p className="mk-note">
          Đọc từ phải sang: nhóm nào chiếm dải rộng nhất là nơi tiền đang mất nhiều nhất.
          Sửa nhóm đó trước, không sửa nhóm nhỏ.
        </p>
      </section>
      <section className="m2-panel">
      <div className="m2-head">
        <h3>Chẩn đoán &amp; hành động</h3>
        <span>Phễu được kiểm tra theo thứ tự — mỗi chiến dịch xếp vào mắt vỡ ĐẦU TIÊN, vì sửa mắt sau khi mắt trước còn vỡ thì vô ích</span>
        <div className="group-ctrl">
          <button onClick={() => setOpenNg(new Set(groups.map(g => g.id)))}>▼ Mở tất cả</button>
          <button onClick={() => setOpenNg(new Set())}>▶ Đóng tất cả</button>
        </div>
      </div>
      <div className="mk-diags">
        {groups.map(g => {
          const open = openNg.has(g.id)
          return (
            <div key={g.id} className={`mk-diag t-${g.tone}`}>
              <button className="hd" onClick={() => toggle(g.id)}>
                <span className="ar">{open ? '▾' : '▸'}</span>
                <b>{g.label}</b>
                <span className="cnt">{g.rows.length} chiến dịch</span>
                <span className="sp">{trieu(g.expense, 2)} tr
                  {tot > 0 && <em> · {pct(g.expense / tot)} chi phí</em>}</span>
              </button>
              <div className="bd">
                <p className="why"><b>Vì sao:</b> {g.why}</p>
                <p className="act"><b>Làm gì:</b> {g.action}</p>
                {open && (
                  <table className="mk-table sub">
                    <thead>
                      <tr>
                        <th>Chiến dịch</th><th>Ngành</th><th className="num">Chi phí</th>
                        <th className="num">Hiển thị</th><th className="num">CTR</th><th className="num">CR</th>
                        <th className="num">Chất lượng đơn</th><th className="num">ROAS thật</th><th className="num">Hoà vốn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map(r => (
                        <tr key={r.campaign_id}>
                          <td className="nm" title={r.ad_name}>{r.ad_name}</td>
                          <td>{r.nganh}</td>
                          <td className="num b">{r.expense ? trieu(r.expense, 2) : '—'}</td>
                          <td className="num">{num(r.impression)}</td>
                          <td className="num">{r.ctr != null ? pct(r.ctr, 2) : '—'}</td>
                          <td className="num">{r.cr != null ? pct(r.cr, 2) : '—'}</td>
                          <td className="num">{r.net_rate != null ? pct(r.net_rate) : '—'}</td>
                          <td className="num b">{fmtRoas(r.roas_thuc)}</td>
                          <td className="num muted">{fmtBe(r.roas_hoa_von)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )
        })}
      </div>
      </section>
    </>
  )
}

/* ================= TAB: CÁCH TÍNH ================= */
function MethodTab({ kpi }) {
  return (
    <section className="m2-panel">
      <div className="m2-head"><h3>Cách tính &amp; giới hạn dữ liệu</h3></div>
      <div className="mk-method">
        <h4>Chỉ số Shopee trả về</h4>
        <ul>
          <li><b>Hiển thị / Click / CTR / CPC</b> — lấy nguyên từ API, cấp shop và cấp chiến dịch.</li>
          <li><b>ROAS Shopee</b> = GMV ads ÷ chi phí ads. Đây là <b>GMV</b>, tức tính cả đơn sau đó bị huỷ.</li>
          <li><b>broad</b> = mọi đơn của sản phẩm được quảng cáo trong cửa sổ quy đổi; <b>direct</b> = đơn mua đúng
            sản phẩm vừa bấm vào. Màn này dùng <b>broad</b>.</li>
        </ul>
        <h4>Chỉ số tự tính — phần trả lời &quot;vì sao&quot;</h4>
        <ul>
          <li><b>Chất lượng đơn</b> = doanh thu ÷ GMV của chính sản phẩm đó trong tháng đó
            (hiện <b>{pct(kpi.netRate)}</b>). Đây là phần GMV thật sự thành tiền sau huỷ, hoàn và giảm giá.</li>
          <li><b>ROAS thật</b> = GMV ads × chất lượng đơn ÷ chi phí ads. Quy ROAS của Shopee về cơ sở doanh thu thật.
            Cách quy đổi này giả định đơn từ ads bị huỷ với cùng tỷ lệ như đơn thường của sản phẩm đó — Shopee
            không tách được tỷ lệ huỷ riêng cho đơn ads.</li>
          <li><b>ROAS hoà vốn</b> = 1 ÷ (GM% − tỷ lệ phí sàn) = 1 ÷ ({pct(kpi.gm)} − {pct(kpi.feeRate)})
            = <b>{fmtBe(kpi.beRoas)}</b>. Dưới ngưỡng này thì mỗi đồng quảng cáo không bù nổi giá vốn và phí sàn.</li>
          <li><b>TACOS</b> = chi phí ads ÷ doanh thu thật (cả đơn tự nhiên) — mức phụ thuộc quảng cáo.</li>
          <li><b>CP/đơn</b> = chi phí ads ÷ số đơn ads (broad).</li>
          <li><b>LN sau ads</b> = doanh thu − giá vốn − phí sàn − chi phí ads.</li>
        </ul>
        <h4>Ngưỡng dùng để chẩn đoán</h4>
        <ul>
          <li>Hiển thị &lt; 2.000/kỳ → không ai thấy · CTR &lt; 1,5% → thấy không bấm ·
            CR &lt; 0,5% → bấm không chốt · chất lượng đơn &lt; 50% → chốt rồi huỷ mất.</li>
          <li>Kiểm tra theo đúng chiều phễu và dừng ở mắt vỡ đầu tiên.</li>
        </ul>
        <h4>Giới hạn phải biết</h4>
        <ul>
          <li>API ads của Shopee chỉ trả <b>khoảng 5 tháng lịch sử</b> và mỗi lần gọi tối đa 30 ngày.
            Các tháng trước cửa sổ này là <b>không có dữ liệu</b>, không phải bằng 0.</li>
          <li>Chi phí cấp shop cao hơn tổng cấp chiến dịch sản phẩm — phần chênh là các loại ads khác
            (Shop ads, video, live) mà API chiến dịch sản phẩm không phủ. Cột nhạt trên biểu đồ là phần này.</li>
          <li>Mỗi chiến dịch gắn <b>đúng 1 sản phẩm</b> nên quy chi phí về sản phẩm là 1:1, không phải phân bổ.
            Sang cấp ngành hàng, sản phẩm nào thuộc nhiều ngành thì chia theo tỷ trọng doanh thu.</li>
        </ul>
      </div>
    </section>
  )
}
