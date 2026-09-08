import { useMemo, useRef, useState } from 'react'
import infra from '../data/infra.json'
import sales from '../data/sales.json'
import daily from '../data/sales_daily.json'
import platform from '../data/platform.json'
import stock from '../data/stock.json'
import mkt from '../data/marketing.json'
import phantom from '../data/phantom.json'
import master, {
  MASTER_BUNDLED, MASTER_IS_OVERRIDE, MASTER_OVERRIDE_AT,
  setMasterOverride, clearMasterOverride,
} from '../data/master'
import {
  parseMasterFile, diffMaster, exportJson, exportMasterXlsx, exportRowsXlsx,
} from '../lib/masterFile'
import { num } from '../lib/format'
import { PHANTOM, STOCK_RAW_BY_SKU } from '../lib/metrics'
import './infra.css'

/* ============================================================
   TỰ SOÁT CHẤT LƯỢNG DỮ LIỆU
   Sinh ra từ đợt audit 08/09/2026. Mỗi dòng là một phép kiểm đã từng phát hiện
   lỗi thật, để lần sau lỗi quay lại thì thấy ngay chứ không phải audit lại tay.
   ============================================================ */
function runChecks() {
  const sk = Object.fromEntries(master.skus.map(x => [x.sku, x]))
  const sumBy = (rows, key, val) => {
    const m = {}
    for (const r of rows) m[key(r)] = (m[key(r)] || 0) + (val(r) || 0)
    return m
  }
  const out = []
  const add = (id, label, state, detail, why) => out.push({ id, label, state, detail, why })

  /* 1. Doanh thu theo tháng phải khớp doanh thu dựng từ dữ liệu ngày.
        Lỗi thật 08/09/2026: view ngày không trừ voucher shop -> màn Lịch bán
        hàng cao hơn mọi màn khác 105,6tr (+5,6%), riêng 2025-03 lệch +34%. */
  const mRev = sumBy(sales.rows, r => sales.months[r.m], r => r.rev)
  const dRev = sumBy(daily.rows, r => r.d.slice(0, 7).replace('-', '.'), r => r.rev)
  const keys = [...new Set([...Object.keys(mRev), ...Object.keys(dRev)])]
  const off = keys.filter(k => Math.abs((mRev[k] || 0) - (dRev[k] || 0)) > 1000)
  const offSum = keys.reduce((a, k) => a + ((dRev[k] || 0) - (mRev[k] || 0)), 0)
  add('rev-day', 'Doanh thu tháng khớp doanh thu ngày',
    off.length ? 'bad' : 'ok',
    off.length ? `${off.length}/${keys.length} tháng lệch, tổng ${Math.round(offSum / 1e6)} tr` : 'khớp toàn bộ',
    'Màn Lịch bán hàng dựng từ dữ liệu ngày, các màn khác từ dữ liệu tháng. Lệch là hai màn báo hai con số.')

  /* 2. Chi phí quảng cáo: tổng shop vs phần gán được chiến dịch */
  const adsShop = platform.ads.reduce((a, r) => a + (r.chi_phi_ads || 0), 0)
  const adsCamp = (mkt.campaigns || []).reduce((a, r) => a + (r.expense || 0), 0)
  const gapRate = adsShop > 0 ? (adsShop - adsCamp) / adsShop : 0
  add('ads-gap', 'Chi phí ads gán được vào chiến dịch',
    gapRate > 0.25 ? 'bad' : gapRate > 0.05 ? 'warn' : 'ok',
    `${Math.round(adsCamp / 1e6)}/${Math.round(adsShop / 1e6)} tr gán được · ${Math.round(gapRate * 100)}% chưa gán`,
    'Phần chưa gán là chiến dịch đã xoá hoặc loại quảng cáo API không trả chi tiết. ROAS/CPC chỉ tính được trên phần gán được.')

  /* 3. Giá vốn thiếu — nếu SKU thiếu giá vốn mà đã bán thì GM% bị thổi lên 100% */
  const noCost = master.skus.filter(x => !(x.unitCost || 0)).map(x => x.sku)
  const soldSet = new Set(sales.rows.filter(r => (r.un || 0) > 0).map(r => r.sku))
  const stockSet = new Set(stock.rows.filter(r => r.qty > 0).map(r => r.sku))
  const badCost = noCost.filter(x => soldSet.has(x) || stockSet.has(x))
  add('cost', 'Giá vốn đã khai đủ cho SKU đang dùng',
    badCost.length ? 'bad' : noCost.length ? 'warn' : 'ok',
    badCost.length
      ? `${badCost.length} SKU đã bán/đang có tồn mà chưa có giá vốn: ${badCost.slice(0, 5).join(', ')}`
      : `${noCost.length}/${master.skus.length} SKU chưa khai, nhưng chưa bán và chưa có tồn`,
    'SKU thiếu giá vốn mà đã bán sẽ cho GM% = 100% một cách âm thầm, và làm nhẹ vốn tồn kho.')

  /* 4. SKU lạ — bán hoặc tồn mà không có trong Master Data thì mọi tra cứu vỡ */
  const known = new Set(master.skus.map(x => x.sku))
  const orphan = [...new Set([...sales.rows.map(r => r.sku), ...stock.rows.map(r => r.sku)])]
    .filter(x => !known.has(x))
  add('orphan', 'Mọi SKU bán/tồn đều có trong Master Data',
    orphan.length ? 'bad' : 'ok',
    orphan.length ? `${orphan.length} SKU lạ: ${orphan.slice(0, 6).join(', ')}` : 'không có SKU lạ',
    'SKU không có trong Master Data thì mất ngành hàng, giá vốn và nhà cung cấp — doanh thu của nó rơi ra ngoài mọi bảng.')

  /* 5. Doanh thu âm — hàng tặng kèm bị phân bổ voucher */
  const neg = sales.rows.filter(r => (r.rev || 0) < 0)
  const negSum = neg.reduce((a, r) => a + r.rev, 0)
  add('neg-rev', 'Không có dòng bán doanh thu âm',
    neg.length ? 'warn' : 'ok',
    neg.length ? `${neg.length} dòng, tổng ${Math.round(negSum / 1000)} nghìn` : 'không có',
    'Hàng tặng kèm (giá bán 0) bị phân bổ voucher shop nên ra doanh thu âm, làm GM% của SKU đó âm vô lý trong bảng.')

  /* 6. Hàng tặng kèm — chi phí không có doanh thu, lẫn trong giá vốn */
  const gift = sales.rows.filter(r => (r.rev || 0) <= 0 && (r.cogs || 0) > 0)
  const giftCogs = gift.reduce((a, r) => a + r.cogs, 0)
  add('gift', 'Hàng tặng kèm đã bóc riêng',
    giftCogs > 0 ? 'warn' : 'ok',
    giftCogs > 0 ? `${Math.round(giftCogs / 1e6)} tr giá vốn không sinh doanh thu` : 'không có',
    'Đây là chi phí thật nhưng nằm lẫn trong giá vốn. Xem khối riêng ở màn Lãi lỗ > Tiền rơi ở đâu.')

  /* 7. Tháng có bán mà không có dữ liệu phí sàn */
  const feeYm = new Set(platform.fees.map(r => r.ym))
  const missFee = sales.months.filter(m => !feeYm.has(m.replace('.', '-')))
  add('fee-cover', 'Mọi tháng có bán đều có dữ liệu phí sàn',
    missFee.length ? 'bad' : 'ok',
    missFee.length ? `thiếu: ${missFee.join(', ')}` : `đủ ${feeYm.size} tháng`,
    'Thiếu phí sàn của một tháng thì lãi tháng đó bị nhìn cao hơn thực tế.')

  /* 8. Quảng cáo chỉ có ~5 tháng lịch sử */
  const adsYm = platform.ads.map(r => r.ym)
  const noAds = sales.months.length - adsYm.length
  add('ads-cover', 'Phạm vi dữ liệu quảng cáo',
    noAds > 0 ? 'warn' : 'ok',
    `có ${adsYm.length}/${sales.months.length} tháng (từ ${adsYm[0] || '—'})`,
    'API Shopee chỉ lưu khoảng 5 tháng. Các tháng trước là KHÔNG CÓ DỮ LIỆU, không phải bằng 0 — lãi những tháng đó chưa trừ ads.')

  /* 9. Tồn ảo khai nhiều hơn tồn thực có.
        PHẢI đọc PHANTOM (số đang áp dụng thật, ưu tiên bản đám mây) chứ không
        đọc phantom.json trong repo — file đó chỉ là bản dự phòng khi mất mạng. */
  const ph = PHANTOM || {}
  const stkBySku = Object.fromEntries(
    Object.entries(STOCK_RAW_BY_SKU).map(([k, v]) => [k, v.total + v.store])
  )
  const over = Object.entries(ph).filter(([k, v]) => (v || 0) > (stkBySku[k] || 0))
  add('phantom', 'Tồn ảo khai không vượt tồn Shopee',
    over.length ? 'bad' : 'ok',
    Object.keys(ph).length
      ? (over.length ? `${over.length} SKU khai vượt: ${over.map(([k]) => k).join(', ')}`
        : `${Object.keys(ph).length} SKU đang khai, đều nhỏ hơn tồn`)
      : 'chưa khai SKU nào',
    'Khai nhiều hơn tồn Shopee nghĩa là số khai sai, hoặc tồn đã bán hết — trừ ra sẽ về 0 và mất dấu.')

  return out
}

const CHK = {
  ok: { label: 'Đạt', tone: 'good' },
  warn: { label: 'Cần biết', tone: 'warn' },
  bad: { label: 'Có vấn đề', tone: 'bad' },
}

function CheckTab({ checks }) {
  const nBad = checks.filter(c => c.state === 'bad').length
  const nWarn = checks.filter(c => c.state === 'warn').length
  return (
    <div className="inf-body">
      <div className={`inf-stale t-${nBad ? 'bad' : nWarn ? 'warn' : 'good'}`}>
        <b>
          {nBad ? `${nBad} phép kiểm đang có vấn đề` : nWarn
            ? `Không có lỗi · ${nWarn} điểm cần biết` : 'Toàn bộ phép kiểm đều đạt'}
        </b>
        <p>
          Mỗi dòng dưới đây là một phép kiểm <b>đã từng phát hiện lỗi thật</b> trong đợt
          soát ngày 08/09/2026. Chúng tính lại mỗi lần mở trang, nên nếu lỗi quay lại
          thì thấy ngay ở đây chứ không phải soát tay lần nữa.
        </p>
      </div>
      <section className="m2-panel">
        <div className="m2-head">
          <h3>Chín phép kiểm dữ liệu</h3>
          <span>“Cần biết” là giới hạn của nguồn dữ liệu, không phải lỗi app —
            nhưng phải biết để đọc số cho đúng</span>
        </div>
        <div className="m2-tablewrap">
          <table className="inf-table">
            <thead>
              <tr><th>Phép kiểm</th><th>Kết quả</th><th className="num">Trạng thái</th>
                <th>Vì sao quan trọng</th></tr>
            </thead>
            <tbody>
              {checks.map(c => (
                <tr key={c.id}>
                  <td><b>{c.label}</b></td>
                  <td className="sm mono">{c.detail}</td>
                  <td className="num">
                    <span className={`pill t-${CHK[c.state].tone}`}>{CHK[c.state].label}</span>
                  </td>
                  <td className="sm">{c.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

/* ---------- thời gian ---------- */
const VN = 'Asia/Ho_Chi_Minh'
const parse = s => {
  if (!s) return null
  /* Postgres trả "2026-09-07 05:25:40.69+00" — Safari không nhận dạng này */
  const d = new Date(String(s).replace(' ', 'T').replace(/\+00$/, '+00:00'))
  return isNaN(d) ? null : d
}
const fmt = s => {
  const d = parse(s)
  if (!d) return '—'
  return d.toLocaleString('vi-VN', {
    timeZone: VN, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
const fmtDay = s => {
  const d = parse(s)
  return d ? d.toLocaleDateString('vi-VN', { timeZone: VN }) : '—'
}
/* Tuổi dữ liệu phải đo từ BÂY GIỜ, không phải từ lúc kết xuất.
   Trước đây lấy mốc là lúc kết xuất với lý do "trang tĩnh, so với bây giờ thì
   báo gián đoạn oan" — sai: mốc đóng băng nên hiệu số không bao giờ lớn lên,
   app báo "Bình thường" vĩnh viễn dù job đã đứng cả ngày (07-08/09/2026).
   Người xem đang nhìn số kéo lúc `pulled` vào lúc `NOW`, nên tuổi thật là
   NOW - pulled. Tách làm 2 phần để biết lỗi ở đâu:
     lagAtExport = EXPORT_AT - pulled  -> job không kéo được (ETL đứng)
     PAGE_AGE_H  = NOW - EXPORT_AT     -> job kéo rồi nhưng chưa deploy lại */
const EXPORT_AT = parse(infra.exportedAt) || new Date()
const NOW = new Date()
const PAGE_AGE_H = Math.max(0, (NOW - EXPORT_AT) / 36e5)
const hoursTo = s => {
  const d = parse(s)
  return d ? (NOW - d) / 36e5 : null
}
const lagAtExport = s => {
  const d = parse(s)
  return d ? Math.max(0, (EXPORT_AT - d) / 36e5) : null
}
const ago = h => {
  if (h == null) return '—'
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} phút`
  if (h < 48) return `${h.toFixed(1)} giờ`
  return `${Math.round(h / 24)} ngày`
}

/* Lịch chạy 3 khung giờ -> quá 9 tiếng không chạy là đã trượt ít nhất 1 lượt */
const SLA_H = 9
const stateOf = h => (h == null ? 'unknown' : h <= SLA_H ? 'ok' : h <= 36 ? 'late' : 'down')
const STATE = {
  ok: { label: 'Bình thường', tone: 'good' },
  late: { label: 'Chậm nhịp', tone: 'warn' },
  down: { label: 'Gián đoạn', tone: 'bad' },
  unknown: { label: 'Chưa có log', tone: 'grey' },
}

/* ---------- mô tả từng bảng kéo về ---------- */
const TABLE_INFO = {
  raw_order: { label: 'Đơn hàng', api: 'order/get_order_list + get_order_detail', cols: '48 cột/đơn · 32 cột/dòng hàng', job: 'fact_order[create_time]' },
  raw_escrow: { label: 'Escrow — phí sàn & tiền thực nhận', api: 'payment/get_escrow_detail_batch', cols: '84 cột order_income · 26 cột/dòng hàng', job: 'fact_order_income' },
  raw_return: { label: 'Đơn hoàn / trả', api: 'returns/get_return_list', cols: '36 cột', job: 'fact_return' },
  raw_item: { label: 'Sản phẩm (listing)', api: 'product/get_item_list + get_item_base_info', cols: '32 cột', job: 'dim_item' },
  raw_model: { label: 'Biến thể + tồn kho', api: 'product/get_model_list', cols: '14 cột · có stock_info_v2', job: 'dim_model' },
  raw_stock_snapshot: { label: 'Ảnh chụp tồn theo ngày', api: 'suy ra từ stock_info_v2', cols: 'tồn theo SKU × kho', job: 'stock_snapshot' },
  raw_warehouse: { label: 'Danh sách kho', api: 'shop/get_warehouse_detail', cols: '13 cột', job: 'stock_snapshot' },
  raw_ads_shop_daily: { label: 'Quảng cáo — cấp shop', api: 'ads/get_all_cpc_ads_daily_performance', cols: '16 cột/ngày', job: 'ads_shop_daily' },
  raw_ads_campaign_daily: { label: 'Quảng cáo — cấp chiến dịch', api: 'ads/get_product_campaign_daily_performance', cols: '19 cột/ngày', job: 'ads_campaign_daily' },
  raw_ads_campaign: { label: 'Cấu hình chiến dịch', api: 'ads/get_product_level_campaign_setting_info', cols: 'item_id, ngân sách, mục tiêu ROAS', job: 'ads_campaign_daily' },
  raw_shop: { label: 'Thông tin shop', api: 'shop/get_shop_info', cols: 'payload gốc', job: 'dim_shop' },
  dim_sku: { label: 'Danh mục SKU (từ Master Data)', api: 'không phải API — nạp từ Excel', cols: '15 cột', job: null },
  sku_alias: { label: 'Đối chiếu mã SKU cũ → mới', api: 'suy ra theo model_id', cols: '5 cột', job: null },
}
const API_ORDER = ['raw_order', 'raw_escrow', 'raw_return', 'raw_item', 'raw_model',
  'raw_stock_snapshot', 'raw_warehouse', 'raw_ads_shop_daily',
  'raw_ads_campaign_daily', 'raw_ads_campaign', 'raw_shop']

export default function Infra() {
  const [tab, setTab] = useState('flow')
  const [imp, setImp] = useState(null)      // {data, diff} | {error}
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const d = useMemo(() => {
    const byT = Object.fromEntries((infra.tables || []).map(r => [r.t, r]))
    const byJob = Object.fromEntries((infra.jobs || []).map(r => [r.job, r]))
    const cards = API_ORDER.map(t => {
      const row = byT[t] || {}
      const info = TABLE_INFO[t] || {}
      const job = info.job ? byJob[info.job] : null
      const pulled = row.pulled || job?.last_ok
      const h = hoursTo(pulled)
      return { t, ...info, rows: row.n || 0, lo: row.lo, hi: row.hi, pulled, h, st: stateOf(h),
               lag: lagAtExport(pulled),
               fails: job?.fails || 0, runs: job?.runs || 0 }
    })
    const worst = cards.reduce((a, c) =>
      ({ ok: 0, late: 1, down: 2, unknown: 1 }[c.st] > { ok: 0, late: 1, down: 2, unknown: 1 }[a] ? c.st : a), 'ok')
    const fails = (infra.runs || []).filter(r => r.ok === false)
    return { cards, worst, fails, byT, byJob, checks: runChecks() }
  }, [])

  async function onPick(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(true); setImp(null)
    try {
      const data = await parseMasterFile(f)
      setImp({ data, diff: diffMaster(master, data), name: f.name })
    } catch (err) {
      setImp({ error: err.message || String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inf-page">
      <div className="m2-title">
        <div>
          <span>HỆ THỐNG</span>
          <h2>Cơ sở hạ tầng</h2>
          <p>
            App hoạt động thế nào, dữ liệu đến từ đâu, lần cập nhật gần nhất là khi nào,
            và nhật ký mọi thay đổi. Số liệu trên trang này chụp tại lần kết xuất
            <b> {fmt(infra.exportedAt)}</b> — app là trang tĩnh nên đây là mốc dữ liệu,
            không phải thời gian thực.
          </p>
        </div>
        <div className={`inf-health t-${STATE[d.worst].tone}`}>
          <span>Trạng thái đường ống</span>
          <b>{STATE[d.worst].label}</b>
        </div>
      </div>

      {PAGE_AGE_H > SLA_H && (
        <div className={`inf-stale t-${stateOf(PAGE_AGE_H) === 'down' ? 'bad' : 'warn'}`}>
          <b>⚠ Trang này đang xem số cũ — kết xuất cách đây {ago(PAGE_AGE_H)}</b>
          <p>
            Bình thường GitHub Actions kéo dữ liệu rồi deploy lại ngay, nên trang không
            thể cũ quá {SLA_H} giờ. Cũ hơn thế nghĩa là <b>lượt chạy đã lỗi</b> — mở tab
            Actions của repo để xem lượt đỏ, hoặc bấm “Run workflow” để chạy bù.
            Dòng phụ dưới mỗi bảng cho biết lỗi ở đâu: “job trễ … ngay tại lúc kết xuất”
            là Shopee/ETL không kéo được; còn nếu job vẫn kịp thì lỗi ở bước build/deploy.
          </p>
        </div>
      )}

      <div className="mk-tabbar">
        <div className="mk-tabs">
          {[['flow', '⛭', 'App hoạt động thế nào', null],
            ['sources', '⛁', 'Nguồn dữ liệu', d.cards.length + 1],
            ['check', '✓', 'Tự soát dữ liệu', d.checks.filter(c => c.state !== 'ok').length || null],
            ['log', '☰', 'Nhật ký', (infra.runs || []).length],
            ['stack', '⚙', 'Hạ tầng & lịch chạy', null]].map(([id, ic, lb, n]) => (
              <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                <span className="ic" aria-hidden>{ic}</span>{lb}
                {n != null && <em>{n}</em>}
              </button>
            ))}
        </div>
      </div>

      {tab === 'flow' && <FlowTab d={d} />}
      {tab === 'sources' && (
        <SourcesTab d={d} imp={imp} setImp={setImp} busy={busy}
          fileRef={fileRef} onPick={onPick} />
      )}
      {tab === 'check' && <CheckTab checks={d.checks} />}
      {tab === 'log' && <LogTab d={d} />}
      {tab === 'stack' && <StackTab d={d} />}
    </div>
  )
}

/* ================= APP HOẠT ĐỘNG THẾ NÀO ================= */
const STEPS = [
  {
    k: '1', t: 'Nguồn', c: 'nguon',
    items: [
      ['Master Data.xlsx', 'File Excel phòng mua hàng giữ: SKU, ngành hàng, nhà cung cấp, giá vốn, đơn mua'],
      ['Shopee Open API v2', 'Đơn hàng, escrow, đơn hoàn, quảng cáo, tồn kho — ký HMAC-SHA256, token tự làm mới'],
    ],
  },
  {
    k: '2', t: 'Lấy dữ liệu (ETL)', c: 'etl',
    items: [
      ['scripts/extract_master.py', 'Đọc Excel → master.json'],
      ['scripts/shopee/run_all.py', '9 bước: shop → sản phẩm → tồn → đơn mới → đơn đổi trạng thái → escrow → đơn hoàn → quảng cáo → kết xuất'],
    ],
  },
  {
    k: '3', t: 'Kho dữ liệu', c: 'kho',
    items: [
      ['Supabase Postgres — schema shopee', 'Lớp raw_* giữ NGUYÊN payload API trong cột jsonb, không cắt cột nào'],
      ['View stg_* và mart_*', 'Phẳng hoá jsonb rồi tính chỉ số. Sửa cách tính = sửa view, không phải kéo lại dữ liệu'],
    ],
  },
  {
    k: '4', t: 'Kết xuất', c: 'xuat',
    items: [
      ['export_app_data.py', 'Đọc các view mart → ghi ra src/data/*.json'],
      ['6 file dữ liệu', 'sales · sales_daily · platform · stock · marketing · infra'],
    ],
  },
  {
    k: '5', t: 'Ứng dụng', c: 'app',
    items: [
      ['React + Vite (trang tĩnh)', 'Không có server. Toàn bộ tính toán chạy trong trình duyệt từ 6 file JSON đóng kèm'],
      ['GitHub Pages', 'Build rồi đẩy lên nhánh gh-pages qua scripts/pages/deploy.sh'],
    ],
  },
]

function FlowTab({ d }) {
  return (
    <>
      <section className="m2-panel">
        <div className="m2-head">
          <h3>Đường đi của dữ liệu</h3>
          <span>Từ nguồn tới màn hình — 5 chặng, mỗi chặng là một bước độc lập có thể chạy lại riêng</span>
        </div>
        <div className="inf-flow">
          {STEPS.map((s, i) => (
            <div key={s.k} className={`inf-step ${s.c}`}>
              <div className="hd"><b>{s.k}</b><span>{s.t}</span></div>
              <ul>
                {s.items.map(([a, b]) => (
                  <li key={a}><code>{a}</code><em>{b}</em></li>
                ))}
              </ul>
              {i < STEPS.length - 1 && <i className="arrow" aria-hidden>→</i>}
            </div>
          ))}
        </div>
      </section>

      <div className="inf-row2">
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Ba điều cần biết khi đọc số trên app</h3>
          </div>
          <ol className="inf-notes">
            <li>
              <b>Dữ liệu đóng băng tại lần kết xuất.</b> App không gọi Supabase lúc chạy —
              mọi số nằm trong file JSON đóng kèm bản build. Muốn số mới thì phải chạy lại
              ETL rồi deploy. Mốc hiện tại: <b>{fmt(infra.exportedAt)}</b>.
            </li>
            <li>
              <b>Tháng đang chạy dở không được tính vào tốc độ bán và dự báo.</b>
              Nếu tính vào thì sức bán 3 tháng bị hụt và mọi điểm đặt hàng sẽ sai thấp.
            </li>
            <li>
              <b>Tồn kho Shopee là tồn ĐÃ BƠM ảo để chạy chiến dịch.</b> Số API trả về cao hơn
              thực tế. Khai số đã bơm ở <b>Tồn kho &amp; Đặt hàng → tab Tồn ảo</b> thì hệ thống
              trừ ra tại nguồn, mọi phép tính tồn kho và kế hoạch đặt hàng chạy trên tồn thật.
              Có <b>hai lớp</b>: bản chung <code>src/data/phantom.json</code> mọi máy đều thấy,
              và bản nháp lưu trong trình duyệt chỉ máy đó thấy — app tĩnh không có server nên
              muốn đồng bộ phải đưa số vào bản chung rồi deploy.
            </li>
            <li>
              <b>Mật khẩu đăng nhập là khoá mềm.</b> Nó nằm trong mã trang nên chỉ chống mở
              nhầm, không phải bảo mật. Repo đang public.
            </li>
          </ol>
        </section>

        <section className="m2-panel">
          <div className="m2-head">
            <h3>Quy trình cập nhật số liệu</h3>
            <span>Ba lệnh, theo đúng thứ tự</span>
          </div>
          <ol className="inf-cmd">
            <li><code>python3 scripts/shopee/run_all.py</code><em>Kéo dữ liệu mới về Supabase rồi kết xuất ra src/data/</em></li>
            <li><code>git add src/data &amp;&amp; git commit &amp;&amp; git push</code><em>Lưu lại phiên bản dữ liệu</em></li>
            <li><code>./scripts/pages/deploy.sh</code><em>Build và đẩy lên GitHub Pages</em></li>
          </ol>
          <p className="inf-hint">
            Ba bước trên chỉ cần khi chạy tay (ví dụ vừa đổi Master Data). Bình thường
            <b> GitHub Actions tự làm cả ba</b> vào {infra.schedule?.join(' · ')} —
            kéo dữ liệu, build, rồi đẩy lên Pages, nên link công khai luôn khớp
            với lần chạy gần nhất.
          </p>
        </section>
      </div>
    </>
  )
}

/* ================= NGUỒN DỮ LIỆU ================= */
function SourcesTab({ d, imp, setImp, busy, fileRef, onPick }) {
  const [exp, setExp] = useState('')
  const run = async (label, fn) => {
    setExp(label)
    try { await fn() } finally { setExp('') }
  }

  const apply = () => {
    setMasterOverride(imp.data)
    location.reload()
  }
  const revert = () => {
    clearMasterOverride()
    location.reload()
  }

  return (
    <>
      {/* ---- ô riêng cho Master Data ---- */}
      <section className="m2-panel inf-master">
        <div className="m2-head">
          <h3>⛁ Master Data — nhập từ Excel</h3>
          <span>Nguồn duy nhất cho SKU, ngành hàng, nhà cung cấp, giá vốn và đơn mua.
            Không đến từ API, do phòng mua hàng giữ bằng file Excel</span>
        </div>

        <div className="inf-kv">
          <div><span>File nguồn</span><b>{master.meta?.source || 'Master Data.xlsx'}</b></div>
          <div><span>Nạp lúc</span><b>{MASTER_IS_OVERRIDE ? fmt(MASTER_OVERRIDE_AT) : fmt(infra.exportedAt)}</b></div>
          <div><span>SKU</span><b>{num(master.skus.length)}</b></div>
          <div><span>Nhà cung cấp</span><b>{num(master.suppliers.length)}</b></div>
          <div><span>Kho</span><b>{num(master.warehouses.length)}</b></div>
          <div><span>Dòng đơn mua</span><b>{num(master.purchaseOrders.length)}</b></div>
        </div>

        {MASTER_IS_OVERRIDE && (
          <div className="inf-flag">
            Trình duyệt này đang dùng <b>bản Excel bạn tự nạp</b> ({master.meta?.source}),
            không phải bản đóng kèm app. Chỉ ảnh hưởng máy này.
            <button className="lnk" onClick={revert}>Hoàn nguyên về bản gốc</button>
          </div>
        )}

        <div className="inf-acts">
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls" hidden onChange={onPick} />
          <button className="btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Đang đọc file...' : '⬆ Nhập file Excel'}
          </button>
          <button className="btn-ghost" disabled={!!exp}
            onClick={() => run('xlsx', () => exportMasterXlsx(master))}>
            {exp === 'xlsx' ? 'Đang tạo...' : '⬇ Kết xuất Excel'}
          </button>
          <button className="btn-ghost" disabled={!!exp}
            onClick={() => run('json', async () => exportJson('master.json', master))}>
            ⬇ Kết xuất master.json
          </button>
        </div>
        <p className="inf-hint">
          App là trang tĩnh, không ghi được file lên server. Nhập file sẽ đọc và kiểm tra
          ngay trong trình duyệt, cho bạn xem đổi gì rồi mới áp dụng — bản nạp lưu trong
          trình duyệt này. Muốn cả tổ chức thấy thì kết xuất <code>master.json</code>,
          thay vào <code>src/data/</code> rồi deploy.
        </p>

        {imp?.error && (
          <div className="inf-err">
            <b>Không đọc được file</b>
            <p>{imp.error}</p>
            <p className="sm">Cần đúng 4 sheet: <code>1. Master Data</code> (tiêu đề ở dòng 7),
              <code>0. Mã Supplier</code> (dòng 5), <code>Mã Kho</code>, <code>4. Purchasing</code>.</p>
          </div>
        )}

        {imp?.data && (
          <div className="inf-diff">
            <b>Đã đọc xong <code>{imp.name}</code> — kiểm lại trước khi áp dụng</b>
            <div className="cnt">
              {[['SKU', imp.diff.skus], ['Nhà cung cấp', imp.diff.suppliers],
                ['Kho', imp.diff.warehouses], ['Đơn mua', imp.diff.pos]].map(([k, [a, b]]) => (
                  <span key={k} className={a === b ? '' : 'chg'}>
                    {k}: <b>{num(a)} → {num(b)}</b>
                  </span>
                ))}
            </div>
            <div className="lists">
              <div><span>SKU thêm mới ({imp.diff.added.length})</span>
                <p>{imp.diff.added.slice(0, 24).join(', ') || '—'}{imp.diff.added.length > 24 ? '…' : ''}</p></div>
              <div><span>SKU không còn ({imp.diff.removed.length})</span>
                <p>{imp.diff.removed.slice(0, 24).join(', ') || '—'}{imp.diff.removed.length > 24 ? '…' : ''}</p></div>
              <div><span>Đổi giá vốn ({imp.diff.costChanged.length})</span>
                <p>{imp.diff.costChanged.slice(0, 10).map(c =>
                  `${c.sku} ${num(c.from)}→${num(c.to)}`).join(' · ') || '—'}</p></div>
            </div>
            {imp.diff.removed.length > 0 && (
              <p className="warn">
                ⚠ {imp.diff.removed.length} SKU biến mất so với bản đang dùng. Nếu các SKU đó
                từng phát sinh bán thì doanh thu của chúng sẽ không map được vào ngành hàng nữa.
              </p>
            )}
            <div className="inf-acts">
              <button className="btn-primary" onClick={apply}>Áp dụng cho trình duyệt này</button>
              <button className="btn-ghost" onClick={() => exportJson('master.json', imp.data)}>
                ⬇ Tải master.json để deploy
              </button>
              <button className="btn-ghost" onClick={() => setImp(null)}>Bỏ</button>
            </div>
          </div>
        )}
      </section>

      {/* ---- các bảng kéo từ API ---- */}
      <section className="m2-panel">
        <div className="m2-head">
          <h3>⇅ Dữ liệu kéo từ Shopee Open API</h3>
          <span>Mỗi bảng một ô riêng: kéo bằng API nào, giữ bao nhiêu cột, có bao nhiêu dòng,
            và lần cập nhật gần nhất — quá {SLA_H} giờ không có số mới là đã trượt ít nhất
            một lượt trong lịch 3 khung giờ. “Tuổi” tính từ bây giờ, gồm cả thời gian
            trang chưa được deploy lại ({ago(PAGE_AGE_H)})</span>
          <div className="group-ctrl">
            <button onClick={() => exportRowsXlsx('Trang thai kho du lieu.xlsx', {
              'Bang du lieu': d.cards.map(c => ({
                bang: c.t, ten: c.label, api: c.api, so_dong: c.rows,
                tu: c.lo || '', den: c.hi || '', cap_nhat_cuoi: c.pulled || '',
                tuoi_gio: c.h == null ? '' : +c.h.toFixed(1),
                tre_khi_ket_xuat_gio: c.lag == null ? '' : +c.lag.toFixed(1),
                trang_thai: STATE[c.st].label,
              })),
            })}>⬇ Kết xuất trạng thái</button>
          </div>
        </div>
        <div className="inf-cards">
          {d.cards.map(c => (
            <div key={c.t} className={`inf-card t-${STATE[c.st].tone}`}>
              <div className="top">
                <b>{c.label}</b>
                <span className={`pill t-${STATE[c.st].tone}`}>{STATE[c.st].label}</span>
              </div>
              <code className="tb">{c.t}</code>
              <div className="rows"><b>{num(c.rows)}</b><span>dòng</span></div>
              <dl>
                <dt>API</dt><dd className="mono">{c.api}</dd>
                <dt>Giữ lại</dt><dd>{c.cols}</dd>
                {c.lo && <><dt>Phạm vi</dt><dd>{fmtDay(c.lo)} → {fmtDay(c.hi)}</dd></>}
                <dt>Cập nhật</dt>
                <dd className={c.st === 'ok' ? '' : 'hl'}>
                  {fmt(c.pulled)}{c.h != null && <em> · cũ {ago(c.h)}</em>}
                  {c.lag != null && (
                    <em className="sub">
                      {c.lag > SLA_H
                        ? `job trễ ${ago(c.lag)} ngay tại lúc kết xuất`
                        : `job vẫn kịp lúc kết xuất (trễ ${ago(c.lag)})`}
                    </em>
                  )}
                </dd>
                {c.fails > 0 && (
                  <><dt>Lịch sử</dt>
                    <dd className="hl">{c.fails}/{c.runs} lượt từng lỗi — xem tab Nhật ký</dd></>
                )}
              </dl>
            </div>
          ))}
        </div>
      </section>

      {/* ---- file dữ liệu app đang dùng ---- */}
      <section className="m2-panel">
        <div className="m2-head">
          <h3>▤ File dữ liệu app đang đọc</h3>
          <span>App không gọi database lúc chạy — đây là toàn bộ dữ liệu được đóng kèm bản build</span>
        </div>
        <div className="m2-tablewrap">
          <table className="inf-table">
            <thead>
              <tr><th>File</th><th>Nội dung</th><th className="num">Số dòng</th><th>Phạm vi</th><th>Kết xuất lúc</th><th /></tr>
            </thead>
            <tbody>
              {[
                ['master.json', 'SKU · nhà cung cấp · kho · đơn mua', master.skus.length,
                  `${master.suppliers.length} NCC · ${master.purchaseOrders.length} dòng PO`, master, 'master'],
                ['sales.json', 'Doanh thu · COGS · GM% theo SKU × tháng', sales.rows.length,
                  `${sales.months[0]} → ${sales.months[sales.months.length - 1]}`, sales, 'sales'],
                ['sales_daily.json', 'Doanh thu theo SKU × ngày', null, sales.meta.to, null, 'daily'],
                ['stock.json', 'Tồn kho theo SKU × kho', stock.rows.length,
                  `chụp ${fmtDay(stock.meta.asOfDate)}`, stock, 'stock'],
                ['marketing.json', 'Quảng cáo: chiến dịch · sản phẩm · ngành', mkt.items.length,
                  `${mkt.months[0]?.ym} → ${mkt.months[mkt.months.length - 1]?.ym}`, mkt, 'mkt'],
                ['platform.json', 'Phí sàn 17 khoản · ads · đơn hoàn', null, '', null, 'plat'],
                ['phantom.json', 'Tồn ảo đã bơm trên Shopee — BẢN CHUNG cho cả tổ chức',
                  Object.keys(phantom.items || {}).length,
                  phantom.meta?.updatedAt ? `cập nhật ${fmt(phantom.meta.updatedAt)}` : 'chưa khai SKU nào',
                  phantom, 'phantom'],
                ['infra.json', 'Trạng thái bảng · nhật ký ETL · phiên bản app', (infra.runs || []).length,
                  '', infra, 'infra'],
              ].map(([f, desc, n, range, obj]) => (
                <tr key={f}>
                  <td><code>{f}</code></td>
                  <td>{desc}</td>
                  <td className="num">{n == null ? '—' : num(n)}</td>
                  <td className="mono sm">{range}</td>
                  <td className="sm">{fmt(infra.exportedAt)}</td>
                  <td>{obj && <button className="lnk" onClick={() => exportJson(f, obj)}>⬇ tải</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

/* ================= NHẬT KÝ ================= */
function LogTab({ d }) {
  const [which, setWhich] = useState('etl')
  const [onlyFail, setOnlyFail] = useState(false)
  const runs = (infra.runs || []).filter(r => !onlyFail || r.ok === false)
  const commits = infra.commits || []

  return (
    <>
      <section className="m2-panel">
        <div className="m2-head">
          <h3>☰ Nhật ký thay đổi</h3>
          <span>Hai loại: mỗi lượt kéo dữ liệu (ghi trong bảng <code>shopee.etl_run</code>)
            và mỗi lần app được sửa (lấy từ lịch sử git)</span>
          <div className="group-ctrl">
            <button className={which === 'etl' ? 'on' : ''} onClick={() => setWhich('etl')}>
              Kéo dữ liệu ({(infra.runs || []).length})
            </button>
            <button className={which === 'app' ? 'on' : ''} onClick={() => setWhich('app')}>
              Sửa app ({commits.length})
            </button>
          </div>
        </div>

        {which === 'etl' && (
          <>
            <div className="inf-logbar">
              <label>
                <input type="checkbox" checked={onlyFail} onChange={e => setOnlyFail(e.target.checked)} />
                Chỉ xem lượt lỗi ({d.fails.length})
              </label>
              <button className="lnk" onClick={() => exportRowsXlsx('Nhat ky ETL.xlsx', {
                'ETL': (infra.runs || []).map(r => ({
                  id: r.id, job: r.job, bat_dau: r.started_at, ket_thuc: r.finished_at,
                  giay: r.secs, so_dong: r.rows_in, ok: r.ok, ghi_chu: r.note || '',
                })),
              })}>⬇ Kết xuất Excel</button>
            </div>
            <div className="m2-tablewrap tall">
              <table className="inf-table">
                <thead>
                  <tr><th className="num">#</th><th>Việc</th><th>Bắt đầu</th><th className="num">Giây</th>
                    <th className="num">Số dòng</th><th>Kết quả</th><th>Ghi chú</th></tr>
                </thead>
                <tbody>
                  {runs.map(r => (
                    <tr key={r.id} className={r.ok === false ? 'bad-row' : ''}>
                      <td className="num sm">{r.id}</td>
                      <td className="mono">{r.job}</td>
                      <td className="sm">{fmt(r.started_at)}</td>
                      <td className="num">{r.secs == null ? '—' : num(r.secs, 1)}</td>
                      <td className="num">{num(r.rows_in || 0)}</td>
                      <td>
                        <span className={`pill t-${r.ok === false ? 'bad' : r.ok ? 'good' : 'grey'}`}>
                          {r.ok === false ? 'Lỗi' : r.ok ? 'OK' : 'Đang chạy'}
                        </span>
                      </td>
                      <td className="sm">{r.note || ''}</td>
                    </tr>
                  ))}
                  {!runs.length && <tr><td colSpan={7} className="empty">Không có dòng nào</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {which === 'app' && (
          <div className="inf-commits">
            {commits.map(c => (
              <div key={c.sha} className="cm">
                <div className="cm-hd">
                  <code>{c.sha}</code>
                  <b>{c.subject}</b>
                  <span>{fmt(c.date)} · {c.author}</span>
                </div>
                {c.body && (
                  <pre>{c.body.replace(/\n*Co-Authored-By:.*$/s, '').trim()}</pre>
                )}
              </div>
            ))}
            {!commits.length && <p className="inf-hint">Chưa có lịch sử git trong bản kết xuất này.</p>}
          </div>
        )}
      </section>
    </>
  )
}

/* ================= HẠ TẦNG & LỊCH CHẠY ================= */
function StackTab({ d }) {
  const jobs = infra.jobs || []
  return (
    <>
      <div className="inf-row2">
        <section className="m2-panel">
          <div className="m2-head">
            <h3>⚙ Thành phần hệ thống</h3>
          </div>
          <div className="m2-tablewrap">
            <table className="inf-table">
              <thead><tr><th>Lớp</th><th>Công nghệ</th><th>Vai trò</th></tr></thead>
              <tbody>
                {[
                  ['Nguồn sản phẩm', 'Excel — Master Data.xlsx', 'SKU, ngành hàng, NCC, giá vốn, đơn mua'],
                  ['Nguồn bán hàng', 'Shopee Open API v2', 'Ký HMAC-SHA256, token 4 giờ tự làm mới, uỷ quyền 365 ngày'],
                  ['Kho dữ liệu', 'Supabase Postgres (ap-southeast-1)', 'Schema shopee, RLS bật toàn bộ bảng'],
                  ['Kết nối ETL', 'Session pooler IPv4', 'Host trực tiếp chỉ có IPv6 nên máy local không tới được'],
                  ['Token Shopee', 'Bảng shopee.oauth_token', 'Nằm trong DB, không nằm trong file — máy nào chạy job cũng dùng chung'],
                  ['Lớp phân tích', 'View stg_* / mart_*', 'Phẳng hoá jsonb rồi tính chỉ số ngay trong SQL'],
                  ['Hẹn giờ', 'GitHub Actions', `.github/workflows/etl.yml — ${infra.schedule?.join(' · ')}, chạy trên máy của GitHub nên không phụ thuộc laptop`],
                  ['Ứng dụng', 'React 19 + Vite + Recharts', 'Trang tĩnh, không có server'],
                  ['Nơi chạy', 'GitHub Pages — nhánh gh-pages', 'Actions build và đẩy sau mỗi lượt ETL; chạy tay bằng scripts/pages/deploy.sh'],
                ].map(([a, b, c]) => (
                  <tr key={a}><td><b>{a}</b></td><td className="mono sm">{b}</td><td className="sm">{c}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="m2-panel">
          <div className="m2-head">
            <h3>Từng việc trong job chạy thế nào</h3>
            <span>Một bước lỗi không làm chết cả job — mỗi bước ghi log riêng</span>
          </div>
          <div className="m2-tablewrap">
            <table className="inf-table">
              <thead>
                <tr><th>Việc</th><th className="num">Lượt</th><th className="num">Lỗi</th>
                  <th className="num">Tổng dòng</th><th>Chạy gần nhất</th><th>Trạng thái</th></tr>
              </thead>
              <tbody>
                {jobs.map(j => {
                  const h = hoursTo(j.last_ok || j.last_run)
                  const st = stateOf(h)
                  return (
                    <tr key={j.job}>
                      <td className="mono">{j.job}</td>
                      <td className="num">{num(j.runs)}</td>
                      <td className={`num ${j.fails ? 'hl' : ''}`}>{num(j.fails)}</td>
                      <td className="num">{num(j.rows_total || 0)}</td>
                      <td className="sm">{fmt(j.last_run)}</td>
                      <td><span className={`pill t-${STATE[st].tone}`}>{STATE[st].label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Giới hạn của API Shopee — biết trước để không đọc sai số</h3>
        </div>
        <div className="m2-tablewrap">
          <table className="inf-table">
            <thead><tr><th>Giới hạn</th><th>Hệ quả</th></tr></thead>
            <tbody>
              {[
                ['Đơn hàng: mỗi lần gọi tối đa cửa sổ 15 ngày', 'Kéo lịch sử 20 tháng phải chia 43 lượt'],
                ['Quảng cáo: mỗi lần gọi tối đa 30 ngày, lịch sử chỉ lùi ~5 tháng',
                  'Màn Marketing chỉ có dữ liệu từ 2026-04; các tháng trước là KHÔNG CÓ, không phải bằng 0'],
                ['Tồn kho: chỉ trả tồn hiện tại, không có lịch sử',
                  'Phải chụp ảnh theo ngày; lịch sử tồn chỉ tích luỹ từ 2026-09-07 trở đi'],
                ['Địa chỉ người mua bị che toàn bộ, kể cả tỉnh/thành',
                  'Không phân tích được theo địa lý'],
                ['seller_transaction_fee = credit_card_transaction_fee ở 100% đơn',
                  'Cùng một khoản tiền, hai tên. Cộng cả hai sẽ đội phí sàn từ 19,6% lên 24,4%'],
                ['Token truy cập hết hạn sau 4 giờ, refresh token 30 ngày',
                  'Job tự làm mới mỗi lượt chạy. Nếu để quá 30 ngày không chạy thì phải uỷ quyền lại'],
              ].map(([a, b]) => (
                <tr key={a}><td className="sm"><b>{a}</b></td><td className="sm">{b}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
