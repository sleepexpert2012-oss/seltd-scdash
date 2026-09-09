# Audit toàn bộ app — 08/09/2026

Soát 5 lớp: dữ liệu gốc trong Supabase → file JSON của app → tính nhất quán định
nghĩa giữa các màn → lỗi chạy trên mọi màn/tab/bộ lọc biên → lỗ hổng bảo mật.

## Kết quả tóm gọn
3 lỗi thật (đã sửa), 4 điểm cần biết, 1 việc chờ quyết định. Không có lỗ hổng
bảo mật. 45+ tổ hợp màn × tab sạch trên 4 kịch bản bộ lọc.

## LỖI 1 (nặng, đã sửa) — Lịch bán hàng báo doanh thu cao hơn mọi màn khác
`shopee.mart_sales_sku_day.rev` **không trừ voucher shop**, còn
`mart_sales_sku_month.rev` thì trừ. Hai màn dùng hai view khác nhau nên ra hai
con số.

Lệch **cả 21/21 tháng**, tổng **+105,6tr (+5,6%)** — đúng bằng tổng `dc`.
Tháng lệch nhiều nhất 2025-03: 23,4tr → 31,4tr (**+34%**).

Cách phát hiện: cộng `rev` theo tháng từ `sales.json` và từ `sales_daily.json`
rồi so từng tháng. GMV, số lượng và giá vốn khớp, chỉ `rev` lệch → khoanh ngay
được vào khoản voucher.

Sửa: thêm join `stg_escrow_item` và trừ voucher theo tỷ lệ `qty_net/qty` vào view
ngày, y như view tháng. Lưu ý kỹ thuật: `create or replace view` **không cho đổi
tên cột đã có**, nên cột `dc` mới phải để cuối danh sách select.
Kiểm sau sửa: 21/21 tháng khớp, màn Lịch tháng 2026.09 từ 9tr về 8tr.

## LỖI 2 (nặng, đã sửa) — Hai màn báo chi phí quảng cáo khác nhau
Màn Marketing KPI ghi **48,6tr**, màn Lãi lỗ ghi **57,3tr**. Chênh 8,7tr (15%),
riêng 06/2026 thiếu 4,06tr trên 6,81tr (**60% chi phí tháng đó**).

Nguyên nhân: có hai mẫu số khác nhau và màn Marketing chỉ dùng cái nhỏ.
`raw_ads_shop_daily` là tổng chi phí toàn shop; `raw_ads_campaign_daily` chỉ có
các chiến dịch API còn trả về (chiến dịch đã xoá thì mất). Mọi chỉ số dẫn xuất
(CPC, chi phí/đơn, ROAS, TACOS, LN sau ads) đều tính trên mẫu số nhỏ → **ROAS bị
nhìn cao hơn thật ~18%**.

Sửa: KPI "Chi phí quảng cáo" hiện tổng shop, dòng phụ ghi rõ bao nhiêu gán được
chiến dịch và bao nhiêu chưa gán (chuyển màu hổ phách khi chưa gán > 10%).
TACOS và LN sau ads chuyển sang dùng tổng shop để khớp màn Lãi lỗ. ROAS/CPC/CR
giữ mẫu số "gán được" vì không có lượt xem/click cho phần chưa gán — nhưng nhãn
ghi rõ điều đó. Khi có bộ lọc ngành/SKU thì không chia được phần chưa gán, lúc đó
quay về dùng đúng phần gán được.

## LỖI 3 (vừa, đã sửa) — Kho hàng lỗi được tính như hàng bán được
`STOCK_RAW_BY_SKU` cộng cả 4 kho, trong đó WH04 "Kho hàng lỗi" có
`type = 'Kho lưu trữ'`. Tồn của nó chạy vào điểm đặt hàng, số tháng bán còn, tồn
chết và vốn tồn đọng — tức hàng lỗi được coi là hàng bán được.

Hiện chỉ 2 unit / 6,8tr (0,7% vốn tồn) nên sai số nhỏ, nhưng sai nguyên tắc và sẽ
lớn dần khi hàng lỗi dồn lại.

Sửa: thêm `SELL_WH` (chỉ kho `type = 'Kho bán hàng'`); `total` chỉ gồm kho bán
hàng, hàng kho lưu trữ đếm riêng ở `store` + `STORE_ONLY`. Trừ tồn ảo cũng chỉ
trừ trên kho bán hàng. Nhãn KPI ghi rõ "không tính vào tồn khả dụng".
Sau sửa: tồn tổng 1.006 → 1.004 unit, vốn tồn 861 → 854tr.

## ĐIỂM CẦN BIẾT (không phải lỗi app)
1. **60/143 SKU chưa khai giá vốn** — hiện chưa bán và chưa có tồn nên chưa sai
   số nào. Nhưng nếu bán mà chưa khai thì GM% = 100% một cách âm thầm.
2. **8 dòng doanh thu âm** (−192 nghìn): hàng tặng kèm giá 0 bị phân bổ voucher
   shop. Nhỏ, nhưng làm GM% của SKU đó âm vô lý trong bảng.
3. **Hàng tặng kèm 25,9tr** giá vốn không sinh doanh thu, nằm lẫn trong giá vốn.
   Đã bóc riêng thành khối ở màn Lãi lỗ.
4. **Quảng cáo chỉ có 6/21 tháng** (từ 2026-04) vì API Shopee chỉ lưu ~5 tháng.
   Lãi các tháng cũ là **chưa trừ ads**.

## CHỜ QUYẾT ĐỊNH
Màn **Giới thiệu & Định nghĩa** vẫn là bản nháp: ghi "Khu vực nội dung của trang
này sẽ được dựng ở bước kế tiếp" và "Màn hình 0 chỉ dựng khung". Link đang public
cho cả tổ chức nên đây là lỗ hổng nhìn thấy được. Dựng hay ẩn khỏi menu là quyết
định của anh Louis.

## ĐÃ KIỂM VÀ ĐẠT
- **Khớp chéo giữa các màn** (kỳ 2026.01→09): Tổng quan = Lãi lỗ = Range Review =
  Ngành hàng. GMV 1.254 · huỷ 706 · doanh thu 479 · giá vốn 288 · Nệm 316 /
  Chăn 108 / Gối 55. Không màn nào lệch.
- **File app vs Supabase**: gmv/rev/cogs/cx/rt/dc/phí sàn khớp từng con số.
- **Không có SKU lạ**: mọi SKU bán và tồn đều có trong Master Data.
- **Lỗi chạy**: 45+ tổ hợp màn × tab, trên 4 kịch bản (6 tháng gần nhất · chỉ
  tháng chạy dở 2026.09 · toàn kỳ · bộ lọc không ra dòng nào) — không có NaN,
  Infinity, undefined, không có ErrorBoundary, không lỗi console.
- **Bảo mật**: quét bundle với 7 mẫu khoá (`shpk`, `postgresql://`,
  `service_role`, `db_password`, mật khẩu DB, `sb_secret`, JWT) — **không lọt
  khoá nào**. `secrets/` không bị git theo dõi. Chỉ có `sb_publishable_*` là khoá
  công khai cố ý.
- **Đối chiếu escrow**: công thức `escrow = giá bán − phí sàn − voucher shop`
  khớp 99,6% trên 1.521 đơn.

## Đã bổ sung: tab "Tự soát dữ liệu"
Cơ sở hạ tầng > **Tự soát dữ liệu** — 9 phép kiểm chạy lại mỗi lần mở trang, mỗi
phép kiểm là một lỗi đã từng có thật ở đợt này. Lần sau lỗi quay lại thì thấy ngay
chứ không phải audit tay lần nữa. Badge trên tab đếm số phép kiểm chưa đạt.

## Bẫy đã gặp khi audit (để lần sau nhanh hơn)
- Bấm tab ngành ở màn Ngành hàng **đổi luôn bộ lọc toàn cục** → kịch bản sau bị
  nhiễm. Phải reset bộ lọc giữa các kịch bản.
- Input tìm kiếm **không có attribute `type`** nên `input[type=text]` không khớp;
  phải dùng `.filters input`.
- ErrorBoundary render ra class `.err-panel`, không phải `fallback` — dò sai
  selector thì báo "không lỗi" một cách sai.
- Vòng quét async chạy quá lâu thì công cụ hết thời gian chờ nhưng **vòng lặp vẫn
  chạy trong trang** và làm mọi lệnh sau đó nghẽn → phải reload để dừng.

## Bổ sung 09/09/2026 — kiểm bản local có mới nhất chưa
Anh Louis hỏi bản local đã mới nhất chưa. Ba nơi, ba trạng thái khác nhau:

| Nơi | Trạng thái lúc kiểm (09/09 16:21) |
|---|---|
| Code local | mới nhất (git sạch ở `5a3d1d7`) |
| **Dữ liệu local** | **cũ 29,1 giờ** — kết xuất 08/09 11:15, 2.217 đơn |
| Supabase | 2.236 đơn |
| Link công khai | 2.236 đơn — **đã mới** |

Nguyên nhân: GitHub Actions chỉ ghi vào Supabase và nhánh `gh-pages`, **không ghi
dữ liệu về máy này**. Nên `src/data/*.json` ở local đứng ở lần kết xuất tay gần
nhất. Đồng bộ bằng `python3 scripts/shopee/export_app_data.py` (kéo từ Supabase,
không cần gọi Shopee) — sau khi chạy: 2.240 đơn, cảnh báo tắt.

Bộ báo động sửa hôm 08/09 hoạt động đúng trong tình huống thật: hiện
"Chậm nhịp · kết xuất cách đây 29,1 giờ". Nhưng câu giải thích lúc đó chỉ đúng cho
bản đã deploy ("lượt chạy đã lỗi"), sai với bản local — đã tách hai nhánh theo
`location.hostname`.

### Cron của GitHub Actions trễ có hệ thống
Đo 4 lượt: **lượt nào cũng trễ 1,9-4,4 giờ** so với lịch đặt.

| Đặt lịch | Chạy thực | Trễ |
|---|---|---|
| 12:00 | 08/09 16:18 | 4,3 h |
| 20:00 | 09/09 00:08 | 4,1 h |
| 06:00 | 09/09 07:55 | 1,9 h |
| 12:00 | 09/09 16:21 | 4,4 h |

Đây là đặc tính của `schedule` trên Actions (best-effort, xếp hàng theo tải), không
sửa được bằng code. Hệ quả: khoảng cách thực giữa hai lượt là 7,8-8,4 giờ, mà ngưỡng
cảnh báo đang là 9 giờ — chỉ dư 0,6 giờ. **Đã nâng `SLA_H` 9 -> 11 giờ**, vẫn bắt
được lượt bị bỏ hẳn (bỏ một lượt thì khoảng cách nhảy lên ~16 giờ).

Nếu cần dữ liệu đúng giờ sáng thì phải đặt cron sớm hơn để bù độ trễ, hoặc chuyển
job sang nơi chạy đúng giờ — không phải Actions.
