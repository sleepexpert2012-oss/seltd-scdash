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
  ['ns', 'Kế hoạch & ngân sách'],
  ['qt', 'Quản trị tài chính'],
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
  { g: 'phi', t: 'Công nợ nhà cung cấp', f: 'khai tay theo từng NCC', s: 'phần mềm kế toán',
    n: 'Chốt theo ngày, dùng để lập kế hoạch chi tiền ở màn Dòng tiền.',
    bay: 'Số app tự cộng từ PO trong Master Data LỆCH xa (1.380tr so với 779tr) vì Master Data chưa đánh dấu khoản đã thanh toán. Đừng dùng số từ PO để chi tiền.' },
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
  { g: 'ton', t: 'Tồn khả dụng', f: 'tồn đầu kỳ (kho bán được) − SL bán sau mốc',
    s: 'Kiểm kho thực tế, tải lên từ Excel',
    n: 'Từ 08/11/2026 KHÔNG lấy từ Shopee nữa vì API trả sai (app 949 vs kiểm kho 827).',
    bay: 'Kho trưng bày/hàng lỗi không tính là bán được, nhưng VẪN tính vào giá trị tồn kho.' },
  { g: 'ton', t: 'Tồn đầu kỳ', f: 'ảnh chụp kiểm kho tại một thời điểm', s: 'file Excel kiểm kho',
    n: 'Mã kho WH001..WH005 theo file kiểm kho, khác mã kho Shopee WH01..WH04.',
    bay: 'Cột theo từng kho là số TẠI MỐC đầu kỳ. Phần đã bán cố ý không chia xuống từng kho vì Shopee không cho biết đơn xuất từ kho nào.' },
  { g: 'ton', t: 'SL bán sau mốc', f: 'SL thuần Shopee (ngày đặt > mốc) + SL bán ngoài sàn khai tay',
    s: 'đơn Shopee + khai tay',
    n: '', bay: 'Dùng ngày ĐẶT đơn, không phải ngày xuất kho — lệch vài ngày với lúc hàng thật sự rời kho.' },
  { g: 'ton', t: 'Tồn ảo', f: 'số lượng đã bơm thêm trên Shopee, khai tay theo SKU', s: 'người dùng khai, lưu trên đám mây',
    n: 'Từ 08/11/2026 KHÔNG còn trừ vào tồn thật — chỉ để đối chiếu với số Shopee đang hiển thị.',
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

  /* ---------- kế hoạch & ngân sách (src/lib/fin.js, bảng fin_*) ---------- */
  { g: 'ns', t: 'Ngân sách', f: 'số người dùng nhập theo phiên bản × tháng × khoản mục', s: 'bảng fin_plan',
    n: 'Mỗi năm một phiên bản "hiện hành" — các màn so sánh mặc định đọc bản này. Đổi bản cũ thì nhân bản, không sửa đè.',
    bay: 'Ô trống là CHƯA CÓ SỐ, khác ô nhập 0. Tổng có ô trống bị thấp hơn thật.' },
  { g: 'ns', t: 'Khoản tự tính', f: 'doanh thu, giá vốn, 6 khoản phí sàn, quảng cáo Shopee', s: 'Shopee API + phiếu xuất kho',
    n: 'Cùng cách tính với màn Lãi lỗ. Không nhập tay được.',
    bay: 'Quảng cáo Shopee chỉ có từ 2026-04 (API giữ ~5 tháng): tháng trước đó là chưa có số, không phải 0.' },
  { g: 'ns', t: 'Doanh thu bán ngoài sàn', f: 'Σ thành tiền phiếu xuất kho, theo tháng ngày giao', s: 'ar_delivery',
    n: 'Chưa gồm VAT.', bay: 'Đơn đã đặt mà chưa xuất kho chưa phải doanh thu.' },
  { g: 'ns', t: 'Giá vốn bán ngoài sàn', f: 'SL trên phiếu xuất × giá vốn Master Data', s: 'ar_delivery_line + Master Data',
    n: 'Gồm cả hàng tặng, hàng mẫu (thành tiền 0 nhưng hàng vẫn ra khỏi kho).', bay: '' },
  { g: 'ns', t: 'Chi phí thực tế nhập tay', f: 'số người dùng nhập theo tháng phát sinh', s: 'bảng fin_actual',
    n: 'Lương, thuê nhà, kho bãi, dịch vụ, vật tư, tiếp thị ngoài Shopee, lãi vay. Ghi theo tháng PHÁT SINH (dồn tích).',
    bay: 'Không phải tiền chi trong kế hoạch dòng tiền tuần — cùng khoản nhưng khác thời điểm. Tháng chưa nhập là "chưa đủ chi phí", không tính như 0.' },
  { g: 'ns', t: 'Cố định / biến đổi', f: 'phân loại người dùng đặt cho từng khoản', s: 'fin_line.behavior',
    n: 'Biến đổi = tăng giảm theo doanh thu (giá vốn, phí sàn, quảng cáo Shopee, kho bãi). Cố định = không theo doanh thu.',
    bay: 'Là giả định, không phải sự thật kế toán — quyết định trực tiếp điểm hòa vốn. Kho bãi khoán theo tháng thì phải đổi sang cố định.' },
  { g: 'ns', t: 'Trần % doanh thu', f: 'chi phí khoản đó ÷ doanh thu ≤ trần', s: 'fin_line.cap_pct',
    n: 'Mức chi tối đa cho phép trên mỗi đồng doanh thu, dùng ở màn Định mức chi phí.', bay: '' },
  { g: 'ns', t: 'Lợi nhuận trước thuế (kế hoạch)', f: 'doanh thu − giá vốn − phí sàn − marketing − chi phí hoạt động − chi phí tài chính',
    s: 'tính ra', n: 'Tính trên lưới ngân sách.',
    bay: 'Khoản nào chưa có số thì không bị trừ → lợi nhuận bị nhìn cao hơn thật.' },

  /* ---------- quản trị tài chính (src/lib/fin.js, fcSnap.js, insights.js) ---------- */
  { g: 'qt', t: 'Dự báo cả năm (KH vs TĐ)', f: 'thực đạt đến tháng chọn + ngân sách các tháng còn lại', s: 'màn Lãi lỗ → Kế hoạch vs Thực đạt',
    n: 'Mặc định chỉ tính tháng đã kết thúc.', bay: 'Tháng đang chạy dở so với ngân sách cả tháng thì lúc nào cũng "hụt".' },
  { g: 'qt', t: 'Đóng góp vào lệch lợi nhuận', f: 'dấu nhóm × (thực tế − ngân sách) của từng khoản', s: 'tính ra',
    n: 'Cộng mọi khoản = đúng mức lệch lợi nhuận trước thuế.', bay: 'Chi phí cao hơn kế hoạch là đóng góp ÂM.' },
  { g: 'qt', t: 'Mẫu số định mức', f: 'phí sàn, quảng cáo & giá vốn Shopee ÷ DT Shopee; giá vốn ngoài sàn ÷ DT ngoài sàn; còn lại ÷ DT toàn công ty', s: 'màn Định mức chi phí',
    n: 'Mỗi khoản chia cho doanh thu của kênh sinh ra nó.', bay: 'Chia phí sàn cho cả doanh thu ngoài sàn làm phí sàn trông rẻ giả.' },
  { g: 'qt', t: 'Tiền vượt định mức', f: 'biến đổi: (% thực tế − trần) × DT mẫu số · cố định: thực tế − ngân sách', s: 'tính ra',
    n: 'Ngưỡng "cần chú ý" từ 90% trần / ngân sách.', bay: 'Khoản cố định không xét theo % doanh thu: doanh thu giảm thì % tăng dù không chi thêm.' },
  { g: 'qt', t: 'Số dư đảm phí (CM) · CM%', f: 'doanh thu − chi phí biến đổi · CM ÷ doanh thu', s: 'màn Điểm hòa vốn', n: '', bay: 'CM% ≤ 0 thì không có điểm hòa vốn: bán càng nhiều càng lỗ.' },
  { g: 'qt', t: 'Doanh thu hòa vốn', f: 'chi phí cố định ÷ CM%', s: 'tính ra',
    n: 'Chỉ cộng các tháng đã nhập đủ chi phí.', bay: 'Hòa vốn từng tháng khác hòa vốn lũy kế — đọc đúng nhãn.' },
  { g: 'qt', t: 'Biên an toàn (MOS)', f: '(doanh thu − doanh thu hòa vốn) ÷ doanh thu', s: 'tính ra', n: 'Doanh thu giảm bao nhiêu % thì bắt đầu lỗ.', bay: '' },
  { g: 'qt', t: 'ROAS hòa vốn · ROAS thật', f: '1 ÷ (biên gộp − phí sàn%) · GMV quảng cáo × (DT thuần ÷ GMV) ÷ chi quảng cáo', s: 'Shopee API',
    n: 'Cùng định nghĩa với màn Marketing.', bay: 'ROAS Shopee báo là theo GMV — phải quy về doanh thu thuần mới so được với mức hòa vốn.' },
  { g: 'qt', t: 'Tốc độ đốt tiền · đường băng', f: 'bình quân dòng tiền thuần 3 tháng âm gần nhất · số dư ÷ tốc độ đốt', s: 'kế hoạch dòng tiền tuần',
    n: 'Tuần có nhập tiền mặt đầu kỳ được lấy làm mốc số thật.', bay: 'Không có tháng âm thì ghi "không đốt tiền", không ra số vô cực.' },
  { g: 'qt', t: 'Chu kỳ tiền mặt (CCC)', f: 'DIO + DSO − DPO, cửa sổ 90 ngày', s: 'màn Dòng tiền → Vốn lưu động',
    n: 'DIO = tồn ÷ giá vốn 90 ngày × 90 · DSO = phải thu ÷ doanh thu 90 ngày × 90 · DPO = phải trả NCC ÷ giá vốn 90 ngày × 90.',
    bay: 'Chưa tính tiền Shopee chờ giải ngân → DSO thấp hơn thật. Tồn thiếu giá vốn → DIO thấp hơn thật.' },
  { g: 'qt', t: 'WAPE · Bias dự báo', f: 'Σ|thực tế − dự báo| ÷ Σ thực tế · Σ(dự báo − thực tế) ÷ Σ thực tế', s: 'bản dự báo đã chốt + bán Shopee',
    n: 'Tính ở cấp SKU × tháng rồi cộng.', bay: 'Tính trên tổng thì thừa SKU này bù thiếu SKU kia, che mất sai số.' },
  { g: 'qt', t: 'Giá trị gia tăng của dự báo', f: 'WAPE cách đoán ngây thơ − WAPE bản chốt', s: 'tính ra',
    n: 'Ngây thơ = bình quân 3 tháng đủ trước ngày chốt.', bay: 'Âm nghĩa là dự báo còn tệ hơn đoán đơn giản.' },
  { g: 'qt', t: 'Nhận xét tự động', f: '15 quy tắc cố định, ngưỡng ở đầu src/lib/insights.js', s: 'màn Báo cáo điều hành',
    n: 'Không dùng AI: cùng dữ liệu luôn ra cùng câu. Quy tắc thiếu dữ liệu được liệt kê kèm lý do.', bay: 'Báo cáo đã lưu là số đóng băng — không tự đổi khi dữ liệu mới về.' },
  { g: 'qt', t: '% đạt KPI · điểm phòng ban', f: 'cao-là-tốt: thực tế ÷ mục tiêu · thấp-là-tốt: mục tiêu ÷ thực tế (chặn 120%) · điểm = bình quân trọng số', s: 'màn Chiến lược & KPI',
    n: 'Chỉ cấp phòng ban. Xếp loại: Xuất sắc ≥100% · Tốt 80–99% · Đạt 60–79% · Chưa đạt <60%.',
    bay: 'Phòng chưa đủ 100% trọng số hoặc dưới 2 KPI thì không xếp hạng. Tháng chưa có số là "chưa có số", không phải 0%.' },
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
