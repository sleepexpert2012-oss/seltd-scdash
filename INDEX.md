# SELTD Supply Chain Dashboard — INDEX

Mã nguồn app báo cáo Supply Chain (chạy local). Đặt ngoài OneDrive vì preview server không đọc được thư mục CloudStorage.

| Đường dẫn | Vai trò |
|---|---|
| `src/styles/tokens.css` | Design token kế thừa báo cáo mẫu 1 (màu, font, radius, shadow) |
| `src/screens/Login.jsx` + `login.css` | Màn hình đăng nhập — đã duyệt |
| `src/app/AppShell.jsx` + `shell.css` | **Màn hình 0 — khung app**: sidebar · topbar · vùng nội dung |
| `src/app/nav.js` | Cấu trúc menu (4 nhóm) |
| `src/app/FilterBar.jsx` | Thanh bộ lọc toàn cục + preset kỳ |
| `src/app/Icon.jsx` | Bộ icon SVG dùng chung |
| `src/data/master.json` | Dữ liệu sản phẩm thật, sinh từ Master Data.xlsx |
| `scripts/extract_master.py` | Script trích Excel → JSON (chạy lại khi Excel đổi) |
| `src/screens/Overview.jsx` + `overview.css` | **Màn hình 1 — Tổng quan**: 10 KPI · 3 chart xu hướng · Top 10 SKU |
| `src/screens/Category.jsx` + `category.css` | **Màn hình 2 — Ngành hàng**: tab 5 ngành · 8 KPI · nhìn nhanh · xu hướng · loại hình · NCC · **bảng theo kích thước** · bảng SKU |
| `src/screens/Range.jsx` + `range.css` | **Màn hình 3 — Range Review**: tổng quan ngành · ma trận Loại hình × Phân khúc · chi tiết ô · bảng hành động |
| `src/screens/Matrix.jsx` + `matrix.css` | **Màn hình 4 — Ma trận sản phẩm**: Ngành × NCC × bậc giá, ô = loại hình |
| `src/screens/Supplier.jsx` + `supplier.css` | **Màn hình 5 — NCC & Mua hàng** (layout mẫu 2): KPI Σ PO/NCC/tập trung/cần rà giá · 3 tab · nhịp PO · danh sách NCC · NCC theo ngành · so sánh giá · công nợ — dữ liệu PO THẬT |
| `src/screens/Stock.jsx` + `stock.css` | **Màn hình 6 — Tồn kho & Đặt hàng** (layout mẫu 2): dải phạm vi · 5 KPI · chip 6 trạng thái · 5 tab: tổng quan kho · chi tiết loại hình & SKU · tuổi tồn · tổng hợp hành động · tham số |
| `src/data/stock_mock.json` · `scripts/gen_mock_stock.py` | **TỒN KHO GIẢ** (snapshot 2026.09) |
| `src/screens/Forecast.jsx` + `forecast.css` | **Màn hình 7 — Forecast & Kế hoạch** (layout mẫu 2): 3 chart tổng quan cả năm luôn hiển thị · 4 tab: kế hoạch đặt hàng · S&OP · dự báo 6 tháng · phương pháp |
| `src/app/shell.css` (khối `m2-*`) | Bố cục dùng chung theo mẫu 2: tiêu đề trang, tabs có icon, dải KPI liền khối, panel tiêu đề uppercase, bảng header navy |
| `src/screens/Calendar.jsx` + `calendar.css` | **Màn hình 8 — Lịch bán hàng**: heatmap ngày trong tháng · nhịp theo thứ · top ngày · SKU bán trong ngày |
| `src/data/sales_daily_mock.json` · `scripts/gen_mock_daily.py` | **DỮ LIỆU NGÀY GIẢ** — phân bổ từ sales_mock, tổng tháng giữ nguyên |
| `src/screens/Guide.jsx` + `guide.css` | **Màn hình 12 — Giới thiệu & Định nghĩa**: 4 tab (app này là gì · từ điển 44 chỉ số có tìm kiếm + cột Cạm bẫy · đọc từng màn · quy ước & giới hạn) |
| `src/screens/Infra.jsx` tab *Tự soát dữ liệu* | 9 phép kiểm chất lượng dữ liệu, tính lại mỗi lần mở trang — sinh ra từ đợt audit 08/09/2026 |
| `src/screens/Pnl.jsx` + `pnl.css` | **Màn hình 11 — Lãi lỗ**: thác nước GMV→lãi lỗ (SVG tự vẽ) · 6 tab: tiền rơi ở đâu · theo tháng · phí sàn · vì sao lãi đổi · ngành & SKU · cách tính |
| `src/screens/ClassModal.jsx` + `classModal.css` | **Màn phụ — Class Dashboard**: drill-down 4 phần, mở từ mọi màn |
| `src/app/drill.jsx` | Context mở/đóng màn phụ |
| `src/app/ErrorBoundary.jsx` | Chặn lỗi một màn làm trắng cả app |
| `src/lib/metrics.js` · `src/lib/format.js` | Lọc, tổng hợp KPI, chuỗi tháng, top SKU, định dạng số |
| `src/data/sales_mock.json` | **DỮ LIỆU BÁN HÀNG GIẢ** — sinh bằng `scripts/gen_mock_sales.py` |
| `scripts/gen_mock_sales.py` | Sinh dữ liệu giả (seed cố định 20260906) |
| `src/App.jsx` | Chưa đăng nhập → Login; đã đăng nhập → AppShell |
| `public/logo.png` | Logo Sleep Expert (copy từ thư mục dự án OneDrive) |
| `.claude/launch.json` | Cấu hình dev server (port 5173) |

## Trạng thái theo màn hình
- [x] Đăng nhập — đã duyệt (kèm bảng màu brand)
- [x] Màn 0 — Khung app (sidebar · topbar · filter bar) — đã duyệt
- [x] Màn 1 — Tổng quan — đã duyệt (kèm dải chọn tháng + chips xu hướng)
- [x] Màn 2 — Ngành hàng — đã duyệt
- [x] Màn 3 — Range Review — đã duyệt
- [x] Màn 4 — Ma trận sản phẩm — đã duyệt
- [x] Màn 5 — NCC & Mua hàng — đã duyệt
- [x] Màn 6 — Tồn kho & Đặt hàng — đã duyệt
- [x] Màn 7 — Forecast & Kế hoạch — chờ duyệt
- [x] Màn phụ — Class Dashboard (4 phần) — đã duyệt
- [x] Màn 8 — Lịch bán hàng (Calendar) — chờ duyệt

## Nguồn tham chiếu
- Spec thị giác + cấu trúc + công thức: `SELTD Supply Chain Dashboard/knowledge/spec-hoc-tu-2-web-mau.md` (OneDrive)
- Dữ liệu sản phẩm thật: `SELTD Supply Chain Dashboard/Master Data.xlsx` (OneDrive)
- Dữ liệu bán hàng & tồn kho: **chưa nạp — sẽ dùng dữ liệu giả** cho tới khi chốt xong UI

## Dữ liệu thật — Shopee API → Supabase (cập nhật 2026-09-07)

| Thành phần | Trạng thái |
|---|---|
| Supabase `seltd-supply-chain` (ap-southeast-1) | ✅ schema `shopee`, 11 bảng, RLS bật hết |
| `raw_order` | ✅ 2.226 đơn · 2025-01-15 → nay · 48/48 cột |
| `raw_escrow` | ✅ 1.546 đơn · 84/84 cột `order_income` |
| `raw_return` | ✅ 111 đơn hoàn · 36/36 cột |
| `raw_item` / `raw_model` | ✅ 17 listing / 96 biến thể (84 SKU) |
| `raw_ads_shop_daily` / `_campaign_daily` | ✅ từ 2026-04 (API chỉ lưu ~5 tháng) |
| `dim_sku` | ✅ 143 SKU từ Master Data |
| View `stg_*` / `mart_*` | ✅ 8 view |
| `raw_ads_campaign` | ✅ 64 chiến dịch: item_id, ngân sách, mục tiêu ROAS, trạng thái |
| App đọc dữ liệu thật | ✅ `src/data/sales.json`, `sales_daily.json`, `platform.json`, `stock.json`, `marketing.json` |
| `raw_warehouse` / `raw_stock_snapshot` | ✅ tồn THẬT 4 kho (WH01–WH04), 1.062 unit, chụp ảnh mỗi lần chạy job |
| `sku_alias` | ✅ 22 mã SKU cũ quy về mã hiện hành theo `model_id` — 0 SKU lạc |
| Job 3 khung giờ 06:00 / 12:00 / 20:00 | ✅ launchd `com.seltd.scdash.etl`, đã chạy thử 9/9 bước OK |

### Script (`scripts/shopee/`)
| File | Việc |
|---|---|
| `shopee_client.py` | ký HMAC-SHA256, tự refresh token, retry |
| `db.py` | nối Supabase session pooler, upsert jsonb, ghi `etl_run` |
| `schema.sql` · `mart.sql` | DDL + lớp view phân tích |
| `load_dim_sku.py` | Master Data → `dim_sku` |
| `etl_dim.py` · `etl_order.py` · `etl_escrow.py` · `etl_return.py` · `etl_ads.py` · `etl_stock.py` | kéo từng bảng |
| `schema_stock.sql` · `schema_alias.sql` | DDL tồn kho + bảng đối chiếu mã SKU cũ |
| `export_app_data.py` | Supabase → `src/data/*.json` |
| `run_all.py` | job hằng ngày, gọi tất cả các bước |
| `com.seltd.scdash.etl.plist` | lịch launchd 3 khung giờ |

Nhật ký job: `logs/etl.log` · `logs/etl.err.log`

### Dữ liệu giả đã nghỉ
`obsolete/2026-09/` giữ `sales_mock.json`, `sales_daily_mock.json`, `stock_mock.json`
(kèm `_README.md`). Script sinh vẫn ở `scripts/gen_mock_*.py`. Không xoá trước 2026-12.

### Màn hình 9 — Marketing Analysis (2026-09-07)
`src/screens/Marketing.jsx` + `marketing.css`, nav nhóm *Phân tích kinh doanh*.
Nguồn: `shopee.mart_ads_item_month`, `mart_ads_nganh_month`, `mart_ads_campaign_full`
(file `scripts/shopee/mart_ads.sql`) → `src/data/marketing.json`.

6 tab (segmented control `.mk-tabs`): **Tổng quan** · Theo chiến dịch · Theo sản phẩm ·
Theo ngành hàng · Chẩn đoán & hành động · Cách tính.

Tab Tổng quan giữ 8 biểu đồ: phễu SVG · chi phí & ROAS theo tháng · CTR & CPC ·
CR & chi phí/đơn · lượt xem & lượt click · tỷ lệ thành công đơn ·
ads vs doanh thu & LN · mỗi 100 đồng doanh thu đi đâu.
Phễu và biểu đồ chi phí/ROAS **chỉ xuất hiện ở tab Tổng quan**; các tab cấp dưới
chỉ có biểu đồ của đúng cấp đó (phân tán bong bóng · thanh ngang ghép đôi ·
cột phân kỳ · treemap · thanh 100% phân bổ).

### Màn hình 12 — Giới thiệu & Định nghĩa (2026-09-11)
`src/screens/Guide.jsx` + `guide.css`, nhóm *Tài liệu & Hệ thống*. Thay màn nháp cũ
(ScreenPlaceholder) vốn ghi "sẽ được dựng ở bước kế tiếp" trên link công khai.

4 tab: **App này là gì** (luồng 4 bước · nguồn dữ liệu · mốc dữ liệu · 3 điều nên biết) ·
**Từ điển chỉ số** (44 chỉ số, tìm kiếm + lọc theo 6 nhóm, mỗi dòng có công thức, nguồn
và cột **Cạm bẫy**) · **Đọc từng màn** (11 màn: trả lời câu hỏi gì, có gì, dùng khi nào,
kèm 6 trạng thái tồn) · **Quy ước & giới hạn** (đơn vị, VAT, kỳ so sánh, những gì app
KHÔNG có, và quy trình 4 bước khi thấy số đáng ngờ).

Công thức chép đúng từ `src/lib/metrics.js` và `scripts/shopee/mart*.sql`. **Sửa công
thức trong code thì phải sửa ở đây** — nếu không bảng này thành sai lệch có thẩm quyền,
tệ hơn là không có.

### Menu (2026-09-08)
Ba nhóm: **Phân tích kinh doanh** (Tổng quan · Lịch bán hàng · Ngành hàng · Range Review ·
Ma trận sản phẩm · Marketing Analysis · Lãi lỗ) · **Cung ứng & Kế hoạch** (Nhà cung cấp &
Mua hàng · Tồn kho & Đặt hàng · Forecast & Kế hoạch) · **Tài liệu & Hệ thống**
(Cơ sở hạ tầng · Giới thiệu & Định nghĩa).

Gộp "Mua hàng & Nhà cung cấp" + "Tồn kho & Kế hoạch" thành *Cung ứng & Kế hoạch* theo yêu cầu
anh Louis — ba màn đó đi liền một mạch nghiệp vụ.

### Màn hình 11 — Lãi lỗ (2026-09-08)
`src/screens/Pnl.jsx` + `pnl.css`, nav nhóm *Phân tích kinh doanh*, ngay sau Marketing Analysis.
Nguồn: `src/data/sales.json` (GMV/huỷ/hoàn/giảm giá/doanh thu/giá vốn theo SKU-tháng)
+ `src/data/platform.json` khối `fees` (escrow từng đơn) và `ads`.

**Định nghĩa chốt** — phí sàn = đúng 6 khoản `tong_phi_san`
(hoa hồng + dịch vụ + giao dịch + AMS + campaign + hỗ trợ kỹ thuật).
KHÔNG gộp voucher shop vào phí sàn: nó đã bị trừ ở bước Giảm giá khi tính doanh thu,
gộp lại là tính hai lần. Voucher Shopee tài trợ không phải chi phí của shop.
`seller_transaction_fee` = `credit_card_transaction_fee` ở 100% đơn — chỉ tính một lần.

**Đối chiếu dòng tiền** (dò trên từng đơn, khớp 99,6% ở 1.521 đơn):
`escrow_amount = order_selling_price − phí sàn − voucher_from_seller`.
Phần lệch 0,43% là điều chỉnh lẻ của Shopee, hiện trên màn thành dòng "Chênh lệch";
vượt 2% thì đổi màu đỏ vì nghĩa là escrow có khoản mới chưa vào công thức.

**Phân rã vì sao lãi đổi**: `LN% = GM% − phí sàn% − ads%` nên ba nguyên nhân cộng lại
đúng bằng mức thay đổi LN%, không có phần "còn lại". Tính theo ĐIỂM % trên doanh thu
vì so tiền tuyệt đối giữa hai kỳ khác quy mô thì vô nghĩa.

**Ở cấp ngành/SKU phí là số PHÂN BỔ** theo tỷ trọng doanh thu — Shopee không trả phí
ở cấp SKU. Doanh thu / giá vốn / LN gộp vẫn là số thật. Màn tự hiện dải cảnh báo khi
bộ lọc chiều đang bật.

**Hàng tặng kèm**: dòng bán có giá vốn mà giá bán 0 — bóc riêng thành khối, vì nó nằm
lẫn trong giá vốn nên trước đây không ai thấy (toàn kỳ 25,9tr, riêng 2026 là 10,0tr).

Giới hạn đã ghi rõ trên tab *Cách tính*: chưa có ads trước 2026-04 (API chỉ lưu ~5 tháng)
nên lãi các tháng cũ là chưa trừ ads; chưa có chi phí vận hành nên đây là lãi **đóng góp**,
chưa phải lãi ròng.

Quy ước nhãn biểu đồ toàn app: biểu đồ từ 2 chỉ số trở lên phải có legend;
biểu đồ 2 trục ghi rõ `(trái)`/`(phải)` và đơn vị trong nhãn.
Chỉ số tự tính (Shopee KHÔNG có): **Chất lượng đơn · ROAS thật · ROAS hoà vốn · TACOS · LN sau ads**.
Cửa sổ dữ liệu 2026-04 → nay (API ads chỉ lưu ~5 tháng).

## Đưa lên mạng (2026-09-07)
| Mục | Giá trị |
|---|---|
| Repo | https://github.com/sleepexpert2012-oss/seltd-scdash — **PUBLIC** |
| Bản chạy | https://sleepexpert2012-oss.github.io/seltd-scdash/ |
| Deploy tự động | `.github/workflows/etl.yml` — 06:00 · 12:00 · 20:00 giờ VN: kéo Shopee → build → đẩy `gh-pages` |
| Deploy tay | `./scripts/pages/deploy.sh` — build rồi đẩy `dist/` lên nhánh `gh-pages` |
| Token Shopee | bảng `shopee.oauth_token` trong Supabase (không nằm trong file) |

Chuyển từ launchd sang Actions ngày 08/09/2026: chạy trên laptop thì máy ngủ là mất
lượt, và job cũ không deploy nên link public đứng ở bản cũ dù job vẫn chạy.
Bản workflow cũ chưa dùng đã chuyển vào `obsolete/2026-09/`.

⚠️ Repo public nên toàn bộ `src/data/` (giá vốn, giá mua NCC, công nợ, GM%, tồn kho,
chi phí ads) là công khai. Khoá API KHÔNG bị lộ — `secrets/` đã gitignore và đã kiểm bundle.
Mật khẩu đăng nhập là khoá mềm phía client, không phải bảo mật thật.

Cập nhật số liệu: `python3 scripts/shopee/run_all.py` → commit `src/data/*.json` → push → `./scripts/pages/deploy.sh`.

## Màn hình 10 — Cơ sở hạ tầng (2026-09-07)
`src/screens/Infra.jsx` + `infra.css` · nav nhóm **Tài liệu & Hệ thống**.
4 tab: App hoạt động thế nào · Nguồn dữ liệu · Nhật ký · Hạ tầng & lịch chạy.

Dữ liệu: `src/data/infra.json` (trạng thái 13 bảng, 300 dòng `etl_run`, 60 commit git).
Nhập/kết xuất Excel chạy trong trình duyệt: `src/lib/masterFile.js` (thư viện `xlsx`
nạp động). Bản Excel nạp vào lưu ở `localStorage` qua `src/data/master.js` — đây là
điểm truy cập duy nhất tới Master Data, KHÔNG import trực tiếp `master.json` nữa.

Đã kiểm bộ đọc file bằng test đối chiếu với `scripts/extract_master.py`:
**0 sai lệch trên 2.288 trường SKU và 182 dòng PO.**

## Tồn ảo trên Shopee (2026-09-07)
Shopee được bơm tồn để chạy chiến dịch → tồn API cao hơn thực tế.
`metrics.js`: `STOCK_RAW_BY_SKU` (nguyên bản) → `STOCK_BY_SKU` = tồn Shopee − `PHANTOM`.
Mọi tính toán phía sau đọc `STOCK_BY_SKU` nên tự động chạy trên tồn thật.
Khai báo ở **Tồn kho & Đặt hàng → tab ⚗ Tồn ảo**. SKU nhiều kho: trừ dần từ kho
nhiều nhất. Khai vượt: tồn về 0, không cho âm, có cảnh báo.

**Đồng bộ đám mây** (Supabase, `scripts/shopee/schema_phantom.sql`):
bảng `public.phantom_stock` + log bất biến `public.phantom_stock_log`,
ghi qua hàm `set_phantom()`. Client: `src/lib/cloud.js` (fetch thuần).
`main.jsx` nạp số từ đám mây TRƯỚC khi mount React vì metrics tính tồn lúc khởi tạo.
Mất mạng: dùng cache, rồi tới `src/data/phantom.json`; bấm Lưu sẽ báo lỗi chứ
không ghi ngầm. Có Lịch sử thay đổi + nút Khôi phục.

⚠️ Khoá gọi đám mây là công khai (repo public). anon chỉ đọc/ghi được bảng tồn ảo,
KHÔNG chạm được schema `shopee`. Muốn chặn hẳn thì cần Supabase Auth.

## knowledge/ — thứ cần đọc lại sau này
| File | Nội dung |
|---|---|
| `knowledge/2026-09-08_dong-bo-dut-ma-app-bao-binh-thuong.md` | Chẩn đoán 4 lỗi làm đồng bộ đứng mà app vẫn báo "Bình thường"; chuyển ETL sang GitHub Actions; token Shopee vào bảng `shopee.oauth_token` |
| `knowledge/2026-09-08_audit-toan-bo-app.md` | **Audit toàn app**: 3 lỗi thật đã sửa (doanh thu ngày thiếu voucher · chi phí ads hai mẫu số · kho hàng lỗi tính là hàng bán được), 4 điểm cần biết, bẫy khi audit |
| `knowledge/LESSONS.md` | Bài học dồn theo ngày — mỗi entry: việc · sai gì · sửa gì · rule rút ra |
