import { useMemo, useState } from 'react'
import master from '../data/master'
import sales from '../data/sales.json'
import platform from '../data/platform.json'
import stock from '../data/stock.json'
import infra from '../data/infra.json'
import { MONTHS, LAST_DATA_DAY, PARTIAL, Z_SERVICE, VMIN, DEFAULT_LT, STATUS } from '../lib/metrics'
import { num } from '../lib/format'
import './guide.css'

/* ============================================================
   TỪ ĐIỂN CHỈ SỐ
   Một chỗ duy nhất định nghĩa mọi con số trong app. Công thức chép đúng từ
   code (src/lib/metrics.js và scripts/shopee/mart*.sql) — sửa code thì phải
   sửa ở đây, nếu không bảng này thành sai lệch có thẩm quyền, tệ hơn không có.
   Cột "Cạm bẫy" là chỗ đã có người đọc sai thật.
   ============================================================ */
const NHOM = [
  ['ban', 'Bán hàng'],
  ['phi', 'Phí sàn & dòng tiền'],
  ['lai', 'Lãi lỗ'],
  ['ads', 'Quảng cáo'],
  ['ton', 'Tồn kho & đặt hàng'],
  ['dubao', 'Dự báo'],
]

const DICT = [
  /* ---------- bán hàng ---------- */
  { g: 'ban', t: 'GMV', f: 'giá thực bán × SL mua', s: 'Đơn hàng Shopee, mọi trạng thái',
    n: 'Giá thực bán là giá khách trả sau khuyến mãi của sàn, KHÔNG phải giá niêm yết.',
    bay: 'GMV gồm cả đơn sau đó bị huỷ. Đừng dùng GMV để nói về tiền đã về.' },
  { g: 'ban', t: 'Huỷ đơn', f: 'giá thực bán × SL huỷ', s: 'Trạng thái đơn CANCELLED + dòng bị huỷ trong đơn',
    n: 'Tính cả đơn huỷ toàn bộ lẫn dòng bị huỷ trong đơn còn lại.',
    bay: 'Huỷ KHÔNG phải chi phí — hàng không xuất, giá vốn không mất. Nhưng tiền quảng cáo chạy cho đơn đó thì đã tiêu.' },
  { g: 'ban', t: 'Hoàn trả', f: 'giá thực bán × SL hoàn', s: 'API đơn hoàn (returns)', n: '', bay: '' },
  { g: 'ban', t: 'Giảm giá', f: 'voucher shop tự chịu × (SL thuần ÷ SL mua)', s: 'escrow từng dòng đơn',
    n: 'Chia theo tỷ lệ vì đơn bị huỷ/hoàn một phần thì shop không mất trọn tiền voucher.',
    bay: 'Chỉ gồm voucher SHOP tự chịu. Voucher Shopee tài trợ không nằm đây và không phải chi phí của shop.' },
  { g: 'ban', t: 'Doanh thu thuần', f: 'GMV − huỷ − hoàn − giảm giá', s: 'tính ra',
    n: 'Đây là "doanh thu" mặc định ở mọi màn.',
    bay: 'Chưa trừ phí sàn và quảng cáo. Muốn biết còn lại bao nhiêu thì xem màn Lãi lỗ.' },
  { g: 'ban', t: 'SL mua / SL thuần', f: 'SL mua = đặt · SL thuần = đặt − huỷ − hoàn', s: 'dòng đơn hàng',
    n: 'Mọi chỉ số trên đầu sản phẩm (ASP, giá vốn) dùng SL thuần.', bay: '' },
  { g: 'ban', t: 'Giá vốn (COGS)', f: 'giá vốn 1 đơn vị × SL thuần', s: 'Master Data, cột Unit Cost',
    n: 'Giá vốn CHƯA VAT.',
    bay: 'SKU chưa khai giá vốn sẽ cho GM% = 100% một cách âm thầm. Xem Cơ sở hạ tầng → Tự soát dữ liệu.' },
  { g: 'ban', t: 'Lợi nhuận gộp', f: 'doanh thu − giá vốn', s: 'tính ra', n: '', bay: '' },
  { g: 'ban', t: 'GM %', f: 'lợi nhuận gộp ÷ doanh thu', s: 'tính ra',
    n: '', bay: 'Chưa trừ phí sàn. GM 38% không có nghĩa là lãi 38%.' },
  { g: 'ban', t: 'ASP', f: 'doanh thu ÷ SL thuần', s: 'tính ra', n: 'Giá bán bình quân thực nhận trên một sản phẩm.', bay: '' },
  { g: 'ban', t: 'AOV', f: 'doanh thu ÷ số đơn', s: 'tính ra', n: 'Giá trị bình quân một đơn.', bay: '' },
  { g: 'ban', t: 'Tỷ lệ huỷ / hoàn', f: 'huỷ ÷ GMV · hoàn ÷ GMV', s: 'tính ra',
    n: '', bay: 'Mẫu số là GMV chứ không phải doanh thu — dùng nhầm mẫu số sẽ ra con số nhỏ hơn nhiều.' },

  /* ---------- phí sàn ---------- */
  { g: 'phi', t: 'Phí sàn', f: 'hoa hồng + dịch vụ + giao dịch + AMS + campaign + hỗ trợ kỹ thuật',
    s: 'escrow từng đơn (6 khoản)',
    n: 'Số thật Shopee trừ trên từng đơn, không phải ước lượng theo %.',
    bay: 'KHÔNG gộp voucher shop vào đây — nó đã bị trừ ở bước Giảm giá, gộp lại là tính hai lần.' },
  { g: 'phi', t: 'Phí giao dịch', f: 'seller_transaction_fee', s: 'escrow',
    n: 'API trả hai tên (seller_transaction_fee và credit_card_transaction_fee) bằng nhau ở 100% đơn — cùng một khoản.',
    bay: 'Cộng cả hai thì phí sàn bị đội thêm khoảng 5 điểm %.' },
  { g: 'phi', t: 'Tiền thực nhận', f: 'giá bán − phí sàn − voucher shop', s: 'escrow_amount',
    n: 'Công thức dò trên từng đơn, khớp 99,6% ở 1.521 đơn; phần lệch là điều chỉnh lẻ của Shopee.', bay: '' },
  { g: 'phi', t: 'Voucher Shopee tài trợ', f: 'voucher_from_shopee', s: 'escrow',
    n: 'Sàn chịu, shop vẫn nhận đủ.', bay: 'KHÔNG phải chi phí của shop — cộng vào là tự nhận khoản người khác trả.' },
  { g: 'phi', t: 'Phí vận chuyển', f: 'phí vận chuyển thực tế − trợ giá Shopee', s: 'escrow',
    n: 'Hai khoản gần như bù trừ hết nhau, phần lệch nhỏ đã nằm trong tiền thực nhận.', bay: '' },

  /* ---------- lãi lỗ ---------- */
  { g: 'lai', t: 'Lãi / lỗ', f: 'doanh thu − giá vốn − phí sàn − quảng cáo', s: 'tính ra',
    n: 'Đây là lãi ở mức ĐÓNG GÓP.',
    bay: 'Chưa trừ chi phí vận hành (nhân sự, kho, đóng gói) vì chưa có nguồn — nên chưa phải lãi ròng.' },
  { g: 'lai', t: 'LN % doanh thu', f: 'lãi lỗ ÷ doanh thu', s: 'tính ra',
    n: 'Phân rã được: LN% = GM% − phí sàn% − ads%, ba phần cộng lại đúng bằng mức thay đổi.', bay: '' },
  { g: 'lai', t: 'Hàng tặng kèm', f: 'giá vốn của dòng bán có giá bán = 0', s: 'dòng đơn hàng',
    n: 'Chi phí thật nhưng nằm lẫn trong giá vốn nên không ai thấy — màn Lãi lỗ bóc riêng.', bay: '' },
  { g: 'lai', t: 'Phí phân bổ (ngành/SKU)', f: 'tổng phí sàn + ads × tỷ trọng doanh thu', s: 'phân bổ, KHÔNG phải số Shopee trả',
    n: 'Shopee không trả phí ở cấp SKU nên phải chia theo doanh thu.',
    bay: 'Đừng dùng con số phân bổ để đàm phán giá với nhà cung cấp — dùng cột lợi nhuận gộp.' },

  /* ---------- quảng cáo ---------- */
  { g: 'ads', t: 'Chi phí quảng cáo', f: 'expense', s: 'API ads Shopee',
    n: 'Có hai mẫu số: tổng TOÀN SHOP, và phần gán được vào chiến dịch (nhỏ hơn ~15%).',
    bay: 'Chiến dịch đã xoá thì API không trả nữa — phần chênh là chi phí không gán được, không phải sai số.' },
  { g: 'ads', t: 'CTR', f: 'lượt click ÷ lượt xem', s: 'API ads', n: 'Dưới 1,5% là ảnh bìa/tiêu đề/giá chưa đủ hấp dẫn.', bay: '' },
  { g: 'ads', t: 'CPC', f: 'chi phí ÷ lượt click', s: 'API ads', n: 'CPC tăng nghĩa là đấu giá đang đắt lên.', bay: '' },
  { g: 'ads', t: 'CR', f: 'đơn từ ads ÷ lượt click', s: 'API ads', n: 'Dưới 0,5% là trang sản phẩm hoặc giá cuối làm khách rời.', bay: '' },
  { g: 'ads', t: 'ROAS Shopee', f: 'GMV từ ads ÷ chi phí ads', s: 'số Shopee báo',
    n: '', bay: 'Tính cả đơn sau đó bị huỷ — đây là con số đẹp nhất và ít thật nhất.' },
  { g: 'ads', t: 'Chất lượng đơn', f: 'doanh thu ÷ GMV', s: 'tự tính (Shopee không có)',
    n: 'Bao nhiêu phần GMV thật sự thành doanh thu sau huỷ/hoàn/giảm giá.', bay: '' },
  { g: 'ads', t: 'ROAS thật', f: '(GMV từ ads × chất lượng đơn) ÷ chi phí ads', s: 'tự tính',
    n: 'ROAS Shopee đã chiết khấu theo tỷ lệ đơn thật sự thành công.', bay: '' },
  { g: 'ads', t: 'ROAS hoà vốn', f: '1 ÷ (GM% − phí sàn%)', s: 'tự tính',
    n: 'Ngưỡng ROAS thật phải vượt thì quảng cáo mới sinh lời.',
    bay: 'Khi GM% − phí sàn% ≤ 2 điểm thì hiện "không thể" — biên đã mỏng hơn phí, không mức ROAS nào cứu được.' },
  { g: 'ads', t: 'ACOS', f: 'chi phí ads ÷ GMV từ ads', s: 'tự tính', n: 'Nghịch đảo của ROAS Shopee.', bay: '' },
  { g: 'ads', t: 'TACOS', f: 'toàn bộ chi phí ads ÷ doanh thu', s: 'tự tính',
    n: 'Quảng cáo chiếm bao nhiêu phần doanh thu thật.', bay: '' },
  { g: 'ads', t: 'LN sau ads', f: 'doanh thu − giá vốn − phí sàn − chi phí ads', s: 'tự tính', n: '', bay: '' },

  /* ---------- tồn kho ---------- */
  { g: 'ton', t: 'Tồn khả dụng', f: 'tồn ở kho BÁN HÀNG − tồn ảo đã khai', s: 'Shopee stock_info_v2',
    n: 'Kho lưu trữ (hàng lỗi) không tính là hàng bán được.', bay: '' },
  { g: 'ton', t: 'Tồn ảo', f: 'số lượng đã bơm thêm trên Shopee, khai tay theo SKU', s: 'người dùng khai, lưu trên đám mây',
    n: 'Trừ ngay tại nguồn để mọi phép tính phía sau chạy trên tồn thật.',
    bay: 'Không khai thì hệ thống tưởng còn nhiều hàng và không đề xuất đặt thêm — đúng lúc thực tế đang cạn.' },
  { g: 'ton', t: 'Sức bán (vel3)', f: 'trung bình SL thuần 3 tháng gần nhất', s: 'tính ra',
    n: 'Chỉ tính trên tháng ĐỦ ngày — tháng chạy dở bị loại khỏi cửa sổ.', bay: '' },
  { g: 'ton', t: 'Tồn an toàn (SS)', f: `${Z_SERVICE} × độ lệch chuẩn × √(lead time ÷ 30)`, s: 'tính ra',
    n: `Hệ số ${Z_SERVICE} ứng với mức phục vụ 99%.`, bay: '' },
  { g: 'ton', t: 'Điểm đặt lại (ROP)', f: 'vel3 × (lead time ÷ 30) + tồn an toàn', s: 'tính ra',
    n: 'Tồn chạm mức này là phải đặt.', bay: '' },
  { g: 'ton', t: 'Mức đặt tới (OUP)', f: 'vel3 × ((lead time + 30) ÷ 30) + tồn an toàn', s: 'tính ra', n: '', bay: '' },
  { g: 'ton', t: 'Cần đặt', f: 'OUP − tồn, làm tròn LÊN bội số MOQ', s: 'tính ra',
    n: `Chỉ đề xuất khi sức bán ≥ ${VMIN}/tháng — dưới mức đó coi là bán chậm, đặt thêm là chôn vốn.`, bay: '' },
  { g: 'ton', t: 'Số tháng bán còn', f: 'mô phỏng trừ dần tồn theo mùa vụ từng tháng', s: 'tính ra',
    n: 'Không phải phép chia đơn giản — dùng đúng mùa vụ nên tháng cao điểm sẽ hết nhanh hơn.', bay: '' },
  { g: 'ton', t: 'Lead time', f: 'khai theo nhà cung cấp', s: `mặc định ${DEFAULT_LT} ngày khi chưa khai`,
    n: 'Sửa được ở màn Tồn kho, lưu tại máy.', bay: '' },

  /* ---------- dự báo ---------- */
  { g: 'dubao', t: 'Hệ số tăng trưởng (g)', f: '(vel 3 tháng gần ÷ vel 3 tháng trước) − 1', s: 'tính ra',
    n: 'Kẹp trong khoảng −40% đến +60% để một tháng bất thường không kéo lệch cả kế hoạch.', bay: '' },
  { g: 'dubao', t: 'Chỉ số mùa vụ', f: 'SL tháng đó năm trước ÷ trung bình 12 tháng', s: 'tính ra',
    n: 'Kẹp trong 0,4–2,5.', bay: '' },
  { g: 'dubao', t: 'Dự báo tháng t', f: 'vel3 × (1 + g) × chỉ số mùa vụ', s: 'tính ra',
    n: 'Mức bán hiện tại × xu hướng × mùa vụ.',
    bay: 'SKU đã ngừng bán (vel3 = 0) sẽ dự báo 0 — không "hồi sinh" theo mùa vụ.' },
]

const MAN = [
  { m: 'Tổng quan', hoi: 'Kỳ này công ty bán được bao nhiêu, so kỳ trước thế nào?',
    co: '10 KPI · xu hướng doanh thu & GM · top 10 SKU',
    khi: 'Mở đầu mỗi cuộc họp — nhìn 30 giây biết đang lên hay xuống.' },
  { m: 'Lịch bán hàng', hoi: 'Ngày nào trong tháng bán mạnh, thứ mấy bán tốt?',
    co: 'Heatmap theo ngày · nhịp theo thứ · SKU bán trong ngày',
    khi: 'Chọn ngày chạy khuyến mãi, xếp ca kho.' },
  { m: 'Ngành hàng', hoi: 'Ngành nào đang kéo hay đang dìm kết quả?',
    co: '8 KPI mỗi ngành · xu hướng · loại hình · NCC · bảng theo kích thước',
    khi: 'Khi Tổng quan cho thấy có gì đó đổi, vào đây tìm ngành gây ra.' },
  { m: 'Range Review', hoi: 'Danh mục đang thừa/thiếu ở phân khúc nào?',
    co: 'Ma trận loại hình × phân khúc giá · bảng hành động',
    khi: 'Rà danh mục theo mùa, quyết định thêm/bớt dòng hàng.' },
  { m: 'Ma trận sản phẩm', hoi: 'Khoảng giá nào công ty chưa có hàng bán?',
    co: 'Ngành × NCC × bậc giá, ô trống = khoảng trống danh mục',
    khi: 'Tìm khoảng trống để phát triển sản phẩm mới.' },
  { m: 'Marketing Analysis', hoi: 'Tiền quảng cáo đang đi đâu và có sinh lời không?',
    co: '16 KPI · phễu · 8 biểu đồ · chẩn đoán theo chiến dịch/sản phẩm/ngành',
    khi: 'Trước khi tăng hay cắt ngân sách quảng cáo.' },
  { m: 'Lãi lỗ', hoi: 'Tiền rơi ở đâu từ GMV xuống lãi cuối?',
    co: 'Thác nước · phí sàn 6 khoản · phân rã vì sao lãi đổi · lãi lỗ theo ngành & SKU',
    khi: 'Họp kết quả kinh doanh, quyết định giá và ngân sách.' },
  { m: 'Nhà cung cấp & Mua hàng', hoi: 'Mua của ai, giá thế nào, còn nợ bao nhiêu?',
    co: 'Nhịp PO · danh sách NCC · so sánh giá theo SKU · công nợ',
    khi: 'Đàm phán giá, lên kế hoạch thanh toán.' },
  { m: 'Tồn kho & Đặt hàng', hoi: 'Cần đặt SKU nào, bao nhiêu, và vốn đang chôn ở đâu?',
    co: '5 KPI · 6 trạng thái tồn · điểm đặt lại · tuổi tồn · tồn ảo',
    khi: 'Lên PO hàng tuần, rà vốn đọng.' },
  { m: 'Forecast & Kế hoạch', hoi: 'Sáu tháng tới bán được bao nhiêu, cần chuẩn bị gì?',
    co: 'Dự báo cả năm · kế hoạch đặt hàng · S&OP · dự báo 6 tháng theo SKU',
    khi: 'Lập kế hoạch quý, chốt ngân sách nhập hàng.' },
  { m: 'Cơ sở hạ tầng', hoi: 'Số trên app có mới không, có bước nào hỏng không?',
    co: 'Luồng dữ liệu · trạng thái từng bảng · 10 phép tự soát · nhật ký chạy',
    khi: 'Khi nghi số sai hoặc số không đổi — vào đây trước khi hỏi ai.' },
]

export default function Guide() {
  const [tab, setTab] = useState('intro')
  const [q, setQ] = useState('')
  const [ng, setNg] = useState('')

  const d = useMemo(() => {
    const rows = sales.rows
    const thang = MONTHS.length
    const sku = new Set(rows.filter(r => (r.un || 0) > 0).map(r => r.sku)).size
    const ton = stock.rows.reduce((a, r) => a + r.qty, 0)
    const adsTu = platform.ads.length ? platform.ads[0].ym : null
    return {
      thang, sku, ton, adsTu,
      donHang: sales.meta.orders,
      skuMaster: master.skus.length,
      kho: stock.warehouses.length,
      tuThang: MONTHS[0], denThang: MONTHS[MONTHS.length - 1],
    }
  }, [])

  const dict = useMemo(() => {
    const k = q.trim().toLowerCase()
    return DICT.filter(x => (!ng || x.g === ng)
      && (!k || `${x.t} ${x.f} ${x.s} ${x.n} ${x.bay}`.toLowerCase().includes(k)))
  }, [q, ng])

  return (
    <div className="gd-page">
      <div className="m2-title">
        <div>
          <h2>Giới thiệu &amp; Định nghĩa</h2>
          <p>
            Sổ tay của app: mỗi con số nghĩa là gì, tính bằng công thức nào, lấy từ đâu,
            và chỗ nào dễ đọc sai. Mở trang này trước khi tranh luận về một con số.
          </p>
        </div>
        <div className="gd-stamp">
          <span>Phạm vi dữ liệu</span>
          <b>{d.tuThang} → {d.denThang}</b>
          <i>{num(d.donHang)} đơn · {d.skuMaster} SKU</i>
        </div>
      </div>

      <div className="mk-tabbar">
        <div className="mk-tabs">
          {[['intro', '◈', 'App này là gì', null],
            ['dict', 'ƒ', 'Từ điển chỉ số', DICT.length],
            ['screens', '▦', 'Đọc từng màn', MAN.length],
            ['rules', '⚠', 'Quy ước & giới hạn', null]].map(([id, ic, lb, n]) => (
              <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                <span className="ic" aria-hidden>{ic}</span>{lb}
                {n != null && <em>{n}</em>}
              </button>
            ))}
        </div>
      </div>

      {tab === 'intro' && <IntroTab d={d} />}
      {tab === 'dict' && (
        <DictTab rows={dict} q={q} setQ={setQ} ng={ng} setNg={setNg} tong={DICT.length} />
      )}
      {tab === 'screens' && <ScreensTab />}
      {tab === 'rules' && <RulesTab d={d} />}
    </div>
  )
}

/* ================= App này là gì ================= */
function IntroTab({ d }) {
  return (
    <div className="gd-body">
      <section className="m2-panel">
        <div className="m2-head">
          <h3>App này trả lời cái gì</h3>
          <span>Một chỗ duy nhất để nhìn toàn bộ chuỗi: bán được bao nhiêu → thật sự thu về
            bao nhiêu → còn lại bao nhiêu → phải nhập thêm gì</span>
        </div>
        <div className="gd-flow">
          {[['Bán ra', 'GMV, đơn hàng, khách huỷ bao nhiêu'],
            ['Thu về', 'Sau huỷ, hoàn, giảm giá và phí sàn'],
            ['Còn lại', 'Sau giá vốn và quảng cáo — lãi hay lỗ'],
            ['Nhập tiếp', 'Cần đặt SKU nào, bao nhiêu, khi nào']].map(([a, b], i) => (
              <div key={a} className="gd-step">
                <b>{i + 1}</b>
                <div><strong>{a}</strong><span>{b}</span></div>
              </div>
            ))}
        </div>
      </section>

      <div className="gd-row2">
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Số đến từ đâu</h3>
            <span>Hai nguồn, không có nguồn thứ ba</span>
          </div>
          <table className="gd-table">
            <thead><tr><th>Nguồn</th><th>Cho cái gì</th><th>Cập nhật</th></tr></thead>
            <tbody>
              <tr>
                <td><b>Master Data.xlsx</b></td>
                <td className="sm">Danh mục SKU, ngành hàng, loại hình, nhà cung cấp,
                  giá vốn, đơn mua hàng (PO), công nợ</td>
                <td className="sm">Tải lên tay ở màn Cơ sở hạ tầng</td>
              </tr>
              <tr>
                <td><b>Shopee Open API</b></td>
                <td className="sm">Đơn hàng, tiền về từng đơn (escrow), đơn hoàn, tồn kho
                  theo kho, chi phí quảng cáo</td>
                <td className="sm">Tự động 3 khung giờ mỗi ngày</td>
              </tr>
            </tbody>
          </table>
          <p className="gd-note">
            Mọi con số tiền và số lượng đều từ Shopee. Excel chỉ cho danh mục và giá vốn —
            không có con số bán hàng nào gõ tay.
          </p>
        </section>

        <section className="m2-panel">
          <div className="m2-head">
            <h3>Số mới tới đâu</h3>
            <span>Biết mốc dữ liệu trước khi kết luận</span>
          </div>
          <dl className="gd-kv">
            <dt>Phạm vi</dt><dd>{d.tuThang} → {d.denThang} ({d.thang} tháng)</dd>
            <dt>Đơn hàng</dt><dd>{num(d.donHang)} đơn</dd>
            <dt>SKU có bán</dt><dd>{d.sku} trên {d.skuMaster} SKU trong Master Data</dd>
            <dt>Tồn kho</dt><dd>{num(d.ton)} sản phẩm · {d.kho} kho</dd>
            <dt>Quảng cáo</dt><dd>chỉ có từ {d.adsTu} — API Shopee lưu khoảng 5 tháng</dd>
            <dt>Ngày mới nhất</dt><dd>{LAST_DATA_DAY}</dd>
          </dl>
          {PARTIAL && (
            <p className="gd-note warn">
              Tháng <b>{MONTHS[PARTIAL.m]}</b> mới có <b>{PARTIAL.have}/{PARTIAL.days}</b> ngày dữ liệu.
              App tự loại tháng chạy dở khỏi mọi phép tính tốc độ bán và dự báo, nhưng khi
              anh so tháng này với tháng trước bằng mắt thì phải nhớ nó chưa đủ ngày.
            </p>
          )}
        </section>
      </div>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Ba điều nên biết trước khi đọc bất kỳ con số nào</h3>
        </div>
        <ol className="gd-ol">
          <li>
            <b>GMV không phải doanh thu.</b> Phần lớn chênh lệch nằm ở đơn khách huỷ.
            Mọi màn dùng chữ "doanh thu" đều có nghĩa là đã trừ huỷ, hoàn và giảm giá.
          </li>
          <li>
            <b>GM% chưa trừ phí sàn.</b> Phí sàn hiện quanh 21–30% doanh thu tuỳ tháng,
            nên GM 38% không có nghĩa là lãi 38%. Muốn biết còn lại bao nhiêu thì vào màn Lãi lỗ.
          </li>
          <li>
            <b>Lãi ở đây là lãi đóng góp.</b> Chưa trừ nhân sự, kho bãi, đóng gói — những
            khoản chưa có nguồn nào cấp vào app.
          </li>
        </ol>
      </section>
    </div>
  )
}

/* ================= Từ điển ================= */
function DictTab({ rows, q, setQ, ng, setNg, tong }) {
  return (
    <div className="gd-body">
      <section className="m2-panel">
        <div className="m2-head">
          <h3>Từ điển chỉ số</h3>
          <span>Công thức chép đúng từ code đang chạy. Cột cuối là chỗ đã có người đọc sai thật —
            đọc cột đó trước khi dùng con số để ra quyết định</span>
        </div>
        <div className="gd-filter">
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Tìm chỉ số, ví dụ: ROAS, tồn an toàn, voucher…" />
          <div className="gd-chips">
            <button className={!ng ? 'on' : ''} onClick={() => setNg('')}>Tất cả</button>
            {NHOM.map(([id, lb]) => (
              <button key={id} className={ng === id ? 'on' : ''} onClick={() => setNg(id)}>{lb}</button>
            ))}
          </div>
          <span className="gd-count">{rows.length}/{tong} chỉ số</span>
        </div>
        <div className="m2-tablewrap">
          <table className="gd-table dict">
            <thead>
              <tr><th>Chỉ số</th><th>Công thức</th><th>Nguồn</th><th>Cạm bẫy</th></tr>
            </thead>
            <tbody>
              {rows.map(x => (
                <tr key={x.t + x.g}>
                  <td>
                    <b>{x.t}</b>
                    <i className="grp">{NHOM.find(n => n[0] === x.g)?.[1]}</i>
                  </td>
                  <td className="sm mono">{x.f}{x.n && <i className="note">{x.n}</i>}</td>
                  <td className="sm">{x.s}</td>
                  <td className="sm bay">{x.bay || '—'}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={4} className="gd-empty">Không có chỉ số nào khớp “{q}”.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

/* ================= Đọc từng màn ================= */
function ScreensTab() {
  return (
    <div className="gd-body">
      <section className="m2-panel">
        <div className="m2-head">
          <h3>Mỗi màn trả lời câu hỏi gì</h3>
          <span>Chọn màn theo câu hỏi đang có trong đầu, không phải theo thứ tự menu</span>
        </div>
        <div className="m2-tablewrap">
          <table className="gd-table">
            <thead>
              <tr><th>Màn hình</th><th>Trả lời câu hỏi</th><th>Có gì</th><th>Dùng khi nào</th></tr>
            </thead>
            <tbody>
              {MAN.map(x => (
                <tr key={x.m}>
                  <td><b>{x.m}</b></td>
                  <td className="sm hoi">{x.hoi}</td>
                  <td className="sm">{x.co}</td>
                  <td className="sm">{x.khi}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Sáu trạng thái tồn kho</h3>
          <span>Dùng chung ở màn Tồn kho và Forecast</span>
        </div>
        <div className="gd-status">
          {STATUS.map(s => (
            <div key={s.id} className="gd-st">
              <span className="ic" aria-hidden>{s.icon}</span>
              <div><strong>{s.label}</strong><span>{s.act}</span></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

/* ================= Quy ước & giới hạn ================= */
function RulesTab({ d }) {
  return (
    <div className="gd-body">
      <div className="gd-row2">
        <section className="m2-panel">
          <div className="m2-head">
            <h3>Quy ước đọc số</h3>
          </div>
          <dl className="gd-kv">
            <dt>Đơn vị tiền</dt><dd>triệu đồng, trừ khi ghi khác</dd>
            <dt>Giá vốn</dt><dd>chưa VAT</dd>
            <dt>Công nợ NCC</dt><dd>trên giá CÓ VAT — không trừ thẳng với giá trị PO</dd>
            <dt>Kỳ</dt><dd>theo tháng, chọn ở thanh lọc trên cùng</dd>
            <dt>Kỳ so sánh</dt><dd>kỳ liền trước hoặc cùng kỳ năm trước, chọn ở thanh lọc</dd>
            <dt>Tháng chạy dở</dt><dd>bị loại khỏi tốc độ bán và dự báo, nhưng vẫn hiện ở biểu đồ</dd>
            <dt>Mức phục vụ</dt><dd>99% (hệ số {Z_SERVICE})</dd>
            <dt>Ngưỡng bán chậm</dt><dd>dưới {VMIN} sản phẩm/tháng thì không đề xuất đặt thêm</dd>
          </dl>
        </section>

        <section className="m2-panel">
          <div className="m2-head">
            <h3>App KHÔNG có gì</h3>
            <span>Biết giới hạn để không kết luận quá tay</span>
          </div>
          <ul className="gd-ul">
            <li><b>Chi phí vận hành</b> — nhân sự, kho bãi, đóng gói, vận chuyển nội bộ.
              Chưa có nguồn nào cấp vào app.</li>
            <li><b>Kênh ngoài Shopee</b> — toàn bộ số là của shop Tuft &amp; Needle by Sleep Expert
              trên Shopee. Bán ở kênh khác không nằm đây.</li>
            <li><b>Quảng cáo trước {d.adsTu}</b> — API Shopee chỉ lưu ~5 tháng, nên lãi các tháng
              cũ là <b>chưa trừ ads</b> và đang bị nhìn cao hơn thực tế.</li>
            <li><b>Địa lý khách hàng</b> — Shopee che tỉnh/thành người mua, nên không có phân tích
              theo vùng.</li>
            <li><b>Tồn kho ngoài Shopee</b> — chỉ có tồn Shopee khai báo theo kho, chưa đối chiếu
              với sổ kho nội bộ.</li>
          </ul>
        </section>
      </div>

      <section className="m2-panel">
        <div className="m2-head">
          <h3>Khi thấy một con số đáng ngờ thì làm gì</h3>
          <span>Theo thứ tự, dừng ở bước nào ra vấn đề thì dừng</span>
        </div>
        <ol className="gd-ol">
          <li>
            Mở <b>Cơ sở hạ tầng → Tự soát dữ liệu</b>. Mười phép kiểm tự chạy ở đó bắt được
            phần lớn lỗi dữ liệu đã từng xảy ra.
          </li>
          <li>
            Xem <b>mốc kết xuất</b> ở đầu màn Cơ sở hạ tầng. Nếu trang báo đang xem số cũ thì
            con số chưa phản ánh hôm nay.
          </li>
          <li>
            Tra chỉ số đó ở tab <b>Từ điển chỉ số</b>, đọc cột <b>Cạm bẫy</b> — phần lớn tranh
            luận về số là do hai người dùng hai định nghĩa khác nhau.
          </li>
          <li>
            Còn nghi thì đối chiếu với <b>Lãi lỗ → Tiền rơi ở đâu</b>: khối đối chiếu ở đó so
            con số tự tính với số tiền Shopee thật sự chuyển về.
          </li>
        </ol>
      </section>
    </div>
  )
}
