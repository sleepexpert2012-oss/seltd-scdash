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

Quy ước nhãn biểu đồ toàn app: biểu đồ từ 2 chỉ số trở lên phải có legend;
biểu đồ 2 trục ghi rõ `(trái)`/`(phải)` và đơn vị trong nhãn.
Chỉ số tự tính (Shopee KHÔNG có): **Chất lượng đơn · ROAS thật · ROAS hoà vốn · TACOS · LN sau ads**.
Cửa sổ dữ liệu 2026-04 → nay (API ads chỉ lưu ~5 tháng).

## Đưa lên mạng (2026-09-07)
| Mục | Giá trị |
|---|---|
| Repo | https://github.com/sleepexpert2012-oss/seltd-scdash — **PUBLIC** |
| Bản chạy | https://sleepexpert2012-oss.github.io/seltd-scdash/ |
| Deploy | `./scripts/pages/deploy.sh` — build rồi đẩy `dist/` lên nhánh `gh-pages` |

Không dùng GitHub Actions vì token account này thiếu scope `workflow`.
File workflow giữ sẵn ở `scripts/pages/github-actions-deploy.yml.txt`.

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
